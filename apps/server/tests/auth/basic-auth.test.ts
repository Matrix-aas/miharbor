// Basic-Auth middleware tests — mount the middleware onto a minimal Elysia
// app with a single protected route and assert status codes.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthStore } from '../../src/auth/password.ts'
import { createRateLimiter } from '../../src/auth/rate-limit.ts'
import { createTrustProxyEvaluator } from '../../src/auth/trust-proxy.ts'
import { basicAuth, getAuthUser } from '../../src/auth/basic-auth.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-ba-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

const fakeHash = async (p: string): Promise<string> => `fake$${p}`
const fakeVerify = async (p: string, h: string): Promise<boolean> => h === `fake$${p}`

async function buildApp(
  overrides: {
    disabled?: boolean
    password?: string
    trustedCidrs?: string
    trustProxyHeader?: string
    limiterOpts?: {
      now?: () => number
      maxFails?: number
      lockoutMs?: number
      failWindowMs?: number
    }
  } = {},
) {
  const authStore = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    ...(overrides.password ? { envPassHash: `fake$${overrides.password}` } : {}),
    hash: fakeHash,
    verify: fakeVerify,
  })
  const rateLimiter = createRateLimiter(overrides.limiterOpts ?? { now: () => 0 })
  const trustProxy = createTrustProxyEvaluator(overrides.trustedCidrs ?? '')

  const app = new Elysia()
    .use(
      basicAuth({
        authStore,
        rateLimiter,
        trustProxy,
        trustProxyHeader: overrides.trustProxyHeader ?? '',
        disabled: overrides.disabled ?? false,
      }),
    )
    .get('/api/me', ({ request }) => ({ user: getAuthUser(request) ?? null }))
  return { app, authStore, rateLimiter, trustProxy }
}

function basic(u: string, p: string): string {
  return 'Basic ' + btoa(`${u}:${p}`)
}

test('401 without Authorization header', async () => {
  const { app } = await buildApp({ password: 's3cret' })
  const r = await app.handle(new Request('http://localhost/api/me'))
  expect(r.status).toBe(401)
  expect(r.headers.get('www-authenticate')).toContain('Basic')
})

test('401 with wrong password', async () => {
  const { app } = await buildApp({ password: 's3cret' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { authorization: basic('admin', 'wrong') },
    }),
  )
  expect(r.status).toBe(401)
})

test('200 with correct credentials + user surfaces via getAuthUser', async () => {
  const { app } = await buildApp({ password: 's3cret' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { authorization: basic('admin', 's3cret') },
    }),
  )
  expect(r.status).toBe(200)
  const body = (await r.json()) as { user: string | null }
  expect(body.user).toBe('admin')
})

test('MIHARBOR_AUTH_DISABLED=true passes everything through', async () => {
  const { app } = await buildApp({ disabled: true })
  const r = await app.handle(new Request('http://localhost/api/me'))
  expect(r.status).toBe(200)
})

test('trust-proxy bypass: trusted CIDR + header → auth skipped', async () => {
  // When the CIDR allowlist includes our request source (localhost in Elysia tests)
  // and the header is present, auth is bypassed and user comes from the header.
  const { app } = await buildApp({
    password: 'unreachable',
    trustedCidrs: '127.0.0.0/8, ::1/128',
    trustProxyHeader: 'x-forwarded-user',
  })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-user': 'external-proxy-user' },
    }),
  )
  // NOTE: Elysia's `request.requestIP()` returns null in synthetic Request
  // tests; the middleware falls back to '0.0.0.0'. '0.0.0.0' isn't in our
  // trusted CIDRs (127/8 + ::1), so the bypass should NOT trigger — the
  // request is treated as untrusted and must auth normally.
  expect(r.status).toBe(401)
})

test('trust-proxy bypass: when CIDR matches fallback IP, user from header', async () => {
  // Use 0.0.0.0/0 to match the fallback. Confirms that the bypass logic itself works.
  const { app } = await buildApp({
    password: 'unreachable',
    trustedCidrs: '0.0.0.0/0',
    trustProxyHeader: 'x-forwarded-user',
  })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-user': 'external-proxy-user' },
    }),
  )
  expect(r.status).toBe(200)
  const body = (await r.json()) as { user: string | null }
  expect(body.user).toBe('external-proxy-user')
})

test('spoofed trust-proxy header from UNtrusted source is ignored', async () => {
  // Empty CIDR list means header should NEVER be trusted.
  const { app } = await buildApp({
    password: 's3cret',
    trustedCidrs: '',
    trustProxyHeader: 'x-forwarded-user',
  })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { 'x-forwarded-user': 'attacker' },
    }),
  )
  expect(r.status).toBe(401)
})

test('rate limit: 5 failures → 6th request gets 429 + Retry-After', async () => {
  const { app } = await buildApp({
    password: 's3cret',
    limiterOpts: { now: () => 0, maxFails: 5, lockoutMs: 60_000, failWindowMs: 300_000 },
  })
  for (let i = 0; i < 5; i += 1) {
    const r = await app.handle(
      new Request('http://localhost/api/me', {
        headers: { authorization: basic('admin', 'wrong') },
      }),
    )
    expect(r.status).toBe(401)
  }
  const r6 = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { authorization: basic('admin', 's3cret') },
    }),
  )
  expect(r6.status).toBe(429)
  expect(r6.headers.get('retry-after')).toBeTruthy()
})

test('success resets the fail counter', async () => {
  const { app } = await buildApp({
    password: 's3cret',
    limiterOpts: { now: () => 0, maxFails: 3, lockoutMs: 60_000, failWindowMs: 300_000 },
  })
  // 2 failures.
  for (let i = 0; i < 2; i += 1) {
    await app.handle(
      new Request('http://localhost/api/me', {
        headers: { authorization: basic('admin', 'wrong') },
      }),
    )
  }
  // Success resets.
  const ok = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { authorization: basic('admin', 's3cret') },
    }),
  )
  expect(ok.status).toBe(200)
  // 2 more failures should NOT trip (we're back at 0).
  for (let i = 0; i < 2; i += 1) {
    const r = await app.handle(
      new Request('http://localhost/api/me', {
        headers: { authorization: basic('admin', 'wrong') },
      }),
    )
    expect(r.status).toBe(401)
  }
})

test('malformed Authorization header → 401 (not crash)', async () => {
  const { app } = await buildApp({ password: 's3cret' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { authorization: 'Basic notbase64!!' },
    }),
  )
  expect(r.status).toBe(401)
})

test('Basic without colon separator → 401', async () => {
  const { app } = await buildApp({ password: 's3cret' })
  const r = await app.handle(
    new Request('http://localhost/api/me', {
      headers: { authorization: 'Basic ' + btoa('just-some-token') },
    }),
  )
  expect(r.status).toBe(401)
})

// ---------------------------------------------------------------------------
// B2 — /health bypasses auth
// ---------------------------------------------------------------------------

test('/health is accessible without Authorization header (Docker HEALTHCHECK)', async () => {
  // Build an app that includes /health AS REGISTERED IN server-bootstrap.
  const authStore = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    envPassHash: `fake$s3cret`,
    hash: fakeHash,
    verify: fakeVerify,
  })
  const rateLimiter = createRateLimiter({ now: () => 0 })
  const trustProxy = createTrustProxyEvaluator('')

  const app = new Elysia()
    .use(basicAuth({ authStore, rateLimiter, trustProxy, trustProxyHeader: '', disabled: false }))
    .get('/health', () => ({ status: 'ok' }))
    .get('/api/me', () => ({ ok: true }))

  const h = await app.handle(new Request('http://localhost/health'))
  expect(h.status).toBe(200)
  // Sanity: /api/me still requires auth.
  const me = await app.handle(new Request('http://localhost/api/me'))
  expect(me.status).toBe(401)
})

// ---------------------------------------------------------------------------
// B3 — trust-proxy gate on x-real-ip
// ---------------------------------------------------------------------------

test('x-real-ip from UNtrusted source is ignored (B3)', async () => {
  // extractClientIp (exported) is the unit under test. When no CIDR evaluator
  // says the socket-IP is trusted, x-real-ip must be dropped.
  const { extractClientIp } = await import('../../src/auth/basic-auth.ts')
  const trustProxy = createTrustProxyEvaluator('10.0.0.0/8')
  const req = new Request('http://localhost/api/me', {
    headers: { 'x-real-ip': '8.8.8.8' },
  })
  // Socket IP outside trusted range — header ignored.
  expect(extractClientIp(req, '203.0.113.5', trustProxy)).toBe('203.0.113.5')
  // Socket IP inside trusted range — header honoured.
  expect(extractClientIp(req, '10.1.2.3', trustProxy)).toBe('8.8.8.8')
})

test('x-forwarded-for from trusted source picks first hop', async () => {
  const { extractClientIp } = await import('../../src/auth/basic-auth.ts')
  const trustProxy = createTrustProxyEvaluator('127.0.0.0/8')
  const req = new Request('http://localhost/api/me', {
    headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' },
  })
  expect(extractClientIp(req, '127.0.0.1', trustProxy)).toBe('1.2.3.4')
})

test('no trustProxy evaluator → always returns socket IP', async () => {
  const { extractClientIp } = await import('../../src/auth/basic-auth.ts')
  const req = new Request('http://localhost/api/me', {
    headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' },
  })
  expect(extractClientIp(req, '1.1.1.1')).toBe('1.1.1.1')
})

// ---------------------------------------------------------------------------
// v0.2.1 hotfix — /api/onboarding/status bypasses auth
// ---------------------------------------------------------------------------
// The SPA router guard probes /api/onboarding/status BEFORE the user has a
// chance to authenticate (so it can decide whether to render the onboarding
// screen). With auth enabled and no cached creds, the probe was getting 401
// and the router was bailing out, never showing onboarding.
//
// Status is safe to expose anonymously: it reveals only "config file missing
// or not" + the configured path — no secrets. Writes (/seed) stay gated.

async function buildOnboardingApp(overrides: { disabled?: boolean } = {}) {
  const authStore = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    envPassHash: `fake$s3cret`,
    hash: fakeHash,
    verify: fakeVerify,
  })
  const rateLimiter = createRateLimiter({ now: () => 0 })
  const trustProxy = createTrustProxyEvaluator('')
  const app = new Elysia()
    .use(
      basicAuth({
        authStore,
        rateLimiter,
        trustProxy,
        trustProxyHeader: '',
        disabled: overrides.disabled ?? false,
      }),
    )
    .get('/api/onboarding/status', () => ({ needsOnboarding: false }))
    .post('/api/onboarding/seed', () => ({ success: true }))
    .get('/api/onboarding/other', () => ({ other: true }))
  return app
}

test('GET /api/onboarding/status bypasses auth (SPA router guard pre-login probe)', async () => {
  const app = await buildOnboardingApp()
  const r = await app.handle(new Request('http://localhost/api/onboarding/status'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { needsOnboarding: boolean }
  expect(body.needsOnboarding).toBe(false)
})

test('POST /api/onboarding/seed still requires auth', async () => {
  const app = await buildOnboardingApp()
  const r = await app.handle(
    new Request('http://localhost/api/onboarding/seed', { method: 'POST' }),
  )
  expect(r.status).toBe(401)
})

test('other /api/onboarding/* paths still require auth', async () => {
  const app = await buildOnboardingApp()
  const r = await app.handle(new Request('http://localhost/api/onboarding/other'))
  expect(r.status).toBe(401)
})

test('/api/onboarding/status prefix-tricks do not bypass auth', async () => {
  // Defense against someone sneaking a path like
  // `/api/onboarding/status/secret` or `/api/onboarding/statusleak` past
  // the gate via loose matching. The check is exact-match.
  const authStore = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    envPassHash: `fake$s3cret`,
    hash: fakeHash,
    verify: fakeVerify,
  })
  const rateLimiter = createRateLimiter({ now: () => 0 })
  const trustProxy = createTrustProxyEvaluator('')
  const app = new Elysia()
    .use(
      basicAuth({
        authStore,
        rateLimiter,
        trustProxy,
        trustProxyHeader: '',
        disabled: false,
      }),
    )
    .get('/api/onboarding/status/secret', () => ({ leaked: true }))
    .get('/api/onboarding/statusleak', () => ({ leaked: true }))

  const r1 = await app.handle(new Request('http://localhost/api/onboarding/status/secret'))
  expect(r1.status).toBe(401)
  const r2 = await app.handle(new Request('http://localhost/api/onboarding/statusleak'))
  expect(r2.status).toBe(401)
})
