// Service view — projects a mihomo `proxy-groups` entry + the rules that
// target it into a `Service` (see miharbor-shared ../types/service.ts).
// 1:1 with proxy-groups; deduced, not stored. `rules[].index` keeps the
// original position in the global `rules:` array so UIs can render
// "Rule #42" and linters can reason about unreachability by order.

import type { Document } from 'yaml'
import type { ProxyGroup, ProxyGroupType, Rule, Service } from 'miharbor-shared'
import { parseRulesFromDoc } from 'miharbor-shared'

// Generic helper: yaml's YAMLMap#get returns `unknown`; we narrow per-call.
function mapGet(node: unknown, key: string): unknown {
  if (
    node &&
    typeof node === 'object' &&
    'get' in node &&
    typeof (node as { get: unknown }).get === 'function'
  ) {
    return (node as { get: (k: string) => unknown }).get(key)
  }
  return undefined
}

function toJSON(node: unknown): unknown {
  if (
    node &&
    typeof node === 'object' &&
    'toJSON' in node &&
    typeof (node as { toJSON: unknown }).toJSON === 'function'
  ) {
    return (node as { toJSON: () => unknown }).toJSON()
  }
  return node
}

function asStringArray(node: unknown): string[] {
  const v = toJSON(node)
  if (Array.isArray(v)) return v.map((x) => String(x))
  return []
}

function asGroupType(v: unknown): ProxyGroupType {
  const s = String(v ?? '')
  if (s === 'url-test' || s === 'fallback' || s === 'load-balance' || s === 'relay') return s
  return 'select'
}

/** Read every proxy-group from `doc` and return `Service[]`. Safe to call on
 *  a doc without proxy-groups or without rules (returns empty on either). */
export function getServices(doc: Document): Service[] {
  const groupsNode = doc.getIn(['proxy-groups']) as { items?: unknown[] } | undefined
  if (!groupsNode || !Array.isArray(groupsNode.items)) return []

  // Parse rules once; safe if rules key is missing.
  let allRules: { index: number; rule: Rule }[]
  try {
    allRules = parseRulesFromDoc(doc)
  } catch {
    // Malformed rule — linters will surface this; for the view, fall back
    // to an empty list rather than throwing.
    allRules = []
  }

  const services: Service[] = []
  for (const g of groupsNode.items) {
    const name = String(mapGet(g, 'name') ?? '')
    if (!name) continue
    const group: ProxyGroup = {
      name,
      type: asGroupType(mapGet(g, 'type')),
      proxies: asStringArray(mapGet(g, 'proxies')),
    }
    const url = mapGet(g, 'url')
    if (typeof url === 'string') group.url = url
    const interval = mapGet(g, 'interval')
    if (typeof interval === 'number') group.interval = interval
    const hidden = mapGet(g, 'hidden')
    if (typeof hidden === 'boolean') group.hidden = hidden

    const relatedRules = allRules.filter((r) => r.rule.target === name)
    const direction = deduceDirection(group)
    services.push({ name, group, rules: relatedRules, direction, issues: [] })
  }
  return services
}

// `direction` is deduced from the first proxy in the group (current selection
// in `select`-type). For url-test / fallback we can't tell statically; we mark
// MIXED and let the UI consult the runtime API instead.
function deduceDirection(group: ProxyGroup): Service['direction'] {
  if (group.type !== 'select') return 'MIXED'
  const first = group.proxies[0]
  if (first === 'DIRECT') return 'DIRECT'
  if (first === 'REJECT') return 'REJECT'
  if (!first) return 'MIXED'
  return 'VPN'
}
