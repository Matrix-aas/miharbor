// Minimal mock mihomo REST API for Playwright e2e.
// Covers only the endpoints Miharbor hits during a happy-path deploy:
//   GET  /version            — mihomo identifies itself
//   PUT  /configs            — config reload (returns 204)
//   GET  /configs            — read active runtime config
//   GET  /proxies            — proxy list (empty by default)
//   GET  /rules              — rule list (empty)
// All other routes return 404.
//
// Usage:
//   MOCK_MIHOMO_PORT=19999 bun run e2e/mock-mihomo.ts
//
// The Playwright webServer fixture starts this with `bun run e2e/mock-mihomo.ts`
// and waits for the /version endpoint to respond before running the tests.

const port = Number(process.env.MOCK_MIHOMO_PORT ?? '19999')
const version = process.env.MOCK_MIHOMO_VERSION ?? '1.19.23'

// Keep a single in-memory copy of the last-pushed config so test flows can
// round-trip PUT → GET if they care.
let liveConfig = 'mode: rule\nmixed-port: 7890\n'
const startedAt = Date.now()

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === 'GET' && path === '/version') {
      return Response.json({ version, meta: true, premium: false })
    }
    if (req.method === 'GET' && path === '/configs') {
      return Response.json({ mode: 'Rule', 'mixed-port': 7890 })
    }
    if (req.method === 'PUT' && path === '/configs') {
      // Body can be JSON {path: "..."} when reloading from file, or raw YAML.
      // We accept both and stash whatever we got so subsequent GETs reflect it.
      try {
        const text = await req.text()
        if (text) liveConfig = text
      } catch {
        /* ignore */
      }
      return new Response(null, { status: 204 })
    }
    if (req.method === 'GET' && path === '/proxies') {
      return Response.json({ proxies: {} })
    }
    if (req.method === 'GET' && path === '/rules') {
      return Response.json({ rules: [] })
    }
    if (req.method === 'GET' && path === '/mock/ping') {
      // Convenience endpoint for test fixtures to detect readiness.
      return Response.json({ ok: true, uptime_ms: Date.now() - startedAt })
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(
  `[mock-mihomo] listening on :${server.port}, live-config cached ${liveConfig.length} bytes`,
)
