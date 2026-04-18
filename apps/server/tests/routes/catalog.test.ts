import { expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createGeoCache, type FetchImpl } from '../../src/catalog/geo-cache.ts'
import { catalogRoutes } from '../../src/routes/catalog.ts'
import { buildTinyDat } from '../catalog/fixtures/build-fixture.ts'

function makeFetch(mapping: Record<string, string[]>): FetchImpl {
  return async (url) => {
    const names = mapping[url]
    if (!names) throw new Error(`no mapping for ${url}`)
    return { ok: true, status: 200, body: buildTinyDat(names) }
  }
}

function buildApp(fetchImpl: FetchImpl) {
  const transport = new InMemoryTransport({ initialConfig: 'mode: rule\n' })
  const cache = createGeoCache({ ttlMs: 60_000, fetchImpl, now: () => 0 })
  const app = new Elysia().use(catalogRoutes({ transport, cache }))
  return { app, transport }
}

test('GET /api/catalog/geo returns both sections with uppercased GEOIP', async () => {
  const fetchImpl = makeFetch({
    'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat': ['ru', 'cn'],
    'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat': [
      'google',
      'youtube',
    ],
  })
  const { app } = buildApp(fetchImpl)
  const r = await app.handle(new Request('http://localhost/api/catalog/geo'))
  expect(r.status).toBe(200)
  expect(r.headers.get('cache-control')).toContain('max-age=300')
  const body = (await r.json()) as {
    geoip: { entries: string[]; source: string; error: string | null }
    geosite: { entries: string[]; source: string; error: string | null }
  }
  expect(body.geoip.entries).toEqual(['RU', 'CN'])
  expect(body.geosite.entries).toEqual(['google', 'youtube'])
  expect(body.geoip.error).toBeNull()
  expect(body.geosite.error).toBeNull()
})

test('GET /api/catalog/geo isolates per-side fetch failures', async () => {
  const fetchImpl: FetchImpl = async (url) => {
    if (url.endsWith('geoip.dat')) {
      throw new Error('geoip fetch broken')
    }
    return { ok: true, status: 200, body: buildTinyDat(['google']) }
  }
  const { app } = buildApp(fetchImpl)
  const r = await app.handle(new Request('http://localhost/api/catalog/geo'))
  const body = (await r.json()) as {
    geoip: { entries: string[]; error: string | null }
    geosite: { entries: string[]; error: string | null }
  }
  expect(body.geosite.entries).toEqual(['google'])
  expect(body.geosite.error).toBeNull()
  expect(body.geoip.entries).toEqual([])
  expect(body.geoip.error).toContain('geoip fetch broken')
})

test('?refresh=1 forces re-fetch', async () => {
  let count = 0
  const fetchImpl: FetchImpl = async () => {
    count += 1
    return { ok: true, status: 200, body: buildTinyDat([`c${count}`]) }
  }
  const { app } = buildApp(fetchImpl)
  await app.handle(new Request('http://localhost/api/catalog/geo'))
  await app.handle(new Request('http://localhost/api/catalog/geo?refresh=1'))
  // Two sides × two calls = 4 underlying fetches.
  expect(count).toBe(4)
})
