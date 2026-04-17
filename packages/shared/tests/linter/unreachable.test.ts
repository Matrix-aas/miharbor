import { expect, test } from 'bun:test'
import { detectUnreachable } from '../../src/linter/unreachable.ts'
import { parseRule } from '../../src/parser/rule-parser.ts'
import type { Rule } from '../../src/types/rule.ts'

// Tiny helper: turn an array of raw mihomo rule strings into the indexed form
// `detectUnreachable` expects. `index` is the position in the global
// `rules:` array — we keep it equal to the array position in tests so the
// `path` parameter in each Issue is predictable.
const rules = (arr: string[]): { index: number; rule: Rule }[] =>
  arr.map((s, i) => ({ index: i, rule: parseRule(s) }))

// --- Shadowing ------------------------------------------------------------

test('detects DOMAIN-SUFFIX shadowed by broader suffix', () => {
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,com,A', 'DOMAIN-SUFFIX,example.com,B']))
  expect(issues.length).toBe(1)
  expect(issues[0]!.code).toBe('LINTER_UNREACHABLE_RULE')
  expect(issues[0]!.path).toEqual(['rules', 1])
  expect((issues[0]!.params as { covered_by_index: number }).covered_by_index).toBe(0)
})

test('no issue when narrower-to-broader same target', () => {
  // Rules with same target — technically a downstream rule is reachable
  // because the narrower one already catches its inputs before the broader
  // runs; we don't flag it.
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,example.com,A', 'DOMAIN-SUFFIX,com,A']))
  expect(issues).toEqual([])
})

test('detects DOMAIN-KEYWORD shadow (substring containment)', () => {
  const issues = detectUnreachable(
    rules(['DOMAIN-KEYWORD,google,A', 'DOMAIN-KEYWORD,google-mail,B']),
  )
  expect(issues.some((i) => i.code === 'LINTER_UNREACHABLE_RULE' && i.path[1] === 1)).toBe(true)
})

// --- Duplicates ------------------------------------------------------------

test('detects duplicate rule', () => {
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,x.ru,A', 'DOMAIN-SUFFIX,x.ru,A']))
  expect(issues.length).toBe(1)
  expect(issues[0]!.code).toBe('LINTER_DUPLICATE_RULE')
  expect(issues[0]!.path).toEqual(['rules', 1])
  expect((issues[0]!.params as { duplicate_of_index: number }).duplicate_of_index).toBe(0)
})

test('duplicate with different target is not an exact duplicate', () => {
  // Different target → not LINTER_DUPLICATE_RULE; shadowing rules for
  // DOMAIN-SUFFIX only trigger when narrower (.endsWith), not when equal.
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,x.ru,A', 'DOMAIN-SUFFIX,x.ru,B']))
  expect(issues).toEqual([])
})

// --- MATCH ----------------------------------------------------------------

test('ignores MATCH rule above and flags what follows as unreachable', () => {
  const issues = detectUnreachable(rules(['MATCH,default', 'DOMAIN-SUFFIX,x.ru,A']))
  expect(issues.length).toBe(1)
  expect(issues[0]!.code).toBe('LINTER_UNREACHABLE_RULE')
  expect(issues[0]!.path).toEqual(['rules', 1])
  expect((issues[0]!.params as { reason: string }).reason).toBe('match_above')
})

test('MATCH at the end is fine', () => {
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,x.ru,A', 'MATCH,default']))
  expect(issues).toEqual([])
})

// --- Happy path ------------------------------------------------------------

test('no issues for a diverse valid rule list', () => {
  const issues = detectUnreachable(
    rules([
      'DOMAIN-SUFFIX,example.com,A',
      'DOMAIN-SUFFIX,other.org,B',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      'GEOIP,RU,DIRECT,no-resolve',
      'MATCH,default',
    ]),
  )
  expect(issues).toEqual([])
})

test('empty rules list → no issues', () => {
  expect(detectUnreachable([])).toEqual([])
})

test('only flags nearest (first-seen) covering rule, not every ancestor', () => {
  // Two possible covering rules; we should emit exactly one Issue for index 2,
  // pointing at the closest ancestor (index 0 — both would match, break on first).
  const issues = detectUnreachable(
    rules(['DOMAIN-SUFFIX,com,A', 'DOMAIN-SUFFIX,net,B', 'DOMAIN-SUFFIX,example.com,C']),
  )
  expect(issues.length).toBe(1)
  expect(issues[0]!.path).toEqual(['rules', 2])
  expect((issues[0]!.params as { covered_by_index: number }).covered_by_index).toBe(0)
})
