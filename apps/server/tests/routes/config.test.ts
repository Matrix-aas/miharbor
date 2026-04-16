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
import { configRoutes } from '../../src/routes/config.ts'

const GOLDEN_CFG = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-cfg-routes-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function buildApp() {
  const transport = new InMemoryTransport({ initialConfig: GOLDEN_CFG })
  const draftStore = createDraftStore()
  const app = new Elysia().use(configRoutes({ transport, draftStore }))
  return { app, transport, draftStore }
}

test('GET /api/config/services returns Service[]', async () => {
  const { app } = buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/services'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<{ name: string; direction: string }>
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
  expect(body.some((s) => s.name === 'Google')).toBe(true)
})

test('GET /api/config/proxies returns ProxyNode[]', async () => {
  const { app } = buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/proxies'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<{ name: string; type: string }>
  expect(body.some((p) => p.type === 'wireguard')).toBe(true)
})

test('GET /api/config/meta returns top-level settings', async () => {
  const { app } = buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/meta'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { mode?: string }
  expect(body.mode).toBe('rule')
})

test('GET /api/config/raw returns plain text of live config', async () => {
  const { app } = buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/raw'))
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('text/plain')
  const text = await r.text()
  expect(text).toContain('mode: rule')
})

test('PUT /api/config/draft stores + GET /api/config/draft returns it', async () => {
  const { app, draftStore } = buildApp()
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
  const { app } = buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/draft'))
  const body = (await r.json()) as { source: string; text: string }
  expect(body.source).toBe('current')
  expect(body.text).toContain('mode: rule')
})

test('DELETE /api/config/draft clears the draft', async () => {
  const { app, draftStore } = buildApp()
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
