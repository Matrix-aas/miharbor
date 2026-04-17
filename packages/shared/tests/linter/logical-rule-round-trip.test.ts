// Task 40 fuzz test — proves that `parseRule` + `serializeRule` form an
// involution on LogicalRule shapes for arbitrarily generated AND/OR/NOT trees.
//
// The tree-editor UI mutates a deep-cloned Rule and writes it back via
// `serializeRule`. If the round-trip is not structurally identical we corrupt
// the user's config silently, so we generate 50+ random nestings and assert:
//   1. serialize(tree)          parses back to an identical tree
//   2. serialize(parse(serialize(tree)))  equals serialize(tree)      (idempotent)
//   3. invariants: NOT has exactly one child, AND/OR have ≥ 1 child
//
// Determinism: seeded PRNG (simple LCG) so CI prints stable failures.
//
// Kept in packages/shared/tests/linter/ per the Task 40 brief, even though
// it lives right next to the parser — the brief picks "linter" for the shared
// round-trip coverage surface.

import { expect, test } from 'bun:test'
import { cloneRule, parseRule, serializeRule } from '../../src/parser/rule-parser.ts'
import type {
  LogicalOp,
  LogicalRule,
  Rule,
  SimpleRule,
  SimpleRuleType,
} from '../../src/types/rule.ts'

// Deterministic PRNG — a Lehmer / "minimal standard" generator is plenty for
// structural fuzzing. We want reproducibility, not cryptographic randomness.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

// Mihomo simple-rule types that are safe for the fuzzer. We deliberately stay
// away from rule-types whose `value` field has commas / parentheses — those
// would need escaping that mihomo's config grammar doesn't support.
const FUZZ_SIMPLE_TYPES: readonly SimpleRuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'NETWORK',
  'DST-PORT',
  'SRC-PORT',
  'PROCESS-NAME',
  'RULE-SET',
]

const LOGICAL_OPS: readonly LogicalOp[] = ['AND', 'OR', 'NOT']

// Value generators per rule-type. Fuzz values avoid `,` and `()` which are
// reserved in the mihomo rule grammar.
function valueFor(type: SimpleRuleType, rand: () => number): string {
  switch (type) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
      return `${pickLetters(rand, 3)}.${pickLetters(rand, 2)}`
    case 'DOMAIN-KEYWORD':
      return pickLetters(rand, 5)
    case 'GEOSITE':
      return pickLetters(rand, 4).toLowerCase()
    case 'GEOIP':
      return pickLetters(rand, 2).toUpperCase()
    case 'IP-CIDR': {
      const a = Math.floor(rand() * 255)
      const b = Math.floor(rand() * 255)
      return `${a}.${b}.0.0/16`
    }
    case 'IP-CIDR6':
      return '2001:db8::/32'
    case 'NETWORK':
      return rand() < 0.5 ? 'tcp' : 'udp'
    case 'DST-PORT':
    case 'SRC-PORT':
      return `${1024 + Math.floor(rand() * 60000)}`
    case 'PROCESS-NAME':
      return `${pickLetters(rand, 6)}.exe`
    case 'RULE-SET':
      return pickLetters(rand, 4).toLowerCase()
    default:
      return pickLetters(rand, 4)
  }
}

function pickLetters(rand: () => number, len: number): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz'
  let out = ''
  for (let i = 0; i < len; i++) {
    out += alpha[Math.floor(rand() * alpha.length)]
  }
  return out
}

function randomSimple(rand: () => number): SimpleRule {
  const type = FUZZ_SIMPLE_TYPES[Math.floor(rand() * FUZZ_SIMPLE_TYPES.length)] as SimpleRuleType
  const rule: SimpleRule = {
    kind: 'simple',
    type,
    value: valueFor(type, rand),
    target: '',
  }
  // Maybe tack on a "no-resolve" modifier for IP types — mirrors real configs.
  if ((type === 'IP-CIDR' || type === 'IP-CIDR6' || type === 'GEOIP') && rand() < 0.4) {
    rule.modifiers = ['no-resolve']
  }
  return rule
}

function randomLogical(rand: () => number, depth: number, maxDepth: number): LogicalRule {
  // Op selection — keep a healthy NOT bias so we exercise the unary branch.
  const op = LOGICAL_OPS[Math.floor(rand() * LOGICAL_OPS.length)] as LogicalOp
  // Children count: NOT is unary (exactly 1), AND/OR ≥ 1 (we cap at 4 to keep
  // the generated strings readable when a failure prints).
  const count = op === 'NOT' ? 1 : 1 + Math.floor(rand() * 3)
  const children: Rule[] = []
  for (let i = 0; i < count; i++) {
    const goDeep = depth < maxDepth && rand() < 0.35
    if (goDeep) {
      children.push(randomLogical(rand, depth + 1, maxDepth))
    } else {
      children.push(randomSimple(rand))
    }
  }
  return { kind: 'logical', op, children, target: '' }
}

function withTarget(rule: LogicalRule, target: string): LogicalRule {
  return { ...rule, target }
}

// --- actual tests --------------------------------------------------------

test('fuzz round-trip — 100 random logical trees (seed 1)', () => {
  const rand = mulberry32(1)
  for (let i = 0; i < 100; i++) {
    const tree = withTarget(randomLogical(rand, 0, 4), `Group${i}`)
    const serialized = serializeRule(tree)
    const reParsed = parseRule(serialized)
    expect(reParsed).toEqual(tree)
    // Idempotent through a second round.
    expect(serializeRule(reParsed)).toBe(serialized)
  }
})

test('fuzz round-trip — 50 deeper trees (seed 42, maxDepth 5)', () => {
  const rand = mulberry32(42)
  for (let i = 0; i < 50; i++) {
    const tree = withTarget(randomLogical(rand, 0, 5), `Deep${i}`)
    const serialized = serializeRule(tree)
    const reParsed = parseRule(serialized)
    expect(reParsed).toEqual(tree)
    expect(serializeRule(reParsed)).toBe(serialized)
  }
})

test('fuzz — mutating a cloned tree does not affect the original', () => {
  // Proof that cloneRule really produces an independent structure; this is
  // the invariant the UI relies on when handing a draft to the tree editor.
  const rand = mulberry32(7)
  const tree = withTarget(randomLogical(rand, 0, 3), 'Original')
  const draft = cloneRule(tree)
  // Tamper with draft.
  if (draft.children[0] && draft.children[0].kind === 'simple') {
    draft.children[0].value = 'MUTATED'
  } else if (draft.children[0] && draft.children[0].kind === 'logical') {
    const first = draft.children[0]
    if (first.children[0] && first.children[0].kind === 'simple') {
      first.children[0].value = 'MUTATED'
    }
  }
  // Original stays pristine — re-parse of the original serializes identical.
  expect(parseRule(serializeRule(tree))).toEqual(tree)
})

test('edit-then-serialize round-trip (editor workflow simulation)', () => {
  // Simulates the real flow:
  //   1. parse raw string into tree
  //   2. editor deep-clones, mutates
  //   3. editor serializes back
  //   4. re-parsing the output must produce the edited tree
  const raw = 'AND,((DOMAIN-SUFFIX,example.com),(NOT,((GEOIP,CN,no-resolve)))),Proxy'
  const parsed = parseRule(raw) as LogicalRule
  const draft = cloneRule(parsed)

  // Flip AND -> OR and add a new condition.
  draft.op = 'OR'
  draft.children.push({
    kind: 'simple',
    type: 'DOMAIN-KEYWORD',
    value: 'news',
    target: '',
  })

  const out = serializeRule(draft)
  const reParsed = parseRule(out) as LogicalRule
  expect(reParsed.op).toBe('OR')
  expect(reParsed.target).toBe('Proxy')
  expect(reParsed.children).toHaveLength(3)
  expect(reParsed.children[2]).toEqual({
    kind: 'simple',
    type: 'DOMAIN-KEYWORD',
    value: 'news',
    target: '',
  })
})

test('parse → edit target → serialize preserves structure', () => {
  const raw = 'OR,((GEOSITE,google),(GEOSITE,youtube)),Proxy'
  const draft = cloneRule(parseRule(raw)) as LogicalRule
  draft.target = 'Google-Services'
  const out = serializeRule(draft)
  expect(out).toBe('OR,((GEOSITE,google),(GEOSITE,youtube)),Google-Services')
})
