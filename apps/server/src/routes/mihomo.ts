// /api/mihomo/* — thin proxy around the typed mihomo API client.
//
// Scope: read-only endpoints the web UI needs to render live runtime state
// without hitting the mihomo daemon from the browser (CORS + Bearer-secret
// protection stays server-side). Write endpoints (reloadConfig, refresh
// providers) are driven by the deploy pipeline, not directly exposed here.
//
// Errors: MihomoApiError → 502 Bad Gateway with a JSON body carrying the
// endpoint + status. MihomoApiAuthError → 502 with code `MIHOMO_AUTH`.
// Intentional: the browser should treat "mihomo is down" as a soft fault
// and degrade gracefully (cached lists, stale badges) instead of surfacing
// a hard error to the operator.

import { Elysia, t } from 'elysia'
import type { MihomoApi } from '../mihomo/api-client.ts'
import { MihomoApiAuthError, MihomoApiError } from '../mihomo/api-client.ts'

export interface MihomoRoutesDeps {
  mihomoApi: MihomoApi
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

export function mihomoRoutes(deps: MihomoRoutesDeps) {
  return (
    new Elysia({ prefix: '/api/mihomo' })
      .get('/version', async ({ set }) => {
        try {
          return await deps.mihomoApi.getVersion()
        } catch (e) {
          return mapError(e, set)
        }
      })
      .get('/proxies', async ({ set }) => {
        try {
          return await deps.mihomoApi.listProxies()
        } catch (e) {
          return mapError(e, set)
        }
      })
      // GET /api/mihomo/proxies/:name/delay?url=...&timeout=...
      // Proxies the mihomo "delay test" endpoint. `url` and `timeout` fall back
      // to the API client defaults (gstatic.com/generate_204 and 5s).
      .get(
        '/proxies/:name/delay',
        async ({ params, query, set }) => {
          try {
            const opts: { url?: string; timeout?: number } = {}
            if (typeof query.url === 'string' && query.url.length > 0) opts.url = query.url
            if (typeof query.timeout === 'string' && query.timeout.length > 0) {
              const n = Number(query.timeout)
              if (Number.isFinite(n) && n > 0) opts.timeout = n
            }
            return await deps.mihomoApi.getProxyDelay(params.name, opts)
          } catch (e) {
            return mapError(e, set)
          }
        },
        {
          params: t.Object({ name: t.String() }),
          query: t.Object({
            url: t.Optional(t.String()),
            timeout: t.Optional(t.String()),
          }),
        },
      )
  )
}
