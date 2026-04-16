// /api/settings/* — Settings page backing endpoints.
//
// GET /api/settings/env → snapshot of the server's resolved Env with
// provenance (`source: 'env' | 'default'`). Secret-looking keys have their
// value redacted to `***` with a `masked: true` marker so the UI can still
// show "secret is configured" without ever leaking it.
//
// This endpoint is read-only and protected by the same Basic Auth as the
// rest of `/api/*`. No writes are supported in MVP — operators can't change
// ENV at runtime; they edit compose/env files and restart.

import { Elysia } from 'elysia'
import type { Env } from '../env/schema.ts'

export interface SettingsRoutesDeps {
  env: Env
  /** Raw env (as presented by the OS) so we can decide whether a given
   *  key's value came from ENV or was filled by the schema's default. */
  rawEnv: Record<string, string | undefined>
}

export interface EnvEntry {
  value: string | number | boolean
  source: 'env' | 'default'
  masked?: true
}

/** Return true iff the key name looks like a secret. These values are
 *  redacted in the response. The pattern is conservative — additional
 *  secrets can be added over time without breaking existing UI. */
export function isSecretKey(key: string): boolean {
  // Common secret name patterns.
  if (/_SECRET(_|$)/.test(key)) return true
  if (/_API_KEY(_|$)/.test(key)) return true
  if (/_KEY$/.test(key) && key !== 'MIHARBOR_VAULT_KEY') {
    // MIHARBOR_VAULT_KEY is also a secret — covered by the _KEY fallthrough.
  }
  if (/_KEY$/.test(key)) return true
  if (/_PASS_HASH$/.test(key)) return true
  if (/_PASSWORD$/.test(key)) return true
  if (/_TOKEN$/.test(key)) return true
  return false
}

/** Build the JSON-serialisable env snapshot. Exported for direct unit tests. */
export function buildEnvSnapshot(
  env: Env,
  rawEnv: Record<string, string | undefined>,
): Record<string, EnvEntry> {
  const out: Record<string, EnvEntry> = {}
  for (const [key, value] of Object.entries(env)) {
    const source: EnvEntry['source'] = rawEnv[key] !== undefined ? 'env' : 'default'
    if (isSecretKey(key)) {
      // Always mask — even when the current value is the empty default.
      // Distinguish "secret configured" vs "empty" via source.
      const hasValue = typeof value === 'string' ? value.length > 0 : Boolean(value)
      out[key] = {
        value: hasValue ? '***' : '',
        source,
        masked: true,
      }
      continue
    }
    // Non-secret — serialise as-is (number / boolean / string pass through JSON).
    out[key] = { value: value as string | number | boolean, source }
  }
  return out
}

export function settingsRoutes(deps: SettingsRoutesDeps) {
  return new Elysia({ prefix: '/api/settings' }).get('/env', () =>
    buildEnvSnapshot(deps.env, deps.rawEnv),
  )
}
