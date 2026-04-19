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
  DUMP_OPTS,
  type GeoxUrlConfig,
  type ProfileConfig,
  type ProfileNested,
  type ProxyNode,
  type Rule,
  type RuleProviderConfig,
  type RuleProvidersConfig,
  serializeRule,
  type SnifferConfig,
  type SnifferProtocol,
  type SnifferProtocolConfig,
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

/** Serialize back to text. Uses the same `DUMP_OPTS` as the server's
 *  `canonicalize` / `maskedLiveText` / deploy pipeline — without this
 *  symmetry `/api/config/draft/diff` reports formatting noise (folded
 *  URLs, quote style flips, map-key reordering) that masks real edits. */
export function serializeDraft(doc: Document): string {
  return doc.toString(DUMP_OPTS)
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

// ----- sniffer: section mutators -----------------------------------------

/** Canonical order for `sniffer:` keys. Roughly matches mihomo's example
 *  docs — enable/override first, then parse-pure-ip, then the nested sniff
 *  map, then domain lists, then dns-mapping, then port-whitelist. */
const SNIFFER_KEY_ORDER: readonly string[] = [
  'enable',
  'override-destination',
  'parse-pure-ip',
  'force-dns-mapping',
  'sniff',
  'force-domain',
  'skip-domain',
  'port-whitelist',
]

const SNIFFER_PROTOCOL_ORDER: readonly SnifferProtocol[] = ['HTTP', 'TLS', 'QUIC']
const SNIFFER_PROTOCOL_KEY_ORDER: readonly string[] = ['ports', 'override-destination']

function buildProtocolConfig(cfg: SnifferProtocolConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of SNIFFER_PROTOCOL_KEY_ORDER) {
    const v = (cfg as Record<string, unknown>)[k]
    if (v === undefined) continue
    out[k] = v
  }
  if (cfg.extras) {
    const extraKeys = Object.keys(cfg.extras).sort()
    for (const k of extraKeys) {
      out[k] = cfg.extras[k]
    }
  }
  return out
}

function buildSniffMap(sniff: NonNullable<SnifferConfig['sniff']>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const proto of SNIFFER_PROTOCOL_ORDER) {
    const p = sniff[proto]
    if (p === undefined) continue
    out[proto] = buildProtocolConfig(p)
  }
  if (sniff.extras) {
    const extraKeys = Object.keys(sniff.extras).sort()
    for (const k of extraKeys) {
      out[k] = sniff.extras[k]
    }
  }
  return out
}

/** Replace the entire `sniffer:` section with `config`. Unknown keys on
 *  `config.extras` (and per-protocol `extras`) are preserved. Callers pass a
 *  freshly-merged object; this writes, it does not merge. */
export function setSnifferConfig(doc: Document, config: SnifferConfig): void {
  const raw: Record<string, unknown> = {}
  for (const k of SNIFFER_KEY_ORDER) {
    if (k === 'sniff') {
      if (config.sniff !== undefined) raw.sniff = buildSniffMap(config.sniff)
      continue
    }
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
    doc.deleteIn(['sniffer'])
    return
  }
  const node = doc.createNode(raw)
  doc.setIn(['sniffer'], node)
}

// ----- profile: top-level scalars mutator --------------------------------

/** Canonical ordering for the top-level scalar keys Miharbor's profile view
 *  owns. When a key is NEW to the document (wasn't present before) the
 *  mutator appends it in this order AFTER the last existing known key (or
 *  at the top of the doc when none of the known keys existed). Keys that
 *  already exist keep their original position — we only rewrite their
 *  values in place. */
const PROFILE_KEY_ORDER: readonly string[] = [
  'mode',
  'log-level',
  'mixed-port',
  'allow-lan',
  'bind-address',
  'ipv6',
  'tcp-concurrent',
  'unified-delay',
  'interface-name',
  'geodata-mode',
  'geo-auto-update',
  'geo-update-interval',
  'geox-url',
  'keep-alive-interval',
  'find-process-mode',
  'global-client-fingerprint',
  'external-controller',
  'secret',
  'external-ui',
  'external-ui-name',
  'external-ui-url',
  'authentication',
  'profile',
]

/** Nested `profile:` sub-section key order. */
const PROFILE_NESTED_KEY_ORDER: readonly string[] = ['store-selected', 'store-fake-ip']

/** Nested `geox-url:` sub-section key order — matches mihomo docs convention
 *  (geoip / geosite / mmdb / asn). Keys not in this list come from `extras`
 *  and are appended after the known ones, sorted for determinism. */
const GEOX_URL_KEY_ORDER: readonly string[] = ['geoip', 'geosite', 'mmdb', 'asn']

const PROFILE_MANAGED_KEYS: ReadonlySet<string> = new Set(PROFILE_KEY_ORDER)

function buildGeoxUrl(cfg: GeoxUrlConfig): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const k of GEOX_URL_KEY_ORDER) {
    const v = (cfg as Record<string, unknown>)[k]
    if (v === undefined) continue
    out[k] = v
  }
  if (cfg.extras) {
    for (const k of Object.keys(cfg.extras).sort()) {
      out[k] = cfg.extras[k]
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function buildProfileNested(cfg: ProfileNested): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PROFILE_NESTED_KEY_ORDER) {
    const v = (cfg as Record<string, unknown>)[k]
    if (v === undefined) continue
    out[k] = v
  }
  if (cfg.extras) {
    const extraKeys = Object.keys(cfg.extras).sort()
    for (const k of extraKeys) {
      out[k] = cfg.extras[k]
    }
  }
  return out
}

/** Replace the top-level profile fields in `doc` with the values from
 *  `config`. Unknown keys on `config.extras` are preserved (appended after
 *  the managed keys, sorted). Reserved sections (dns/tun/sniffer/rules/…)
 *  are never touched — this mutator only edits the keys declared in
 *  `PROFILE_KEY_ORDER` plus any `extras` the operator already had.
 *
 *  Keys already present in the document keep their original position so the
 *  operator's YAML layout is preserved. Keys NEW to the document are
 *  appended in `PROFILE_KEY_ORDER`. */
export function setProfileConfig(doc: Document, config: ProfileConfig): void {
  const root = doc.contents
  if (!root || !isMap(root as Node)) {
    // Doc has no mapping at the root — bootstrap one.
    const node = doc.createNode({}) as YAMLMap
    doc.contents = node
  }
  const rootMap = doc.contents as YAMLMap

  // 1. Update or remove every managed scalar key.
  const managed = new Map<string, unknown>()
  for (const k of PROFILE_KEY_ORDER) {
    const v = (config as Record<string, unknown>)[k]
    if (k === 'profile') {
      // Nested sub-section: emitted only when the sub-config is non-empty.
      const nested = config.profile
      if (
        nested &&
        (nested['store-selected'] !== undefined ||
          nested['store-fake-ip'] !== undefined ||
          (nested.extras && Object.keys(nested.extras).length > 0))
      ) {
        managed.set('profile', buildProfileNested(nested))
      }
      continue
    }
    if (k === 'geox-url') {
      // Nested sub-section — emitted only when at least one field survives.
      const geox = config['geox-url']
      if (geox) {
        const built = buildGeoxUrl(geox)
        if (built !== null) managed.set('geox-url', built)
      }
      continue
    }
    if (k === 'authentication') {
      const auth = config.authentication
      if (auth && auth.length > 0) managed.set('authentication', auth)
      continue
    }
    if (v === undefined) continue
    managed.set(k, v)
  }
  // Unknown extras (sorted for determinism).
  if (config.extras) {
    for (const k of Object.keys(config.extras).sort()) {
      managed.set(k, config.extras[k])
    }
  }

  // 2. Remove managed keys that are no longer present.
  const toRemove: string[] = []
  for (const item of rootMap.items) {
    if (!(item instanceof Pair)) continue
    const keyNode = item.key as Scalar | { value?: unknown }
    const key =
      keyNode instanceof Scalar
        ? String(keyNode.value)
        : String((keyNode as { value?: unknown }).value ?? '')
    if (!key) continue
    // Only remove keys we manage — leave nested sections (dns/tun/…) alone.
    if (
      !PROFILE_MANAGED_KEYS.has(key) &&
      !(config.extras && Object.prototype.hasOwnProperty.call(config.extras, key))
    ) {
      // Skip — not managed.
      continue
    }
    if (!managed.has(key)) toRemove.push(key)
  }
  for (const k of toRemove) {
    rootMap.delete(k)
  }

  // 3. Update existing keys in place, and append newly-added ones at the end.
  for (const [k, v] of managed) {
    if (rootMap.has(k)) {
      rootMap.set(k, doc.createNode(v))
    } else {
      // New key — append. The YAMLMap preserves insertion order, so we just
      // add with .set(). (Canonical order is advisory when the original doc
      // is brand-new; existing docs keep their layout.)
      rootMap.set(k, doc.createNode(v))
    }
  }
}

// ----- rule-providers: section mutators ----------------------------------

/** Canonical per-provider key order. Matches the typical mihomo example
 *  layout: type/behavior/format first, then transport-specific fields. The
 *  specific key subset written depends on `type` — for http we emit
 *  url/interval/proxy; for file just path; for inline the payload. */
const PROVIDER_KEY_ORDER: readonly (keyof RuleProviderConfig)[] = [
  'type',
  'behavior',
  'format',
  'url',
  'interval',
  'proxy',
  'path',
  'payload',
]

function buildProviderMap(cfg: RuleProviderConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PROVIDER_KEY_ORDER) {
    const v = cfg[k]
    if (v === undefined) continue
    out[k] = v
  }
  if (cfg.extras) {
    const extraKeys = Object.keys(cfg.extras).sort()
    for (const k of extraKeys) {
      out[k] = cfg.extras[k]
    }
  }
  return out
}

/** Replace the entire `rule-providers:` section with `config`. Providers are
 *  written in the insertion order of `config.providers`; top-level extras
 *  (malformed entries round-tripped from the view projection) are appended
 *  after, sorted by key for determinism. An empty config removes the
 *  section entirely rather than emitting `rule-providers: {}`. */
export function setProvidersConfig(doc: Document, config: RuleProvidersConfig): void {
  const raw: Record<string, unknown> = {}
  if (config.providers) {
    for (const [name, cfg] of Object.entries(config.providers)) {
      raw[name] = buildProviderMap(cfg)
    }
  }
  if (config.extras) {
    const extraKeys = Object.keys(config.extras).sort()
    for (const k of extraKeys) {
      // Don't overwrite a real provider with an extras entry of the same
      // name — defensive, shouldn't happen on normal round-trip because
      // the projection never emits a name to both buckets.
      if (k in raw) continue
      raw[k] = config.extras[k]
    }
  }
  if (Object.keys(raw).length === 0) {
    doc.deleteIn(['rule-providers'])
    return
  }
  const node = doc.createNode(raw)
  doc.setIn(['rule-providers'], node)
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
