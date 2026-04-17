// ENV schema — single source of truth for all Miharbor runtime configuration.
// TypeBox is used for structural validation + Static<> type extraction.
//
// Validation modes for `runMihomoValidate`:
//   'shared-only'  — just shared linter + YAML parse (default; no external dep)
//   'api'          — use mihomo REST API (PUT /configs with throwaway file)
//   'ssh-exec'     — run `mihomo -t` on target (SSH transport only)
//   'docker-exec'  — docker exec <mihomo-container> mihomo -t

import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { applyDeprecations } from './deprecations.ts'

const EnvSchema = Type.Object({
  MIHARBOR_PORT: Type.Number({ default: 3000 }),
  MIHARBOR_TRANSPORT: Type.Union([Type.Literal('local'), Type.Literal('ssh')], {
    default: 'local',
  }),
  MIHARBOR_CONFIG_PATH: Type.String({ default: '/config/config.yaml' }),
  MIHARBOR_DATA_DIR: Type.String({ default: '/app/data' }),
  /**
   * Absolute path to the pre-built Vue web bundle (apps/web/dist). If set and
   * the directory exists, the server will serve the SPA under `/` and handle
   * client-side routes by falling back to index.html. Empty (default) means
   * the server runs API-only; in that case the Vite dev server (:5173) is
   * expected to serve the UI via its `/api` proxy.
   */
  MIHARBOR_WEB_DIST: Type.String({ default: '' }),
  MIHOMO_API_URL: Type.String({ default: 'http://host.docker.internal:9090' }),
  MIHOMO_API_SECRET: Type.String({ default: '' }),
  MIHARBOR_AUTH_USER: Type.String({ default: 'admin' }),
  MIHARBOR_AUTH_PASS_HASH: Type.String({ default: '' }),
  MIHARBOR_AUTH_DISABLED: Type.Boolean({ default: false }),
  MIHARBOR_TRUST_PROXY_HEADER: Type.String({ default: '' }),
  MIHARBOR_TRUSTED_PROXY_CIDRS: Type.String({ default: '' }),
  MIHARBOR_VAULT_KEY: Type.String({ default: '' }),
  MIHARBOR_SNAPSHOT_RETENTION_COUNT: Type.Number({ default: 50 }),
  MIHARBOR_SNAPSHOT_RETENTION_DAYS: Type.Number({ default: 30 }),
  MIHARBOR_LOG_LEVEL: Type.Union(
    [Type.Literal('debug'), Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')],
    { default: 'info' },
  ),
  MIHARBOR_AUTO_ROLLBACK: Type.Boolean({ default: true }),
  MIHARBOR_LLM_DISABLED: Type.Boolean({ default: false }),
  MIHARBOR_PRODUCTION: Type.Boolean({ default: false }),
  MIHARBOR_METRICS_DISABLED: Type.Boolean({ default: false }),
  MIHOMO_API_VALIDATION_MODE: Type.Union(
    [
      Type.Literal('shared-only'),
      Type.Literal('api'),
      Type.Literal('ssh-exec'),
      Type.Literal('docker-exec'),
    ],
    { default: 'shared-only' },
  ),
  MIHOMO_CONTAINER_NAME: Type.String({ default: 'mihomo' }),
  ANTHROPIC_API_KEY: Type.String({ default: '' }),
  OPENAI_API_KEY: Type.String({ default: '' }),
  /**
   * Opt-out for Content-Security-Policy independent of MIHARBOR_PRODUCTION.
   * Set to `true` when running the SPA behind a dev tunnel or some other
   * setup where the strict CSP blocks legitimate resources. All other
   * security headers stay on.
   */
  MIHARBOR_CSP_DISABLED: Type.Boolean({ default: false }),
})

export type Env = Static<typeof EnvSchema>

const SCHEMA_KEYS = new Set(Object.keys(EnvSchema.properties))

// TypeBox schema property — may be an Object with `type` field or a Union.
// We coerce per-field by looking at the declared type; string-typed fields
// are passed through unchanged so digit-only API keys aren't silently
// converted to numbers (C1).
interface TypeBoxProp {
  type?: string
  anyOf?: Array<{ const?: unknown; type?: string }>
}

function schemaTypeOf(key: string): 'string' | 'number' | 'integer' | 'boolean' | 'union' | null {
  const prop = (EnvSchema.properties as Record<string, TypeBoxProp>)[key]
  if (!prop) return null
  if (prop.type === 'boolean') return 'boolean'
  if (prop.type === 'number') return 'number'
  if (prop.type === 'integer') return 'integer'
  if (prop.type === 'string') return 'string'
  // Union (e.g. transport/log-level) — literal string constants; no numeric coercion.
  if (Array.isArray(prop.anyOf)) return 'union'
  return null
}

function coerce(raw: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    // Only coerce keys relevant to our schema — avoid stuffing the whole host env.
    if (!SCHEMA_KEYS.has(k)) continue
    const t = schemaTypeOf(k)
    if (t === 'boolean') {
      out[k] = v === 'true' ? true : v === 'false' ? false : v
    } else if (t === 'number' || t === 'integer') {
      out[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
    } else {
      // string or union-of-string-literals — pass through verbatim.
      // Critical: digit-only strings (e.g. ANTHROPIC_API_KEY=1234567890) must
      // NOT be coerced to numbers — schema type is string (C1).
      out[k] = v
    }
  }
  return out
}

export function loadEnv(
  raw: Record<string, string | undefined>,
  warn: (m: string) => void = console.warn,
): Env {
  const resolved = applyDeprecations(raw, warn)
  const coerced = coerce(resolved)
  const withDefaults = Value.Default(EnvSchema, coerced) as Record<string, unknown>
  if (!Value.Check(EnvSchema, withDefaults)) {
    const errors = [...Value.Errors(EnvSchema, withDefaults)]
    const msg = errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ')
    throw new Error(`Invalid ENV: ${msg}`)
  }
  return withDefaults as Env
}
