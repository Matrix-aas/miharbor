// /api/config/* — read-only views + the PUT /api/config/draft endpoint
// that feeds DraftStore. The views (services, proxies, meta) are derived
// on-demand from the live config for freshness; small enough that we don't
// bother caching.
//
// Masked-text cache:
//   `vault.maskDoc` is non-idempotent by design — every call mints fresh
//   UUID sentinels for each secret. So two back-to-back `/raw` calls produce
//   DIFFERENT bytes for the same file on disk, which breaks the SPA's
//   `dirtyCount` (string compare of `rawLive` vs `draftText`). Both `/raw`
//   and the `/draft` live-fallback route through `maskedLiveText()` below,
//   which memoises the masked result keyed on the source content's hash.
//   Cache is invalidated on content change (new hash on disk → new mask pass).

import { Elysia, t } from 'elysia'
import { parseDocument } from 'yaml'
import type { Transport } from '../transport/transport.ts'
import type { DraftStore } from '../draft-store.ts'
import type { Vault } from '../vault/vault.ts'
import { getServices } from '../config/views/services.ts'
import { getProxies } from '../config/views/proxies.ts'
import { getMeta } from '../config/views/meta.ts'
import { getAuthUser } from '../auth/basic-auth.ts'

export interface ConfigRoutesDeps {
  transport: Transport
  draftStore: DraftStore
  vault: Vault
}

export function configRoutes(deps: ConfigRoutesDeps) {
  // Per-hash memo of the masked live YAML. Shared by /raw and the /draft
  // live-fallback branch so both return the SAME bytes. `hash` is the
  // content hash reported by Transport (sha256 of the live file); if it
  // changes, we re-run maskDoc and replace the cached entry.
  let maskedCache: { hash: string; text: string } | null = null
  async function maskedLiveText(): Promise<string> {
    const { content, hash } = await deps.transport.readConfig()
    if (maskedCache && maskedCache.hash === hash) return maskedCache.text
    const doc = parseDocument(content)
    await deps.vault.maskDoc(doc)
    const text = doc.toString()
    maskedCache = { hash, text }
    return text
  }

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
      // Raw live config, MASKED for display. The vault pass replaces every
      // secret scalar with a `$MIHARBOR_VAULT:<uuid>` sentinel so operators
      // can copy the YAML (e.g. for diffing, support tickets) without
      // accidentally exfiltrating credentials. The `x-miharbor-masked`
      // response header flags this for the UI.
      const text = await maskedLiveText()
      return new Response(text, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-miharbor-masked': 'true',
        },
      })
    })
    .get('/draft', async ({ request }) => {
      // When the user has no draft, we fall back to the live config — but
      // we MUST return the SAME masked form that `/raw` returns. Otherwise
      // the SPA's `dirtyCount` (rawLive vs draftText) diverges on every
      // secret line and shows a spurious "changes pending" badge from the
      // moment of login. The stored draft path is already masked-by-origin
      // (the UI seeded the draft from masked /raw or /draft), so it's
      // returned as-is.
      const user = getAuthUser(request) ?? 'anonymous'
      const draft = deps.draftStore.get(user)
      if (draft) return { source: 'draft' as const, text: draft.text, updated: draft.updated }
      const text = await maskedLiveText()
      return { source: 'current' as const, text }
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
