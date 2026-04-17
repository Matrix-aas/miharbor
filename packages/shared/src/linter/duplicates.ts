// Duplicate and dangling-reference detector. Five issue codes:
//
//   LINTER_DANGLING_GROUP_REFERENCE   — a rule's target isn't a built-in
//                                      (DIRECT/REJECT/…) and isn't a known
//                                      proxy-group.
//   LINTER_DANGLING_RULESET_REFERENCE — a RULE-SET,X,… rule names a
//                                      rule-provider that doesn't exist.
//   LINTER_DANGLING_NODE_REFERENCE    — a proxy-group lists a node name that
//                                      isn't under `proxies:` and isn't
//                                      another group / built-in.
//   LINTER_INTRA_GROUP_DUPLICATE      — same (type, value) simple rule routed
//                                      into the same target twice.
//   LINTER_CROSS_GROUP_DUPLICATE      — same (type, value) routed into two
//                                      different groups. Warning: often
//                                      intentional ("example.com → A unless
//                                      on mobile") but surfaces inconsistency.

import type { Document } from 'yaml'
import type { Issue } from '../types/issue.ts'
import type { Rule, SimpleRule } from '../types/rule.ts'

type IndexedRule = { index: number; rule: Rule }

// mihomo built-in targets that never need to be declared under `proxy-groups`
// or `proxies:`. We exclude these from every dangling-ref check.
const BUILTIN_TARGETS: ReadonlySet<string> = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PROXY',
  'GLOBAL',
  'PASS',
])

// --- small helpers that narrow yaml@2's loose Node surface ----------------

interface YamlSeqLike {
  items?: unknown[]
}
interface YamlMapLike {
  items?: { key?: unknown; value?: unknown }[]
  get: (k: string) => unknown
  toJSON?: () => unknown
}

function isSeqLike(n: unknown): n is YamlSeqLike {
  return !!n && typeof n === 'object' && Array.isArray((n as YamlSeqLike).items)
}

function hasGet(n: unknown): n is { get: (k: string) => unknown } {
  return !!n && typeof n === 'object' && typeof (n as { get?: unknown }).get === 'function'
}

function toJSON(n: unknown): unknown {
  if (
    n &&
    typeof n === 'object' &&
    'toJSON' in n &&
    typeof (n as { toJSON: unknown }).toJSON === 'function'
  ) {
    return (n as { toJSON: () => unknown }).toJSON()
  }
  return n
}

// Extract a group's `proxies:` sub-array as plain strings regardless of
// whether we're looking at a YAMLSeq of scalars, a flow array, or a plain JS
// array inside a flow-map group.
function getGroupProxies(group: unknown): string[] {
  if (!hasGet(group)) return []
  const raw = (group as YamlMapLike).get('proxies')
  const resolved = toJSON(raw)
  if (!Array.isArray(resolved)) return []
  return resolved.map((v) => String(v))
}

function getGroupName(group: unknown): string {
  if (!hasGet(group)) return ''
  return String((group as YamlMapLike).get('name') ?? '')
}

// Extract every declared key under a YAML map (used for proxy name / provider
// name enumeration). Works with both block and flow maps.
function collectMapKeys(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  // yaml@2: YAMLMap.items is a ReadonlyArray<Pair>, each Pair has `key`.
  const map = node as { items?: unknown[] }
  if (!Array.isArray(map.items)) return []
  const out: string[] = []
  for (const item of map.items) {
    if (!item || typeof item !== 'object') continue
    const key = (item as { key?: unknown }).key
    if (key === undefined || key === null) continue
    if (typeof key === 'object' && key !== null && 'value' in (key as Record<string, unknown>)) {
      out.push(String((key as { value: unknown }).value))
    } else {
      out.push(String(key))
    }
  }
  return out
}

// Collect names out of a `proxies:` sequence; each item is expected to be a
// map with a `name:` field.
function collectProxyNames(node: unknown): string[] {
  if (!isSeqLike(node)) return []
  const items = node.items ?? []
  const out: string[] = []
  for (const it of items) {
    if (!hasGet(it)) {
      // Sometimes the item is a plain JS object (flow map). toJSON handles both.
      const resolved = toJSON(it)
      if (resolved && typeof resolved === 'object' && 'name' in resolved) {
        out.push(String((resolved as { name: unknown }).name))
      }
      continue
    }
    const name = (it as YamlMapLike).get('name')
    if (name !== undefined && name !== null) out.push(String(name))
  }
  return out
}

// --- main -----------------------------------------------------------------

export function detectDuplicates(doc: Document, rules: IndexedRule[]): Issue[] {
  const issues: Issue[] = []

  // Build lookup sets up front — one pass each through proxy-groups, proxies,
  // and rule-providers. Cheap; avoids nested scans below.
  const groupsNode = doc.getIn(['proxy-groups'])
  const groupItems = isSeqLike(groupsNode) ? (groupsNode.items ?? []) : []
  const groupNames = new Set<string>(groupItems.map(getGroupName).filter(Boolean))

  const proxyNames = new Set<string>(collectProxyNames(doc.getIn(['proxies'])))

  const ruleProviderNames = new Set<string>(collectMapKeys(doc.getIn(['rule-providers'])))

  // 1. proxy-groups → nodes / other groups / built-ins
  for (const g of groupItems) {
    const name = getGroupName(g)
    if (!name) continue
    const refs = getGroupProxies(g)
    for (const ref of refs) {
      if (BUILTIN_TARGETS.has(ref)) continue
      if (proxyNames.has(ref) || groupNames.has(ref)) continue
      issues.push({
        level: 'error',
        code: 'LINTER_DANGLING_NODE_REFERENCE',
        path: ['proxy-groups', name, 'proxies'],
        params: { ref, group: name },
      })
    }
  }

  // 2. rules → groups / rule-providers
  for (const { index, rule } of rules) {
    // Any rule kind has a top-level target (MATCH/SIMPLE/LOGICAL). Children
    // of logical rules don't carry targets (they inherit from the parent) so
    // we only check the top.
    const target = rule.target
    if (target && !BUILTIN_TARGETS.has(target) && !groupNames.has(target)) {
      issues.push({
        level: 'error',
        code: 'LINTER_DANGLING_GROUP_REFERENCE',
        path: ['rules', index],
        params: { target },
      })
    }
    if (rule.kind === 'simple' && rule.type === 'RULE-SET') {
      if (!ruleProviderNames.has(rule.value)) {
        issues.push({
          level: 'error',
          code: 'LINTER_DANGLING_RULESET_REFERENCE',
          path: ['rules', index],
          params: { provider: rule.value },
        })
      }
    }
  }

  // 3. Duplicate simple rules — both intra-group (same (type,value) routed
  //    into the same target twice) and cross-group (same (type,value) into a
  //    different group than the first occurrence).
  // NOTE: logical / MATCH rules are out of scope for this check — comparing
  // them would require value-set semantics we haven't implemented.
  const seenPerGroup = new Map<string, Map<string, number>>() // target → (key → firstIndex)
  const firstByKey = new Map<string, { index: number; target: string }>()
  for (let i = 0; i < rules.length; i++) {
    const { index, rule } = rules[i]!
    if (rule.kind !== 'simple') continue
    const s: SimpleRule = rule
    const key = `${s.type}:${s.value}`

    // Intra-group: same key already seen with same target.
    let groupMap = seenPerGroup.get(s.target)
    if (!groupMap) {
      groupMap = new Map()
      seenPerGroup.set(s.target, groupMap)
    }
    const priorIdx = groupMap.get(key)
    if (priorIdx !== undefined) {
      issues.push({
        level: 'warning',
        code: 'LINTER_INTRA_GROUP_DUPLICATE',
        path: ['rules', index],
        params: { group: s.target, key, duplicate_of_index: priorIdx },
      })
    } else {
      groupMap.set(key, index)
    }

    // Cross-group: earliest occurrence had a different target.
    const first = firstByKey.get(key)
    if (first !== undefined) {
      if (first.target !== s.target) {
        issues.push({
          level: 'warning',
          code: 'LINTER_CROSS_GROUP_DUPLICATE',
          path: ['rules', index],
          params: {
            firstAt: first.index,
            firstTarget: first.target,
            currentTarget: s.target,
            key,
          },
        })
      }
    } else {
      firstByKey.set(key, { index, target: s.target })
    }
  }

  return issues
}
