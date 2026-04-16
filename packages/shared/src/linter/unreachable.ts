// Unreachable rules detector — flags rules that can never fire because an
// earlier rule in the list already matches all of their inputs. Three cases:
//
//   1. Any rule after MATCH is unreachable — MATCH is a catch-all.
//   2. Exact duplicate — same TYPE/VALUE/TARGET (and modifiers) as an earlier
//      rule. Redundant; the later one will never trigger.
//   3. Shadowed — an earlier simple rule covers a strictly wider set than the
//      current one (e.g. DOMAIN-SUFFIX,com shadows DOMAIN-SUFFIX,example.com).
//
// Same target with narrower-first → broader-second is *not* flagged: the
// narrower rule still fires on its own inputs, the broader one catches the
// rest. Different targets with shadowing = warning (not error) because it may
// be unintentional but is sometimes deliberate (e.g. carving a subdomain out
// of a broader GEOSITE group — except we can't tell statically from the
// simple-rule level, so a warning is the right default).
//
// MVP scope: we shadow-check only DOMAIN-SUFFIX (suffix subset), DOMAIN-KEYWORD
// (substring), and exact-value equality for every other simple type. IP-CIDR
// subnet containment is a TODO — it needs proper CIDR math and is noisy on
// configs with GEOIP rules.

import type { Rule, SimpleRule } from '../types/rule.ts'
import type { Issue } from '../types/issue.ts'

type IndexedRule = { index: number; rule: Rule }

/**
 * Detect unreachable / duplicate rules. Input is the result of
 * `parseRulesFromDoc(doc)` or equivalent — a list of parsed rules keyed by
 * their original index in the YAML `rules:` array.
 *
 * Returns at most one Issue per rule; we break on the first match so the
 * "covered by" message points at the nearest ancestor rule (the most useful
 * for a human fix).
 */
export function detectUnreachable(rules: IndexedRule[]): Issue[] {
  const issues: Issue[] = []
  for (let i = 0; i < rules.length; i++) {
    const cur = rules[i]!
    for (let j = 0; j < i; j++) {
      const prev = rules[j]!
      // Case 1: MATCH above — everything below is unreachable.
      if (prev.rule.kind === 'match') {
        issues.push({
          level: 'error',
          code: 'LINTER_UNREACHABLE_RULE',
          path: ['rules', cur.index],
          params: { covered_by_index: prev.index, reason: 'match_above' },
        })
        break
      }
      // Case 2: exact duplicate (same JSON form, including target + modifiers).
      if (isExactDuplicate(prev.rule, cur.rule)) {
        issues.push({
          level: 'warning',
          code: 'LINTER_DUPLICATE_RULE',
          path: ['rules', cur.index],
          params: { duplicate_of_index: prev.index },
        })
        break
      }
      // Case 3: earlier rule covers a strictly wider set → unreachable.
      if (shadows(prev.rule, cur.rule)) {
        issues.push({
          level: 'warning',
          code: 'LINTER_UNREACHABLE_RULE',
          path: ['rules', cur.index],
          params: { covered_by_index: prev.index },
        })
        break
      }
    }
  }
  return issues
}

function isExactDuplicate(a: Rule, b: Rule): boolean {
  // JSON comparison is adequate because our Rule objects are plain data with
  // a fixed key-set per `kind` (see ../types/rule.ts). Key order is stable
  // because we construct objects with a consistent literal shape.
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * True iff `broad` covers a strictly wider set of inputs than `narrow`. Only
 * applies to SimpleRule-vs-SimpleRule. For MATCH we already short-circuit in
 * the caller, and logical rules are too expressive to statically compare in
 * MVP. Target equality doesn't factor in: if the earlier rule routes `*.com`
 * to A, a later `example.com` → B is still unreachable (the packet goes to A
 * first); we emit a warning instead of error because it's often intentional.
 */
function shadows(broad: Rule, narrow: Rule): boolean {
  if (broad.kind !== 'simple' || narrow.kind !== 'simple') return false
  const b: SimpleRule = broad
  const n: SimpleRule = narrow
  if (b.type !== n.type) return false

  if (b.type === 'DOMAIN-SUFFIX') {
    // broad="com" covers "example.com" (ends with ".com") but not "mcom".
    // Also covers an exact equality ("com" shadows "com") — but that path is
    // already flagged as duplicate.
    if (n.value === b.value) return false // duplicate, handled elsewhere
    return n.value.endsWith('.' + b.value)
  }
  if (b.type === 'DOMAIN-KEYWORD') {
    if (n.value === b.value) return false
    return n.value.includes(b.value)
  }
  // TODO: IP-CIDR / IP-CIDR6 subnet containment. For MVP, only exact-value
  // equality is covered (and that goes through `isExactDuplicate`).
  return false
}
