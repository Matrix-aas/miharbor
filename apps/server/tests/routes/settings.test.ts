// /api/settings/env route tests.
//
// Asserts:
//  * GET returns a snapshot of all env keys with `source: 'env' | 'default'`.
//  * Secret-looking keys (_SECRET / _API_KEY / _KEY / _PASS_HASH / _PASSWORD
//    / _TOKEN) have `value: '***'` and `masked: true` when set, or `value: ''`
//    with `masked: true` when unset.
//  * Non-secret values flow through verbatim.

import { expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { loadEnv } from '../../src/env/schema.ts'
import { buildEnvSnapshot, isSecretKey, settingsRoutes } from '../../src/routes/settings.ts'

function mkRawEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    MIHARBOR_DATA_DIR: '/tmp/miharbor-settings-test',
    ...extra,
  }
}

test('isSecretKey catches SECRET / API_KEY / KEY / PASS_HASH / PASSWORD / TOKEN suffixes', () => {
  expect(isSecretKey('MIHOMO_API_SECRET')).toBe(true)
  expect(isSecretKey('ANTHROPIC_API_KEY')).toBe(true)
  expect(isSecretKey('MIHARBOR_VAULT_KEY')).toBe(true)
  expect(isSecretKey('MIHARBOR_AUTH_PASS_HASH')).toBe(true)
  expect(isSecretKey('FOO_PASSWORD')).toBe(true)
  expect(isSecretKey('SLACK_TOKEN')).toBe(true)
  expect(isSecretKey('MIHARBOR_PORT')).toBe(false)
  expect(isSecretKey('MIHARBOR_TRANSPORT')).toBe(false)
  expect(isSecretKey('MIHARBOR_CONFIG_PATH')).toBe(false)
})

test('buildEnvSnapshot masks secret keys with *** and reports source=env', () => {
  const raw = mkRawEnv({
    MIHOMO_API_SECRET: 'topsecret',
    ANTHROPIC_API_KEY: 'sk-anthropic-123',
  })
  const env = loadEnv(raw)
  const snap = buildEnvSnapshot(env, raw)
  expect(snap.MIHOMO_API_SECRET).toEqual({ value: '***', source: 'env', masked: true })
  expect(snap.ANTHROPIC_API_KEY).toEqual({ value: '***', source: 'env', masked: true })
})

test('buildEnvSnapshot reports source=default for unset vars', () => {
  const raw = mkRawEnv()
  const env = loadEnv(raw)
  const snap = buildEnvSnapshot(env, raw)
  expect(snap.MIHARBOR_PORT).toEqual({ value: 3000, source: 'default' })
  expect(snap.MIHARBOR_TRANSPORT).toEqual({ value: 'local', source: 'default' })
})

test('buildEnvSnapshot empty-but-secret key still reports masked:true with empty value', () => {
  const raw = mkRawEnv()
  const env = loadEnv(raw)
  const snap = buildEnvSnapshot(env, raw)
  // Default for MIHOMO_API_SECRET is '' — we still mask it but value is empty.
  expect(snap.MIHOMO_API_SECRET).toEqual({ value: '', source: 'default', masked: true })
})

test('GET /api/settings/env returns the JSON snapshot through the route', async () => {
  const raw = mkRawEnv({ MIHOMO_API_SECRET: 'abc' })
  const env = loadEnv(raw)
  const app = new Elysia().use(settingsRoutes({ env, rawEnv: raw }))
  const r = await app.handle(new Request('http://localhost/api/settings/env'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Record<
    string,
    { value: unknown; source: string; masked?: boolean }
  >
  expect(body.MIHOMO_API_SECRET!.masked).toBe(true)
  expect(body.MIHOMO_API_SECRET!.value).toBe('***')
  expect(body.MIHARBOR_TRANSPORT!.value).toBe('local')
})
