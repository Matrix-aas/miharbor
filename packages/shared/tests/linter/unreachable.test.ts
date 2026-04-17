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

// --- Suggestions (Task 49) ---

test('unreachable rule issue includes suggestion', () => {
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,com,A', 'DOMAIN-SUFFIX,example.com,B']))
  expect(issues.length).toBe(1)
  const issue = issues[0]!
  expect(issue.suggestion).toBeDefined()
  expect(issue.suggestion?.key).toBe('suggestion_unreachable_rule_shadowed')
  expect(issue.suggestion?.params).toEqual({ covered_by_index: 0 })
})

test('duplicate rule issue includes suggestion', () => {
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,x.ru,A', 'DOMAIN-SUFFIX,x.ru,A']))
  expect(issues.length).toBe(1)
  const issue = issues[0]!
  expect(issue.code).toBe('LINTER_DUPLICATE_RULE')
  expect(issue.suggestion).toBeDefined()
  expect(issue.suggestion?.key).toBe('suggestion_duplicate_rule')
  expect(issue.suggestion?.params).toEqual({ duplicate_of_index: 0 })
})

// --- Edge cases specific to the suffix-trie implementation ---------------
// These guard against accidental false positives introduced by the HF3
// trie optimisation. The reference nested-loop version trivially handled
// them; the trie has to be careful about label boundaries and Unicode.

test('does not shadow on non-boundary prefix match (`com` vs `mcom`)', () => {
  // `DOMAIN-SUFFIX,com` must NOT shadow `DOMAIN-SUFFIX,mcom` — the latter
  // does not end with ".com", only with "com", and mihomo's DOMAIN-SUFFIX
  // semantics require a label boundary.
  const issues = detectUnreachable(rules(['DOMAIN-SUFFIX,com,A', 'DOMAIN-SUFFIX,mcom,B']))
  expect(issues).toEqual([])
})

test('handles Unicode domain values without crashing or false-matching', () => {
  // IDN (Cyrillic). Reversal must preserve code points; trie walk must not
  // mistake any codepoint for '.'.
  const issues = detectUnreachable(
    rules(['DOMAIN-SUFFIX,россия.рф,A', 'DOMAIN-SUFFIX,почта.россия.рф,B']),
  )
  expect(issues.length).toBe(1)
  expect(issues[0]!.code).toBe('LINTER_UNREACHABLE_RULE')
  expect(issues[0]!.path).toEqual(['rules', 1])
})

test('handles very long domain values (>100 chars)', () => {
  const longSuffix = 'a'.repeat(120) + '.example.com'
  const issues = detectUnreachable(
    rules([`DOMAIN-SUFFIX,example.com,A`, `DOMAIN-SUFFIX,${longSuffix},B`]),
  )
  expect(issues.length).toBe(1)
  expect(issues[0]!.path).toEqual(['rules', 1])
})

// --- Performance (HF3) ---------------------------------------------------

test('perf: detectUnreachable on 2000 rules finishes well under 400ms', () => {
  // Generate a representative config: 1000 unique DOMAIN-SUFFIX, 500 unique
  // DOMAIN-KEYWORD, 500 unique IP-CIDR. Verify wall-clock stays under the
  // loose 400ms threshold (well above the ~3ms the optimised impl delivers
  // locally) so shared CI runners don't false-fail. Log actual timing for
  // visibility.
  type Idx = { index: number; rule: ReturnType<typeof parseRule> }
  const fixture: Idx[] = []
  for (let i = 0; i < 1000; i++) {
    fixture.push({
      index: fixture.length,
      rule: parseRule(`DOMAIN-SUFFIX,uniq${i}.example.net,DIRECT`),
    })
  }
  // Keyword values chosen so no keyword is a substring of another: prefix
  // each with a unique marker `_kw_${i}_`.
  for (let i = 0; i < 500; i++) {
    fixture.push({
      index: fixture.length,
      rule: parseRule(`DOMAIN-KEYWORD,_kw_${i}_marker,DIRECT`),
    })
  }
  // IP-CIDR values: spread across /24 subnets so each string is unique.
  for (let i = 0; i < 500; i++) {
    const a = 10 + ((i >> 8) & 0xff)
    const b = i & 0xff
    fixture.push({
      index: fixture.length,
      rule: parseRule(`IP-CIDR,${a}.${b}.0.0/24,DIRECT,no-resolve`),
    })
  }
  // Warm up once — V8 JIT can tilt the first call on shared runners.
  detectUnreachable(fixture)
  const t0 = performance.now()
  const issues = detectUnreachable(fixture)
  const dt = performance.now() - t0
  // Generated fixture has no duplicates or shadows by construction.
  expect(issues).toEqual([])

  console.log(`detectUnreachable(2000 rules): ${dt.toFixed(2)}ms`)
  expect(dt).toBeLessThan(400)
})
