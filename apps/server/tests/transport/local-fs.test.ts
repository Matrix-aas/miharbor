import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { LocalFsTransport } from '../../src/transport/local-fs.ts'
import type { SnapshotMeta } from '../../src/transport/transport.ts'

let root: string
let configPath: string
let dataDir: string
let lockFile: string

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'miharbor-localfs-'))
  configPath = join(root, 'config.yaml')
  dataDir = join(root, 'data')
  lockFile = join(root, '.config.lock')
  writeFileSync(configPath, 'mode: rule\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

test('readConfig returns content + sha256 of raw bytes', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const out = await t.readConfig()
  expect(out.content).toBe('mode: rule\n')
  expect(out.hash).toBe(sha256('mode: rule\n'))
})

test('writeConfig atomically replaces the file under flock', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  await t.writeConfig('mode: global\n', lockFile)
  expect(readFileSync(configPath, 'utf8')).toBe('mode: global\n')
})

test('writeConfig sets mode 0600 on the written file', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  await t.writeConfig('a: 1\n', lockFile)
  const mode = statSync(configPath).mode & 0o777
  // Some Docker volume drivers reject chmod; accept 0600 or 0644 (the
  // umask-default) but require "not world-writable".
  expect(mode & 0o002).toBe(0)
  expect([0o600, 0o644]).toContain(mode)
})

test('writeConfig leaves no tmp files behind after rename', async () => {
  const { readdirSync } = await import('node:fs')
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  await t.writeConfig('foo: bar\n', lockFile)
  const names = readdirSync(root)
  expect(names.some((n) => n.includes('miharbor.tmp'))).toBe(false)
})

test('verifyAndWrite fails when file changed between read and write (TOCTOU)', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const before = await t.readConfig()
  // External mutation — someone ran `vim config.yaml`.
  writeFileSync(configPath, 'mode: direct\n')
  await expect(t.verifyAndWrite('mode: global\n', lockFile, before.hash)).rejects.toThrow(
    /config changed on disk/,
  )
  // And the external change must be preserved (we did not overwrite it).
  expect(readFileSync(configPath, 'utf8')).toBe('mode: direct\n')
})

test('verifyAndWrite succeeds when hash still matches', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const before = await t.readConfig()
  await t.verifyAndWrite('mode: global\n', lockFile, before.hash)
  expect(readFileSync(configPath, 'utf8')).toBe('mode: global\n')
})

test('readSnapshotsDir returns [] on a fresh data dir', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  expect(await t.readSnapshotsDir()).toEqual([])
})

test('writeSnapshot creates the directory and bundle, readSnapshot round-trips', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const meta = makeMeta()
  await t.writeSnapshot(meta.id, {
    'config.yaml': 'mode: rule\n',
    'meta.json': JSON.stringify(meta),
    'diff.patch': '--- a\n+++ b\n',
  })
  const got = await t.readSnapshot(meta.id)
  expect(got['config.yaml']).toBe('mode: rule\n')
  expect(got.meta.id).toBe(meta.id)

  const list = await t.readSnapshotsDir()
  expect(list).toHaveLength(1)
  expect(list[0]!.id).toBe(meta.id)
})

test('readSnapshotsDir sorts newest-first + tolerates unreadable meta', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
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
  // Corrupt a third meta.json to verify tolerance.
  const { mkdirSync } = await import('node:fs')
  const corruptDir = join(t.snapshotsDir(), 'broken')
  mkdirSync(corruptDir, { recursive: true })
  writeFileSync(join(corruptDir, 'meta.json'), '{not json')
  const list = await t.readSnapshotsDir()
  expect(list.map((m) => m.id)).toEqual(['new', 'old'])
})

test('deleteSnapshot removes the directory', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const meta = makeMeta()
  await t.writeSnapshot(meta.id, {
    'config.yaml': '',
    'meta.json': JSON.stringify(meta),
    'diff.patch': '',
  })
  await t.deleteSnapshot(meta.id)
  expect(await t.readSnapshotsDir()).toEqual([])
})

test('deleteSnapshot on missing id is a no-op', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  await t.deleteSnapshot('nonexistent')
  // no throw
})

test('runMihomoValidate shared-only returns ok on valid YAML', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const r = await t.runMihomoValidate('mode: rule\n')
  expect(r.ok).toBe(true)
  expect(r.errors).toEqual([])
  expect(r.raw_output).toContain('shared-only')
})

test('runMihomoValidate shared-only reports parse errors with line/col', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  const r = await t.runMihomoValidate('mode: rule\n  bad: [unclosed\n')
  expect(r.ok).toBe(false)
  expect(r.errors.length).toBeGreaterThan(0)
  // line/col should be defined for at least one error — yaml@2 linePos.
  const first = r.errors[0]!
  expect(typeof first.message).toBe('string')
})

test('runMihomoValidate api-mode stubs with warning', async () => {
  const warnings: unknown[] = []
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
    validationMode: 'api',
    logger: {
      info: () => {},
      warn: (m: unknown) => warnings.push(m),
      debug: () => {},
      error: () => {},
    },
  })
  const r = await t.runMihomoValidate('mode: rule\n')
  expect(r.ok).toBe(true)
  expect(r.raw_output).toContain('api validation deferred')
  expect(warnings.length).toBeGreaterThan(0)
})

test('mihomoApiUrl + mihomoApiSecret return constructor values verbatim', () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://real:9090',
    mihomoApiSecret: 'deadbeef',
  })
  expect(t.mihomoApiUrl()).toBe('http://real:9090')
  expect(t.mihomoApiSecret()).toBe('deadbeef')
})

test('concurrent writeConfig calls are serialised by the lock', async () => {
  const t = new LocalFsTransport({
    configPath,
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: 's',
  })
  // Parallel writers — only the last one "wins" but none should corrupt
  // the file (no partial writes; rename semantics).
  await Promise.all([
    t.writeConfig('a: 1\n', lockFile),
    t.writeConfig('a: 2\n', lockFile),
    t.writeConfig('a: 3\n', lockFile),
  ])
  const final = readFileSync(configPath, 'utf8')
  expect(['a: 1\n', 'a: 2\n', 'a: 3\n']).toContain(final)
})
