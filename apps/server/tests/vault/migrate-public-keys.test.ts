import { afterEach, beforeEach, expect, test, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVault, type Vault } from '../../src/vault/vault.ts'
import { migrateDraftPublicKeys } from '../../src/vault/migrate-public-keys.ts'

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
let dataDir: string
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-migrate-'))
})
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function seedVault(values: string[]): Promise<{ vault: Vault; uuids: string[] }> {
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const uuids: string[] = []
  for (const v of values) uuids.push(await vault.store(v))
  return { vault, uuids }
}

test('rewrites public-key sentinel with resolved vault value', async () => {
  const { vault, uuids } = await seedVault(['abc123DEFpublicKeyXYZ='])
  const input = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuids[0]}\n`
  const { text, touched, count } = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(touched).toBe(true)
  expect(count).toBe(1)
  expect(text).toContain('public-key: abc123DEFpublicKeyXYZ=')
  expect(text).not.toContain('$MIHARBOR_VAULT:')
})

test('leaves non-sentinel drafts untouched', async () => {
  const { vault } = await seedVault([])
  const input = `mode: rule\nproxies:\n  - name: wg1\n    public-key: realkey=\n`
  const { text, touched, count } = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(touched).toBe(false)
  expect(count).toBe(0)
  expect(text).toBe(input)
})

test('uses resolveMany exactly once for multiple vaulted public-keys', async () => {
  const { vault, uuids } = await seedVault(['k1=', 'k2=', 'k3='])
  const input = [
    'proxies:',
    `  - name: a\n    public-key: $MIHARBOR_VAULT:${uuids[0]}`,
    `  - name: b\n    public-key: $MIHARBOR_VAULT:${uuids[1]}`,
    `  - name: c\n    public-key: $MIHARBOR_VAULT:${uuids[2]}`,
    '',
  ].join('\n')
  const spy = mock(vault.resolveMany.bind(vault))
  const patched: Vault = { ...vault, resolveMany: spy }
  const { text, touched, count } = await migrateDraftPublicKeys(input, patched, noopLogger)
  expect(touched).toBe(true)
  expect(count).toBe(3)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(text).toContain('public-key: k1=')
  expect(text).toContain('public-key: k2=')
  expect(text).toContain('public-key: k3=')
})

test('preserves sentinel and warns when uuid is unknown to vault', async () => {
  const { vault } = await seedVault([])
  const UNKNOWN = '00000000-0000-0000-0000-000000000000'
  const input = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${UNKNOWN}\n`
  const warns: unknown[] = []
  const logger = { ...noopLogger, warn: (o: unknown) => warns.push(o) }
  const { text, touched, count } = await migrateDraftPublicKeys(input, vault, logger)
  expect(touched).toBe(false)
  expect(count).toBe(0)
  expect(text).toContain(`$MIHARBOR_VAULT:${UNKNOWN}`)
  expect(warns).toHaveLength(1)
})

test('partial success — some resolved, some unknown', async () => {
  const { vault, uuids } = await seedVault(['known-key='])
  const UNKNOWN = '00000000-0000-0000-0000-000000000000'
  const input = [
    'proxies:',
    `  - name: a\n    public-key: $MIHARBOR_VAULT:${uuids[0]}`,
    `  - name: b\n    public-key: $MIHARBOR_VAULT:${UNKNOWN}`,
    '',
  ].join('\n')
  const { text, touched, count } = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(touched).toBe(true)
  expect(count).toBe(1)
  expect(text).toContain('public-key: known-key=')
  expect(text).toContain(`public-key: $MIHARBOR_VAULT:${UNKNOWN}`)
})

test('invalid YAML returns input unchanged without throwing', async () => {
  const { vault } = await seedVault([])
  const bad = 'not: valid: yaml: : :\n  - missing\n'
  const { text, touched, count } = await migrateDraftPublicKeys(bad, vault, noopLogger)
  expect(touched).toBe(false)
  expect(count).toBe(0)
  expect(text).toBe(bad)
})

test('idempotent — second call is a no-op', async () => {
  const { vault, uuids } = await seedVault(['roundtrip='])
  const input = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuids[0]}\n`
  const first = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(first.touched).toBe(true)
  expect(first.count).toBe(1)
  const second = await migrateDraftPublicKeys(first.text, vault, noopLogger)
  expect(second.touched).toBe(false)
  expect(second.count).toBe(0)
  expect(second.text).toBe(first.text)
})
