// Test idempotency: after first canonicalization, does a second round-trip drift further?
import { readFileSync, writeFileSync } from 'node:fs'
import { parseDocument } from 'yaml'

const CONFIG_PATH = '/Users/matrix/WebstormProjects/server-install/mihomo-configs/config-server.yaml'
const original = readFileSync(CONFIG_PATH, 'utf8')

const DUMP_OPTS: any = {
  lineWidth: 0,
  minContentWidth: 0,
  flowCollectionPadding: false,
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
  doubleQuotedMinMultiLineLength: 999999,
}

// Step 1: canonicalize once
const d1 = parseDocument(original)
const canonical = d1.toString(DUMP_OPTS)
writeFileSync('/tmp/poc3-canonical.yaml', canonical)

// Step 2: parse canonical again, dump — should be identical
const d2 = parseDocument(canonical)
const canonical2 = d2.toString(DUMP_OPTS)
writeFileSync('/tmp/poc3-canonical2.yaml', canonical2)

const diff = Bun.spawnSync(['diff', '-u', '/tmp/poc3-canonical.yaml', '/tmp/poc3-canonical2.yaml'])
const diffText = diff.stdout.toString()
console.log('=== IDEMPOTENCY CHECK: canonical → canonical2 ===')
console.log(diffText || '  ✓ IDENTICAL — formatting is stable after canonicalization')
console.log('')

// Step 3: now mutate canonical copy, serialize — diff against canonical should be ONLY the change
{
  const d = parseDocument(canonical)
  d.setIn(['dns', 'ipv6'], true)
  const mutated = d.toString(DUMP_OPTS)
  writeFileSync('/tmp/poc3-mutated.yaml', mutated)
  const mdiff = Bun.spawnSync(['diff', '-u', '/tmp/poc3-canonical.yaml', '/tmp/poc3-mutated.yaml'])
  const mdiffText = mdiff.stdout.toString()
  const added = (mdiffText.match(/^\+[^+]/gm) || []).length
  const removed = (mdiffText.match(/^-[^-]/gm) || []).length
  console.log(`=== CASE A: canonical → canonical + dns.ipv6 flip ===`)
  console.log(`  +${added} / -${removed} lines`)
  console.log(mdiffText.split('\n').filter(l => /^[+-][^+-]/.test(l)).join('\n'))
  console.log('')
}

// Step 4: mutate - add rule
{
  const d = parseDocument(canonical)
  const rules: any = d.getIn(['rules'])
  const idx = rules.items.findIndex((it: any) => (it?.value ?? it) === 'GEOSITE,notion,Notion')
  rules.items.splice(idx + 1, 0, d.createNode('DOMAIN-SUFFIX,notion.so,Notion'))
  const mutated = d.toString(DUMP_OPTS)
  writeFileSync('/tmp/poc3-mutated2.yaml', mutated)
  const mdiff = Bun.spawnSync(['diff', '-u', '/tmp/poc3-canonical.yaml', '/tmp/poc3-mutated2.yaml'])
  const mdiffText = mdiff.stdout.toString()
  const added = (mdiffText.match(/^\+[^+]/gm) || []).length
  const removed = (mdiffText.match(/^-[^-]/gm) || []).length
  console.log(`=== CASE B: canonical → canonical + add DOMAIN-SUFFIX,notion.so,Notion ===`)
  console.log(`  +${added} / -${removed} lines`)
  console.log(mdiffText.split('\n').filter(l => /^[+-][^+-]/.test(l)).join('\n'))
  console.log('')
}

// Step 5: mutate — delete proxy-group
{
  const d = parseDocument(canonical)
  const groups: any = d.getIn(['proxy-groups'])
  const idx = groups.items.findIndex((it: any) => it?.get?.('name') === 'Gemini')
  groups.items.splice(idx, 1)
  const mutated = d.toString(DUMP_OPTS)
  writeFileSync('/tmp/poc3-mutated3.yaml', mutated)
  const mdiff = Bun.spawnSync(['diff', '-u', '/tmp/poc3-canonical.yaml', '/tmp/poc3-mutated3.yaml'])
  const mdiffText = mdiff.stdout.toString()
  const added = (mdiffText.match(/^\+[^+]/gm) || []).length
  const removed = (mdiffText.match(/^-[^-]/gm) || []).length
  console.log(`=== CASE C: canonical → canonical - proxy-group Gemini ===`)
  console.log(`  +${added} / -${removed} lines`)
  console.log(mdiffText.split('\n').filter(l => /^[+-][^+-]/.test(l)).join('\n'))
  console.log('')
}

// Step 6: Verify critical comments are preserved
const criticalComments = [
  'DISABLED for first rollout',
  'MUST NOT be :53',
  'Prevent self-intercept',
  'Runbook 1.4',
  'Runbook hard rule',
  'runbook 13.3 pt 1',
]
console.log('=== COMMENT PRESERVATION CHECK ===')
for (const cmt of criticalComments) {
  const inOriginal = original.includes(cmt)
  const inCanonical = canonical.includes(cmt)
  console.log(`  "${cmt}": original=${inOriginal ? '✓' : '✗'}, canonical=${inCanonical ? '✓' : '✗'}`)
}

// Step 7: Verify all 420 lines of logical content preserved (parse both, compare JSON)
const originalJson = JSON.stringify(parseDocument(original).toJS(), null, 0)
const canonicalJson = JSON.stringify(parseDocument(canonical).toJS(), null, 0)
console.log(`\n=== SEMANTIC EQUIVALENCE CHECK ===`)
console.log(`  original bytes: ${original.length}, canonical bytes: ${canonical.length}`)
console.log(`  semantic equivalence (parsed JSON): ${originalJson === canonicalJson ? '✓ IDENTICAL' : '✗ DIFFERENT'}`)
if (originalJson !== canonicalJson) {
  console.log(`  original JSON length: ${originalJson.length}, canonical JSON length: ${canonicalJson.length}`)
}
