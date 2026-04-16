import { readFileSync, writeFileSync } from 'node:fs'
import { parseDocument } from 'yaml'

const CONFIG_PATH = '/Users/matrix/WebstormProjects/server-install/mihomo-configs/config-server.yaml'
const original = readFileSync(CONFIG_PATH, 'utf8')

// Tuned options to preserve formatting
const DUMP_OPTS: any = {
  lineWidth: 0,                 // no line-wrap
  minContentWidth: 0,           // keep inline comments where they are
  flowCollectionPadding: false, // [80, 443] not [ 80, 443 ]
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
  doubleQuotedMinMultiLineLength: 999999,
}

function dumpCase(label: string, content: string, target: string) {
  writeFileSync(target, content)
  const diff = Bun.spawnSync(['diff', '-u', CONFIG_PATH, target])
  const diffText = diff.stdout.toString() || '(no diff)'
  const addedLines = (diffText.match(/^\+[^+]/gm) || []).length
  const removedLines = (diffText.match(/^-[^-]/gm) || []).length
  console.log(`=== ${label} ===`)
  console.log(`  +${addedLines} / -${removedLines} lines`)
  if (addedLines + removedLines > 0 && addedLines + removedLines < 40) {
    console.log(`  diff:\n${diffText.split('\n').filter(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@')).join('\n')}`)
  } else if (addedLines + removedLines === 0) {
    console.log(`  ✓ PERFECT round-trip`)
  } else {
    console.log(`  first 20 changed lines:\n${diffText.split('\n').filter(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@')).slice(0, 20).join('\n')}`)
  }
  console.log('')
}

// CASE 1: pure round-trip
{
  const d = parseDocument(original)
  dumpCase('CASE 1: pure round-trip (no changes)', d.toString(DUMP_OPTS), '/tmp/poc2-case1.yaml')
}

// CASE 2: add new proxy-group
{
  const d = parseDocument(original)
  const groups: any = d.getIn(['proxy-groups'])
  if (groups) {
    const newGroup = d.createNode({ name: 'Miro', type: 'select', proxies: ['🇳🇱 Нидерланды', 'DIRECT'] })
    groups.items.splice(15, 0, newGroup)
  }
  dumpCase('CASE 2: add proxy-group Miro at index 15', d.toString(DUMP_OPTS), '/tmp/poc2-case2.yaml')
}

// CASE 3: remove rule DOMAIN-SUFFIX,avito.ru,DIRECT
{
  const d = parseDocument(original)
  const rules: any = d.getIn(['rules'])
  if (rules) {
    const idx = rules.items.findIndex((it: any) => {
      const v = it?.value ?? it
      return typeof v === 'string' && v === 'DOMAIN-SUFFIX,avito.ru,DIRECT'
    })
    if (idx >= 0) rules.items.splice(idx, 1)
  }
  dumpCase('CASE 3: remove rule DOMAIN-SUFFIX,avito.ru,DIRECT', d.toString(DUMP_OPTS), '/tmp/poc2-case3.yaml')
}

// CASE 4: add rule after GEOSITE,notion,Notion
{
  const d = parseDocument(original)
  const rules: any = d.getIn(['rules'])
  if (rules) {
    const idx = rules.items.findIndex((it: any) => {
      const v = it?.value ?? it
      return typeof v === 'string' && v === 'GEOSITE,notion,Notion'
    })
    if (idx >= 0) rules.items.splice(idx + 1, 0, d.createNode('DOMAIN-SUFFIX,notion.so,Notion'))
  }
  dumpCase('CASE 4: add rule DOMAIN-SUFFIX,notion.so,Notion', d.toString(DUMP_OPTS), '/tmp/poc2-case4.yaml')
}

// CASE 5: toggle dns.ipv6
{
  const d = parseDocument(original)
  d.setIn(['dns', 'ipv6'], true)
  dumpCase('CASE 5: dns.ipv6 false → true', d.toString(DUMP_OPTS), '/tmp/poc2-case5.yaml')
}

// CASE 6: delete proxy-group Gemini
{
  const d = parseDocument(original)
  const groups: any = d.getIn(['proxy-groups'])
  if (groups) {
    const idx = groups.items.findIndex((it: any) => it?.get?.('name') === 'Gemini')
    if (idx >= 0) groups.items.splice(idx, 1)
  }
  dumpCase('CASE 6: delete proxy-group Gemini', d.toString(DUMP_OPTS), '/tmp/poc2-case6.yaml')
}

// CASE 7: modify a proxy-group — flip Spotify to put DIRECT first
{
  const d = parseDocument(original)
  const groups: any = d.getIn(['proxy-groups'])
  if (groups) {
    const g = groups.items.find((it: any) => it?.get?.('name') === 'Spotify')
    if (g) g.set('proxies', d.createNode(['DIRECT', '🇳🇱 Нидерланды']))
  }
  dumpCase('CASE 7: flip Spotify proxies order (flow-mapping mutation)', d.toString(DUMP_OPTS), '/tmp/poc2-case7.yaml')
}
