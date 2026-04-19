// /api/catalog/* — lookup helpers for the SPA's RuleEditor:
//   * /geo — parsed category lists for GEOSITE / GEOIP, backed by
//     geo-cache. Uppercases GEOIP entries so the client doesn't need to
//     know the convention. 5-minute Cache-Control hint on the response.
//   * /rule-providers — names declared under the top-level `rule-providers:`
//     map (v0.2.6, RULE-SET combobox source). Read straight from the live
//     config on every call; no caching — mutations land via the draft
//     pipeline and the list is small (typical operator has <20 entries),
//     so there's nothing to cache.

import { Elysia, t } from 'elysia'
import type { Transport } from '../transport/transport.ts'
import type { GeoCache } from '../catalog/geo-cache.ts'
import { resolveGeoUrls } from '../catalog/geo-source.ts'
import { resolveRuleProviders } from '../catalog/rule-providers-source.ts'

export interface CatalogRoutesDeps {
  transport: Transport
  cache: GeoCache
}

export function catalogRoutes(deps: CatalogRoutesDeps) {
  return new Elysia({ prefix: '/api/catalog' })
    .get(
      '/geo',
      async ({ query, set }) => {
        const urls = await resolveGeoUrls(deps.transport)
        const refresh = query.refresh === '1'
        const [geoip, geosite] = await Promise.all([
          deps.cache.get(urls.geoip, { refresh }),
          deps.cache.get(urls.geosite, { refresh }),
        ])
        set.headers['cache-control'] = 'max-age=300'
        return {
          geoip: {
            entries: geoip.entries.map((e) => e.toUpperCase()),
            source: urls.geoip,
            fetched: geoip.fetched,
            error: geoip.error,
          },
          geosite: {
            entries: geosite.entries,
            source: urls.geosite,
            fetched: geosite.fetched,
            error: geosite.error,
          },
        }
      },
      {
        query: t.Object({
          refresh: t.Optional(t.String()),
        }),
      },
    )
    .get('/rule-providers', async () => {
      const result = await resolveRuleProviders(deps.transport)
      return {
        names: result.names,
        source: 'rule-providers',
        error: result.error,
      }
    })
}
