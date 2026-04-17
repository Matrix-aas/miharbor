// /api/mihomo/* route tests — proxy list, version, delay test

import { beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mihomoRoutes } from '../../src/routes/mihomo.ts'
import type { MihomoApi } from '../../src/mihomo/api-client.ts'
import { MihomoApiError, MihomoApiAuthError } from '../../src/mihomo/api-client.ts'

let mihomoApi: MihomoApi

beforeEach(() => {
  // Mock mihomo API
  mihomoApi = {
    getVersion: async () => ({
      version: '1.19.23',
      premium: false,
    }),
    listProxies: async () => ({
      proxies: {
        DIRECT: { name: 'DIRECT', type: 'direct', all: [] },
        'proxy-a': { name: 'proxy-a', type: 'http', all: [] },
      },
    }),
    getProxyDelay: async (name: string, _opts?: { url?: string; timeout?: number }) => ({
      name,
      delay: 42,
    }),
    reloadConfig: async () => {},
    listProviders: async () => ({}),
    refreshProvider: async () => {},
    listRuleProviders: async () => ({}),
    refreshRuleProvider: async () => {},
    listRules: async () => [],
  }
})

function buildApp() {
  return new Elysia().use(mihomoRoutes({ mihomoApi }))
}

test('GET /api/mihomo/version returns version info', async () => {
  const app = buildApp()
  const r = await app.handle(new Request('http://localhost/api/mihomo/version'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { version: string; premium: boolean }
  expect(body.version).toBe('1.19.23')
  expect(body.premium).toBe(false)
})

test('GET /api/mihomo/proxies returns proxy list', async () => {
  const app = buildApp()
  const r = await app.handle(new Request('http://localhost/api/mihomo/proxies'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { proxies?: Record<string, { name: string; type: string }> }
  expect(body.proxies).toBeDefined()
  expect(body.proxies?.DIRECT).toBeDefined()
})

test('GET /api/mihomo/proxies/:name/delay returns delay', async () => {
  const app = buildApp()
  const r = await app.handle(new Request('http://localhost/api/mihomo/proxies/my-proxy/delay'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { name: string; delay: number }
  expect(body.name).toBe('my-proxy')
  expect(body.delay).toBe(42)
})

test('GET /api/mihomo/proxies/:name/delay with url query', async () => {
  const app = buildApp()
  const r = await app.handle(
    new Request('http://localhost/api/mihomo/proxies/my-proxy/delay?url=https://example.com/check'),
  )
  expect(r.status).toBe(200)
})

test('GET /api/mihomo/proxies/:name/delay with timeout query', async () => {
  const app = buildApp()
  const r = await app.handle(
    new Request('http://localhost/api/mihomo/proxies/my-proxy/delay?timeout=3000'),
  )
  expect(r.status).toBe(200)
})

test('GET /api/mihomo/proxies/:name/delay with invalid timeout query ignored', async () => {
  const app = buildApp()
  const r = await app.handle(
    new Request('http://localhost/api/mihomo/proxies/my-proxy/delay?timeout=invalid'),
  )
  expect(r.status).toBe(200)
})

test('GET /api/mihomo/proxies/:name/delay with negative timeout query ignored', async () => {
  const app = buildApp()
  const r = await app.handle(
    new Request('http://localhost/api/mihomo/proxies/my-proxy/delay?timeout=-100'),
  )
  expect(r.status).toBe(200)
})

test('GET /api/mihomo/version with auth error returns 502 MIHOMO_AUTH', async () => {
  const mihomoApiBad: MihomoApi = {
    ...mihomoApi,
    getVersion: async () => {
      throw new MihomoApiAuthError('/version', 'invalid secret')
    },
  }
  const app = new Elysia().use(mihomoRoutes({ mihomoApi: mihomoApiBad }))
  const r = await app.handle(new Request('http://localhost/api/mihomo/version'))
  expect(r.status).toBe(502)
  const body = (await r.json()) as { code: string; endpoint: string }
  expect(body.code).toBe('MIHOMO_AUTH')
  expect(body.endpoint).toBe('/version')
})

test('GET /api/mihomo/version with connection error returns 502 MIHOMO_UNREACHABLE', async () => {
  const mihomoApiBad: MihomoApi = {
    ...mihomoApi,
    getVersion: async () => {
      throw new MihomoApiError('connection failed', { status: 0, endpoint: '/version' })
    },
  }
  const app = new Elysia().use(mihomoRoutes({ mihomoApi: mihomoApiBad }))
  const r = await app.handle(new Request('http://localhost/api/mihomo/version'))
  expect(r.status).toBe(502)
  const body = (await r.json()) as { code: string }
  expect(body.code).toBe('MIHOMO_UNREACHABLE')
})

test('GET /api/mihomo/proxies with generic error returns 500', async () => {
  const mihomoApiBad: MihomoApi = {
    ...mihomoApi,
    listProxies: async () => {
      throw new Error('unknown error')
    },
  }
  const app = new Elysia().use(mihomoRoutes({ mihomoApi: mihomoApiBad }))
  const r = await app.handle(new Request('http://localhost/api/mihomo/proxies'))
  expect(r.status).toBe(500)
  const body = (await r.json()) as { code: string }
  expect(body.code).toBe('INTERNAL')
})
