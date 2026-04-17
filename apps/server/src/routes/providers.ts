// /api/providers/* — rule-provider runtime operations.
//
// Scope: POST /api/providers/:name/refresh — asks mihomo to refresh a rule
// provider immediately (PUT /providers/rules/:name at the mihomo API).
//
// Validation: the route checks that the provider with the given name exists
// in the LIVE config's `rule-providers:` section so refresh calls don't go
// out to names mihomo doesn't know about (saves mihomo an I/O attempt and
// gives the UI a clean 404). If the transport is down we let the mihomo
// call surface the failure rather than refusing preemptively.
//
// Error mapping mirrors routes/mihomo.ts: MihomoApiError → 502 Bad Gateway
// with JSON code. Unknown provider → 404. Transport read failures bubble
// as 500.

import { Elysia, t } from 'elysia'
import { parseDocument } from 'yaml'
import type { MihomoApi } from '../mihomo/api-client.ts'
import { MihomoApiAuthError, MihomoApiError } from '../mihomo/api-client.ts'
import type { Transport } from '../transport/transport.ts'
import { getProvidersConfig } from '../config/views/providers.ts'

export interface ProvidersRoutesDeps {
  mihomoApi: MihomoApi
  transport: Transport
}

function mapError(e: unknown, set: { status?: number | string }): Record<string, unknown> {
  if (e instanceof MihomoApiAuthError) {
    set.status = 502
    return { code: 'MIHOMO_AUTH', endpoint: e.endpoint, message: e.message }
  }
  if (e instanceof MihomoApiError) {
    set.status = 502
    return { code: 'MIHOMO_UNREACHABLE', endpoint: e.endpoint, message: e.message }
  }
  set.status = 500
  return { code: 'INTERNAL', message: (e as Error).message }
}

export function providersRoutes(deps: ProvidersRoutesDeps) {
  return new Elysia({ prefix: '/api/providers' }).post(
    '/:name/refresh',
    async ({ params, set }) => {
      // Decode URL-encoded path segments (e.g. "ads%20list" → "ads list"). Safe
      // for names that are already decoded — `decodeURIComponent` on a non-
      // encoded string is a no-op. Falls back to the raw param on malformed
      // sequences so we don't 500 on attacker-crafted URLs.
      let name = params.name
      try {
        name = decodeURIComponent(params.name)
      } catch {
        // leave raw name — the existence check below will just 404 it.
      }
      // Validate the provider exists in the live config first so the UI gets
      // a targeted 404 for typos rather than a confusing 502 from mihomo.
      try {
        const { content } = await deps.transport.readConfig()
        const doc = parseDocument(content)
        const cfg = getProvidersConfig(doc)
        const known = cfg.providers && Object.prototype.hasOwnProperty.call(cfg.providers, name)
        const inExtras = cfg.extras && Object.prototype.hasOwnProperty.call(cfg.extras, name)
        if (!known && !inExtras) {
          set.status = 404
          return { code: 'UNKNOWN_PROVIDER', name }
        }
      } catch (e) {
        // If we can't read the config we fall through to the mihomo call;
        // the transport error will show up in the 502 body if mihomo can't
        // find the provider either. Not great, but preferable to a silent
        // refusal when the operator's mihomo is live but transport (e.g.
        // SSH) is flaky.
        set.status = 500
        return { code: 'CONFIG_READ_FAILED', message: (e as Error).message }
      }
      try {
        await deps.mihomoApi.refreshRuleProvider(name)
        return { ok: true, name }
      } catch (e) {
        return mapError(e, set)
      }
    },
    { params: t.Object({ name: t.String() }) },
  )
}
