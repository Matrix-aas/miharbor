// /api/config/* route tests. Uses the real Elysia app wired with Basic Auth
// DISABLED so we can assert GETs without constructing Basic credentials
// repeatedly.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createDraftStore } from '../../src/draft-store.ts'
import { createVault } from '../../src/vault/vault.ts'
import { configRoutes } from '../../src/routes/config.ts'

const GOLDEN_CFG = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
const REAL_LOOKING_KEY = 'kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo='
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-cfg-routes-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function buildApp() {
  const transport = new InMemoryTransport({ initialConfig: GOLDEN_CFG })
  const draftStore = createDraftStore()
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const app = new Elysia().use(configRoutes({ transport, draftStore, vault }))
  return { app, transport, draftStore, vault }
}

test('GET /api/config/services returns Service[]', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/services'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<{ name: string; direction: string }>
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
  expect(body.some((s) => s.name === 'Google')).toBe(true)
})

test('GET /api/config/proxies returns ProxyNode[]', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/proxies'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<{ name: string; type: string }>
  expect(body.some((p) => p.type === 'wireguard')).toBe(true)
})

test('GET /api/config/meta returns top-level settings', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/meta'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { mode?: string }
  expect(body.mode).toBe('rule')
})

test('GET /api/config/raw returns MASKED YAML (H4)', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/raw'))
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('text/plain')
  expect(r.headers.get('x-miharbor-masked')).toBe('true')
  const text = await r.text()
  // Non-secret content preserved.
  expect(text).toContain('mode: rule')
  // Secret content (private-key from the WG node) is REPLACED with a sentinel.
  expect(text).not.toContain(REAL_LOOKING_KEY)
  expect(text).toContain('$MIHARBOR_VAULT:')
})

test('PUT /api/config/draft stores + GET /api/config/draft returns it', async () => {
  const { app, draftStore } = await buildApp()
  const putR = await app.handle(
    new Request('http://localhost/api/config/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: 'mode: global\n' }),
    }),
  )
  expect(putR.status).toBe(200)
  const putBody = (await putR.json()) as { ok: boolean }
  expect(putBody.ok).toBe(true)

  const getR = await app.handle(new Request('http://localhost/api/config/draft'))
  const body = (await getR.json()) as { source: string; text: string }
  expect(body.source).toBe('draft')
  expect(body.text).toBe('mode: global\n')
  // Draft store now has 1 entry under 'anonymous'.
  expect(draftStore.size()).toBe(1)
})

test('GET /api/config/draft falls back to live config when no draft', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/draft'))
  const body = (await r.json()) as { source: string; text: string }
  expect(body.source).toBe('current')
  expect(body.text).toContain('mode: rule')
})

test('GET /api/config/draft live-fallback masks secrets, matching /raw byte-for-byte', async () => {
  // Regression guard for v0.2.3: without masking, draftText !== rawLive on
  // every secret line (proxy private-key, mihomo `secret:` Bearer, …) and
  // the SPA's `dirtyCount` trips on fresh login before the operator has
  // touched anything. Both endpoints must return the same masked YAML when
  // no per-user draft exists.
  const { app } = await buildApp()
  const rawR = await app.handle(new Request('http://localhost/api/config/raw'))
  const rawText = await rawR.text()
  const draftR = await app.handle(new Request('http://localhost/api/config/draft'))
  const draftBody = (await draftR.json()) as { source: string; text: string }

  expect(draftBody.source).toBe('current')
  // Secret fields in the golden fixture must be sentinels in the draft too.
  expect(draftBody.text).not.toContain(REAL_LOOKING_KEY)
  expect(draftBody.text).toContain('$MIHARBOR_VAULT:')
  // And the vault-worthy mihomo `secret:` (Bearer token) is also masked —
  // it was `'00...00'` (64 zero-hex) in the fixture; after masking the raw
  // value is gone.
  expect(draftBody.text).not.toContain(
    "secret: '0000000000000000000000000000000000000000000000000000000000000000'",
  )
  // Byte-identical with /raw so `dirtyCount` == 0 on fresh login.
  expect(draftBody.text).toBe(rawText)
})

test('DELETE /api/config/draft clears the draft', async () => {
  const { app, draftStore } = await buildApp()
  await app.handle(
    new Request('http://localhost/api/config/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: 'mode: global\n' }),
    }),
  )
  expect(draftStore.size()).toBe(1)
  await app.handle(new Request('http://localhost/api/config/draft', { method: 'DELETE' }))
  expect(draftStore.size()).toBe(0)
})
