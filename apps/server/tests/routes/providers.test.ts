// /api/providers/:name/refresh route tests.
//
// Asserts the wiring Providers.vue relies on:
//   * POST /api/providers/<existing>/refresh → 200 + {ok:true} when mihomo
//     accepts the PUT /providers/rules/<name>.
//   * POST /api/providers/<unknown>/refresh → 404 with code UNKNOWN_PROVIDER.
//   * mihomo 401 → 502 MIHOMO_AUTH.
//   * mihomo other failures → 502 MIHOMO_UNREACHABLE.
//   * The provider name is URL-decoded before the config lookup so names
//     with special chars still match.

import { expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { providersRoutes } from '../../src/routes/providers.ts'
import { MihomoApiAuthError, MihomoApiError, type MihomoApi } from '../../src/mihomo/api-client.ts'

const CONFIG_WITH_PROVIDERS = `mode: rule
rule-providers:
  adblock:
    type: http
    behavior: domain
    format: yaml
    url: https://example.com/adblock.yaml
    interval: 86400
  local-rules:
    type: file
    behavior: classical
    format: text
    path: ./rules/my-rules.txt
  inline-blocks:
    type: inline
    behavior: classical
    payload:
      - DOMAIN-SUFFIX,bad.example
`

function makeApi(overrides: Partial<MihomoApi> = {}): MihomoApi {
  return {
    getVersion: async () => ({ version: 't', premium: false }),
    reloadConfig: async () => {},
    listProxies: async () => ({}),
    getProxyDelay: async () => ({ delay: 1 }),
    listProviders: async () => ({}),
    refreshProvider: async () => {},
    listRuleProviders: async () => ({}),
    refreshRuleProvider: async () => {},
    listRules: async () => [],
    ...overrides,
  }
}

test('POST /api/providers/:name/refresh calls mihomo and returns ok for a known provider', async () => {
  const transport = new InMemoryTransport({ initialConfig: CONFIG_WITH_PROVIDERS })
  const calls: string[] = []
  const mihomoApi = makeApi({
    refreshRuleProvider: async (name) => {
      calls.push(name)
    },
  })
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/adblock/refresh', { method: 'POST' }),
  )
  expect(r.status).toBe(200)
  const body = (await r.json()) as { ok: boolean; name: string }
  expect(body.ok).toBe(true)
  expect(body.name).toBe('adblock')
  expect(calls).toEqual(['adblock'])
})

test('POST /api/providers/:name/refresh returns 404 for an unknown provider', async () => {
  const transport = new InMemoryTransport({ initialConfig: CONFIG_WITH_PROVIDERS })
  let called = false
  const mihomoApi = makeApi({
    refreshRuleProvider: async () => {
      called = true
    },
  })
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/no-such/refresh', { method: 'POST' }),
  )
  expect(r.status).toBe(404)
  const body = (await r.json()) as { code: string; name: string }
  expect(body.code).toBe('UNKNOWN_PROVIDER')
  expect(body.name).toBe('no-such')
  expect(called).toBe(false)
})

test('POST /api/providers/:name/refresh accepts inline-type providers too', async () => {
  const transport = new InMemoryTransport({ initialConfig: CONFIG_WITH_PROVIDERS })
  const mihomoApi = makeApi({
    refreshRuleProvider: async () => {},
  })
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/inline-blocks/refresh', { method: 'POST' }),
  )
  // The route doesn't filter by type — mihomo decides whether inline
  // refresh is a no-op. We just trust the config-level existence check.
  expect(r.status).toBe(200)
})

test('POST /api/providers/:name/refresh maps mihomo 401 to 502 MIHOMO_AUTH', async () => {
  const transport = new InMemoryTransport({ initialConfig: CONFIG_WITH_PROVIDERS })
  const mihomoApi = makeApi({
    refreshRuleProvider: async () => {
      throw new MihomoApiAuthError('/providers/rules/adblock', 'unauthorized')
    },
  })
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/adblock/refresh', { method: 'POST' }),
  )
  expect(r.status).toBe(502)
  const body = (await r.json()) as { code: string }
  expect(body.code).toBe('MIHOMO_AUTH')
})

test('POST /api/providers/:name/refresh maps other mihomo errors to 502 MIHOMO_UNREACHABLE', async () => {
  const transport = new InMemoryTransport({ initialConfig: CONFIG_WITH_PROVIDERS })
  const mihomoApi = makeApi({
    refreshRuleProvider: async () => {
      throw new MihomoApiError('mihomo /providers/rules/adblock returned 500', {
        status: 500,
        endpoint: '/providers/rules/adblock',
      })
    },
  })
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/adblock/refresh', { method: 'POST' }),
  )
  expect(r.status).toBe(502)
  const body = (await r.json()) as { code: string }
  expect(body.code).toBe('MIHOMO_UNREACHABLE')
})

test('POST accepts URL-encoded names (spaces etc.)', async () => {
  const configWithSpacedName = `mode: rule
rule-providers:
  "ads list":
    type: http
    behavior: domain
    url: https://example.com/a.yaml
    interval: 3600
`
  const transport = new InMemoryTransport({ initialConfig: configWithSpacedName })
  const calls: string[] = []
  const mihomoApi = makeApi({
    refreshRuleProvider: async (name) => {
      calls.push(name)
    },
  })
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/ads%20list/refresh', { method: 'POST' }),
  )
  expect(r.status).toBe(200)
  // Our handler explicitly decodeURIComponent's the name so the call
  // reaches mihomo with the literal value.
  expect(calls).toEqual(['ads list'])
})

test('POST returns 500 when transport fails to read the config', async () => {
  // Wrap InMemoryTransport so only readConfig() throws. Everything else
  // on the Transport interface is a no-op for this test (the route only
  // calls readConfig before reaching mihomo).
  const base = new InMemoryTransport({ initialConfig: CONFIG_WITH_PROVIDERS })
  const brokenTransport = Object.assign(
    Object.create(Object.getPrototypeOf(base)) as object,
    base,
    {
      readConfig: async () => {
        throw new Error('transport is down')
      },
    },
  ) as typeof base
  const mihomoApi = makeApi()
  const app = new Elysia().use(providersRoutes({ mihomoApi, transport: brokenTransport }))
  const r = await app.handle(
    new Request('http://localhost/api/providers/adblock/refresh', { method: 'POST' }),
  )
  expect(r.status).toBe(500)
  const body = (await r.json()) as { code: string; message: string }
  expect(body.code).toBe('CONFIG_READ_FAILED')
  expect(body.message).toContain('transport is down')
})
