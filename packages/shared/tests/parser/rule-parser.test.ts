import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { parseRule, serializeRule, parseRulesFromDoc } from '../../src/parser/rule-parser.ts'
import type { LogicalRule, SimpleRule } from '../../src/types/rule.ts'

// --- parseRule: simple rules --------------------------------------------

test('parses simple DOMAIN-SUFFIX rule', () => {
  const r = parseRule('DOMAIN-SUFFIX,example.com,MyGroup')
  expect(r).toEqual({
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'example.com',
    target: 'MyGroup',
  } as SimpleRule)
})

test('parses simple rule with a modifier (no-resolve)', () => {
  const r = parseRule('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve')
  expect(r).toEqual({
    kind: 'simple',
    type: 'IP-CIDR',
    value: '10.0.0.0/8',
    target: 'DIRECT',
    modifiers: ['no-resolve'],
  } as SimpleRule)
})

test('parses simple rule without modifiers (modifiers omitted, not empty array)', () => {
  const r = parseRule('DOMAIN,example.com,G')
  expect(r).toEqual({ kind: 'simple', type: 'DOMAIN', value: 'example.com', target: 'G' })
  expect((r as SimpleRule).modifiers).toBeUndefined()
})

test('parses GEOIP with no-resolve modifier', () => {
  const r = parseRule('GEOIP,RU,RU трафик,no-resolve')
  expect((r as SimpleRule).type).toBe('GEOIP')
  expect((r as SimpleRule).modifiers).toEqual(['no-resolve'])
})

test('parses RULE-SET rule', () => {
  const r = parseRule('RULE-SET,hagezi_pro,Блокировка рекламы')
  expect((r as SimpleRule).type).toBe('RULE-SET')
  expect((r as SimpleRule).target).toBe('Блокировка рекламы')
})

// --- parseRule: match ---------------------------------------------------

test('parses MATCH rule', () => {
  expect(parseRule('MATCH,Default')).toEqual({ kind: 'match', target: 'Default' })
})

test('parses MATCH rule with spaces in target', () => {
  expect(parseRule('MATCH,Остальной трафик')).toEqual({
    kind: 'match',
    target: 'Остальной трафик',
  })
})

// --- parseRule: logical -------------------------------------------------

test('parses OR rule with two simple children', () => {
  const r = parseRule('OR,((IP-ASN,714),(DOMAIN-SUFFIX,apple.com)),Apple') as LogicalRule
  expect(r.kind).toBe('logical')
  expect(r.op).toBe('OR')
  expect(r.target).toBe('Apple')
  expect(r.children).toHaveLength(2)
  expect(r.children[0]).toEqual({
    kind: 'simple',
    type: 'IP-ASN',
    value: '714',
    target: '',
  })
})

test('parses AND rule with 3 children and a modifier on one child', () => {
  const r = parseRule(
    'AND,((IP-CIDR,34.0.192.0/18,no-resolve),(NETWORK,UDP),(DST-PORT,50000-50100)),X',
  ) as LogicalRule
  expect(r.op).toBe('AND')
  expect(r.children).toHaveLength(3)
  expect((r.children[0] as SimpleRule).modifiers).toEqual(['no-resolve'])
  expect((r.children[1] as SimpleRule).type).toBe('NETWORK')
  expect((r.children[2] as SimpleRule).value).toBe('50000-50100')
})

test('parses nested AND with NOT child', () => {
  const r = parseRule(
    'AND,((DOMAIN-KEYWORD,discord),(NOT,((DOMAIN-SUFFIX,ru)))),DiscordGroup',
  ) as LogicalRule
  expect(r.kind).toBe('logical')
  expect(r.op).toBe('AND')
  expect(r.target).toBe('DiscordGroup')
  expect(r.children).toHaveLength(2)
  const notChild = r.children[1] as LogicalRule
  expect(notChild.kind).toBe('logical')
  expect(notChild.op).toBe('NOT')
  expect(notChild.children).toHaveLength(1)
  expect((notChild.children[0] as SimpleRule).value).toBe('ru')
})

// --- round-trip ---------------------------------------------------------

test('round-trip preservation for the spec samples', () => {
  const samples = [
    'DOMAIN-SUFFIX,example.com,G',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'MATCH,X',
    'AND,((DOMAIN-KEYWORD,a),(NOT,((DOMAIN-SUFFIX,b)))),G',
    'OR,((IP-ASN,714),(DOMAIN-SUFFIX,apple.com)),Apple',
    'AND,((IP-CIDR,34.0.192.0/18,no-resolve),(NETWORK,UDP),(DST-PORT,50000-50100)),X',
    'GEOIP,RU,RU трафик,no-resolve',
    'RULE-SET,hagezi_pro,Блокировка рекламы',
  ]
  for (const s of samples) {
    const parsed = parseRule(s)
    const re = serializeRule(parsed)
    expect(re).toBe(s)
    // idempotent through a second round.
    expect(serializeRule(parseRule(re))).toBe(s)
  }
})

test('deep-equal round-trip on LogicalRule (structural identity)', () => {
  const src = 'OR,((AND,((DOMAIN,a),(DOMAIN,b))),(NOT,((DOMAIN-SUFFIX,c)))),G'
  const parsed = parseRule(src)
  const reParsed = parseRule(serializeRule(parsed))
  expect(reParsed).toEqual(parsed)
})

// --- error handling -----------------------------------------------------

test('rejects empty input', () => {
  expect(() => parseRule('')).toThrow()
})

test('rejects simple rule with unknown type', () => {
  expect(() => parseRule('DOMAIN-BOGUS,x,G')).toThrow()
})

test('rejects logical rule with no target', () => {
  // No trailing ",TARGET" after the children group.
  expect(() => parseRule('AND,((DOMAIN,a),(DOMAIN,b))')).toThrow()
})

test('rejects unbalanced parentheses', () => {
  expect(() => parseRule('AND,((DOMAIN,a),X')).toThrow()
})

// --- parseRulesFromDoc --------------------------------------------------

test('parseRulesFromDoc iterates rules in order with 0-based indices', () => {
  const doc = parseDocument(
    [
      'rules:',
      '  - DOMAIN-SUFFIX,a.com,G',
      '  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      '  - MATCH,X',
    ].join('\n'),
  )
  const list = parseRulesFromDoc(doc)
  expect(list).toHaveLength(3)
  expect(list[0]!.index).toBe(0)
  expect(list[0]!.rule.kind).toBe('simple')
  expect(list[1]!.rule.kind).toBe('simple')
  expect((list[1]!.rule as SimpleRule).modifiers).toEqual(['no-resolve'])
  expect(list[2]!.rule.kind).toBe('match')
})

test('parseRulesFromDoc returns [] when rules key is absent', () => {
  const doc = parseDocument('mode: rule\n')
  expect(parseRulesFromDoc(doc)).toEqual([])
})

test('parseRulesFromDoc handles a logical rule in the list', () => {
  const doc = parseDocument(
    ['rules:', '  - "AND,((IP-ASN,22697),(DST-PORT,49152-65535)),Roblox"', '  - MATCH,X'].join(
      '\n',
    ),
  )
  const list = parseRulesFromDoc(doc)
  expect(list).toHaveLength(2)
  expect(list[0]!.rule.kind).toBe('logical')
  expect((list[0]!.rule as LogicalRule).target).toBe('Roblox')
})
