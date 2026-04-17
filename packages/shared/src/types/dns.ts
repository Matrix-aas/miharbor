// DnsConfig — typed projection of mihomo's top-level `dns:` section.
//
// Schema is intentionally loose: mihomo grows new DNS knobs across versions
// and we don't want to hard-fail on an unknown one. Unknown keys flow through
// via the `extras` bag so the view projection can round-trip a doc that
// contains fields Miharbor doesn't yet model.
//
// All fields are JSON-serializable plain data so the shape survives a
// JSON.stringify → HTTP → JSON.parse round-trip unchanged.

import { Type } from '@sinclair/typebox'

export type DnsEnhancedMode = 'fake-ip' | 'redir-host' | 'normal'
export type DnsFakeIpFilterMode = 'blacklist' | 'whitelist'
export type DnsCacheAlgorithm = 'arc' | 'lru'

export interface DnsFallbackFilter {
  geoip?: boolean
  'geoip-code'?: string
  geosite?: string[]
  ipcidr?: string[]
  domain?: string[]
}

export interface DnsConfig {
  enable?: boolean
  ipv6?: boolean
  /** Host:port. Invariant: should bind to `127.0.0.1:1053`, never `0.0.0.0:53`. */
  listen?: string
  'enhanced-mode'?: DnsEnhancedMode
  'fake-ip-range'?: string
  'use-hosts'?: boolean
  'use-system-hosts'?: boolean
  'fake-ip-filter'?: string[]
  'fake-ip-filter-mode'?: DnsFakeIpFilterMode
  /** Bootstrap resolvers — MUST be literal IPs (no hostnames). */
  'default-nameserver'?: string[]
  nameserver?: string[]
  fallback?: string[]
  'fallback-filter'?: DnsFallbackFilter
  /** domain-pattern → single resolver URL or list of URLs. */
  'nameserver-policy'?: Record<string, string | string[]>
  /** MUST be literal IPs, otherwise DNS loop. */
  'proxy-server-nameserver'?: string[]
  'direct-nameserver'?: string[]
  'direct-nameserver-follow-policy'?: boolean
  'respect-rules'?: boolean
  'cache-algorithm'?: DnsCacheAlgorithm
  /** Unknown keys preserved verbatim (e.g. future mihomo features). */
  extras?: Record<string, unknown>
}

// --- TypeBox schemas ------------------------------------------------------

export const DnsEnhancedModeSchema = Type.Union([
  Type.Literal('fake-ip'),
  Type.Literal('redir-host'),
  Type.Literal('normal'),
])

export const DnsFakeIpFilterModeSchema = Type.Union([
  Type.Literal('blacklist'),
  Type.Literal('whitelist'),
])

export const DnsCacheAlgorithmSchema = Type.Union([Type.Literal('arc'), Type.Literal('lru')])

export const DnsFallbackFilterSchema = Type.Object(
  {
    geoip: Type.Optional(Type.Boolean()),
    'geoip-code': Type.Optional(Type.String()),
    geosite: Type.Optional(Type.Array(Type.String())),
    ipcidr: Type.Optional(Type.Array(Type.String())),
    domain: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
)

export const DnsConfigSchema = Type.Object(
  {
    enable: Type.Optional(Type.Boolean()),
    ipv6: Type.Optional(Type.Boolean()),
    listen: Type.Optional(Type.String()),
    'enhanced-mode': Type.Optional(DnsEnhancedModeSchema),
    'fake-ip-range': Type.Optional(Type.String()),
    'use-hosts': Type.Optional(Type.Boolean()),
    'use-system-hosts': Type.Optional(Type.Boolean()),
    'fake-ip-filter': Type.Optional(Type.Array(Type.String())),
    'fake-ip-filter-mode': Type.Optional(DnsFakeIpFilterModeSchema),
    'default-nameserver': Type.Optional(Type.Array(Type.String())),
    nameserver: Type.Optional(Type.Array(Type.String())),
    fallback: Type.Optional(Type.Array(Type.String())),
    'fallback-filter': Type.Optional(DnsFallbackFilterSchema),
    'nameserver-policy': Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())])),
    ),
    'proxy-server-nameserver': Type.Optional(Type.Array(Type.String())),
    'direct-nameserver': Type.Optional(Type.Array(Type.String())),
    'direct-nameserver-follow-policy': Type.Optional(Type.Boolean()),
    'respect-rules': Type.Optional(Type.Boolean()),
    'cache-algorithm': Type.Optional(DnsCacheAlgorithmSchema),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

// --- Guardrail predicates -------------------------------------------------
// Pure helpers the UI + linters can share. Each returns a human-readable
// reason string when the value fails the invariant, or null when it's fine.

/** `dns.listen` should be `127.0.0.1:1053` (never `0.0.0.0:*` or `:53`). */
export function validateDnsListen(listen: string | undefined): string | null {
  if (!listen) return null
  if (listen.startsWith('0.0.0.0:') || listen === '0.0.0.0') {
    return 'dns.listen binds to 0.0.0.0 — exposes DNS on every interface'
  }
  if (listen.endsWith(':53')) {
    return 'dns.listen uses :53 — conflicts with AdGuardHome / systemd-resolved'
  }
  return null
}

/** Nameservers that MUST be literal IPs (hostnames cause DNS loops). */
export function validateLiteralIp(value: string): string | null {
  if (!value) return 'empty value'
  const trimmed = value.trim()
  // Strip scheme for DoH/DoT so we can validate the host part.
  let host = trimmed
  if (/^https?:\/\//i.test(trimmed) || /^tls:\/\//i.test(trimmed)) {
    try {
      host = new URL(trimmed).hostname
    } catch {
      return 'malformed URL'
    }
  }
  // Strip optional port.
  host = host.replace(/^\[(.+)\](?::\d+)?$/, '$1').replace(/:\d+$/, '')
  // IPv4 literal?
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return null
  // IPv6 literal?
  if (host.includes(':') && /^[0-9a-fA-F:]+$/.test(host)) return null
  return 'hostname-based resolver — must be a literal IP to avoid DNS loops'
}
