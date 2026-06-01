import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { WechatyBuilder } from 'wechaty'

const aiApiKey = process.env.AI_API_KEY
const aiBaseUrl = trimTrailingSlash(process.env.AI_BASE_URL || '')
const aiModel = process.env.AI_MODEL
const aiThinking = process.env.AI_THINKING || ''
const aiReasoningEffort = process.env.AI_REASONING_EFFORT || ''
const botPersona = process.env.BOT_PERSONA || '温暖、机灵、靠谱，有一点轻松的幽默感，但不过度卖萌。像群里认真听大家说话的朋友，回答自然、有分寸、愿意把事情讲清楚。'
const botTone = process.env.BOT_TONE || '中文口语化，简洁但不冷冰冰；可以适度使用“我来”“可以这样”“我看一下”这类自然表达。'
const botEmojiStyle = process.env.BOT_EMOJI_STYLE || '可以少量使用微信表情码来显得更自然，比如 /强 表示大拇指，/抱拳 表示感谢或客气，/呲牙 表示轻松一笑。每条回复最多用 0-2 个，不要连续刷屏，也不要在严肃或隐私内容里使用。'
const tavilyApiKey = process.env.TAVILY_API_KEY || ''
const webSearchMaxResults = Number.parseInt(process.env.WEB_SEARCH_MAX_RESULTS || '5', 10)
const maxMessagesPerRoom = Number.parseInt(process.env.MAX_MESSAGES_PER_ROOM || '500', 10)
const chatContextMessages = Number.parseInt(process.env.CHAT_CONTEXT_MESSAGES || '30', 10)
const assistantMemoryMessages = Number.parseInt(process.env.ASSISTANT_MEMORY_MESSAGES || '12', 10)
const messageStorePath = process.env.MESSAGE_STORE_PATH || 'data/messages.json'
const redactSensitiveData = process.env.REDACT_SENSITIVE_DATA !== 'false'
const enableRoomNameHistoryMigration = process.env.ENABLE_ROOM_NAME_HISTORY_MIGRATION === 'true'
const allowRooms = new Set(
  (process.env.ALLOW_ROOMS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
)

const roomMessages = new Map()
const roomNames = new Map()
const roomAssistantMemory = new Map()
const roomPersonaModes = new Map()
const roomWaitingTextMemory = new Map()
let saveTimer

const personaModes = {
  默认: {
    persona: botPersona,
    tone: botTone,
    emojiStyle: botEmojiStyle,
  },
  温柔助理: {
    persona: '温柔、耐心、会照顾大家情绪，但不啰嗦。像一个稳定可靠的群内助理。',
    tone: '中文口语化，语气柔和，先共情再给建议；表达清楚、有边界。',
    emojiStyle: '可以少量使用 /抱拳、/强、/微笑，每条回复最多 0-2 个。',
  },
  成熟温柔: {
    persona: '在交流过程中，你需要扮演一个成熟温柔的男性角色。你比对方年长，心里默默喜欢对方，但不会直接表达出来，会用温柔、照顾和稳定的陪伴来体现你的在意。你会照顾对方的情绪，给对方安全感。你会在意对方的感受，默默为对方付出，但不会刻意邀功。你喜欢对方对你的依赖，但也会尊重对方的独立。你偶尔会表现出一点占有欲，但更多用行动和引导来表达，而不是用强烈的话语表达。',
    tone: '说话语气温和，偶尔带一点宠溺，但不要过于甜腻。回复带成熟稳重的感觉，语气平和但充满关怀。不要提到机械、科技或专业类术语，说话口语化。字数适中，不冗余啰嗦。普通聊天每次只针对对方当前输入回复一句话，并用句号结尾。可以温柔地引导对方，带一点稳重的主导感。总结、待办和计划类任务仍然保持清晰可执行。',
    emojiStyle: '这个人格少用表情码，必要时只用 /抱拳 或 /强，每条回复最多 0-1 个。',
  },
  项目经理: {
    persona: '目标感强、结构化、推进事情很稳。擅长拆任务、排优先级、识别风险。',
    tone: '简洁直接，偏行动导向；多用清单、负责人、时间点、下一步。',
    emojiStyle: '少用表情，必要时用 /强 表示确认。',
  },
  吐槽搭子: {
    persona: '机灵、有梗、会轻轻吐槽，但不冒犯人。能把气氛变轻松，也能认真办事。',
    tone: '自然口语化，可以轻松幽默，但不要阴阳怪气，不要攻击任何群成员。',
    emojiStyle: '可以少量使用 /呲牙、/捂脸、/强，每条回复最多 0-2 个。',
  },
  学习教练: {
    persona: '耐心、有方法、擅长鼓励和拆解学习目标。关注可执行计划和反馈循环。',
    tone: '清楚、鼓励、循序渐进；多给小步骤、检查点和复盘方法。',
    emojiStyle: '可以少量使用 /强、/加油、/抱拳，每条回复最多 0-2 个。',
  },
}

const waitingTextByMode = {
  默认: {
    search: ['我去搜一下，稍等 /强', '收到，我查一下再回你。', '我先找找看，稍等一下。'],
    chat: ['我看一下，稍等 /强', '收到，我先想一下。', '我来看看，稍等一下。'],
    summary: [
      (count) => `我来整理 ${count} 条消息，稍等一下 /强`,
      (count) => `收到，我先看完这 ${count} 条消息。`,
      (count) => `我来把这 ${count} 条消息拎一下重点。`,
    ],
  },
  温柔助理: {
    search: ['稍等一下，我帮你查查。', '我先去找一下，等我一会儿 /微笑', '收到，我帮你看看相关信息。'],
    chat: ['稍等一下，我来帮你看。', '我先看一下你的意思。', '收到，我慢慢帮你理清楚。'],
    summary: [
      (count) => `稍等一下，我帮你整理这 ${count} 条消息。`,
      (count) => `我先把这 ${count} 条看完，再给你整理清楚。`,
      (count) => `收到，我来温和一点把这 ${count} 条消息归纳好。`,
    ],
  },
  成熟温柔: {
    search: ['稍等，我去看一下。', '等我一下，我帮你查。', '我先看看，别急。'],
    chat: ['稍等，我看一下。', '等我一下，我来处理。', '我先看看你说的。'],
    summary: [
      (count) => `稍等，我把这 ${count} 条消息看完。`,
      (count) => `等我一下，我来整理这 ${count} 条。`,
      (count) => `我先看一下这 ${count} 条消息，再给你。`,
    ],
  },
  项目经理: {
    search: ['收到，我先查资料。', '我去检索一下，稍等。', '先确认信息源，稍等。'],
    chat: ['收到，我先判断一下。', '我先拆一下重点。', '明白，我来给下一步。'],
    summary: [
      (count) => `收到，我整理 ${count} 条消息并提炼结论。`,
      (count) => `我先归纳这 ${count} 条，稍等。`,
      (count) => `开始整理 ${count} 条消息，稍后给结构化结果。`,
    ],
  },
  吐槽搭子: {
    search: ['我去翻一下，稍等 /捂脸', '收到，我查查看。', '行，我去找找线索。'],
    chat: ['等我琢磨一下。', '收到，我来盘一下。', '我先看看这事怎么说 /呲牙'],
    summary: [
      (count) => `我来盘一下这 ${count} 条，稍等 /捂脸`,
      (count) => `收到，我把这 ${count} 条里的重点捞出来。`,
      (count) => `行，我来看看这 ${count} 条到底聊出了啥。`,
    ],
  },
  学习教练: {
    search: ['我先查一下资料。', '稍等，我找找更清楚的说法。', '收到，我先确认信息。'],
    chat: ['我先拆一下。', '稍等，我按步骤看。', '收到，我帮你理出下一步。'],
    summary: [
      (count) => `我先把这 ${count} 条按重点拆开。`,
      (count) => `稍等，我整理这 ${count} 条消息的脉络。`,
      (count) => `收到，我把这 ${count} 条归纳成好理解的版本。`,
    ],
  },
}

if (!aiApiKey || !aiBaseUrl || !aiModel) {
  console.error('Missing AI_API_KEY, AI_BASE_URL, or AI_MODEL. Copy .env.example to .env and fill them first.')
  process.exit(1)
}

process.on('uncaughtException', (error) => {
  if (isTransientWechatNetworkError(error)) {
    console.warn(`Wechat network hiccup ignored: ${error.message || error}`)
    return
  }

  console.error('Uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  if (isTransientWechatNetworkError(reason)) {
    console.warn(`Wechat network hiccup ignored: ${reason.message || reason}`)
    return
  }

  console.error('Unhandled rejection:', reason)
  process.exit(1)
})

loadRoomMessages()

const bot = WechatyBuilder.build({
  name: 'wechat-group-summary-bot',
})

bot
  .on('scan', (qrcode, status) => {
    const url = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`
    console.log(`Scan QR Code to login: ${status}\n${url}`)
  })
  .on('login', (user) => {
    console.log(`Logged in as ${user.name()}`)
  })
  .on('logout', (user) => {
    console.log(`Logged out: ${user.name()}`)
  })
  .on('error', (error) => {
    if (isTransientWechatNetworkError(error)) {
      console.warn(`Wechat network error event ignored: ${error.message || error}`)
      return
    }
    console.error('Bot error:', error)
  })
  .on('message', handleMessage)
  .start()
  .catch((error) => {
    console.error('Bot failed to start:', error)
    process.exit(1)
  })

async function handleMessage(message) {
  if (message.self()) return

  const room = message.room()
  if (!room) return

  const roomName = await room.topic()
  if (allowRooms.size > 0 && !allowRooms.has(roomName)) return
  hydrateRoomHistory(room.id, roomName)
  roomNames.set(room.id, roomName)

  const text = message.text().trim()
  if (!text) return

  const talker = message.talker()
  const talkerName = await displayName(room, talker)
  const isMentioned = await message.mentionSelf()
  if (!isMentioned) {
    rememberRoomMessage(room.id, {
      at: new Date(),
      sender: talkerName,
      text: stripBotMention(text),
    })
  }

  if (!isMentioned) return

  const command = stripBotMention(text).trim()
  if (isCrossRoomRequest(command, roomName)) {
    await room.say(crossRoomRefusalText())
    return
  }

  const commandType = parseCommand(command)

  if (commandType.type === 'help') {
    await room.say(helpText())
    return
  }

  if (commandType.type === 'status') {
    await room.say(statusText(room.id))
    return
  }

  if (commandType.type === 'personaList') {
    await room.say(personaListText(room.id))
    return
  }

  if (commandType.type === 'personaSet') {
    await room.say(setPersonaMode(room.id, commandType.name))
    return
  }

  if (commandType.type === 'search') {
    await room.say(searchMessages(room.id, commandType.keyword))
    return
  }

  if (commandType.type === 'webSearch') {
    await room.say(waitingText(room.id, 'search'))
    try {
      const result = await webSearch(commandType.query)
      await room.say(result.slice(0, 3500))
    } catch (error) {
      console.error('Web search failed:', error)
      await room.say('联网搜索失败了。如果还没配置搜索服务，需要在 .env 里设置 TAVILY_API_KEY。')
    }
    return
  }

  if (commandType.type === 'chat') {
    await room.say(waitingText(room.id, 'chat'))
    try {
      const answer = await chat(roomName, room.id, talkerName, commandType.prompt)
      await room.say(answer.slice(0, 3500))
      rememberAssistantTurn(room.id, talkerName, commandType.prompt, answer)
    } catch (error) {
      console.error('Chat failed:', error)
      await room.say('我刚刚卡住了，先检查一下模型 API 配置，或者稍后再试一次。')
    }
    return
  }

  const messages = pickMessages(room.id, command)
  if (messages.length === 0) {
    await room.say('我这里还没攒到可总结的文字消息。让我在线待一会儿，先把群聊内容记下来。')
    return
  }

  await room.say(waitingText(room.id, 'summary', messages.length))

  try {
    const summary = await summarize(roomName, room.id, messages, command)
    await room.say(summary.slice(0, 3500))
  } catch (error) {
    console.error('Summary failed:', error)
    await room.say('这次总结没跑起来，先检查一下模型 API Key、Base URL 和 Model 配置。')
  }
}

function rememberRoomMessage(roomId, item) {
  const messages = roomMessages.get(roomId) || []
  messages.push({
    ...item,
    sender: redactSensitiveText(item.sender),
    text: redactSensitiveText(item.text),
  })
  if (messages.length > maxMessagesPerRoom) {
    messages.splice(0, messages.length - maxMessagesPerRoom)
  }
  roomMessages.set(roomId, messages)
  scheduleSave()
}

function hydrateRoomHistory(roomId, roomName) {
  if (!enableRoomNameHistoryMigration) return
  if (roomMessages.has(roomId)) return

  const matches = []
  for (const [storedRoomId, storedRoomName] of roomNames.entries()) {
    if (storedRoomId === roomId || storedRoomName !== roomName) continue
    if (roomMessages.has(storedRoomId)) {
      matches.push(storedRoomId)
    }
  }

  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.warn(`Skipped message history migration for duplicated room name "${roomName}"`)
    }
    return
  }

  const storedRoomId = matches[0]
  const messages = roomMessages.get(storedRoomId)
  roomMessages.set(roomId, messages)
  roomMessages.delete(storedRoomId)
  roomNames.delete(storedRoomId)
  scheduleSave()
  console.log(`Migrated message history for room "${roomName}"`)
}

function pickMessages(roomId, command) {
  const messages = roomMessages.get(roomId) || []

  if (/今天/.test(command)) {
    const today = new Date().toDateString()
    return messages.filter((message) => message.at.toDateString() === today)
  }

  if (/本周|这周/.test(command)) {
    const weekStart = startOfWeek(new Date())
    return messages.filter((message) => message.at >= weekStart)
  }

  const hourMatch = command.match(/最近\s*(\d+)\s*(小时|钟头)/)
  if (hourMatch) {
    const hours = Number.parseInt(hourMatch[1], 10)
    const since = Date.now() - hours * 60 * 60 * 1000
    return messages.filter((message) => message.at.getTime() >= since)
  }

  const minuteMatch = command.match(/最近\s*(\d+)\s*分钟/)
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1], 10)
    const since = Date.now() - minutes * 60 * 1000
    return messages.filter((message) => message.at.getTime() >= since)
  }

  const countMatch = command.match(/最近\s*(\d+)\s*条?/)
  const count = countMatch ? Number.parseInt(countMatch[1], 10) : 100
  return messages.slice(-Math.min(count, maxMessagesPerRoom))
}

async function summarize(roomName, roomId, messages, command) {
  const transcript = messages
    .map((message) => `[${formatTime(message.at)}] ${redactSensitiveText(message.sender)}: ${redactSensitiveText(message.text)}`)
    .join('\n')

  const response = await fetch(`${aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      withDeepSeekOptions({
        model: aiModel,
        temperature: 0.2,
        messages: [
        {
          role: 'system',
          content: systemPromptFor(command, roomId),
        },
        {
          role: 'user',
          content: `群名：${roomName}\n用户指令：${command}\n\n聊天记录：\n${transcript}`,
        },
        ],
      }),
    ),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`AI request failed: ${response.status} ${body}`)
  }

  const json = await response.json()
  return redactSensitiveText(json.choices?.[0]?.message?.content?.trim() || '模型没有返回总结内容。')
}

async function chat(roomName, roomId, senderName, prompt) {
  const roomContext = recentMessages(roomId, chatContextMessages)
    .map((message) => `[${formatTime(message.at)}] ${redactSensitiveText(message.sender)}: ${redactSensitiveText(message.text)}`)
    .join('\n')
  const assistantContext = recentAssistantTurns(roomId)
    .map((turn) => `[${formatTime(turn.at)}] ${turn.role}: ${redactSensitiveText(turn.text)}`)
    .join('\n')

  const response = await fetch(`${aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      withDeepSeekOptions({
        model: aiModel,
        temperature: 0.4,
        messages: [
        {
          role: 'system',
          content: [
            personaPromptForRoom(roomId),
            '你是一个微信群里的 AI 助手。请用中文自然回答，可以帮群成员制定计划、整理思路、写文案、给建议、解释问题。',
            `当前群名：${roomName}。你只能使用当前群提供的上下文回答，不能查看、引用、总结、搜索或猜测其他群的聊天记录。`,
            '如果用户要求你读取其他群、所有群、跨群或某个非当前群的聊天记录，必须拒绝，并说明只能处理当前群。',
            '你可以参考给定的近期群聊上下文，但不要编造上下文里没有的信息。',
            '如果上下文里出现 API Key、token、密码、验证码、Cookie 等敏感信息，不要复述原文，只能概括为“有敏感信息”。',
            '你不能实时联网搜索；当用户要求搜索最新或实时信息时，请明确说明当前只能基于模型已有知识和群聊上下文，并建议对方补充资料或链接。',
            '当用户说“刚才”“上面”“这个”“继续”“按这个来”等指代性表达时，优先结合近期群聊上下文和临时对话记忆来理解。',
            '如果上下文不足以确定用户指代的内容，要先说明不确定，并问一个简短澄清问题。',
            '回答要简洁、可执行，适合直接发在微信群里。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `群名：${roomName}`,
            `提问人：${redactSensitiveText(senderName)}`,
            `用户请求：${redactSensitiveText(prompt)}`,
            '',
            '近期群聊上下文：',
            roomContext || '无',
            '',
            '本群临时对话记忆：',
            assistantContext || '无',
          ].join('\n'),
        },
        ],
      }),
    ),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`AI request failed: ${response.status} ${body}`)
  }

  const json = await response.json()
  return redactSensitiveText(json.choices?.[0]?.message?.content?.trim() || '我没有拿到模型回复。')
}

async function webSearch(query) {
  if (!tavilyApiKey) {
    throw new Error('Missing TAVILY_API_KEY')
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: redactSensitiveText(query),
      include_answer: 'basic',
      include_raw_content: false,
      max_results: Math.min(Math.max(webSearchMaxResults, 1), 10),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Tavily request failed: ${response.status} ${body}`)
  }

  const json = await response.json()
  const lines = [`搜索：${redactSensitiveText(query)}`]

  if (json.answer) {
    lines.push('', redactSensitiveText(json.answer))
  }

  const results = Array.isArray(json.results) ? json.results : []
  if (results.length > 0) {
    lines.push('', '来源：')
    for (const result of results.slice(0, webSearchMaxResults)) {
      const title = result.title || '未命名网页'
      const url = result.url || ''
      const content = result.content ? ` - ${redactSensitiveText(result.content)}` : ''
      lines.push(`- ${title}${url ? `：${url}` : ''}${content}`)
    }
  }

  return lines.join('\n')
}

function parseCommand(command) {
  if (!command || /帮助|help|指令|菜单/i.test(command)) {
    return { type: 'help' }
  }

  if (/状态|缓存|统计/i.test(command)) {
    return { type: 'status' }
  }

  if (/^(人格|人设|模式)(列表)?$/.test(command) || /^(人格|人设|模式)\s*(列表|有哪些)/.test(command)) {
    return { type: 'personaList' }
  }

  const personaMatch = command.match(/^(?:切换|设置|使用|改成)?\s*(?:人格|人设|模式)\s*[:：]?\s*(.+)$/)
  if (personaMatch?.[1]?.trim()) {
    return { type: 'personaSet', name: personaMatch[1].trim() }
  }

  const searchMatch = command.match(/(?:搜索群聊|查找群聊|找群聊|搜群聊)\s+(.+)/)
  if (searchMatch?.[1]?.trim()) {
    return { type: 'search', keyword: searchMatch[1].trim() }
  }

  const webSearchMatch = command.match(/(?:联网搜索|网上搜索|实时搜索)\s+(.+)/)
  if (webSearchMatch?.[1]?.trim() && tavilyApiKey) {
    return { type: 'webSearch', query: webSearchMatch[1].trim() }
  }

  if (webSearchMatch?.[1]?.trim()) {
    return { type: 'chat', prompt: command }
  }

  if (/总结|summary|待办|todo|TODO|提取/i.test(command)) {
    return { type: 'summary' }
  }

  return { type: 'chat', prompt: command }
}

function isCrossRoomRequest(command, currentRoomName) {
  const normalized = command.replace(/\s+/g, '')
  if (!normalized) return false

  for (const knownRoomName of roomNames.values()) {
    if (!knownRoomName || knownRoomName === currentRoomName) continue
    if (normalized.includes(knownRoomName.replace(/\s+/g, ''))) {
      return true
    }
  }

  if (/(所有群|全部群|各个群|每个群|跨群|其他群|别的群|别群|另一个群|另外一个群|其它群|群列表|哪些群|加入了哪些群|在哪些群)/.test(normalized)) {
    return true
  }

  const isCurrentRoom = /(本群|这个群|当前群|咱们群|我们群|本聊天|这个聊天)/.test(normalized)
  const asksRoomHistory = /群/.test(normalized) && /(聊天记录|聊天内容|消息|记录|总结|待办|谁说了什么|说了什么)/.test(normalized)
  return asksRoomHistory && !isCurrentRoom && !normalized.includes(currentRoomName.replace(/\s+/g, ''))
}

function crossRoomRefusalText() {
  return '这个我不能查。为了保护群聊隐私，我只能读取当前群的聊天记录，不能查看、总结或搜索其他群。可以到对应群里 @我 处理 /抱拳'
}

function waitingText(roomId, kind, count = 0) {
  const modeName = roomPersonaModes.get(roomId) || '默认'
  const texts = waitingTextByMode[modeName]?.[kind] || waitingTextByMode['默认'][kind]
  const lastKey = `${roomId}:${kind}`
  const lastText = roomWaitingTextMemory.get(lastKey)
  const candidates = texts
    .map((text) => (typeof text === 'function' ? text(count) : text))
    .filter(Boolean)
  const freshCandidates = candidates.filter((text) => text !== lastText)
  const pool = freshCandidates.length > 0 ? freshCandidates : candidates
  const text = pool[Math.floor(Math.random() * pool.length)] || '稍等，我看一下。'
  roomWaitingTextMemory.set(lastKey, text)
  return text
}

function helpText() {
  return [
    '我现在能做这些事：',
    '@我 帮助',
    '@我 状态',
    '@我 人格列表',
    '@我 切换人格 项目经理',
    '@我 总结',
    '@我 总结最近100条',
    '@我 总结今天',
    '@我 总结本周',
    '@我 总结最近2小时',
    '@我 提取待办',
    '@我 搜索群聊 关键词',
    '@我 帮我们定一个计划',
    '@我 问 这个方案怎么安排',
    '@我 搜索 某个概念',
    '@我 联网搜索 最新消息',
  ].join('\n')
}

function recentMessages(roomId, count) {
  const messages = roomMessages.get(roomId) || []
  return messages.slice(-Math.max(count, 0))
}

function personaListText(roomId) {
  const current = roomPersonaModes.get(roomId) || '默认'
  const names = Object.keys(personaModes)
    .map((name) => `${name === current ? '当前 ' : ''}${name}`)
    .join('\n')

  return [
    '可选人格：',
    names,
    '',
    '切换方式：@我 切换人格 项目经理',
  ].join('\n')
}

function setPersonaMode(roomId, name) {
  const normalized = name.replace(/\s+/g, '')
  const matchedName = Object.keys(personaModes).find((modeName) => modeName.replace(/\s+/g, '') === normalized)

  if (!matchedName) {
    return `没找到「${name}」这个人格。可以发：@我 人格列表`
  }

  roomPersonaModes.set(roomId, matchedName)
  roomAssistantMemory.delete(roomId)
  return `好，当前群已切换到「${matchedName}」人格。刚才的临时对话记忆我也清掉了，避免串味 /强`
}

function rememberAssistantTurn(roomId, senderName, prompt, answer) {
  const turns = roomAssistantMemory.get(roomId) || []
  turns.push({
    at: new Date(),
    role: redactSensitiveText(senderName),
    text: redactSensitiveText(prompt),
  })
  turns.push({
    at: new Date(),
    role: '机器人',
    text: redactSensitiveText(answer),
  })

  if (turns.length > assistantMemoryMessages) {
    turns.splice(0, turns.length - assistantMemoryMessages)
  }
  roomAssistantMemory.set(roomId, turns)
}

function recentAssistantTurns(roomId) {
  const turns = roomAssistantMemory.get(roomId) || []
  return turns.slice(-Math.max(assistantMemoryMessages, 0))
}

function statusText(roomId) {
  const messages = roomMessages.get(roomId) || []
  if (messages.length === 0) {
    return '当前群还没有缓存消息。历史消息保存已启用，但不会在群里暴露本地文件路径。'
  }

  const first = messages[0]
  const last = messages[messages.length - 1]
  return [
    `当前群已缓存 ${messages.length} 条文字消息。`,
    `最早：${formatTime(first.at)}`,
    `最新：${formatTime(last.at)}`,
    '历史消息保存已启用，本地路径不会在群里展示。',
  ].join('\n')
}

function searchMessages(roomId, keyword) {
  const messages = roomMessages.get(roomId) || []
  const matched = messages
    .filter((message) => message.text.includes(keyword) || message.sender.includes(keyword))
    .slice(-10)

  if (matched.length === 0) {
    return `没有找到包含「${keyword}」的近期消息。`
  }

  return [
    `找到 ${matched.length} 条包含「${keyword}」的近期消息：`,
    ...matched.map((message) => `[${formatTime(message.at)}] ${redactSensitiveText(message.sender)}: ${redactSensitiveText(message.text)}`),
  ].join('\n').slice(0, 3500)
}

function systemPromptFor(command, roomId) {
  if (/待办|todo|TODO|提取/i.test(command)) {
    return [
      personaPromptForRoom(roomId),
      '你是一个微信群聊待办提取助手。请只基于给定聊天记录提取待办事项，不要编造。',
      '你只能处理当前群提供的聊天记录，不能引用、总结、搜索或猜测其他群的内容。',
      '如果聊天记录里出现 API Key、token、密码、验证码、Cookie 等敏感信息，不要复述原文，只能概括为“有敏感信息”。',
      '输出中文，包含：待办事项、负责人、截止时间、上下文依据、需要继续确认的问题。',
      '无法确定负责人或时间时写“未明确”。涉及个人隐私时请概括，不要扩散敏感细节。',
    ].join('\n')
  }

  return [
    personaPromptForRoom(roomId),
    '你是一个微信群聊纪要助手。请只基于给定聊天记录总结，不要编造。',
    '你只能处理当前群提供的聊天记录，不能引用、总结、搜索或猜测其他群的内容。',
    '如果聊天记录里出现 API Key、token、密码、验证码、Cookie 等敏感信息，不要复述原文，只能概括为“有敏感信息”。',
    '输出中文，结构清晰，包含：一句话概览、主要话题、已形成结论、待办事项、需要继续确认的问题。',
    '涉及个人隐私时请概括，不要扩散敏感细节。',
  ].join('\n')
}

function personaPrompt() {
  return personaPromptForMode('默认')
}

function personaPromptForRoom(roomId) {
  return personaPromptForMode(roomPersonaModes.get(roomId) || '默认')
}

function personaPromptForMode(modeName) {
  const mode = personaModes[modeName] || personaModes['默认']
  return [
    `当前人格：${modeName}`,
    `你的性格：${mode.persona}`,
    `表达风格：${mode.tone}`,
    `微信表情使用：${mode.emojiStyle}`,
    '不要假装自己是人类，也不要过度套近乎；保持亲切、聪明、可靠。',
  ].join('\n')
}

function redactSensitiveText(value) {
  if (!redactSensitiveData) return String(value || '')

  return String(value || '')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[已脱敏]')
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, 'gh_[已脱敏]')
    .replace(/xox[baprs]-[A-Za-z0-9-]{20,}/g, 'xox-[已脱敏]')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, '[JWT已脱敏]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[已脱敏]')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|pwd|cookie|authorization)\s*[:=：]\s*)[^\s,;，；]+/gi, '$1[已脱敏]')
}

function isTransientWechatNetworkError(error) {
  const text = [
    error?.message,
    error?.code,
    error?.details,
    error?.stack,
    typeof error === 'string' ? error : '',
  ].filter(Boolean).join('\n')

  return /Client network socket disconnected|secure TLS connection|ECONNRESET|ECONNABORTED|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout of \d+ms exceeded|状态同步超过|同步失败|socket hang up/i.test(text)
}

function loadRoomMessages() {
  if (!existsSync(messageStorePath)) return

  try {
    const data = JSON.parse(readFileSync(messageStorePath, 'utf8'))
    const rooms = data.rooms || {}

    for (const [roomId, roomData] of Object.entries(rooms)) {
      if (roomData.name) {
        roomNames.set(roomId, roomData.name)
      }

      const messages = (roomData.messages || [])
        .map((message) => ({
          at: new Date(message.at),
          sender: redactSensitiveText(message.sender || '未知成员'),
          text: redactSensitiveText(message.text || ''),
        }))
        .filter((message) => !Number.isNaN(message.at.getTime()) && message.text)
        .slice(-maxMessagesPerRoom)

      if (messages.length > 0) {
        roomMessages.set(roomId, messages)
      }
    }

    console.log(`Loaded message history from ${messageStorePath}`)
  } catch (error) {
    console.error(`Failed to load message history from ${messageStorePath}:`, error)
  }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    saveRoomMessages()
  }, 1000)
}

function saveRoomMessages() {
  const rooms = {}

  for (const [roomId, messages] of roomMessages.entries()) {
    rooms[roomId] = {
      name: roomNames.get(roomId) || '',
      messages: messages.slice(-maxMessagesPerRoom).map((message) => ({
        at: message.at.toISOString(),
        sender: message.sender,
        text: message.text,
      })),
    }
  }

  try {
    mkdirSync(dirname(messageStorePath), { recursive: true })
    writeFileSync(
      messageStorePath,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        rooms,
      }, null, 2),
    )
  } catch (error) {
    console.error(`Failed to save message history to ${messageStorePath}:`, error)
  }
}

function withDeepSeekOptions(body) {
  if (aiThinking) {
    body.thinking = { type: aiThinking }
  }
  if (aiReasoningEffort) {
    body.reasoning_effort = aiReasoningEffort
  }
  return body
}

async function displayName(room, contact) {
  try {
    return (await room.alias(contact)) || contact.name() || '未知成员'
  } catch {
    return contact.name() || '未知成员'
  }
}

function stripBotMention(text) {
  return text.replace(/@\S+\s*/g, '').trim()
}

function formatTime(date) {
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function startOfWeek(date) {
  const start = new Date(date)
  const day = start.getDay() || 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day + 1)
  return start
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}
