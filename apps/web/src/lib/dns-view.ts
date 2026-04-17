// Client-side mirror of apps/server/src/config/views/dns.ts.
// Kept in sync so the Dns.vue page can derive the typed view from the draft
// document without a server round-trip per keystroke.
//
// When the server projection grows a new field, this file must grow the same
// field. Tests exist on both sides to catch drift.

import type { Document } from 'yaml'
import type {
  DnsCacheAlgorithm,
  DnsConfig,
  DnsEnhancedMode,
  DnsFakeIpFilterMode,
  DnsFallbackFilter,
} from 'miharbor-shared'

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'enable',
  'ipv6',
  'listen',
  'enhanced-mode',
  'fake-ip-range',
  'use-hosts',
  'use-system-hosts',
  'fake-ip-filter',
  'fake-ip-filter-mode',
  'default-nameserver',
  'nameserver',
  'fallback',
  'fallback-filter',
  'nameserver-policy',
  'proxy-server-nameserver',
  'direct-nameserver',
  'direct-nameserver-follow-policy',
  'respect-rules',
  'cache-algorithm',
])

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

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((x) => String(x))
}

function asEnhancedMode(v: unknown): DnsEnhancedMode | undefined {
  return v === 'fake-ip' || v === 'redir-host' || v === 'normal' ? v : undefined
}

function asFakeIpFilterMode(v: unknown): DnsFakeIpFilterMode | undefined {
  return v === 'blacklist' || v === 'whitelist' ? v : undefined
}

function asCacheAlgorithm(v: unknown): DnsCacheAlgorithm | undefined {
  return v === 'arc' || v === 'lru' ? v : undefined
}

function asFallbackFilter(v: unknown): DnsFallbackFilter | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const rec = v as Record<string, unknown>
  const out: DnsFallbackFilter = {}
  if (typeof rec.geoip === 'boolean') out.geoip = rec.geoip
  if (typeof rec['geoip-code'] === 'string') out['geoip-code'] = rec['geoip-code']
  const geosite = asStringArray(rec.geosite)
  if (geosite) out.geosite = geosite
  const ipcidr = asStringArray(rec.ipcidr)
  if (ipcidr) out.ipcidr = ipcidr
  const domain = asStringArray(rec.domain)
  if (domain) out.domain = domain
  return out
}

function asNameserverPolicy(v: unknown): Record<string, string | string[]> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const rec = v as Record<string, unknown>
  const out: Record<string, string | string[]> = {}
  for (const [k, raw] of Object.entries(rec)) {
    if (typeof raw === 'string') out[k] = raw
    else if (Array.isArray(raw)) out[k] = raw.map((x) => String(x))
  }
  return out
}

export function getDnsConfig(doc: Document): DnsConfig {
  const raw = toJSON(doc.getIn(['dns']))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const out: DnsConfig = {}

  const enable = asBool(rec.enable)
  if (enable !== undefined) out.enable = enable
  const ipv6 = asBool(rec.ipv6)
  if (ipv6 !== undefined) out.ipv6 = ipv6
  const listen = asString(rec.listen)
  if (listen !== undefined) out.listen = listen
  const enhanced = asEnhancedMode(rec['enhanced-mode'])
  if (enhanced !== undefined) out['enhanced-mode'] = enhanced
  const fakeRange = asString(rec['fake-ip-range'])
  if (fakeRange !== undefined) out['fake-ip-range'] = fakeRange
  const useHosts = asBool(rec['use-hosts'])
  if (useHosts !== undefined) out['use-hosts'] = useHosts
  const useSysHosts = asBool(rec['use-system-hosts'])
  if (useSysHosts !== undefined) out['use-system-hosts'] = useSysHosts
  const fakeFilter = asStringArray(rec['fake-ip-filter'])
  if (fakeFilter !== undefined) out['fake-ip-filter'] = fakeFilter
  const fakeFilterMode = asFakeIpFilterMode(rec['fake-ip-filter-mode'])
  if (fakeFilterMode !== undefined) out['fake-ip-filter-mode'] = fakeFilterMode
  const defaultNs = asStringArray(rec['default-nameserver'])
  if (defaultNs !== undefined) out['default-nameserver'] = defaultNs
  const mainNs = asStringArray(rec.nameserver)
  if (mainNs !== undefined) out.nameserver = mainNs
  const fallback = asStringArray(rec.fallback)
  if (fallback !== undefined) out.fallback = fallback
  const fallbackFilter = asFallbackFilter(rec['fallback-filter'])
  if (fallbackFilter !== undefined) out['fallback-filter'] = fallbackFilter
  const policy = asNameserverPolicy(rec['nameserver-policy'])
  if (policy !== undefined) out['nameserver-policy'] = policy
  const proxyNs = asStringArray(rec['proxy-server-nameserver'])
  if (proxyNs !== undefined) out['proxy-server-nameserver'] = proxyNs
  const directNs = asStringArray(rec['direct-nameserver'])
  if (directNs !== undefined) out['direct-nameserver'] = directNs
  const directFollow = asBool(rec['direct-nameserver-follow-policy'])
  if (directFollow !== undefined) out['direct-nameserver-follow-policy'] = directFollow
  const respect = asBool(rec['respect-rules'])
  if (respect !== undefined) out['respect-rules'] = respect
  const cache = asCacheAlgorithm(rec['cache-algorithm'])
  if (cache !== undefined) out['cache-algorithm'] = cache

  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras

  return out
}
