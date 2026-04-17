import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { detectDuplicates } from '../../src/linter/duplicates.ts'
import { parseRulesFromDoc } from '../../src/parser/rule-parser.ts'
import type { Issue } from '../../src/types/issue.ts'

const run = (yaml: string): Issue[] => {
  const doc = parseDocument(yaml)
  return detectDuplicates(doc, parseRulesFromDoc(doc))
}

// --- dangling references --------------------------------------------------

test('dangling proxy-group reference in rule', () => {
  const issues = run(
    [
      'proxy-groups:',
      '  - {name: Real, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - DOMAIN-SUFFIX,example.com,NotExistsGroup',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_DANGLING_GROUP_REFERENCE')
  expect(iss).toBeDefined()
  expect(iss!.level).toBe('error')
  expect(iss!.path).toEqual(['rules', 0])
  expect((iss!.params as { target: string }).target).toBe('NotExistsGroup')
})

test('DIRECT / REJECT targets are not flagged as dangling', () => {
  const issues = run(
    [
      'proxy-groups: []',
      'rules:',
      '  - DOMAIN-SUFFIX,x.com,DIRECT',
      '  - IP-CIDR,0.0.0.0/0,REJECT',
      '  - MATCH,DIRECT',
    ].join('\n'),
  )
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_GROUP_REFERENCE')).toBe(false)
})

test('dangling rule-provider reference', () => {
  const issues = run(
    [
      'rule-providers: {}',
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - RULE-SET,missing_provider,G',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_DANGLING_RULESET_REFERENCE')
  expect(iss).toBeDefined()
  expect(iss!.path).toEqual(['rules', 0])
  expect((iss!.params as { provider: string }).provider).toBe('missing_provider')
})

test('present rule-provider is accepted', () => {
  const issues = run(
    [
      'rule-providers:',
      '  my_rules: {type: http, behavior: domain, url: "https://x/a", path: "./a.mrs", interval: 86400, format: mrs}',
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - RULE-SET,my_rules,G',
    ].join('\n'),
  )
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_RULESET_REFERENCE')).toBe(false)
})

test('proxy-group references missing node', () => {
  const issues = run(
    [
      'proxies: []',
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [NonexistentNode, DIRECT]}',
      'rules:',
      '  - MATCH,G',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_DANGLING_NODE_REFERENCE')
  expect(iss).toBeDefined()
  expect(iss!.path).toEqual(['proxy-groups', 'G', 'proxies'])
  expect((iss!.params as { ref: string }).ref).toBe('NonexistentNode')
})

test('proxy-group referencing another group is fine', () => {
  const issues = run(
    [
      'proxies: []',
      'proxy-groups:',
      '  - {name: Inner, type: select, proxies: [DIRECT]}',
      '  - {name: Outer, type: select, proxies: [Inner, DIRECT]}',
      'rules:',
      '  - MATCH,Outer',
    ].join('\n'),
  )
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_NODE_REFERENCE')).toBe(false)
})

// --- duplicates -----------------------------------------------------------

test('intra-group duplicate DOMAIN-SUFFIX', () => {
  const issues = run(
    [
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - DOMAIN-SUFFIX,example.com,G',
      '  - DOMAIN-SUFFIX,example.com,G',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_INTRA_GROUP_DUPLICATE')
  expect(iss).toBeDefined()
  expect(iss!.level).toBe('warning')
  expect(iss!.path).toEqual(['rules', 1])
  expect((iss!.params as { group: string; key: string }).group).toBe('G')
})

test('same domain in two different groups — warning, cross-group duplicate', () => {
  const issues = run(
    [
      'proxy-groups:',
      '  - {name: A, type: select, proxies: [DIRECT]}',
      '  - {name: B, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - DOMAIN-SUFFIX,x.com,A',
      '  - DOMAIN-SUFFIX,x.com,B',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_CROSS_GROUP_DUPLICATE')
  expect(iss).toBeDefined()
  expect(iss!.level).toBe('warning')
  expect((iss!.params as { firstTarget: string; currentTarget: string }).firstTarget).toBe('A')
  expect((iss!.params as { firstTarget: string; currentTarget: string }).currentTarget).toBe('B')
})

// --- happy path -----------------------------------------------------------

test('happy path: no duplicates, all refs resolve', () => {
  const issues = run(
    [
      'proxies:',
      '  - {name: N1, type: http, server: 1.1.1.1, port: 8080}',
      'rule-providers:',
      '  my_rules: {type: http, behavior: domain, url: "https://x.com/a", path: "./a.mrs", interval: 86400, format: mrs}',
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [N1, DIRECT]}',
      'rules:',
      '  - RULE-SET,my_rules,G',
      '  - MATCH,G',
    ].join('\n'),
  )
  expect(issues).toEqual([])
})

test('empty doc → no issues', () => {
  expect(run('mode: rule\n')).toEqual([])
})

// --- logical rules --------------------------------------------------------

test('dangling target on logical rule is flagged', () => {
  const issues = run(
    [
      'proxy-groups: []',
      'rules:',
      '  - "AND,((DOMAIN-SUFFIX,example.com),(DST-PORT,443)),Ghost"',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_DANGLING_GROUP_REFERENCE')
  expect(iss).toBeDefined()
  expect((iss!.params as { target: string }).target).toBe('Ghost')
})

// --- Suggestions (Task 49) ---

test('dangling group reference includes suggestion', () => {
  const issues = run(
    [
      'proxy-groups:',
      '  - {name: Real, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - DOMAIN-SUFFIX,example.com,NotExistsGroup',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_DANGLING_GROUP_REFERENCE')
  expect(iss).toBeDefined()
  expect(iss!.suggestion).toBeDefined()
  expect(iss!.suggestion?.key).toBe('suggestion_dangling_group_reference')
  expect(iss!.suggestion?.params).toEqual({ target: 'NotExistsGroup' })
})

test('dangling node reference includes suggestion', () => {
  const issues = run(
    [
      'proxies: []',
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [NonexistentNode, DIRECT]}',
      'rules:',
      '  - MATCH,G',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_DANGLING_NODE_REFERENCE')
  expect(iss).toBeDefined()
  expect(iss!.suggestion).toBeDefined()
  expect(iss!.suggestion?.key).toBe('suggestion_dangling_node_reference')
  expect(iss!.suggestion?.params).toEqual({ ref: 'NonexistentNode', group: 'G' })
})

test('intra-group duplicate includes suggestion', () => {
  const issues = run(
    [
      'proxy-groups:',
      '  - {name: G, type: select, proxies: [DIRECT]}',
      'rules:',
      '  - DOMAIN-SUFFIX,example.com,G',
      '  - DOMAIN-SUFFIX,example.com,G',
    ].join('\n'),
  )
  const iss = issues.find((i) => i.code === 'LINTER_INTRA_GROUP_DUPLICATE')
  expect(iss).toBeDefined()
  expect(iss!.suggestion).toBeDefined()
  expect(iss!.suggestion?.key).toBe('suggestion_intra_group_duplicate')
  expect(iss!.suggestion?.params).toEqual({ group: 'G', duplicate_of_index: 0 })
})
