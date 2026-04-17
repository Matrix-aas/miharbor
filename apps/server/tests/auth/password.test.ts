// Password / auth-store tests. We inject fake hash/verify to keep tests
// fast (Argon2id hashing is ~100ms by design).

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthStore } from '../../src/auth/password.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-auth-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

const fakeHash = async (p: string): Promise<string> => `fake$${p}`
const fakeVerify = async (p: string, h: string): Promise<boolean> => h === `fake$${p}`

test('onboarding: no auth.json + no env → bootstrap mode, admin/admin works, mustChangePassword=true', async () => {
  const store = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    hash: fakeHash,
    verify: fakeVerify,
  })
  expect(store.mustChangePassword()).toBe(true)
  expect(store.getUser()).toBe('admin')
  expect(await store.verifyPassword('admin')).toBe(true)
  expect(await store.verifyPassword('wrong')).toBe(false)
})

test('ENV hash source: uses MIHARBOR_AUTH_PASS_HASH, no must-change flag', async () => {
  const store = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    envPassHash: 'fake$s3cret!',
    hash: fakeHash,
    verify: fakeVerify,
  })
  expect(store.mustChangePassword()).toBe(false)
  expect(await store.verifyPassword('s3cret!')).toBe(true)
  expect(await store.verifyPassword('admin')).toBe(false)
})

test('auth.json wins over ENV hash', async () => {
  const store1 = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    envPassHash: 'fake$from-env',
    hash: fakeHash,
    verify: fakeVerify,
  })
  await store1.setPassword('from-file-password')
  expect(existsSync(join(dataDir, 'auth.json'))).toBe(true)

  // New instance: auth.json should be picked up.
  const store2 = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    envPassHash: 'fake$from-env',
    hash: fakeHash,
    verify: fakeVerify,
  })
  expect(store2.mustChangePassword()).toBe(false)
  expect(await store2.verifyPassword('from-file-password')).toBe(true)
  expect(await store2.verifyPassword('from-env')).toBe(false)
})

test('setPassword rejects < 8 chars', async () => {
  const store = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    hash: fakeHash,
    verify: fakeVerify,
  })
  await expect(store.setPassword('short')).rejects.toThrow(/too short/)
})

test('auth.json written with mode 0600', async () => {
  const store = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
    hash: fakeHash,
    verify: fakeVerify,
  })
  await store.setPassword('correct-horse')
  const path = join(dataDir, 'auth.json')
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as { version: number; user: string; hash: string }
  expect(parsed.version).toBe(1)
  expect(parsed.user).toBe('admin')
  expect(parsed.hash).toContain('correct-horse')
})

test('real Bun.password.hash + verify round-trips (no injection)', async () => {
  const store = await createAuthStore({
    dataDir,
    defaultUser: 'admin',
  })
  expect(store.mustChangePassword()).toBe(true)
  expect(await store.verifyPassword('admin')).toBe(true)
  await store.setPassword('very-good-password-123')
  expect(await store.verifyPassword('very-good-password-123')).toBe(true)
  expect(await store.verifyPassword('admin')).toBe(false)
})
