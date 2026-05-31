import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const timeoutMs = Number.parseInt(process.env.WECHAT4U_TIMEOUT_MS || '180000', 10)
const files = [
  {
    path: join('node_modules', 'wechat4u', 'lib', 'util', 'request.js'),
    patches: [
      {
        name: 'timeout',
        pattern: /defaults\.timeout = (?:1000 \* 60|\d+);/,
        replacement: `defaults.timeout = ${timeoutMs};`,
      },
    ],
  },
  {
    path: join('node_modules', 'wechat4u', 'src', 'util', 'request.js'),
    patches: [
      {
        name: 'timeout',
        pattern: /defaults\.timeout = (?:1000 \* 60|\d+)/,
        replacement: `defaults.timeout = ${timeoutMs}`,
      },
    ],
  },
  {
    path: join('node_modules', 'wechat4u', 'lib', 'util', 'conf.js'),
    patches: [
      {
        name: 'synccheck host override',
        pattern: /conf\.API_synccheck = 'https:\/\/' \+ pushUrl \+ '\/cgi-bin\/mmwebwx-bin\/synccheck';/,
        replacement:
          "var synccheckHost = process.env.WECHAT4U_SYNCCHECK_HOST || pushUrl;\n  conf.API_synccheck = 'https://' + synccheckHost + '/cgi-bin/mmwebwx-bin/synccheck';",
      },
    ],
  },
  {
    path: join('node_modules', 'wechat4u', 'src', 'util', 'conf.js'),
    patches: [
      {
        name: 'synccheck host override',
        pattern: /conf\.API_synccheck = 'https:\/\/' \+ pushUrl \+ '\/cgi-bin\/mmwebwx-bin\/synccheck'/,
        replacement:
          "let synccheckHost = process.env.WECHAT4U_SYNCCHECK_HOST || pushUrl\n  conf.API_synccheck = 'https://' + synccheckHost + '/cgi-bin/mmwebwx-bin/synccheck'",
      },
    ],
  },
]

for (const file of files) {
  if (!existsSync(file.path)) continue

  let content = readFileSync(file.path, 'utf8')
  let changed = false

  for (const patch of file.patches) {
    if (content.includes(patch.replacement)) {
      console.log(`wechat4u ${patch.name} already patched: ${file.path}`)
      continue
    }

    if (!patch.pattern.test(content)) {
      console.warn(`wechat4u ${patch.name} patch skipped, pattern not found: ${file.path}`)
      continue
    }

    content = content.replace(patch.pattern, patch.replacement)
    changed = true
    console.log(`wechat4u ${patch.name} patched: ${file.path}`)
  }

  if (changed) {
    writeFileSync(file.path, content)
  }
}
