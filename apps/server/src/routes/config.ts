// /api/config/* — read-only views + the PUT /api/config/draft endpoint
// that feeds DraftStore. The views (services, proxies, meta) are derived
// on-demand from the live config for freshness; small enough that we don't
// bother caching.

import { Elysia, t } from 'elysia'
import { parseDocument } from 'yaml'
import type { Transport } from '../transport/transport.ts'
import type { DraftStore } from '../draft-store.ts'
import { getServices } from '../config/views/services.ts'
import { getProxies } from '../config/views/proxies.ts'
import { getMeta } from '../config/views/meta.ts'
import { getAuthUser } from '../auth/basic-auth.ts'

export interface ConfigRoutesDeps {
  transport: Transport
  draftStore: DraftStore
}

export function configRoutes(deps: ConfigRoutesDeps) {
  return new Elysia({ prefix: '/api/config' })
    .get('/services', async () => {
      const { content } = await deps.transport.readConfig()
      const doc = parseDocument(content)
      return getServices(doc)
    })
    .get('/proxies', async () => {
      const { content } = await deps.transport.readConfig()
      const doc = parseDocument(content)
      return getProxies(doc)
    })
    .get('/meta', async () => {
      const { content } = await deps.transport.readConfig()
      const doc = parseDocument(content)
      return getMeta(doc)
    })
    .get('/raw', async () => {
      // Raw live config (unmasked). Callers should be authenticated — the
      // Basic-Auth middleware guards /api/*. Returns as plain text.
      const { content } = await deps.transport.readConfig()
      return new Response(content, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    })
    .get('/draft', async ({ request }) => {
      const user = getAuthUser(request) ?? 'anonymous'
      const draft = deps.draftStore.get(user)
      if (draft) return { source: 'draft' as const, text: draft.text, updated: draft.updated }
      const { content } = await deps.transport.readConfig()
      return { source: 'current' as const, text: content }
    })
    .put(
      '/draft',
      ({ body, request }) => {
        const user = getAuthUser(request) ?? 'anonymous'
        const entry = deps.draftStore.put(user, body.yaml)
        return { ok: true, updated: entry.updated }
      },
      { body: t.Object({ yaml: t.String() }) },
    )
    .delete('/draft', ({ request }) => {
      const user = getAuthUser(request) ?? 'anonymous'
      deps.draftStore.clear(user)
      return { ok: true }
    })
}
