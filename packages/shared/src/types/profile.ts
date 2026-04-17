// ProfileConfig — typed projection of mihomo's TOP-LEVEL config fields that
// don't belong to a nested section like dns/tun/sniffer. These are the
// operational knobs the operator usually touches first (mode, log-level,
// mixed-port, external-controller, secret, authentication, geo-* knobs, etc.).
//
// Same philosophy as DnsConfig / TunConfig / SnifferConfig: known fields
// coerce to their declared types, unknown keys survive via the `extras` bag.
// Unlike the other views, this one projects from the DOCUMENT ROOT rather
// than a sub-map — but the projection leaves the other nested sections
// (dns/tun/sniffer/rules/proxies/proxy-groups/…) untouched, so the mutator
// only re-writes the top-level scalars it knows about.
//
// `authentication:` is a `string[]` of "user:pass" entries in mihomo. The UI
// projection keeps the raw list as-is; separate helpers parse the list into
// visible usernames for the "show usernames, edit passwords" UX.
//
// All fields are JSON-serialisable plain data so the shape round-trips
// JSON.stringify → HTTP → JSON.parse unchanged.

import { Type } from '@sinclair/typebox'

export type ProfileMode = 'rule' | 'global' | 'direct'
export type ProfileLogLevel = 'silent' | 'error' | 'warning' | 'info' | 'debug'
export type ProfileFindProcessMode = 'off' | 'strict' | 'always'

/** `profile:` nested sub-section (mihomo's own nested block). */
export interface ProfileNested {
  'store-selected'?: boolean
  'store-fake-ip'?: boolean
  /** Unknown sub-keys preserved verbatim. */
  extras?: Record<string, unknown>
}

export interface ProfileConfig {
  mode?: ProfileMode
  'log-level'?: ProfileLogLevel
  /** Mixed HTTP+SOCKS5 listener port. Absent on TUN-only setups. */
  'mixed-port'?: number
  'allow-lan'?: boolean
  /** Interface bind for mixed-port; "*" means all interfaces (mihomo default). */
  'bind-address'?: string
  /** GUARDRAIL: IPv6 stays disabled until burn-in per runbook. */
  ipv6?: boolean
  /** GUARDRAIL: ensure `secret:` is set if not localhost-only. */
  'external-controller'?: string
  /** Bearer token for external-controller. Masked in UI. */
  secret?: string
  /** Path to the dashboard assets (e.g. `./zash`). */
  'external-ui'?: string
  'external-ui-name'?: string
  'external-ui-url'?: string
  'tcp-concurrent'?: boolean
  'unified-delay'?: boolean
  'find-process-mode'?: ProfileFindProcessMode
  'global-client-fingerprint'?: string
  'geodata-mode'?: boolean
  'geo-auto-update'?: boolean
  /** Hours between geodata refreshes. */
  'geo-update-interval'?: number
  'keep-alive-interval'?: number
  /** mihomo's nested `profile:` sub-section. */
  profile?: ProfileNested
  /** `user:pass` entries for HTTP proxy auth. Passwords are NEVER displayed
   *  after save — the UI only surfaces the usernames. */
  authentication?: string[]
  /** Unknown top-level keys from the set this projection knows about.
   *  (The mutator only touches keys it recognises; top-level keys like
   *  `rules:`, `proxies:`, `proxy-groups:`, `dns:`, `tun:`, `sniffer:` are
   *  preserved by the doc because the projection never touches them.) */
  extras?: Record<string, unknown>
}

// --- TypeBox schemas ------------------------------------------------------

export const ProfileModeSchema = Type.Union([
  Type.Literal('rule'),
  Type.Literal('global'),
  Type.Literal('direct'),
])

export const ProfileLogLevelSchema = Type.Union([
  Type.Literal('silent'),
  Type.Literal('error'),
  Type.Literal('warning'),
  Type.Literal('info'),
  Type.Literal('debug'),
])

export const ProfileFindProcessModeSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('strict'),
  Type.Literal('always'),
])

export const ProfileNestedSchema = Type.Object(
  {
    'store-selected': Type.Optional(Type.Boolean()),
    'store-fake-ip': Type.Optional(Type.Boolean()),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

export const ProfileConfigSchema = Type.Object(
  {
    mode: Type.Optional(ProfileModeSchema),
    'log-level': Type.Optional(ProfileLogLevelSchema),
    'mixed-port': Type.Optional(Type.Number()),
    'allow-lan': Type.Optional(Type.Boolean()),
    'bind-address': Type.Optional(Type.String()),
    ipv6: Type.Optional(Type.Boolean()),
    'external-controller': Type.Optional(Type.String()),
    secret: Type.Optional(Type.String()),
    'external-ui': Type.Optional(Type.String()),
    'external-ui-name': Type.Optional(Type.String()),
    'external-ui-url': Type.Optional(Type.String()),
    'tcp-concurrent': Type.Optional(Type.Boolean()),
    'unified-delay': Type.Optional(Type.Boolean()),
    'find-process-mode': Type.Optional(ProfileFindProcessModeSchema),
    'global-client-fingerprint': Type.Optional(Type.String()),
    'geodata-mode': Type.Optional(Type.Boolean()),
    'geo-auto-update': Type.Optional(Type.Boolean()),
    'geo-update-interval': Type.Optional(Type.Number()),
    'keep-alive-interval': Type.Optional(Type.Number()),
    profile: Type.Optional(ProfileNestedSchema),
    authentication: Type.Optional(Type.Array(Type.String())),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

// --- Guardrail helpers ----------------------------------------------------
//
// Pure helpers the UI + linter share. Each returns a short reason string
// when the value fails the invariant, or null when it's fine. No i18n / no
// DOM — callers wrap the return in their own localised strings.

/** `ipv6: true` is discouraged for the first-rollout phase. The runbook
 *  invariant keeps IPv6 disabled until burn-in — the UI surfaces this plate
 *  whenever the operator flips the switch. */
export function validateIpv6Enabled(ipv6: boolean | undefined): string | null {
  if (ipv6 === true) {
    return 'ipv6 is enabled — runbook first-rollout rule keeps this off until burn-in'
  }
  return null
}

/** `external-controller` bound to anything other than 127.0.0.1 / localhost
 *  REQUIRES a `secret:` — otherwise any LAN host (or WireGuard peer in split
 *  mode) can control mihomo. Returns a reason when the combination is unsafe,
 *  or null when it's fine. */
export function validateExternalController(
  externalController: string | undefined,
  secret: string | undefined,
): string | null {
  if (!externalController || externalController.trim().length === 0) return null
  const trimmed = externalController.trim()
  // Accept literal loopback binds with no secret — they aren't reachable.
  const host = trimmed.split(':')[0] ?? ''
  const isLoopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  if (isLoopback) return null
  if (!secret || secret.trim().length === 0) {
    return 'external-controller is not localhost-only — set a secret to avoid an open control plane'
  }
  return null
}

/** Split a single authentication entry "user:pass" → { user, hasPassword }.
 *  A missing `:` is treated as a username-only entry with no password set
 *  (mihomo rejects such entries at parse time, but the UI should still
 *  surface them for correction rather than silently drop). */
export function parseAuthEntry(entry: string): { user: string; hasPassword: boolean } {
  const idx = entry.indexOf(':')
  if (idx < 0) return { user: entry, hasPassword: false }
  const user = entry.slice(0, idx)
  const pass = entry.slice(idx + 1)
  return { user, hasPassword: pass.length > 0 }
}

/** Serialise back to "user:pass". Empty password serialises as `user:`. */
export function serialiseAuthEntry(user: string, password: string): string {
  return `${user}:${password}`
}
