import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import type { SnapshotMeta } from '../../src/transport/transport.ts'

function makeMeta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    id: '2026-04-16T10-00-00.000Z-abcd1234',
    timestamp: '2026-04-16T10:00:00.000Z',
    sha256_original: 'a'.repeat(64),
    sha256_masked: 'b'.repeat(64),
    applied_by: 'user',
    transport: 'local',
    ...overrides,
  }
}

test('readConfig returns empty string + hash on fresh transport', async () => {
  const t = new InMemoryTransport()
  const out = await t.readConfig()
  expect(out.content).toBe('')
  expect(out.hash).toBe(createHash('sha256').update('').digest('hex'))
})

test('readConfig picks up initialConfig + hash matches bytes', async () => {
  const raw = 'mode: rule\n'
  const t = new InMemoryTransport({ initialConfig: raw })
  const out = await t.readConfig()
  expect(out.content).toBe(raw)
  expect(out.hash).toBe(createHash('sha256').update(raw).digest('hex'))
})

test('writeConfig updates readConfig + increments writeCount', async () => {
  const t = new InMemoryTransport()
  expect(t.writeCount).toBe(0)
  await t.writeConfig('log-level: info\n', '/ignored/lockfile')
  expect(t.writeCount).toBe(1)
  const out = await t.readConfig()
  expect(out.content).toBe('log-level: info\n')
})

test('setConfigRaw simulates out-of-band mutation (does not count as write)', async () => {
  const t = new InMemoryTransport({ initialConfig: 'a: 1\n' })
  t.setConfigRaw('a: 2\n')
  expect(t.writeCount).toBe(0)
  const out = await t.readConfig()
  expect(out.content).toBe('a: 2\n')
})

test('hash reflects content mutations between reads', async () => {
  const t = new InMemoryTransport({ initialConfig: 'x\n' })
  const first = await t.readConfig()
  await t.writeConfig('y\n', '/l')
  const second = await t.readConfig()
  expect(first.hash).not.toBe(second.hash)
})

test('writeSnapshot + readSnapshot round-trips', async () => {
  const t = new InMemoryTransport()
  const meta = makeMeta()
  await t.writeSnapshot(meta.id, {
    'config.yaml': 'mode: rule\n',
    'meta.json': JSON.stringify(meta),
    'diff.patch': '--- a\n+++ b\n',
  })
  const got = await t.readSnapshot(meta.id)
  expect(got['config.yaml']).toBe('mode: rule\n')
  expect(got.meta.id).toBe(meta.id)
  expect(got.meta.applied_by).toBe('user')
})

test('writeSnapshot rejects id/meta.id mismatch', async () => {
  const t = new InMemoryTransport()
  const meta = makeMeta({ id: 'A' })
  await expect(
    t.writeSnapshot('B', {
      'config.yaml': '',
      'meta.json': JSON.stringify(meta),
      'diff.patch': '',
    }),
  ).rejects.toThrow(/meta\.id .* !== id arg/)
})

test('readSnapshotsDir sorts newest-first by timestamp', async () => {
  const t = new InMemoryTransport()
  const older = makeMeta({ id: 'old', timestamp: '2026-04-15T09:00:00.000Z' })
  const newer = makeMeta({ id: 'new', timestamp: '2026-04-16T09:00:00.000Z' })
  await t.writeSnapshot(older.id, {
    'config.yaml': '',
    'meta.json': JSON.stringify(older),
    'diff.patch': '',
  })
  await t.writeSnapshot(newer.id, {
    'config.yaml': '',
    'meta.json': JSON.stringify(newer),
    'diff.patch': '',
  })
  const list = await t.readSnapshotsDir()
  expect(list.map((m) => m.id)).toEqual(['new', 'old'])
})

test('deleteSnapshot removes the entry', async () => {
  const t = new InMemoryTransport()
  const meta = makeMeta()
  await t.writeSnapshot(meta.id, {
    'config.yaml': '',
    'meta.json': JSON.stringify(meta),
    'diff.patch': '',
  })
  await t.deleteSnapshot(meta.id)
  const list = await t.readSnapshotsDir()
  expect(list).toHaveLength(0)
  // reading a deleted id throws
  await expect(t.readSnapshot(meta.id)).rejects.toThrow(/snapshot not found/)
})

test('deleteSnapshot on missing id is a no-op', async () => {
  const t = new InMemoryTransport()
  await t.deleteSnapshot('never-existed')
  // no throw, no list corruption
  const list = await t.readSnapshotsDir()
  expect(list).toHaveLength(0)
})

test('readSnapshot on missing id throws', async () => {
  const t = new InMemoryTransport()
  await expect(t.readSnapshot('nope')).rejects.toThrow(/snapshot not found/)
})

test('runMihomoValidate default-ok when no validator injected', async () => {
  const t = new InMemoryTransport()
  const r = await t.runMihomoValidate('mode: rule\n')
  expect(r.ok).toBe(true)
  expect(r.errors).toEqual([])
})

test('runMihomoValidate forwards to injected validator', async () => {
  const t = new InMemoryTransport({
    validate: (c) => ({
      ok: c.includes('bad') ? false : true,
      errors: c.includes('bad') ? [{ message: 'nope' }] : [],
      raw_output: `saw ${c.length} bytes`,
    }),
  })
  const good = await t.runMihomoValidate('mode: rule\n')
  expect(good.ok).toBe(true)
  const bad = await t.runMihomoValidate('bad\n')
  expect(bad.ok).toBe(false)
  expect(bad.errors[0]!.message).toBe('nope')
  expect(bad.raw_output).toContain('saw')
})

test('mihomoApiUrl + mihomoApiSecret echo constructor options', () => {
  const t = new InMemoryTransport({
    mihomoApiUrl: 'http://fake:9999',
    mihomoApiSecret: 'super-seekret',
  })
  expect(t.mihomoApiUrl()).toBe('http://fake:9999')
  expect(t.mihomoApiSecret()).toBe('super-seekret')
})
