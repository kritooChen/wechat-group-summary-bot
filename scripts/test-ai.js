import 'dotenv/config'

const aiApiKey = process.env.AI_API_KEY
const aiBaseUrl = trimTrailingSlash(process.env.AI_BASE_URL || '')
const aiModel = process.env.AI_MODEL
const aiThinking = process.env.AI_THINKING || ''
const aiReasoningEffort = process.env.AI_REASONING_EFFORT || ''

if (!aiApiKey || !aiBaseUrl || !aiModel) {
  console.error('Missing AI_API_KEY, AI_BASE_URL, or AI_MODEL. Copy .env.example to .env and fill them first.')
  process.exit(1)
}

const body = {
  model: aiModel,
  messages: [
    { role: 'system', content: '你是一个简洁的中文助手。' },
    { role: 'user', content: '回复一句话：DeepSeek 配置成功。' },
  ],
  stream: false,
}

if (aiThinking) {
  body.thinking = { type: aiThinking }
}

if (aiReasoningEffort) {
  body.reasoning_effort = aiReasoningEffort
}

const response = await fetch(`${aiBaseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${aiApiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

if (!response.ok) {
  const text = await response.text()
  console.error(`AI request failed: ${response.status}`)
  console.error(text)
  process.exit(1)
}

const json = await response.json()
console.log(json.choices?.[0]?.message?.content?.trim() || 'No content returned.')

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}
