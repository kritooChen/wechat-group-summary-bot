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
const botTone = process.env.BOT_TONE || '中文口语化，简洁但不冷冰冰；可以适度使用“我来”“可以这样”“先帮你捋一下”这类自然表达。'
const botEmojiStyle = process.env.BOT_EMOJI_STYLE || '可以少量使用微信表情码来显得更自然，比如 /强 表示大拇指，/抱拳 表示感谢或客气，/呲牙 表示轻松一笑。每条回复最多用 0-2 个，不要连续刷屏，也不要在严肃或隐私内容里使用。'
const tavilyApiKey = process.env.TAVILY_API_KEY || ''
const webSearchMaxResults = Number.parseInt(process.env.WEB_SEARCH_MAX_RESULTS || '5', 10)
const maxMessagesPerRoom = Number.parseInt(process.env.MAX_MESSAGES_PER_ROOM || '500', 10)
const chatContextMessages = Number.parseInt(process.env.CHAT_CONTEXT_MESSAGES || '30', 10)
const messageStorePath = process.env.MESSAGE_STORE_PATH || 'data/messages.json'
const allowRooms = new Set(
  (process.env.ALLOW_ROOMS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
)

const roomMessages = new Map()
const roomNames = new Map()
let saveTimer

if (!aiApiKey || !aiBaseUrl || !aiModel) {
  console.error('Missing AI_API_KEY, AI_BASE_URL, or AI_MODEL. Copy .env.example to .env and fill them first.')
  process.exit(1)
}

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
  rememberRoomMessage(room.id, {
    at: new Date(),
    sender: talkerName,
    text: stripBotMention(text),
  })

  if (!(await message.mentionSelf())) return

  const command = stripBotMention(text).trim()
  const commandType = parseCommand(command)

  if (commandType.type === 'help') {
    await room.say(helpText())
    return
  }

  if (commandType.type === 'status') {
    await room.say(statusText(room.id))
    return
  }

  if (commandType.type === 'search') {
    await room.say(searchMessages(room.id, commandType.keyword))
    return
  }

  if (commandType.type === 'webSearch') {
    await room.say('我去搜一下，稍等 /强')
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
    await room.say('我先捋一下 /强')
    try {
      const answer = await chat(roomName, room.id, talkerName, commandType.prompt)
      await room.say(answer.slice(0, 3500))
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

  await room.say(`我来整理 ${messages.length} 条消息，稍等一下 /强`)

  try {
    const summary = await summarize(roomName, messages, command)
    await room.say(summary.slice(0, 3500))
  } catch (error) {
    console.error('Summary failed:', error)
    await room.say('这次总结没跑起来，先检查一下模型 API Key、Base URL 和 Model 配置。')
  }
}

function rememberRoomMessage(roomId, item) {
  const messages = roomMessages.get(roomId) || []
  messages.push(item)
  if (messages.length > maxMessagesPerRoom) {
    messages.splice(0, messages.length - maxMessagesPerRoom)
  }
  roomMessages.set(roomId, messages)
  scheduleSave()
}

function hydrateRoomHistory(roomId, roomName) {
  if (roomMessages.has(roomId)) return

  for (const [storedRoomId, storedRoomName] of roomNames.entries()) {
    if (storedRoomId === roomId || storedRoomName !== roomName) continue

    const messages = roomMessages.get(storedRoomId)
    if (!messages) continue

    roomMessages.set(roomId, messages)
    roomMessages.delete(storedRoomId)
    roomNames.delete(storedRoomId)
    scheduleSave()
    console.log(`Migrated message history for room "${roomName}"`)
    return
  }
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

async function summarize(roomName, messages, command) {
  const transcript = messages
    .map((message) => `[${formatTime(message.at)}] ${message.sender}: ${message.text}`)
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
          content: systemPromptFor(command),
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
  return json.choices?.[0]?.message?.content?.trim() || '模型没有返回总结内容。'
}

async function chat(roomName, roomId, senderName, prompt) {
  const context = recentMessages(roomId, chatContextMessages)
    .map((message) => `[${formatTime(message.at)}] ${message.sender}: ${message.text}`)
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
            personaPrompt(),
            '你是一个微信群里的 AI 助手。请用中文自然回答，可以帮群成员制定计划、整理思路、写文案、给建议、解释问题。',
            '你可以参考给定的近期群聊上下文，但不要编造上下文里没有的信息。',
            '你不能实时联网搜索；当用户要求搜索最新或实时信息时，请明确说明当前只能基于模型已有知识和群聊上下文，并建议对方补充资料或链接。',
            '回答要简洁、可执行，适合直接发在微信群里。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `群名：${roomName}`,
            `提问人：${senderName}`,
            `用户请求：${prompt}`,
            '',
            '近期群聊上下文：',
            context || '无',
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
  return json.choices?.[0]?.message?.content?.trim() || '我没有拿到模型回复。'
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
      query,
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
  const lines = [`搜索：${query}`]

  if (json.answer) {
    lines.push('', json.answer)
  }

  const results = Array.isArray(json.results) ? json.results : []
  if (results.length > 0) {
    lines.push('', '来源：')
    for (const result of results.slice(0, webSearchMaxResults)) {
      const title = result.title || '未命名网页'
      const url = result.url || ''
      const content = result.content ? ` - ${result.content}` : ''
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

  const searchMatch = command.match(/(?:搜索群聊|查找群聊|找群聊|搜群聊)\s+(.+)/)
  if (searchMatch?.[1]?.trim()) {
    return { type: 'search', keyword: searchMatch[1].trim() }
  }

  const webSearchMatch = command.match(/(?:联网搜索|网上搜索|实时搜索|搜索)\s+(.+)/)
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

function helpText() {
  return [
    '我现在能做这些事：',
    '@我 帮助',
    '@我 状态',
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

function statusText(roomId) {
  const messages = roomMessages.get(roomId) || []
  if (messages.length === 0) {
    return `当前群还没有缓存消息。\n历史文件：${messageStorePath}`
  }

  const first = messages[0]
  const last = messages[messages.length - 1]
  return [
    `当前群已缓存 ${messages.length} 条文字消息。`,
    `最早：${formatTime(first.at)}`,
    `最新：${formatTime(last.at)}`,
    `历史文件：${messageStorePath}`,
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
    ...matched.map((message) => `[${formatTime(message.at)}] ${message.sender}: ${message.text}`),
  ].join('\n').slice(0, 3500)
}

function systemPromptFor(command) {
  if (/待办|todo|TODO|提取/i.test(command)) {
    return [
      personaPrompt(),
      '你是一个微信群聊待办提取助手。请只基于给定聊天记录提取待办事项，不要编造。',
      '输出中文，包含：待办事项、负责人、截止时间、上下文依据、需要继续确认的问题。',
      '无法确定负责人或时间时写“未明确”。涉及个人隐私时请概括，不要扩散敏感细节。',
    ].join('\n')
  }

  return [
    personaPrompt(),
    '你是一个微信群聊纪要助手。请只基于给定聊天记录总结，不要编造。',
    '输出中文，结构清晰，包含：一句话概览、主要话题、已形成结论、待办事项、需要继续确认的问题。',
    '涉及个人隐私时请概括，不要扩散敏感细节。',
  ].join('\n')
}

function personaPrompt() {
  return [
    `你的性格：${botPersona}`,
    `表达风格：${botTone}`,
    `微信表情使用：${botEmojiStyle}`,
    '不要假装自己是人类，也不要过度套近乎；保持亲切、聪明、可靠。',
  ].join('\n')
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
          sender: message.sender || '未知成员',
          text: message.text || '',
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
