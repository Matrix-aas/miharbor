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
//
// --- Performance (HF3) ---------------------------------------------------
// Historically a nested O(n²) loop. For 2000-rule configs that was ~400ms
// which users could feel on every keystroke in the editor. We now:
//
//   * Exact-duplicate: Map<jsonKey, firstIndex>. O(1) lookup per rule.
//   * DOMAIN-SUFFIX shadow: reverse-suffix trie. Insert reversed values
//     (`example.com` → `moc.elpmaxe`); during walk, every trie node that
//     carries a terminal with the *next input char == '.'* is a shadowing
//     ancestor. Walk time is O(len(value)) per rule, so the full pass is
//     O(total_chars) amortized.
//   * DOMAIN-KEYWORD: still O(k²) within the DOMAIN-KEYWORD subset only.
//     Typical configs have <50 keyword rules so this is well below the
//     aggregate budget. Raising it to a proper substring index (e.g.
//     suffix-automaton / Aho-Corasick) is premature until we see a profile
//     that lists this as the hot path.
//   * IP-CIDR: unchanged (still TODO — subnet containment needs CIDR math).
//
// Output invariant: for any input list, the returned Issue[] is byte-identical
// to the nested-loop reference implementation in `code`, `level`, `path`, and
// `params`. The tie-breaker rule — "report the *earliest* previous rule that
// triggers any of the three conditions" — is preserved by (a) the duplicate
// map always storing the first index, (b) the trie walk scanning the entire
// path and taking min(endIndex) across all boundary-matching terminals, and
// (c) the caller picking min across matchIdx / dupIdx / shadowIdx.

import type { Rule, SimpleRule } from '../types/rule.ts'
import type { Issue } from '../types/issue.ts'

type IndexedRule = { index: number; rule: Rule }

// --- reverse-suffix trie for DOMAIN-SUFFIX ------------------------------
// Storing REVERSED strings lets us walk from root consuming one char at a
// time; a terminal at position p means some earlier rule stored a value whose
// reverse is exactly rev[0..p]. If rev[p] is '.', that earlier value is a
// proper suffix of the current one aligned to a label boundary → shadow.
//
// We use plain objects with a Map<string, Node> for children. A character-
// indexed array would be faster for ASCII but fails on non-ASCII domains
// (IDN / Unicode). Iterate the reversed string by UTF-16 code unit is fine
// because '.' is a single BMP code unit; non-BMP chars never accidentally
// look like '.'.
interface TrieNode {
  children: Map<string, TrieNode>
  endIndex: number // -1 = no terminal
}

function makeNode(): TrieNode {
  return { children: new Map(), endIndex: -1 }
}

function reverseString(s: string): string {
  // Array spread splits by code point (not UTF-16 code unit), preserving
  // surrogate pairs for emoji/non-BMP IDN characters. Slightly slower than
  // the usual split('').reverse().join('') trick but correct for Unicode.
  return [...s].reverse().join('')
}

/**
 * Walk the trie for `value` and return the earliest (smallest) `endIndex`
 * among terminals encountered where the following character in the reversed
 * input is '.' (a label boundary). Returns -1 if no shadowing suffix exists.
 *
 * Then inserts `value` at index `curIndex` if the terminal node at the end
 * of the path is currently unclaimed. If there's already an endIndex at the
 * end (same-value case, a.k.a. exact-value collision), leave it — duplicate
 * detection is handled by the caller via the jsonKey map.
 */
function suffixShadowLookupAndInsert(root: TrieNode, value: string, curIndex: number): number {
  if (value.length === 0) {
    // Empty values are rejected by parseRule, but be defensive: an empty
    // value has no meaningful trie position. Don't insert, don't shadow.
    return -1
  }
  const rev = reverseString(value)
  let node = root
  let best = -1
  for (let i = 0; i < rev.length; i++) {
    const ch = rev[i]!
    // Terminal at the CURRENT node is a shadow candidate iff the next input
    // char is '.'. (If next char doesn't exist we're at the full string,
    // which is the equal-value case — not a shadow.)
    if (node.endIndex !== -1 && ch === '.') {
      if (best === -1 || node.endIndex < best) best = node.endIndex
    }
    let next = node.children.get(ch)
    if (!next) {
      next = makeNode()
      node.children.set(ch, next)
    }
    node = next
  }
  // End of walk: set endIndex at the terminal node if unclaimed. An existing
  // endIndex here means a prior rule had the same value — the caller reports
  // this as exact-duplicate (via the jsonKey map, which also factors in target
  // + modifiers); we preserve the earliest index in the trie regardless.
  if (node.endIndex === -1) node.endIndex = curIndex
  return best
}

/**
 * Detect unreachable / duplicate rules. Input is the result of
 * `parseRulesFromDoc(doc)` or equivalent — a list of parsed rules keyed by
 * their original index in the YAML `rules:` array.
 *
 * Returns at most one Issue per rule, preserving the reference behaviour
 * of reporting the nearest (earliest-index) covering rule.
 */
export function detectUnreachable(rules: IndexedRule[]): Issue[] {
  const issues: Issue[] = []

  // Earliest MATCH rule seen so far (index into `rules`, not rule.index). -1
  // if no MATCH encountered yet. After the first MATCH, every subsequent rule
  // is unreachable and we short-circuit.
  let firstMatchPos = -1

  // Map<jsonKey, earliest-position-in-rules-array>. Position is the array
  // index (`pos`), not the rule's own `.index` field; we convert when
  // emitting the issue params.
  const firstByJson = new Map<string, number>()

  // DOMAIN-SUFFIX trie (root).
  const suffixTrie = makeNode()

  // DOMAIN-KEYWORD rules keep the original O(k²) behaviour but scoped to the
  // keyword subset only. Values are cached alongside the array-position of
  // their first occurrence so we can report the earliest match.
  // Entries are appended in iteration order; a later scan walks from 0..k-1
  // mirroring the reference inner loop over `j < i`.
  type KwEntry = { value: string; pos: number }
  const keywords: KwEntry[] = []

  for (let i = 0; i < rules.length; i++) {
    const cur = rules[i]!

    // --- earliest candidate across the three cases ---------------------
    // Each candidate is the POSITION in `rules` (not the rule's `.index`),
    // so we can compare them. -1 means "no candidate of this kind".
    const matchPos = firstMatchPos
    let dupPos = -1
    let shadowPos = -1

    // Exact-duplicate (by full JSON). The Map stores the EARLIEST position
    // seen for this json key, so the lookup is the tight reference.
    const jsonKey = JSON.stringify(cur.rule)
    const prior = firstByJson.get(jsonKey)
    if (prior !== undefined) {
      dupPos = prior
    } else {
      firstByJson.set(jsonKey, i)
    }

    // Shadow-check: only for simple rules. Matches the reference `shadows()`
    // predicate but routed through type-specific indexes.
    if (cur.rule.kind === 'simple') {
      const s: SimpleRule = cur.rule
      if (s.type === 'DOMAIN-SUFFIX') {
        const hit = suffixShadowLookupAndInsert(suffixTrie, s.value, i)
        if (hit !== -1) shadowPos = hit
      } else if (s.type === 'DOMAIN-KEYWORD') {
        // Bounded O(k²) — see note at top of file. Walk in insertion order
        // so the first substring-containing entry wins (the reference does
        // likewise with its j=0..i-1 inner loop).
        for (const kw of keywords) {
          if (kw.value === s.value) continue // equal → duplicate path
          if (s.value.includes(kw.value)) {
            shadowPos = kw.pos
            break
          }
        }
        // Always record this keyword — even if shadowed, the reference
        // inserts every rule into its "seen" set implicitly by virtue of
        // walking linearly. Skipping wouldn't change output correctness
        // (anything this rule would shadow is already shadowed by its
        // shadower) but we keep the insertion for parity with the trie
        // path, which also records every terminal visited.
        keywords.push({ value: s.value, pos: i })
      }
      // Other simple types (DOMAIN, GEOIP, IP-CIDR, …): reference `shadows`
      // returns false, so no shadow check here. Equality is covered by the
      // json-key duplicate map.
    }

    // --- pick the earliest candidate and emit -------------------------
    // At most one kind can fire at a given `j` position (the reference's
    // if/elif chain guarantees this), so ties across kinds at the SAME pos
    // are impossible by construction. We pick min() and route by kind.
    const best = minPos(matchPos, dupPos, shadowPos)
    if (best !== -1) {
      if (best === matchPos) {
        issues.push({
          level: 'error',
          code: 'LINTER_UNREACHABLE_RULE',
          path: ['rules', cur.index],
          params: { covered_by_index: rules[best]!.index, reason: 'match_above' },
          suggestion: {
            key: 'suggestion_unreachable_rule_after_match',
            params: { covered_by_index: rules[best]!.index },
          },
        })
      } else if (best === dupPos) {
        issues.push({
          level: 'warning',
          code: 'LINTER_DUPLICATE_RULE',
          path: ['rules', cur.index],
          params: { duplicate_of_index: rules[best]!.index },
          suggestion: {
            key: 'suggestion_duplicate_rule',
            params: { duplicate_of_index: rules[best]!.index },
          },
        })
      } else {
        issues.push({
          level: 'warning',
          code: 'LINTER_UNREACHABLE_RULE',
          path: ['rules', cur.index],
          params: { covered_by_index: rules[best]!.index },
          suggestion: {
            key: 'suggestion_unreachable_rule_shadowed',
            params: { covered_by_index: rules[best]!.index },
          },
        })
      }
    }

    // Book-keeping AFTER issue emission: update firstMatchPos if cur is
    // itself a MATCH and we haven't seen one yet. We intentionally update
    // *after* emitting so a MATCH-at-i doesn't flag itself; the reference
    // has the same semantics (inner loop `j < i` never sees its own index).
    // Must run regardless of whether an issue was emitted — the very first
    // MATCH typically has no predecessors that flag it, so without this
    // update every subsequent rule would be missed.
    if (cur.rule.kind === 'match' && firstMatchPos === -1) firstMatchPos = i
  }

  return issues
}

/** min of up to three non-negative ints, treating -1 as "absent". */
function minPos(a: number, b: number, c: number): number {
  let m = -1
  if (a !== -1) m = a
  if (b !== -1 && (m === -1 || b < m)) m = b
  if (c !== -1 && (m === -1 || c < m)) m = c
  return m
}
