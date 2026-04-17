// SnifferConfig — typed projection of mihomo's top-level `sniffer:` section.
//
// Mirror of DnsConfig / TunConfig: the schema is loose on purpose because
// mihomo grows new sniffer knobs across versions. Unknown keys survive via
// the `extras` bag, and per-protocol unknown keys survive via each protocol's
// own `extras`. Everything is JSON-serialisable plain data so the shape
// round-trips HTTP JSON without surprises.

import { Type } from '@sinclair/typebox'

/** Protocol names mihomo's sniffer understands. HTTP/TLS/QUIC are the only
 *  ones currently documented; future protocols go in each instance's
 *  `extras` on SnifferProtocolMap. */
export type SnifferProtocol = 'HTTP' | 'TLS' | 'QUIC'

/** Per-protocol configuration under `sniffer.sniff.<PROTOCOL>`. Each protocol
 *  has a `ports` list of port-range strings (e.g. "80", "8080-8090") and
 *  HTTP additionally allows a per-protocol `override-destination`. */
export interface SnifferProtocolConfig {
  /** Port ranges monitored for this protocol. Each entry is either a single
   *  port ("80") or an inclusive range ("80-90"). Comma-separated lists
   *  ("80,443") are NOT valid — use multiple entries. */
  ports?: string[]
  /** HTTP only: overrides the top-level `override-destination` for this
   *  protocol. Other protocols pass this through `extras` verbatim. */
  'override-destination'?: boolean
  /** Preserved verbatim. */
  extras?: Record<string, unknown>
}

export interface SnifferProtocolMap {
  HTTP?: SnifferProtocolConfig
  TLS?: SnifferProtocolConfig
  QUIC?: SnifferProtocolConfig
  /** Future / unknown protocol entries. */
  extras?: Record<string, unknown>
}

export interface SnifferConfig {
  enable?: boolean
  /** GUARDRAIL: rewrites the rule-matching destination from IP to the
   *  sniffed domain. Useful but surprising — understand before enabling. */
  'override-destination'?: boolean
  /** Sniff pure-IP connections (no domain hint). */
  'parse-pure-ip'?: boolean
  /** Per-protocol config. Each key's shape matches SnifferProtocolConfig. */
  sniff?: SnifferProtocolMap
  /** Domains that always use the sniffed hostname regardless of
   *  `override-destination`. */
  'force-domain'?: string[]
  /** Domains that skip sniffing entirely. */
  'skip-domain'?: string[]
  /** When true, the sniffed hostname is also injected into mihomo's DNS
   *  cache (useful for rule-based routing by domain after IP is already
   *  known). */
  'force-dns-mapping'?: boolean
  /** If non-empty, ONLY these ports are ever sniffed, overriding each
   *  protocol's `ports` list. Mutually redundant with per-protocol ports
   *  but mihomo allows both — the whitelist wins. */
  'port-whitelist'?: string[]
  /** Unknown keys preserved verbatim (future mihomo fields). */
  extras?: Record<string, unknown>
}

// --- TypeBox schemas ------------------------------------------------------

export const SnifferProtocolSchema = Type.Union([
  Type.Literal('HTTP'),
  Type.Literal('TLS'),
  Type.Literal('QUIC'),
])

export const SnifferProtocolConfigSchema = Type.Object(
  {
    ports: Type.Optional(Type.Array(Type.String())),
    'override-destination': Type.Optional(Type.Boolean()),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

export const SnifferProtocolMapSchema = Type.Object(
  {
    HTTP: Type.Optional(SnifferProtocolConfigSchema),
    TLS: Type.Optional(SnifferProtocolConfigSchema),
    QUIC: Type.Optional(SnifferProtocolConfigSchema),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

export const SnifferConfigSchema = Type.Object(
  {
    enable: Type.Optional(Type.Boolean()),
    'override-destination': Type.Optional(Type.Boolean()),
    'parse-pure-ip': Type.Optional(Type.Boolean()),
    sniff: Type.Optional(SnifferProtocolMapSchema),
    'force-domain': Type.Optional(Type.Array(Type.String())),
    'skip-domain': Type.Optional(Type.Array(Type.String())),
    'force-dns-mapping': Type.Optional(Type.Boolean()),
    'port-whitelist': Type.Optional(Type.Array(Type.String())),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

// --- Port range validator --------------------------------------------------

/** Accepts a single port ("80") or a closed inclusive range ("80-90").
 *  Rejects:
 *    - empty / whitespace-only input
 *    - comma-separated lists ("80,443" — use multiple entries instead)
 *    - non-numeric tokens
 *    - out-of-range ports (<1 or >65535)
 *    - reversed ranges (e.g. "90-80")
 *  Returns a short human-readable reason when invalid, or null when the
 *  value is fine. The caller is responsible for localising the string. */
export function validatePortRange(value: string | undefined): string | null {
  if (value === undefined) return 'port range is empty'
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'port range is empty'
  if (trimmed.includes(',')) {
    return 'port range cannot contain commas — split into multiple entries'
  }
  // Reject stray whitespace inside the value — "80 - 90" / "80 -90" would
  // otherwise masquerade as a valid range.
  if (/\s/.test(trimmed)) return 'port range cannot contain whitespace'
  const parts = trimmed.split('-')
  if (parts.length === 1) {
    const only = parts[0]!
    return validateSinglePort(only)
  }
  if (parts.length !== 2) return 'port range must be "N" or "N-M"'
  const [lo, hi] = parts as [string, string]
  const loErr = validateSinglePort(lo)
  if (loErr) return loErr
  const hiErr = validateSinglePort(hi)
  if (hiErr) return hiErr
  const loN = Number(lo)
  const hiN = Number(hi)
  if (loN > hiN) return 'port range is reversed — low must be ≤ high'
  return null
}

function validateSinglePort(raw: string): string | null {
  if (raw.length === 0) return 'port is empty'
  // Reject negative sign, decimals, hex, etc. — only digits allowed.
  if (!/^\d+$/.test(raw)) return `port "${raw}" is not a positive integer`
  const n = Number(raw)
  if (!Number.isFinite(n)) return `port "${raw}" is not finite`
  if (n < 1) return `port "${raw}" must be ≥ 1`
  if (n > 65535) return `port "${raw}" must be ≤ 65535`
  return null
}
