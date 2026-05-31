import { spawnSync } from 'node:child_process'

const checks = [
  ['node', ['--version']],
  ['npm', ['--version']],
]

let failed = false

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    failed = true
    console.log(`x ${command} not found`)
  } else {
    console.log(`ok ${command} ${result.stdout.trim()}`)
  }
}

if (failed) {
  console.log('\nPlease install Node.js from https://nodejs.org/ or Homebrew, then run this check again.')
  process.exit(1)
}

console.log('\nEnvironment looks ready. Next: npm install')
