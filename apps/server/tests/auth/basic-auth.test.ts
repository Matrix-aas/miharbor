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
