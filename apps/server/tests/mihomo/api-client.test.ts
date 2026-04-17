import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createMihomoApi, MihomoApiAuthError, MihomoApiError } from '../../src/mihomo/api-client.ts'

/** A minimal mihomo-flavoured HTTP server for tests. Listens on an
 *  ephemeral port; caller inspects `receivedRequests` and can return
 *  static JSON for each path. */
interface MockServer {
  baseUrl: string
  received: Array<{ path: string; method: string; auth: string | null; url: string }>
  stop: () => void
}

type RouteHandler = (req: Request) => Response | Promise<Response>

function startMockServer(routes: Record<string, RouteHandler>): MockServer {
  const received: MockServer['received'] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url)
      received.push({
        path: u.pathname,
        method: req.method,
        auth: req.headers.get('authorization'),
        url: req.url,
      })
      // Look up a handler keyed on `METHOD path` first, then fall back to `path`.
      const keyed = routes[`${req.method} ${u.pathname}`]
      if (keyed) return keyed(req)
      const any = routes[u.pathname]
      if (any) return any(req)
      return new Response('not found', { status: 404 })
    },
  })
  return {
    baseUrl: `http://localhost:${server.port}`,
    received,
    stop: () => server.stop(true),
  }
}

let mock: MockServer

beforeEach(() => {
  mock = startMockServer({})
})

afterEach(() => {
  mock.stop()
})

test('getVersion parses JSON response', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () =>
      new Response(JSON.stringify({ version: '1.19.23', premium: false }), {
        headers: { 'content-type': 'application/json' },
      }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 'token-1' })
  const v = await api.getVersion()
  expect(v.version).toBe('1.19.23')
  expect(v.premium).toBe(false)
})

test('Authorization header is set when secret is non-empty', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () => new Response(JSON.stringify({ version: 'X', premium: false })),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 'my-bearer' })
  await api.getVersion()
  expect(mock.received[0]!.auth).toBe('Bearer my-bearer')
})

test('empty secret omits Authorization header', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () => new Response(JSON.stringify({ version: 'X', premium: false })),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: '' })
  await api.getVersion()
  expect(mock.received[0]!.auth).toBeNull()
})

test('401 response throws MihomoApiAuthError', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () => new Response('unauthorized', { status: 401 }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 'bad' })
  const err = await api.getVersion().catch((e) => e as MihomoApiAuthError)
  expect(err).toBeInstanceOf(MihomoApiAuthError)
  expect((err as MihomoApiAuthError).status).toBe(401)
  expect((err as MihomoApiAuthError).endpoint).toBe('/version')
})

test('other HTTP errors throw MihomoApiError with status + endpoint', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () => new Response('boom', { status: 500 }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 'x' })
  const err = await api.getVersion().catch((e) => e as MihomoApiError)
  expect(err).toBeInstanceOf(MihomoApiError)
  // Must not be the auth subtype.
  expect(err).not.toBeInstanceOf(MihomoApiAuthError)
  expect((err as MihomoApiError).status).toBe(500)
  expect((err as MihomoApiError).endpoint).toBe('/version')
})

test('reloadConfig uses PUT /configs?force=true with JSON body', async () => {
  mock.stop()
  let receivedBody = ''
  let receivedContentType = ''
  mock = startMockServer({
    'PUT /configs': (req) => {
      receivedContentType = req.headers.get('content-type') ?? ''
      // Bun's req.body is a ReadableStream; we need to read it for tests.
      // The mock server doesn't auto-parse, so we capture the raw bytes.
      return req.text().then((body) => {
        receivedBody = body
        return new Response(null, { status: 204 })
      })
    },
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  await api.reloadConfig()
  expect(mock.received[0]!.method).toBe('PUT')
  expect(mock.received[0]!.url).toContain('/configs?force=true')
  expect(mock.received[0]!.auth).toBe('Bearer s') // Auth still present
  expect(receivedContentType).toBe('application/json')
  expect(receivedBody).toBe('{}')
})

test('listProxies returns parsed JSON object', async () => {
  mock.stop()
  mock = startMockServer({
    '/proxies': () =>
      new Response(
        JSON.stringify({
          proxies: {
            DIRECT: { type: 'Direct' },
            GLOBAL: { type: 'Selector', all: ['DIRECT'] },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const out = await api.listProxies()
  expect((out as { proxies: Record<string, unknown> }).proxies).toBeDefined()
})

test('getProxyDelay sends url+timeout query and returns {delay}', async () => {
  mock.stop()
  let receivedUrl = ''
  mock = startMockServer({
    [`/proxies/vmess-eu/delay`]: (req) => {
      receivedUrl = new URL(req.url).search
      return new Response(JSON.stringify({ delay: 123 }))
    },
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const r = await api.getProxyDelay('vmess-eu', { url: 'http://t.example', timeout: 2000 })
  expect(r.delay).toBe(123)
  expect(receivedUrl).toContain('url=http%3A%2F%2Ft.example')
  expect(receivedUrl).toContain('timeout=2000')
})

test('getProxyDelay escapes names with special chars', async () => {
  mock.stop()
  mock = startMockServer({
    '/proxies/Hello%20world/delay': () => new Response(JSON.stringify({ delay: 5 })),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const r = await api.getProxyDelay('Hello world')
  expect(r.delay).toBe(5)
})

test('listProviders returns raw JSON', async () => {
  mock.stop()
  mock = startMockServer({
    '/providers/proxies': () => new Response(JSON.stringify({ providers: { p1: {} } })),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const out = await api.listProviders()
  expect(out).toHaveProperty('providers')
})

test('refreshProvider uses PUT /providers/proxies/:name', async () => {
  mock.stop()
  mock = startMockServer({
    'PUT /providers/proxies/my-provider': () => new Response(null, { status: 204 }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  await api.refreshProvider('my-provider')
  expect(mock.received[0]!.method).toBe('PUT')
  expect(mock.received[0]!.path).toBe('/providers/proxies/my-provider')
})

test('listRuleProviders returns raw JSON from /providers/rules', async () => {
  mock.stop()
  mock = startMockServer({
    '/providers/rules': () =>
      new Response(
        JSON.stringify({
          providers: {
            adblock: { behavior: 'domain', updatedAt: '2026-04-01T00:00:00Z' },
          },
        }),
      ),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const out = await api.listRuleProviders()
  expect(out).toHaveProperty('providers')
})

test('refreshRuleProvider uses PUT /providers/rules/:name', async () => {
  mock.stop()
  mock = startMockServer({
    'PUT /providers/rules/adblock': () => new Response(null, { status: 204 }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  await api.refreshRuleProvider('adblock')
  expect(mock.received[0]!.method).toBe('PUT')
  expect(mock.received[0]!.path).toBe('/providers/rules/adblock')
})

test('refreshRuleProvider escapes names with special chars', async () => {
  mock.stop()
  mock = startMockServer({
    'PUT /providers/rules/ads%20list': () => new Response(null, { status: 204 }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  await api.refreshRuleProvider('ads list')
  expect(mock.received[0]!.path).toBe('/providers/rules/ads%20list')
})

test('listRules extracts the rules array', async () => {
  mock.stop()
  mock = startMockServer({
    '/rules': () =>
      new Response(
        JSON.stringify({
          rules: [
            { type: 'DOMAIN-SUFFIX', payload: 'google.com', proxy: 'DIRECT' },
            { type: 'MATCH', payload: '', proxy: 'PROXY' },
          ],
        }),
      ),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const rules = await api.listRules()
  expect(rules).toHaveLength(2)
})

test('listRules tolerates empty/missing array', async () => {
  mock.stop()
  mock = startMockServer({
    '/rules': () => new Response(JSON.stringify({})),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const rules = await api.listRules()
  expect(rules).toEqual([])
})

test('timeout aborts the request and throws MihomoApiError', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': async () => {
      await new Promise((r) => setTimeout(r, 300))
      return new Response(JSON.stringify({ version: 'slow', premium: false }))
    },
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's', timeoutMs: 50 })
  const err = await api.getVersion().catch((e) => e)
  expect(err).toBeInstanceOf(MihomoApiError)
  // Must not be MihomoApiAuthError (status null, not 401).
  expect(err).not.toBeInstanceOf(MihomoApiAuthError)
})

test('network error on a dead URL surfaces as MihomoApiError', async () => {
  const api = createMihomoApi({
    baseUrl: 'http://127.0.0.1:1', // port 1 — almost always refused
    secret: 's',
    timeoutMs: 500,
  })
  const err = await api.getVersion().catch((e) => e)
  expect(err).toBeInstanceOf(MihomoApiError)
  expect(err).not.toBeInstanceOf(MihomoApiAuthError)
})

test('non-JSON success body surfaces as MihomoApiError', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () => new Response('not json', { status: 200 }),
  })
  const api = createMihomoApi({ baseUrl: mock.baseUrl, secret: 's' })
  const err = await api.getVersion().catch((e) => e)
  expect(err).toBeInstanceOf(MihomoApiError)
})

test('injected fetchImpl is used instead of global fetch', async () => {
  let calledWith = ''
  // Using the narrower FetchLike alias the client accepts so we don't
  // have to stub out the full `typeof fetch` (which includes preconnect
  // in Bun's global fetch type).
  const injected = (input: string | URL) => {
    calledWith = String(input)
    return Promise.resolve(
      new Response(JSON.stringify({ version: 'injected', premium: false }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  const api = createMihomoApi({
    baseUrl: 'http://whatever',
    secret: 's',
    fetchImpl: injected,
  })
  const v = await api.getVersion()
  expect(v.version).toBe('injected')
  expect(calledWith).toBe('http://whatever/version')
})

test('trailing slash in baseUrl is stripped', async () => {
  mock.stop()
  mock = startMockServer({
    '/version': () => new Response(JSON.stringify({ version: 'v', premium: false })),
  })
  // Add three trailing slashes on purpose.
  const api = createMihomoApi({ baseUrl: mock.baseUrl + '///', secret: 's' })
  const v = await api.getVersion()
  expect(v.version).toBe('v')
})
