// Rule parser — converts raw mihomo-style `rules:` strings into typed Rule
// objects (see ../types/rule.ts) and back. Round-trips are exact for every
// shape we've seen in production configs (SimpleRule, LogicalRule AND/OR/NOT
// arbitrarily nested, MatchRule).
//
// Grammar (informal):
//   Rule := SimpleRule | LogicalRule | MatchRule
//   SimpleRule  := TYPE "," VALUE "," TARGET ("," MODIFIER)*
//   LogicalRule := OP "," "(" ChildList ")" ["," TARGET]
//   MatchRule   := "MATCH" "," TARGET
//   ChildList   := ChildExpr ("," ChildExpr)*
//   ChildExpr   := "(" TYPE "," VALUE ("," MODIFIER)* ")"   -- a "headless" simple predicate
//                | "(" OP "," "(" ChildList ")" ")"         -- nested logical
//
// Important subtleties:
//   * Inside logical children TARGET is not written — it's inherited from the
//     enclosing top-level rule. We model this with `target: ''` on children.
//   * Logical rules appear in two contexts: as a top-level rule (has TARGET)
//     and inside rule-provider payloads (no TARGET). `parseRule` always
//     expects a TARGET; use `parseRuleExpr` (internal) for bare children.
//   * MATCH has exactly one arg (target).

import type { Document } from 'yaml'
import type { Rule, SimpleRule, LogicalOp, SimpleRuleType } from '../types/rule.ts'
import { LOGICAL_OPS, SIMPLE_RULE_TYPES } from '../types/rule.ts'

const LOGICAL_OP_SET: ReadonlySet<string> = new Set<string>(LOGICAL_OPS)
const SIMPLE_TYPE_SET: ReadonlySet<string> = new Set<string>(SIMPLE_RULE_TYPES)

// Split a comma-separated list at top level (depth-0), ignoring commas inside
// any (...) groups. Empty input yields [].
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  if (s.length > 0) out.push(s.slice(start))
  return out.map((p) => p.trim())
}

// Split the *inside* of a "(...)" group into its top-level child expressions
// (each still wrapped in parentheses). Example:
//   "(A,B),(C,D)"  -> ["(A,B)", "(C,D)"]
function splitChildren(inner: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '(') {
      if (depth === 0) start = i
      depth++
    } else if (c === ')') {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(inner.slice(start, i + 1))
        start = -1
      }
    }
  }
  return out
}

// Parse a bare child expression (no target). Accepts:
//   "(TYPE,VALUE[,MOD...])"          -> SimpleRule with target=''
//   "(OP,(CHILDREN))"                -> LogicalRule with target=''
// where CHILDREN is itself a group like "(A),(B),..."
function parseRuleExpr(expr: string): Rule {
  const trimmed = expr.trim()
  if (!(trimmed.startsWith('(') && trimmed.endsWith(')'))) {
    throw new Error(`rule-parser: bare child expression must be wrapped in (...): ${expr}`)
  }
  const inner = trimmed.slice(1, -1)
  // Peek at the head token.
  const firstComma = inner.indexOf(',')
  if (firstComma < 0) throw new Error(`rule-parser: malformed child expression: ${expr}`)
  const head = inner.slice(0, firstComma).trim()
  const rest = inner.slice(firstComma + 1)
  if (LOGICAL_OP_SET.has(head)) {
    // Remainder must be "(CHILD_LIST)" — a single parenthesized group.
    const restTrim = rest.trim()
    if (!(restTrim.startsWith('(') && restTrim.endsWith(')'))) {
      throw new Error(`rule-parser: logical child missing parenthesized children: ${expr}`)
    }
    const childrenInner = restTrim.slice(1, -1)
    const childGroups = splitChildren(childrenInner)
    const children = childGroups.map((g) => parseRuleExpr(g))
    return { kind: 'logical', op: head as LogicalOp, children, target: '' }
  }
  // Simple predicate: TYPE,VALUE[,MOD...]
  const parts = splitTopLevel(inner)
  if (parts.length < 2) throw new Error(`rule-parser: simple child needs TYPE,VALUE: ${expr}`)
  const [type, value, ...modifiers] = parts
  if (!SIMPLE_TYPE_SET.has(type ?? '')) {
    throw new Error(`rule-parser: unknown simple rule type in child: ${type}`)
  }
  const simple: SimpleRule = {
    kind: 'simple',
    type: type as SimpleRuleType,
    value: value ?? '',
    target: '',
    modifiers,
  }
  if (!simple.modifiers?.length) delete simple.modifiers
  return simple
}

export function parseRule(raw: string): Rule {
  const trimmed = String(raw).trim()
  if (trimmed.length === 0) throw new Error('rule-parser: empty rule')

  // MATCH rule — always exactly "MATCH,TARGET".
  if (trimmed.startsWith('MATCH,')) {
    return { kind: 'match', target: trimmed.slice('MATCH,'.length).trim() }
  }

  const firstComma = trimmed.indexOf(',')
  if (firstComma < 0) throw new Error(`rule-parser: rule has no separator: ${raw}`)
  const head = trimmed.slice(0, firstComma).trim()
  const rest = trimmed.slice(firstComma + 1)

  if (LOGICAL_OP_SET.has(head)) {
    // Top-level logical: OP,(CHILDREN),TARGET
    const restTrim = rest.trimStart()
    if (!restTrim.startsWith('(')) {
      throw new Error(`rule-parser: logical rule must open with '(': ${raw}`)
    }
    // Find the matching closing paren for the children group.
    let depth = 0
    let close = -1
    for (let i = 0; i < restTrim.length; i++) {
      const c = restTrim[i]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close < 0) throw new Error(`rule-parser: unbalanced parentheses in: ${raw}`)
    const childrenInner = restTrim.slice(1, close)
    const afterGroup = restTrim.slice(close + 1)
    // Must be ",TARGET" — the remainder after the group.
    if (!afterGroup.startsWith(',')) {
      throw new Error(`rule-parser: logical rule missing target: ${raw}`)
    }
    const target = afterGroup.slice(1).trim()
    if (!target) throw new Error(`rule-parser: logical rule has empty target: ${raw}`)
    const childGroups = splitChildren(childrenInner)
    const children = childGroups.map((g) => parseRuleExpr(g))
    return { kind: 'logical', op: head as LogicalOp, children, target }
  }

  // Simple rule: TYPE,VALUE,TARGET[,MOD...]
  const parts = splitTopLevel(trimmed)
  if (parts.length < 3) throw new Error(`rule-parser: simple rule needs TYPE,VALUE,TARGET: ${raw}`)
  const [type, value, target, ...modifiers] = parts
  if (!SIMPLE_TYPE_SET.has(type ?? '')) {
    throw new Error(`rule-parser: unknown simple rule type: ${type}`)
  }
  const result: SimpleRule = {
    kind: 'simple',
    type: type as SimpleRuleType,
    value: value ?? '',
    target: target ?? '',
    modifiers,
  }
  if (!result.modifiers?.length) delete result.modifiers
  return result
}

// Serialize a rule back to its canonical mihomo string form. Round-trips are
// preserved for every shape supported by `parseRule`.
export function serializeRule(rule: Rule): string {
  if (rule.kind === 'match') return `MATCH,${rule.target}`
  if (rule.kind === 'simple') {
    const mods = rule.modifiers && rule.modifiers.length ? ',' + rule.modifiers.join(',') : ''
    return `${rule.type},${rule.value},${rule.target}${mods}`
  }
  const kids = rule.children.map(serializeChild).join(',')
  return `${rule.op},(${kids}),${rule.target}`
}

function serializeChild(rule: Rule): string {
  if (rule.kind === 'match') {
    // Theoretically invalid (MATCH should never be nested) — but serialize
    // symmetrically so we don't lose data on an unusual input.
    return `(MATCH,${rule.target})`
  }
  if (rule.kind === 'simple') {
    const mods = rule.modifiers && rule.modifiers.length ? ',' + rule.modifiers.join(',') : ''
    return `(${rule.type},${rule.value}${mods})`
  }
  const kids = rule.children.map(serializeChild).join(',')
  return `(${rule.op},(${kids}))`
}

// Helper used by linters and views to iterate a doc's `rules:` array in order.
// Returns { index, rule } pairs; skips nothing, throws on malformed entries
// (callers may catch and surface as an Issue).
export function parseRulesFromDoc(doc: Document): { index: number; rule: Rule }[] {
  const rules = doc.getIn(['rules']) as { items?: unknown[] } | undefined
  if (!rules || !Array.isArray(rules.items)) return []
  return rules.items.map((it, index) => {
    // yaml Scalar nodes have a .value field; plain strings do not.
    const raw =
      typeof it === 'string'
        ? it
        : it && typeof it === 'object' && 'value' in (it as Record<string, unknown>)
          ? String((it as { value: unknown }).value)
          : String(it)
    return { index, rule: parseRule(raw) }
  })
}
