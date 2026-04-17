// Sniffer view — projects a mihomo `sniffer:` section into a typed
// `SnifferConfig`. Mirror of dns.ts / tun.ts (same philosophy): known fields
// coerce to their declared types, unknown fields land in `extras` so the UI
// can round-trip docs containing knobs Miharbor doesn't yet model.
//
// The `sniff:` sub-map has one entry per protocol (HTTP / TLS / QUIC). Each
// known protocol is projected into a SnifferProtocolConfig; unrecognised
// protocol keys land on `sniff.extras`.

import type { Document } from 'yaml'
import type {
  SnifferConfig,
  SnifferProtocol,
  SnifferProtocolConfig,
  SnifferProtocolMap,
} from 'miharbor-shared'

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set([
  'enable',
  'override-destination',
  'parse-pure-ip',
  'sniff',
  'force-domain',
  'skip-domain',
  'force-dns-mapping',
  'port-whitelist',
])

const KNOWN_PROTOCOLS: readonly SnifferProtocol[] = ['HTTP', 'TLS', 'QUIC']

const KNOWN_PROTOCOL_KEYS: ReadonlySet<string> = new Set(['ports', 'override-destination'])

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

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((x) => String(x))
}

function projectProtocolConfig(raw: unknown): SnifferProtocolConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const out: SnifferProtocolConfig = {}
  const ports = asStringArray(rec.ports)
  if (ports !== undefined) out.ports = ports
  const override = asBool(rec['override-destination'])
  if (override !== undefined) out['override-destination'] = override

  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_PROTOCOL_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras
  return out
}

function projectSniffMap(raw: unknown): SnifferProtocolMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const out: SnifferProtocolMap = {}
  for (const proto of KNOWN_PROTOCOLS) {
    const cfg = projectProtocolConfig(rec[proto])
    if (cfg !== undefined) out[proto] = cfg
  }
  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if ((KNOWN_PROTOCOLS as readonly string[]).includes(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras
  // An entirely empty sniff: {} map still round-trips as {} to preserve
  // intent (user explicitly set it empty).
  return out
}

/** Read the `sniffer:` section from `doc` and return a `SnifferConfig`.
 *  Absent keys stay undefined; unknown keys land in `extras` so the
 *  round-trip is non-destructive. Safe to call on a doc without a
 *  `sniffer:` section (returns {}). */
export function getSnifferConfig(doc: Document): SnifferConfig {
  const raw = toJSON(doc.getIn(['sniffer']))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const out: SnifferConfig = {}

  const enable = asBool(rec.enable)
  if (enable !== undefined) out.enable = enable
  const override = asBool(rec['override-destination'])
  if (override !== undefined) out['override-destination'] = override
  const parsePureIp = asBool(rec['parse-pure-ip'])
  if (parsePureIp !== undefined) out['parse-pure-ip'] = parsePureIp
  const sniff = projectSniffMap(rec.sniff)
  if (sniff !== undefined) out.sniff = sniff
  const forceDomain = asStringArray(rec['force-domain'])
  if (forceDomain !== undefined) out['force-domain'] = forceDomain
  const skipDomain = asStringArray(rec['skip-domain'])
  if (skipDomain !== undefined) out['skip-domain'] = skipDomain
  const forceDnsMapping = asBool(rec['force-dns-mapping'])
  if (forceDnsMapping !== undefined) out['force-dns-mapping'] = forceDnsMapping
  const portWhitelist = asStringArray(rec['port-whitelist'])
  if (portWhitelist !== undefined) out['port-whitelist'] = portWhitelist

  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_TOP_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras

  return out
}
