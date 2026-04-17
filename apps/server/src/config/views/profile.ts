// Profile view — projects the top-level scalar fields of a mihomo config
// (mode, log-level, external-controller, secret, authentication, etc.) into
// a typed `ProfileConfig`. Mirror of dns.ts / tun.ts / sniffer.ts but reading
// FROM THE DOCUMENT ROOT rather than a sub-map.
//
// Unlike the nested section views, this one has to carefully avoid copying
// well-known nested sections (`dns`, `tun`, `sniffer`, `rules`, `proxies`,
// `proxy-groups`, `rule-providers`, `proxy-providers`, `listeners`, etc.)
// into the `extras` bag — those keep being owned by their own view projections
// and mutators. Any top-level key we DON'T know about that ISN'T in the
// reserved-section list lands on `extras` so round-tripping is non-destructive.

import type { Document } from 'yaml'
import type {
  ProfileConfig,
  ProfileFindProcessMode,
  ProfileLogLevel,
  ProfileMode,
  ProfileNested,
} from 'miharbor-shared'

/** Top-level keys this projection owns. Anything else on the doc root either
 *  belongs to another view (see SECTION_KEYS) or lands in `extras`. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'mode',
  'log-level',
  'mixed-port',
  'allow-lan',
  'bind-address',
  'ipv6',
  'external-controller',
  'secret',
  'external-ui',
  'external-ui-name',
  'external-ui-url',
  'tcp-concurrent',
  'unified-delay',
  'find-process-mode',
  'global-client-fingerprint',
  'geodata-mode',
  'geo-auto-update',
  'geo-update-interval',
  'keep-alive-interval',
  'profile',
  'authentication',
])

/** Top-level keys that belong to OTHER views (dns/tun/sniffer/…) or to the
 *  structured plane (rules/proxies/proxy-groups/…). The projection leaves
 *  them alone — the mutator is likewise careful to never overwrite them. */
const SECTION_KEYS: ReadonlySet<string> = new Set([
  'dns',
  'tun',
  'sniffer',
  'rules',
  'proxies',
  'proxy-groups',
  'proxy-providers',
  'rule-providers',
  'listeners',
  'sub-rules',
  'hosts',
  'tunnels',
  'experimental',
  'log-file',
  'redir-port',
  'tproxy-port',
  'port',
  'socks-port',
  'routing-mark',
  'keep-alive-idle',
])

const KNOWN_PROFILE_SUB_KEYS: ReadonlySet<string> = new Set(['store-selected', 'store-fake-ip'])

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

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((x) => String(x))
}

function asMode(v: unknown): ProfileMode | undefined {
  if (v === 'rule' || v === 'global' || v === 'direct') return v
  return undefined
}

function asLogLevel(v: unknown): ProfileLogLevel | undefined {
  if (v === 'silent' || v === 'error' || v === 'warning' || v === 'info' || v === 'debug') {
    return v
  }
  return undefined
}

function asFindProcessMode(v: unknown): ProfileFindProcessMode | undefined {
  if (v === 'off' || v === 'strict' || v === 'always') return v
  return undefined
}

function projectProfileNested(raw: unknown): ProfileNested | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const out: ProfileNested = {}
  const storeSelected = asBool(rec['store-selected'])
  if (storeSelected !== undefined) out['store-selected'] = storeSelected
  const storeFakeIp = asBool(rec['store-fake-ip'])
  if (storeFakeIp !== undefined) out['store-fake-ip'] = storeFakeIp

  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_PROFILE_SUB_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras
  return out
}

/** Read top-level profile fields from `doc` and return a `ProfileConfig`.
 *  Absent keys stay undefined; unknown top-level keys that are NOT reserved
 *  sections land in `extras`. Safe to call on any doc. */
export function getProfileConfig(doc: Document): ProfileConfig {
  const raw = toJSON(doc.contents)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const out: ProfileConfig = {}

  const mode = asMode(rec.mode)
  if (mode !== undefined) out.mode = mode
  const logLevel = asLogLevel(rec['log-level'])
  if (logLevel !== undefined) out['log-level'] = logLevel
  const mixedPort = asNumber(rec['mixed-port'])
  if (mixedPort !== undefined) out['mixed-port'] = mixedPort
  const allowLan = asBool(rec['allow-lan'])
  if (allowLan !== undefined) out['allow-lan'] = allowLan
  const bindAddress = asString(rec['bind-address'])
  if (bindAddress !== undefined) out['bind-address'] = bindAddress
  const ipv6 = asBool(rec.ipv6)
  if (ipv6 !== undefined) out.ipv6 = ipv6
  const externalController = asString(rec['external-controller'])
  if (externalController !== undefined) out['external-controller'] = externalController
  const secret = asString(rec.secret)
  if (secret !== undefined) out.secret = secret
  const externalUi = asString(rec['external-ui'])
  if (externalUi !== undefined) out['external-ui'] = externalUi
  const externalUiName = asString(rec['external-ui-name'])
  if (externalUiName !== undefined) out['external-ui-name'] = externalUiName
  const externalUiUrl = asString(rec['external-ui-url'])
  if (externalUiUrl !== undefined) out['external-ui-url'] = externalUiUrl
  const tcpConcurrent = asBool(rec['tcp-concurrent'])
  if (tcpConcurrent !== undefined) out['tcp-concurrent'] = tcpConcurrent
  const unifiedDelay = asBool(rec['unified-delay'])
  if (unifiedDelay !== undefined) out['unified-delay'] = unifiedDelay
  const findProcessMode = asFindProcessMode(rec['find-process-mode'])
  if (findProcessMode !== undefined) out['find-process-mode'] = findProcessMode
  const fingerprint = asString(rec['global-client-fingerprint'])
  if (fingerprint !== undefined) out['global-client-fingerprint'] = fingerprint
  const geodataMode = asBool(rec['geodata-mode'])
  if (geodataMode !== undefined) out['geodata-mode'] = geodataMode
  const geoAutoUpdate = asBool(rec['geo-auto-update'])
  if (geoAutoUpdate !== undefined) out['geo-auto-update'] = geoAutoUpdate
  const geoUpdateInterval = asNumber(rec['geo-update-interval'])
  if (geoUpdateInterval !== undefined) out['geo-update-interval'] = geoUpdateInterval
  const keepAliveInterval = asNumber(rec['keep-alive-interval'])
  if (keepAliveInterval !== undefined) out['keep-alive-interval'] = keepAliveInterval
  const profileNested = projectProfileNested(rec.profile)
  if (profileNested !== undefined) out.profile = profileNested
  const authentication = asStringArray(rec.authentication)
  if (authentication !== undefined) out.authentication = authentication

  // Preserve unknown top-level keys that are NOT reserved sections so the
  // round-trip is non-destructive. Nested sections (`dns`, `tun`, etc.) are
  // owned by their own views and must NOT appear here.
  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_KEYS.has(k)) continue
    if (SECTION_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras

  return out
}
