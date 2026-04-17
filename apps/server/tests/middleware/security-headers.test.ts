// security-headers middleware — mount onto a minimal Elysia app and assert
// response headers for the six protected headers + HSTS gating rules.
//
// Scenarios covered:
//   1. All six headers set in prod (CSP, X-Frame-Options, X-Content-Type-Options,
//      Referrer-Policy, Permissions-Policy + HSTS when trust-gate passes)
//   2. HSTS gate — trusted proxy + x-forwarded-proto=https → HSTS set
//   3. HSTS gate — untrusted proxy + x-forwarded-proto=https → NO HSTS
//   4. HSTS gate — no proxy header at all → NO HSTS
//   5. HSTS gate — no proxy header but direct TLS (we treat as "no HSTS unless
//      explicit opt-in", documented in middleware header comment)
//   6. CSP omitted in dev mode (cspDisabled=true)
//   7. MIHARBOR_CSP_DISABLED=1 opt-out still emits all other headers
//   8. 404 responses (no route) still get headers (acceptance: every response)
//   9. /health still gets headers

import { expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createTrustProxyEvaluator } from '../../src/auth/trust-proxy.ts'
import { securityHeaders } from '../../src/middleware/security-headers.ts'

function buildApp(opts: { cspDisabled: boolean; trustedCidrs?: string }): Elysia {
  const trustProxy = createTrustProxyEvaluator(opts.trustedCidrs ?? '')
  return new Elysia()
    .use(
      securityHeaders({
        cspDisabled: opts.cspDisabled,
        trustProxy,
      }),
    )
    .get('/health', () => ({ status: 'ok' }))
    .get('/api/me', () => ({ user: 'admin' }))
}

// ---------------------------------------------------------------------------
// Header presence (prod mode)
// ---------------------------------------------------------------------------

test('sets all six non-HSTS headers in prod mode', async () => {
  // CIDR 0.0.0.0/0 so the synthetic-Request fallback IP 0.0.0.0 is "trusted"
  // and HSTS can be asserted in the same run.
  const app = buildApp({ cspDisabled: false, trustedCidrs: '0.0.0.0/0' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-proto': 'https' },
    }),
  )
  expect(r.status).toBe(200)
  expect(r.headers.get('content-security-policy')).toContain("default-src 'self'")
  expect(r.headers.get('content-security-policy')).toContain(
    "script-src 'self' 'unsafe-eval' blob:",
  )
  expect(r.headers.get('content-security-policy')).toContain("style-src 'self' 'unsafe-inline'")
  expect(r.headers.get('content-security-policy')).toContain("worker-src 'self' blob:")
  expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  expect(r.headers.get('x-frame-options')).toBe('DENY')
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  expect(r.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()')
})

// ---------------------------------------------------------------------------
// HSTS gate
// ---------------------------------------------------------------------------

test('HSTS present when trusted proxy + x-forwarded-proto=https', async () => {
  // 0.0.0.0/0 matches the Elysia synthetic-Request fallback socket IP (0.0.0.0).
  const app = buildApp({ cspDisabled: false, trustedCidrs: '0.0.0.0/0' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-proto': 'https' },
    }),
  )
  expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
})

test('HSTS absent when UNtrusted proxy sends x-forwarded-proto=https', async () => {
  // 10.0.0.0/8 does NOT include 0.0.0.0 fallback — header must be ignored.
  const app = buildApp({ cspDisabled: false, trustedCidrs: '10.0.0.0/8' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-proto': 'https' },
    }),
  )
  expect(r.headers.get('strict-transport-security')).toBeNull()
})

test('HSTS absent when no proxy header (plain HTTP from direct client)', async () => {
  const app = buildApp({ cspDisabled: false, trustedCidrs: '0.0.0.0/0' })
  const r = await app.handle(new Request('http://localhost/api/me'))
  expect(r.headers.get('strict-transport-security')).toBeNull()
})

test('HSTS absent when trusted proxy sends x-forwarded-proto=http (explicit non-HTTPS)', async () => {
  const app = buildApp({ cspDisabled: false, trustedCidrs: '0.0.0.0/0' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-proto': 'http' },
    }),
  )
  expect(r.headers.get('strict-transport-security')).toBeNull()
})

test('HSTS absent when no proxy header but direct TLS (we do not auto-enable)', async () => {
  // In synthetic tests we can't simulate `socket.encrypted`. The middleware
  // documents: HSTS is ONLY emitted on verified-HTTPS-via-trusted-proxy. A
  // direct TLS termination at the Miharbor listener without a proxy header is
  // treated as "no HSTS" — operators who terminate TLS at Miharbor itself
  // must front it with an x-forwarded-proto-setting proxy or accept that
  // HSTS won't be set. Assert that behaviour here.
  const app = buildApp({ cspDisabled: false, trustedCidrs: '0.0.0.0/0' })
  const r = await app.handle(new Request('https://localhost/api/me'))
  expect(r.headers.get('strict-transport-security')).toBeNull()
})

// ---------------------------------------------------------------------------
// CSP gating (dev mode / MIHARBOR_CSP_DISABLED opt-out)
// ---------------------------------------------------------------------------

test('CSP absent in dev mode (cspDisabled=true) but other headers still set', async () => {
  const app = buildApp({ cspDisabled: true })
  const r = await app.handle(new Request('http://localhost/api/me'))
  expect(r.headers.get('content-security-policy')).toBeNull()
  // Sanity: the other headers must still be there.
  expect(r.headers.get('x-frame-options')).toBe('DENY')
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  expect(r.headers.get('permissions-policy')).toContain('camera=()')
})

test('MIHARBOR_CSP_DISABLED opt-out path (cspDisabled=true surface)', async () => {
  // The middleware only sees a resolved flag; the env binding (NODE_ENV /
  // MIHARBOR_CSP_DISABLED → cspDisabled) is the wireApp caller's job.
  // Assert: even when cspDisabled=true, everything else including HSTS still fires.
  const app = buildApp({ cspDisabled: true, trustedCidrs: '0.0.0.0/0' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-proto': 'https' },
    }),
  )
  expect(r.headers.get('content-security-policy')).toBeNull()
  expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
})

// ---------------------------------------------------------------------------
// Coverage: every response (404, /health, routed)
// ---------------------------------------------------------------------------

test('headers present on 404 responses (unregistered routes)', async () => {
  const app = buildApp({ cspDisabled: false })
  const r = await app.handle(new Request('http://localhost/does-not-exist'))
  expect(r.status).toBe(404)
  // All the low-gate headers should still be set — the middleware fires on
  // onRequest so headers survive into the 404 response Elysia synthesises.
  expect(r.headers.get('x-frame-options')).toBe('DENY')
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(r.headers.get('referrer-policy')).toBe('no-referrer')
  expect(r.headers.get('permissions-policy')).toContain('camera=()')
  expect(r.headers.get('content-security-policy')).toContain("default-src 'self'")
})

test('headers present on /health', async () => {
  const app = buildApp({ cspDisabled: false })
  const r = await app.handle(new Request('http://localhost/health'))
  expect(r.status).toBe(200)
  expect(r.headers.get('x-frame-options')).toBe('DENY')
  expect(r.headers.get('content-security-policy')).toContain("default-src 'self'")
})
