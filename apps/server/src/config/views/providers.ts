// Rule-providers view — projects mihomo's `rule-providers:` map (external
// ruleset definitions) into a typed `RuleProvidersConfig`. Mirror of
// dns.ts / tun.ts / sniffer.ts / profile.ts.
//
// Each entry under `rule-providers:` is keyed by provider name and carries
// a sub-map with type/behavior/format plus transport-specific fields. The
// projection coerces known fields to their declared types; unknown per-
// provider keys land on each provider's `extras`. Entries whose shape
// doesn't parse (e.g. missing `type`, non-object value) round-trip through
// the top-level `extras` so the raw YAML is preserved byte-for-byte on
// round-trip through the mutator.
//
// Note: this view deliberately does NOT validate required fields per type
// (url for http, path for file, payload for inline). That's the UI's job
// — the projection's contract is "whatever's on disk, typed". Validation
// runs in the form layer so the operator can see the exact reason a
// provider is invalid.

import type { Document } from 'yaml'
import type {
  RuleProviderBehavior,
  RuleProviderConfig,
  RuleProviderFormat,
  RuleProviderType,
  RuleProvidersConfig,
} from 'miharbor-shared'

const KNOWN_PROVIDER_KEYS: ReadonlySet<string> = new Set([
  'type',
  'behavior',
  'format',
  'url',
  'interval',
  'proxy',
  'path',
  'payload',
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

function asType(v: unknown): RuleProviderType | undefined {
  if (v === 'http' || v === 'file' || v === 'inline') return v
  return undefined
}

function asBehavior(v: unknown): RuleProviderBehavior | undefined {
  if (v === 'domain' || v === 'ipcidr' || v === 'classical') return v
  return undefined
}

function asFormat(v: unknown): RuleProviderFormat | undefined {
  if (v === 'yaml' || v === 'text' || v === 'mrs') return v
  return undefined
}

/** Project a single provider map entry. Returns null when the shape can't
 *  be projected (unknown `type` value, missing `type`, missing `behavior`,
 *  non-object entry). The caller puts the raw node into `extras` so the
 *  round-trip stays non-destructive. */
function projectProvider(raw: unknown): RuleProviderConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const type = asType(rec.type)
  const behavior = asBehavior(rec.behavior)
  if (type === undefined || behavior === undefined) return null
  const out: RuleProviderConfig = { type, behavior }
  const format = asFormat(rec.format)
  if (format !== undefined) out.format = format
  const url = asString(rec.url)
  if (url !== undefined) out.url = url
  const interval = asNumber(rec.interval)
  if (interval !== undefined) out.interval = interval
  const proxy = asString(rec.proxy)
  if (proxy !== undefined) out.proxy = proxy
  const path = asString(rec.path)
  if (path !== undefined) out.path = path
  const payload = asStringArray(rec.payload)
  if (payload !== undefined) out.payload = payload

  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_PROVIDER_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras
  return out
}

/** Read `rule-providers:` from `doc` and return a typed `RuleProvidersConfig`.
 *  Absent section returns {}. Entries that don't project go into `extras`
 *  verbatim so callers can round-trip the YAML without data loss. */
export function getProvidersConfig(doc: Document): RuleProvidersConfig {
  const raw = toJSON(doc.getIn(['rule-providers']))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const providers: Record<string, RuleProviderConfig> = {}
  const extras: Record<string, unknown> = {}
  let hasProviders = false
  let hasExtras = false
  for (const [name, value] of Object.entries(rec)) {
    const projected = projectProvider(value)
    if (projected === null) {
      extras[name] = value
      hasExtras = true
      continue
    }
    providers[name] = projected
    hasProviders = true
  }
  const out: RuleProvidersConfig = {}
  if (hasProviders) out.providers = providers
  if (hasExtras) out.extras = extras
  return out
}
