// TunConfig — typed projection of mihomo's top-level `tun:` section.
//
// Same philosophy as DnsConfig: the schema is intentionally loose because
// mihomo grows new TUN knobs across versions. Unknown keys flow through via
// the `extras` bag so the view projection can round-trip a doc that contains
// fields Miharbor doesn't yet model.
//
// All fields are JSON-serializable plain data so the shape survives a
// JSON.stringify → HTTP → JSON.parse round-trip unchanged.

import { Type } from '@sinclair/typebox'

export type TunStack = 'system' | 'gvisor' | 'mixed'

export interface TunConfig {
  enable?: boolean
  /** TUN interface name (e.g. "mihomo-tun"). Empty → mihomo picks default,
   *  which varies by OS and is generally a footgun on multi-NIC hosts. */
  device?: string
  stack?: TunStack
  'auto-route'?: boolean
  'auto-redirect'?: boolean
  /** When true, mihomo picks the "primary" interface automatically. Breaks
   *  on dual-NIC routers where WAN≠the default. Prefer `interface-name`. */
  'auto-detect-interface'?: boolean
  'strict-route'?: boolean
  mtu?: number
  /** List of IP:port entries that TUN intercepts (DNS takeover). Empty
   *  array = feature explicitly disabled. */
  'dns-hijack'?: string[]
  /** CIDRs to route through TUN (in addition to defaults). */
  'route-address'?: string[]
  /** CIDRs to NOT route through TUN. MUST include every proxy-node server IP
   *  (as /32) to prevent self-intercept loops when stack='system'. */
  'route-exclude-address'?: string[]
  'inet4-address'?: string[]
  'inet6-address'?: string[]
  /** Explicit WAN interface binding (preferred over auto-detect-interface). */
  'interface-name'?: string
  'endpoint-independent-nat'?: boolean
  'exclude-interface'?: string[]
  /** Unknown keys preserved verbatim (e.g. future mihomo features). */
  extras?: Record<string, unknown>
}

// --- TypeBox schemas ------------------------------------------------------

export const TunStackSchema = Type.Union([
  Type.Literal('system'),
  Type.Literal('gvisor'),
  Type.Literal('mixed'),
])

export const TunConfigSchema = Type.Object(
  {
    enable: Type.Optional(Type.Boolean()),
    device: Type.Optional(Type.String()),
    stack: Type.Optional(TunStackSchema),
    'auto-route': Type.Optional(Type.Boolean()),
    'auto-redirect': Type.Optional(Type.Boolean()),
    'auto-detect-interface': Type.Optional(Type.Boolean()),
    'strict-route': Type.Optional(Type.Boolean()),
    mtu: Type.Optional(Type.Number()),
    'dns-hijack': Type.Optional(Type.Array(Type.String())),
    'route-address': Type.Optional(Type.Array(Type.String())),
    'route-exclude-address': Type.Optional(Type.Array(Type.String())),
    'inet4-address': Type.Optional(Type.Array(Type.String())),
    'inet6-address': Type.Optional(Type.Array(Type.String())),
    'interface-name': Type.Optional(Type.String()),
    'endpoint-independent-nat': Type.Optional(Type.Boolean()),
    'exclude-interface': Type.Optional(Type.Array(Type.String())),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

// --- Guardrail helpers ----------------------------------------------------
//
// Pure helpers the UI + linter share. Each returns a human-readable reason
// string when a value fails the invariant, or null when it's fine. Keep
// these data-free — no i18n, no DOM. The UI wraps the return value in a
// localized string.

/** `tun.device` empty → mihomo picks OS default (utun* on macOS, tun* on
 *  Linux). Works for single-box setups; on a router with a dedicated name
 *  (e.g. "mihomo-tun") this becomes a diagnostic hazard. */
export function validateTunDevice(device: string | undefined): string | null {
  if (!device || device.trim().length === 0) {
    return 'tun.device is unset — mihomo will pick a default that varies by OS'
  }
  return null
}

/** Cross-reference: every proxy-server IP must appear (as bare IP or /32
 *  CIDR) in `route-exclude-address` to prevent self-intercept. Returns the
 *  list of proxy IPs that are MISSING from the exclusion list; empty result
 *  means all are covered. Callers pass the already-collected proxy IPs. */
export function findMissingRouteExcludes(
  proxyServerIps: readonly string[],
  routeExcludeAddress: readonly string[] | undefined,
): string[] {
  if (proxyServerIps.length === 0) return []
  const haystack = new Set<string>()
  for (const entry of routeExcludeAddress ?? []) {
    const bare = entry.replace(/\/\d+$/, '').trim()
    if (bare.length > 0) haystack.add(bare)
    haystack.add(entry.trim())
  }
  const missing: string[] = []
  for (const ip of proxyServerIps) {
    const bare = ip.trim()
    if (bare.length === 0) continue
    // Match by bare IP (`1.2.3.4`), or by `1.2.3.4/32`, or any exact CIDR
    // already in the list (user may have excluded a wider subnet).
    if (haystack.has(bare) || haystack.has(`${bare}/32`)) continue
    // Wider subnet coverage: we cannot do CIDR math without pulling a
    // dependency. Fall back to an exact-prefix check — a user who wants to
    // exclude `1.2.3.0/24` gets credit for `1.2.3` as a prefix of the bare
    // IP. This keeps the warning quiet when the user has intentionally
    // excluded a block (the linter can do proper CIDR math separately).
    let covered = false
    for (const excl of routeExcludeAddress ?? []) {
      const trimmed = excl.trim()
      const slash = trimmed.indexOf('/')
      if (slash < 0) continue
      const prefix = trimmed.slice(0, slash)
      if (!prefix || bare === prefix) {
        covered = true
        break
      }
      // Accept a dotted-octet prefix match (e.g. `10.0.0.0/8` covers
      // `10.0.0.5`). This is an approximation — a /16 will also match a
      // bare IP whose first two octets differ in the last character — but
      // it's good enough to silence the warning without a CIDR library.
      const prefixParts = prefix.split('.')
      const bareParts = bare.split('.')
      if (prefixParts.length === 4 && bareParts.length === 4) {
        const mask = parseInt(trimmed.slice(slash + 1), 10)
        if (!Number.isFinite(mask) || mask < 0 || mask > 32) continue
        const octetMatchCount = Math.floor(mask / 8)
        let match = true
        for (let i = 0; i < octetMatchCount; i++) {
          if (prefixParts[i] !== bareParts[i]) {
            match = false
            break
          }
        }
        if (match && octetMatchCount > 0) {
          covered = true
          break
        }
      }
    }
    if (!covered) missing.push(bare)
  }
  return missing
}
