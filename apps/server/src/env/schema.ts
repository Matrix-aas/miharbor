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
  // `memory` is a test-only transport that swaps LocalFs/Ssh for
  // InMemoryTransport. It is intentionally in the schema so tests can
  // set the env var without TypeBox validation rejecting it, but it is
  // NOT documented in README / docker-compose and is never selected by
  // production code paths.
  MIHARBOR_TRANSPORT: Type.Union(
    [Type.Literal('local'), Type.Literal('ssh'), Type.Literal('memory')],
    {
      default: 'local',
    },
  ),
  MIHARBOR_CONFIG_PATH: Type.String({ default: '/config/config.yaml' }),
  MIHARBOR_DATA_DIR: Type.String({ default: '/app/data' }),
  /**
   * POSIX mode applied to the public config.yaml after Miharbor's atomic
   * tmp-write+rename. Default `0o644` (420 decimal) lets mihomo — which
   * typically runs as root but with a hardened CapabilityBoundingSet that
   * drops CAP_DAC_OVERRIDE, OR as a different non-root UID entirely — read
   * the file without relying on DAC bypass. Operators with unusual setups
   * (e.g. Miharbor + mihomo running as the same dedicated UID) can tighten
   * this to 0o600 (384). Octal literals in shell: export the decimal value
   * (`420` for 0o644, `384` for 0o600) — TypeBox parses this as a Number.
   * Internal files (.miharbor.lock, snapshots, drafts) keep their
   * restrictive owner-only modes regardless of this knob.
   */
  MIHARBOR_CONFIG_WRITE_MODE: Type.Number({ default: 0o644 }),
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
  /**
   * Strict-Transport-Security max-age (seconds). Default 31536000 (1 year).
   * Set to 0 to disable HSTS entirely (no header emitted).
   */
  MIHARBOR_HSTS_MAX_AGE: Type.Number({ default: 31536000 }),
  /**
   * Include the 'includeSubDomains' directive in HSTS header.
   * Default false for safety in shared deployments (e.g. sibling subdomains
   * on the same domain). Set to true only if you own the entire domain.
   */
  MIHARBOR_HSTS_INCLUDE_SUBDOMAINS: Type.Boolean({ default: false }),
  /**
   * Include the 'preload' directive in HSTS header (for HSTS preload-list
   * eligibility). Only meaningful if MIHARBOR_HSTS_INCLUDE_SUBDOMAINS=true.
   */
  MIHARBOR_HSTS_PRELOAD: Type.Boolean({ default: false }),

  // --- SSH transport (only read when MIHARBOR_TRANSPORT=ssh) ---
  /** Remote host — required when MIHARBOR_TRANSPORT=ssh. */
  MIHARBOR_SSH_HOST: Type.String({ default: '' }),
  MIHARBOR_SSH_PORT: Type.Number({ default: 22 }),
  /** Remote login user — required when MIHARBOR_TRANSPORT=ssh. */
  MIHARBOR_SSH_USER: Type.String({ default: '' }),
  /** Absolute path to a private key file on the Miharbor host. When empty,
   *  falls back to `SSH_AUTH_SOCK` (ssh-agent). At least one must be set. */
  MIHARBOR_SSH_KEY_PATH: Type.String({ default: '' }),
  /** Passphrase for an encrypted key file. Ignored when the key is
   *  unencrypted or when agent auth is used. */
  MIHARBOR_SSH_KEY_PASSPHRASE: Type.String({ default: '' }),
  /** Remote absolute path to mihomo's config.yaml. */
  MIHARBOR_SSH_REMOTE_CONFIG_PATH: Type.String({ default: '/etc/mihomo/config.yaml' }),
  /** Remote absolute path to the lock sidecar used by Miharbor to serialise
   *  writes. Must be on the same filesystem as the config so `mv` is atomic. */
  MIHARBOR_SSH_REMOTE_LOCK_PATH: Type.String({ default: '/etc/mihomo/.miharbor.lock' }),
  MIHARBOR_SSH_CONNECT_TIMEOUT_MS: Type.Number({ default: 10_000 }),
  MIHARBOR_SSH_KEEPALIVE_INTERVAL_MS: Type.Number({ default: 30_000 }),
  /** Absolute path to an OpenSSH `known_hosts`-format file on the Miharbor
   *  host. When non-empty, Miharbor pins the remote host key against this
   *  file: connection is aborted on fingerprint mismatch. Generate with:
   *    ssh-keyscan -t ed25519,rsa,ecdsa <host> > /path/to/known_hosts
   *  (drop `-H` for unhashed lines — the parser doesn't support hashed
   *  entries yet.) Mutually exclusive with `MIHARBOR_SSH_HOST_KEY_INSECURE`. */
  MIHARBOR_SSH_KNOWN_HOSTS: Type.String({ default: '' }),
  /** Explicit opt-in to accept any host key (equivalent to
   *  `StrictHostKeyChecking=no`). Intended for first-contact exploration
   *  or controlled lab setups where you have no other way to pin the
   *  key. The server logs a WARN per connect in this mode. When
   *  MIHARBOR_SSH_KNOWN_HOSTS is set this flag is ignored. */
  MIHARBOR_SSH_HOST_KEY_INSECURE: Type.Boolean({ default: false }),
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
