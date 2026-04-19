// /api/catalog/geo — returns parsed category lists for geosite / geoip
// backed by the in-memory geo-cache. Uppercases GEOIP entries so the
// client doesn't need to know the convention. Response gets a 5-minute
// Cache-Control hint; the underlying cache TTL is independent.

import { Elysia, t } from 'elysia'
import type { Transport } from '../transport/transport.ts'
import type { GeoCache } from '../catalog/geo-cache.ts'
import { resolveGeoUrls } from '../catalog/geo-source.ts'

export interface CatalogRoutesDeps {
  transport: Transport
  cache: GeoCache
}

export function catalogRoutes(deps: CatalogRoutesDeps) {
  return new Elysia({ prefix: '/api/catalog' }).get(
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
}
