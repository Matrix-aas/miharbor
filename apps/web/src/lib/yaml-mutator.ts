// Client-side YAML mutator — replicates the server's mutator surface
// (see apps/server/src/config/mutator.ts) so the Services / Proxies screens
// can perform structured edits locally without a server round-trip per
// keystroke. The store then PUTs the serialized draft in a debounced call.
//
// Why duplicate? Keeping the mutation pipeline in the browser avoids:
//   1. Round-trip latency on every rule edit (would feel laggy in RuleEditor).
//   2. A bespoke PATCH endpoint per mutation — the UI would drift from the
//      server's data model.
//   3. Reaching for a WebSocket for optimistic updates.
// The server still validates the final YAML when it reaches PUT /api/config/draft.

import {
  type Document,
  isCollection,
  isMap,
  isSeq,
  parseDocument,
  type Node,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
} from 'yaml'
import {
  type DnsConfig,
  type ProxyNode,
  type Rule,
  serializeRule,
  type TunConfig,
  type WireGuardNode,
} from 'miharbor-shared'

/** Parse YAML text. Surfaces parse errors as a thrown Error with a flattened
 *  human-readable message (to keep the editor stores small). */
export function parseDraft(yaml: string): Document {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) {
    const first = doc.errors[0]
    if (first) {
      throw new Error(`YAML parse error: ${first.message}`)
    }
    throw new Error('YAML parse error')
  }
  return doc
}

/** Serialize back to text. Preserves key order / comments where the yaml
 *  library can manage it. */
export function serializeDraft(doc: Document): string {
  return doc.toString()
}

// ----- rules mutators -----------------------------------------------------

function getRulesSeq(doc: Document): YAMLSeq | null {
  const rules = doc.getIn(['rules']) as unknown
  if (!rules || !isSeq(rules as Node)) return null
  return rules as YAMLSeq
}

function ensureRulesSeq(doc: Document): YAMLSeq {
  const existing = getRulesSeq(doc)
  if (existing) return existing
  const seq = new YAMLSeq()
  doc.setIn(['rules'], seq)
  return seq
}

export function insertRule(doc: Document, rule: Rule, atIndex = -1): void {
  if (atIndex !== -1 && atIndex < 0) {
    throw new Error(`insertRule: negative index ${atIndex} not allowed (use -1 for append)`)
  }
  const seq = ensureRulesSeq(doc)
  const node = doc.createNode(serializeRule(rule)) as Node
  if (atIndex === -1 || atIndex >= seq.items.length) {
    seq.items.push(node)
  } else {
    seq.items.splice(atIndex, 0, node)
  }
}

export function replaceRule(doc: Document, index: number, rule: Rule): void {
  const seq = getRulesSeq(doc)
  if (!seq) throw new Error('mutator: rules array missing or not a sequence')
  if (index < 0 || index >= seq.items.length) {
    throw new Error(`mutator: rule index ${index} out of bounds (length=${seq.items.length})`)
  }
  seq.items[index] = doc.createNode(serializeRule(rule)) as Node
}

export function removeRule(doc: Document, index: number): void {
  const seq = getRulesSeq(doc)
  if (!seq) throw new Error('mutator: rules array missing or not a sequence')
  if (index < 0 || index >= seq.items.length) {
    throw new Error(`mutator: rule index ${index} out of bounds (length=${seq.items.length})`)
  }
  seq.items.splice(index, 1)
}

/** Find indexes of all rules whose target == groupName. Useful for "delete
 *  service and its rules" flow. */
export function findRuleIndexesByTarget(doc: Document, target: string): number[] {
  const seq = getRulesSeq(doc)
  if (!seq) return []
  const out: number[] = []
  for (let i = 0; i < seq.items.length; i++) {
    const item = seq.items[i]
    const raw =
      item instanceof Scalar ? String((item as Scalar).value) : typeof item === 'string' ? item : ''
    // Tail of the rule is ",TARGET" (simple) or ",(CHILD),TARGET" (logical) or
    // "MATCH,TARGET". We compare the last comma-separated segment that isn't
    // a modifier. For MVP keep a simple suffix check; callers must quote only
    // targets they control.
    if (!raw) continue
    if (raw === `MATCH,${target}` || raw.endsWith(`,${target}`)) {
      out.push(i)
    }
  }
  return out
}

// ----- proxy-groups (service) mutators ------------------------------------

function getGroupsSeq(doc: Document): YAMLSeq | null {
  const groups = doc.getIn(['proxy-groups']) as unknown
  if (!groups || !isSeq(groups as Node)) return null
  return groups as YAMLSeq
}

function ensureGroupsSeq(doc: Document): YAMLSeq {
  const existing = getGroupsSeq(doc)
  if (existing) return existing
  const seq = new YAMLSeq()
  doc.setIn(['proxy-groups'], seq)
  return seq
}

function findGroupIndex(doc: Document, name: string): number {
  const seq = getGroupsSeq(doc)
  if (!seq) return -1
  for (let i = 0; i < seq.items.length; i++) {
    const item = seq.items[i]
    if (isMap(item as Node)) {
      const got = (item as YAMLMap).get('name')
      if (String(got) === name) return i
    }
  }
  return -1
}

/** Flip the direction of a `select`-type group by setting `proxies[0]` to
 *  DIRECT / REJECT / <first remaining VPN>. Non-select groups are left alone
 *  (the UI's direction switcher is disabled for those). */
export function setGroupDirection(
  doc: Document,
  groupName: string,
  direction: 'VPN' | 'DIRECT' | 'REJECT',
): void {
  const idx = findGroupIndex(doc, groupName)
  if (idx < 0) throw new Error(`setGroupDirection: group "${groupName}" not found`)
  const seq = getGroupsSeq(doc)!
  const groupNode = seq.items[idx] as YAMLMap
  const proxies = groupNode.get('proxies') as unknown
  if (!proxies || !isSeq(proxies as Node)) {
    throw new Error(`setGroupDirection: group "${groupName}" has no proxies[] list`)
  }
  const proxiesSeq = proxies as YAMLSeq
  // Collect current list as strings for manipulation.
  const current: string[] = proxiesSeq.items.map((item) =>
    item instanceof Scalar ? String((item as Scalar).value) : String(item),
  )
  let desired: string
  if (direction === 'DIRECT') desired = 'DIRECT'
  else if (direction === 'REJECT') desired = 'REJECT'
  else {
    // VPN — pick the first non-DIRECT, non-REJECT entry already in the list.
    desired = current.find((p) => p !== 'DIRECT' && p !== 'REJECT') ?? 'PROXY'
  }
  // Remove any existing occurrence and prepend.
  const next = [desired, ...current.filter((p) => p !== desired)]
  // Rebuild sequence preserving the underlying scalar style.
  proxiesSeq.items = next.map((v) => doc.createNode(v) as Node)
}

export interface CreateServiceInput {
  name: string
  direction: 'VPN' | 'DIRECT' | 'REJECT'
  /** Optional fallback list for the VPN case; defaults to ["PROXY", "DIRECT"]. */
  vpnFallback?: string[]
}

/** Append a new `select`-type proxy-group to the config. Throws if a group
 *  with the same name already exists. */
export function createService(doc: Document, input: CreateServiceInput): void {
  const existing = findGroupIndex(doc, input.name)
  if (existing >= 0) throw new Error(`createService: name "${input.name}" already taken`)
  const seq = ensureGroupsSeq(doc)
  let proxies: string[]
  if (input.direction === 'DIRECT') proxies = ['DIRECT', 'REJECT']
  else if (input.direction === 'REJECT') proxies = ['REJECT', 'DIRECT']
  else
    proxies =
      input.vpnFallback && input.vpnFallback.length > 0
        ? input.vpnFallback
        : ['PROXY', 'DIRECT', 'REJECT']
  const node = doc.createNode({
    name: input.name,
    type: 'select',
    proxies,
  })
  seq.items.push(node as Node)
}

export function deleteService(doc: Document, name: string): void {
  const seq = getGroupsSeq(doc)
  if (!seq) return
  const idx = findGroupIndex(doc, name)
  if (idx < 0) return
  seq.items.splice(idx, 1)
}

/** Delete a service AND every top-level rule targeting it. Returns the number
 *  of rules removed (UIs render this in the confirm dialog). */
export function deleteServiceWithRules(doc: Document, name: string): number {
  const indexes = findRuleIndexesByTarget(doc, name)
  // Remove rules in descending order so earlier indexes stay valid.
  const sorted = [...indexes].sort((a, b) => b - a)
  for (const i of sorted) removeRule(doc, i)
  deleteService(doc, name)
  return indexes.length
}

// ----- proxy nodes (proxies:) mutators ------------------------------------

function getProxiesSeq(doc: Document): YAMLSeq | null {
  const proxies = doc.getIn(['proxies']) as unknown
  if (!proxies || !isSeq(proxies as Node)) return null
  return proxies as YAMLSeq
}

function ensureProxiesSeq(doc: Document): YAMLSeq {
  const existing = getProxiesSeq(doc)
  if (existing) return existing
  const seq = new YAMLSeq()
  doc.setIn(['proxies'], seq)
  return seq
}

function findProxyIndex(doc: Document, name: string): number {
  const seq = getProxiesSeq(doc)
  if (!seq) return -1
  for (let i = 0; i < seq.items.length; i++) {
    const item = seq.items[i]
    if (isMap(item as Node)) {
      const got = (item as YAMLMap).get('name')
      if (String(got) === name) return i
    }
  }
  return -1
}

/** Add or replace a proxy node. Match is by `name`. */
export function upsertProxyNode(doc: Document, node: ProxyNode): void {
  const seq = ensureProxiesSeq(doc)
  const idx = findProxyIndex(doc, node.name)
  const created = doc.createNode(node) as Node
  if (idx < 0) {
    seq.items.push(created)
  } else {
    seq.items[idx] = created
  }
}

export function removeProxyNode(doc: Document, name: string): void {
  const seq = getProxiesSeq(doc)
  if (!seq) return
  const idx = findProxyIndex(doc, name)
  if (idx < 0) return
  seq.items.splice(idx, 1)
}

/** Export a convenience predicate — the Proxies screen uses it to decide
 *  if a submitted WireGuard form should be an insert or an update. */
export function hasProxyNode(doc: Document, name: string): boolean {
  return findProxyIndex(doc, name) >= 0
}

// ----- tiny helpers the stores sometimes need ------------------------------

/** Low-level escape hatch used by tests and the Raw YAML screen. */
export function cloneDoc(doc: Document): Document {
  return parseDocument(doc.toString())
}

/** Collect the raw names of existing proxy-groups — useful for unique-name
 *  validation in AddServiceDialog without parsing the whole structure. */
export function listGroupNames(doc: Document): string[] {
  const seq = getGroupsSeq(doc)
  if (!seq) return []
  const out: string[] = []
  for (const item of seq.items) {
    if (isMap(item as Node)) {
      const got = (item as YAMLMap).get('name')
      if (typeof got === 'string') out.push(got)
      else if (got != null) out.push(String(got))
    }
  }
  return out
}

/** List of proxy-node names (the union shown in VPN-fallback hints). */
export function listProxyNodeNames(doc: Document): string[] {
  const seq = getProxiesSeq(doc)
  if (!seq) return []
  const out: string[] = []
  for (const item of seq.items) {
    if (isMap(item as Node)) {
      const got = (item as YAMLMap).get('name')
      if (typeof got === 'string') out.push(got)
      else if (got != null) out.push(String(got))
    }
  }
  return out
}

/** Convenience guard for the WireGuardForm — keeps the type-narrowing out of
 *  the SFC. */
export function isWireGuardNode(node: ProxyNode): node is WireGuardNode {
  return node.type === 'wireguard'
}

// ----- dns: section mutators ---------------------------------------------

/** The canonical key order Miharbor writes out; keys not in this list come
 *  from `extras` and are appended after the known ones. */
const DNS_KEY_ORDER: readonly string[] = [
  'enable',
  'listen',
  'ipv6',
  'cache-algorithm',
  'enhanced-mode',
  'fake-ip-range',
  'use-hosts',
  'use-system-hosts',
  'respect-rules',
  'direct-nameserver-follow-policy',
  'default-nameserver',
  'nameserver',
  'fallback',
  'fallback-filter',
  'proxy-server-nameserver',
  'direct-nameserver',
  'nameserver-policy',
  'fake-ip-filter-mode',
  'fake-ip-filter',
]

/** Replace the entire `dns:` section with `config`. Unknown keys on
 *  `config.extras` are preserved (appended at the end). Callers should pass a
 *  freshly-merged object; this writes, it does not merge. */
export function setDnsConfig(doc: Document, config: DnsConfig): void {
  const raw: Record<string, unknown> = {}
  // Copy known keys in canonical order.
  for (const k of DNS_KEY_ORDER) {
    const v = (config as Record<string, unknown>)[k]
    if (v === undefined) continue
    raw[k] = v
  }
  // Extras go at the end, sorted for determinism.
  if (config.extras) {
    const extraKeys = Object.keys(config.extras).sort()
    for (const k of extraKeys) {
      raw[k] = config.extras[k]
    }
  }
  if (Object.keys(raw).length === 0) {
    // Empty config — remove the section entirely rather than emitting `dns: {}`.
    doc.deleteIn(['dns'])
    return
  }
  const node = doc.createNode(raw)
  doc.setIn(['dns'], node)
}

// ----- tun: section mutators ---------------------------------------------

/** Canonical order for `tun:` keys. Matches mihomo's conventional ordering
 *  (enable/device/stack first, then routing flags, then address/interface
 *  bindings, finally list fields). Keys not in this list come from `extras`
 *  and are appended after the known ones. */
const TUN_KEY_ORDER: readonly string[] = [
  'enable',
  'device',
  'stack',
  'mtu',
  'auto-route',
  'auto-redirect',
  'auto-detect-interface',
  'strict-route',
  'interface-name',
  'endpoint-independent-nat',
  'inet4-address',
  'inet6-address',
  'dns-hijack',
  'route-address',
  'route-exclude-address',
  'exclude-interface',
]

/** Replace the entire `tun:` section with `config`. Unknown keys on
 *  `config.extras` are preserved (appended at the end). Callers should pass a
 *  freshly-merged object; this writes, it does not merge. */
export function setTunConfig(doc: Document, config: TunConfig): void {
  const raw: Record<string, unknown> = {}
  for (const k of TUN_KEY_ORDER) {
    const v = (config as Record<string, unknown>)[k]
    if (v === undefined) continue
    raw[k] = v
  }
  if (config.extras) {
    const extraKeys = Object.keys(config.extras).sort()
    for (const k of extraKeys) {
      raw[k] = config.extras[k]
    }
  }
  if (Object.keys(raw).length === 0) {
    doc.deleteIn(['tun'])
    return
  }
  const node = doc.createNode(raw)
  doc.setIn(['tun'], node)
}

/** Collect proxy-server IPs from the current doc. Used by the Tun page to
 *  cross-reference `route-exclude-address` against every server that would
 *  otherwise self-intercept. Returns bare IPs (no /32 suffix) for each proxy
 *  entry that has a resolvable `server:` key. */
export function listProxyServerIps(doc: Document): string[] {
  const seq = getProxiesSeq(doc)
  if (!seq) return []
  const out: string[] = []
  for (const item of seq.items) {
    if (!isMap(item as Node)) continue
    const server = (item as YAMLMap).get('server')
    if (typeof server === 'string' && server.trim().length > 0) {
      out.push(server.trim())
    }
  }
  return out
}

// ----- low-level re-exports ------------------------------------------------
// Consumers occasionally want direct access for custom flows.
export { isCollection, isMap, isSeq, parseDocument, Pair, Scalar, YAMLMap, YAMLSeq }
