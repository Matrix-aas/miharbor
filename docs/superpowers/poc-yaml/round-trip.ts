import { readFileSync, writeFileSync } from 'node:fs'
import { parseDocument, Document } from 'yaml'

const CONFIG_PATH = '/Users/matrix/WebstormProjects/server-install/mihomo-configs/config-server.yaml'

const original = readFileSync(CONFIG_PATH, 'utf8')
const doc = parseDocument(original)

function dumpCase(label: string, content: string, target: string) {
  writeFileSync(target, content)
  const diff = Bun.spawnSync(['diff', '-u', CONFIG_PATH, target])
  const diffText = diff.stdout.toString() || '(no diff)'
  const lineCount = diffText.split('\n').length
  const addedLines = (diffText.match(/^\+[^+]/gm) || []).length
  const removedLines = (diffText.match(/^-[^-]/gm) || []).length
  console.log(`=== ${label} ===`)
  console.log(`diff size: ${lineCount} lines total, +${addedLines} / -${removedLines}`)
  console.log(`first 40 lines of diff:\n${diffText.split('\n').slice(0, 40).join('\n')}`)
  console.log('')
}

// 1. Pure round-trip: load → dump without any change
{
  const d = parseDocument(original)
  dumpCase('CASE 1: pure round-trip (no changes)', d.toString(), '/tmp/poc-case1.yaml')
}

// 2. Add a new proxy-group (flow-mapping style expected to match existing)
{
  const d = parseDocument(original)
  const groups: any = d.getIn(['proxy-groups'])
  if (groups) {
    const newGroup = d.createNode({ name: 'Miro', type: 'select', proxies: ['🇳🇱 Нидерланды', 'DIRECT'] })
    groups.items.splice(15, 0, newGroup)
  }
  dumpCase('CASE 2: add new proxy-group Miro at index 15', d.toString(), '/tmp/poc-case2.yaml')
}

// 3. Remove one rule (DOMAIN-SUFFIX,avito.ru,DIRECT — line 265)
{
  const d = parseDocument(original)
  const rules: any = d.getIn(['rules'])
  if (rules) {
    // find the 'DOMAIN-SUFFIX,avito.ru,DIRECT' item index
    const idx = rules.items.findIndex((it: any) => {
      const v = it?.value ?? it
      return typeof v === 'string' && v === 'DOMAIN-SUFFIX,avito.ru,DIRECT'
    })
    if (idx >= 0) {
      rules.items.splice(idx, 1)
    }
  }
  dumpCase('CASE 3: remove rule DOMAIN-SUFFIX,avito.ru,DIRECT', d.toString(), '/tmp/poc-case3.yaml')
}

// 4. Add rule DOMAIN-SUFFIX,notion.so,Notion to 'Service-specific' block
{
  const d = parseDocument(original)
  const rules: any = d.getIn(['rules'])
  if (rules) {
    // insert after GEOSITE,notion,Notion rule
    const idx = rules.items.findIndex((it: any) => {
      const v = it?.value ?? it
      return typeof v === 'string' && v === 'GEOSITE,notion,Notion'
    })
    if (idx >= 0) {
      rules.items.splice(idx + 1, 0, d.createNode('DOMAIN-SUFFIX,notion.so,Notion'))
    }
  }
  dumpCase('CASE 4: add rule DOMAIN-SUFFIX,notion.so,Notion', d.toString(), '/tmp/poc-case4.yaml')
}

// 5. Change value in DNS section — toggle dns.ipv6
{
  const d = parseDocument(original)
  d.setIn(['dns', 'ipv6'], true)
  dumpCase('CASE 5: change dns.ipv6 false → true', d.toString(), '/tmp/poc-case5.yaml')
}

// 6. Delete a proxy-group that has inline-mapping (Gemini, line 177)
{
  const d = parseDocument(original)
  const groups: any = d.getIn(['proxy-groups'])
  if (groups) {
    const idx = groups.items.findIndex((it: any) => {
      const name = it?.get?.('name')
      return name === 'Gemini'
    })
    if (idx >= 0) {
      groups.items.splice(idx, 1)
    }
  }
  dumpCase('CASE 6: delete proxy-group Gemini', d.toString(), '/tmp/poc-case6.yaml')
}
