// Rule-providers (`rule-providers:`) — typed projection of mihomo's
// external rule-set lists (adblock, geosite, etc.).
//
// Shape (map of name → provider):
//   rule-providers:
//     adblock:
//       type: http
//       behavior: domain
//       format: yaml
//       url: https://example.com/adblock.yaml
//       interval: 86400
//       proxy: PROXY
//     my-file:
//       type: file
//       behavior: classical
//       format: text
//       path: ./rules/my-rules.txt
//     inline-blocks:
//       type: inline
//       behavior: classical
//       payload:
//         - DOMAIN-SUFFIX,evil.example
//         - DOMAIN-KEYWORD,tracker
//
// Like the other section types, unknown per-provider keys are preserved
// via each provider's `extras` bag, and unknown per-map entries (pass-
// through of future shapes) are preserved via the top-level `extras` on
// `RuleProvidersConfig`.

import { Type } from '@sinclair/typebox'

/** Transport the provider uses to fetch its ruleset. */
export type RuleProviderType = 'http' | 'file' | 'inline'

/** How mihomo interprets the fetched payload. */
export type RuleProviderBehavior = 'domain' | 'ipcidr' | 'classical'

/** Encoding of the fetched payload. Only meaningful for http/file. */
export type RuleProviderFormat = 'yaml' | 'text' | 'mrs'

export interface RuleProviderConfig {
  /** Required — selects the transport. */
  type: RuleProviderType
  /** Required — rule-matching behavior. */
  behavior: RuleProviderBehavior
  /** Required for type=http/file (mihomo needs to parse the payload).
   *  Optional for type=inline (no wire format — payload IS the rules). */
  format?: RuleProviderFormat
  /** HTTP only: URL mihomo fetches the rule-set from. */
  url?: string
  /** HTTP only: refresh interval in seconds. Zero or missing disables
   *  automatic refresh (operator uses the refresh button instead). */
  interval?: number
  /** HTTP only: optional proxy-group name mihomo routes the fetch through
   *  (useful when the rule-set host is geo-blocked or requires the VPN to
   *  reach). */
  proxy?: string
  /** FILE only: path to a local file mihomo reads on startup + refresh.
   *  Relative to mihomo's config directory. */
  path?: string
  /** INLINE only: an array of rule strings, one per payload entry. Each
   *  string is a rule body without the leading "RULE-SET,<name>," — e.g.
   *  "DOMAIN-SUFFIX,example.com", "IP-CIDR,10.0.0.0/8,no-resolve". */
  payload?: string[]
  /** Unknown per-provider keys (future mihomo knobs). */
  extras?: Record<string, unknown>
}

/** Complete `rule-providers:` section. Key = provider name. Values that
 *  don't parse into a RuleProviderConfig (bad type, missing required
 *  fields at projection time) land on `extras` verbatim so round-trip is
 *  non-destructive. */
export interface RuleProvidersConfig {
  /** Name → provider config. Order here is insertion order from the
   *  original YAML so the UI can show providers in a stable order. */
  providers?: Record<string, RuleProviderConfig>
  /** Preserved verbatim: entries whose shape we couldn't project, and
   *  keys the operator added that aren't map entries. */
  extras?: Record<string, unknown>
}

// --- TypeBox schemas ------------------------------------------------------

export const RuleProviderTypeSchema = Type.Union([
  Type.Literal('http'),
  Type.Literal('file'),
  Type.Literal('inline'),
])

export const RuleProviderBehaviorSchema = Type.Union([
  Type.Literal('domain'),
  Type.Literal('ipcidr'),
  Type.Literal('classical'),
])

export const RuleProviderFormatSchema = Type.Union([
  Type.Literal('yaml'),
  Type.Literal('text'),
  Type.Literal('mrs'),
])

export const RuleProviderConfigSchema = Type.Object(
  {
    type: RuleProviderTypeSchema,
    behavior: RuleProviderBehaviorSchema,
    format: Type.Optional(RuleProviderFormatSchema),
    url: Type.Optional(Type.String()),
    interval: Type.Optional(Type.Number()),
    proxy: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    payload: Type.Optional(Type.Array(Type.String())),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

export const RuleProvidersConfigSchema = Type.Object(
  {
    providers: Type.Optional(Type.Record(Type.String(), RuleProviderConfigSchema)),
    extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
)

// --- Validators -----------------------------------------------------------

/** Validate a provider name. Mihomo uses the name as the ruleset identifier
 *  in `rules:` (e.g. `RULE-SET,<name>,PROXY`). Reject empty, whitespace, and
 *  commas (would break the rules parser). */
export function validateProviderName(name: string | undefined): string | null {
  if (name === undefined) return 'name is required'
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'name is required'
  if (/\s/.test(trimmed)) return 'name cannot contain whitespace'
  if (trimmed.includes(',')) return 'name cannot contain commas'
  return null
}

/** Validate a provider config against its declared `type`. Returns a
 *  human-readable reason when invalid, or null when fine. The caller
 *  localizes the message. */
export function validateProviderConfig(cfg: RuleProviderConfig): string | null {
  if (cfg.type === 'http') {
    if (!cfg.url || cfg.url.trim().length === 0) return 'url is required for type=http'
    if (cfg.interval === undefined || !Number.isFinite(cfg.interval) || cfg.interval <= 0) {
      return 'interval (>0 seconds) is required for type=http'
    }
  } else if (cfg.type === 'file') {
    if (!cfg.path || cfg.path.trim().length === 0) return 'path is required for type=file'
  } else if (cfg.type === 'inline') {
    if (!cfg.payload || cfg.payload.length === 0) {
      return 'payload must have at least one entry for type=inline'
    }
  }
  return null
}
