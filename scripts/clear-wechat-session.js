import { existsSync, renameSync } from 'node:fs'

const memoryFile = 'wechat-group-summary-bot.memory-card.json'

if (!existsSync(memoryFile)) {
  console.log('No Wechaty memory card found.')
  process.exit(0)
}

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-')

const backupFile = `${memoryFile}.${stamp}.bak`
renameSync(memoryFile, backupFile)
console.log(`Moved ${memoryFile} to ${backupFile}`)
