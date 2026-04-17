// Rate-limit store tests — disk persistence for brute-force lockouts so an
// attacker can't reset their counter by `docker restart`ing Miharbor.
//
// Covers both store implementations:
//   - createFileStore: atomic write (tmp + rename), debounce, load-time pruning,
//     corrupt-file recovery, dispose flush semantics
//   - createNullStore: no-op shim for when MIHARBOR_DATA_DIR is unset

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'

import {
  createFileStore,
  createNullStore,
  type FileStoreOptions,
} from '../../src/auth/rate-limit-store.ts'
import type { RateLimitEntry } from '../../src/auth/rate-limit.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miharbor-rls-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function captureWarnings(): {
  warnings: Array<Record<string, unknown>>
  logger: {
    info: () => void
    warn: (p: Record<string, unknown>) => void
    debug: () => void
    error: () => void
  }
} {
  const warnings: Array<Record<string, unknown>> = []
  return {
    warnings,
    logger: {
      info: () => {},
      warn: (p) => {
        warnings.push(p)
      },
      debug: () => {},
      error: () => {},
    },
  }
}

function mkEntry(e: Partial<RateLimitEntry> = {}): RateLimitEntry {
  return {
    fails: e.fails ?? 1,
    firstFailAt: e.firstFailAt ?? 0,
    lockedUntil: e.lockedUntil ?? 0,
  }
}

function waitDebounce(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------- FileStore: save / load roundtrip ----------

test('FileStore: save writes JSON v1 with entries + timestamp', async () => {
  const path = join(dir, 'rl.json')
  const store = createFileStore({ path, debounceMs: 10, now: () => 1000 })
  const m = new Map<string, RateLimitEntry>()
  m.set('1.2.3.4', mkEntry({ fails: 3, firstFailAt: 500, lockedUntil: 0 }))
  store.save(m)
  await store.dispose() // flush pending

  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as {
    version: number
    entries: Record<string, RateLimitEntry>
    savedAt: number
  }
  expect(parsed.version).toBe(1)
  expect(parsed.savedAt).toBe(1000)
  expect(parsed.entries['1.2.3.4']).toEqual({ fails: 3, firstFailAt: 500, lockedUntil: 0 })
})

test('FileStore: load() returns empty Map when file missing', async () => {
  const path = join(dir, 'missing.json')
  const store = createFileStore({ path, debounceMs: 10 })
  const loaded = await store.load()
  expect(loaded.size).toBe(0)
  await store.dispose()
})

test('FileStore: roundtrip save → dispose → load', async () => {
  const path = join(dir, 'rl.json')
  const s1 = createFileStore({ path, debounceMs: 10 })
  const m = new Map<string, RateLimitEntry>([
    ['1.2.3.4', mkEntry({ fails: 2, firstFailAt: 100, lockedUntil: 0 })],
    ['5.6.7.8', mkEntry({ fails: 5, firstFailAt: 200, lockedUntil: 999999 })],
  ])
  s1.save(m)
  await s1.dispose()

  const s2 = createFileStore({ path, debounceMs: 10, now: () => 0 })
  const loaded = await s2.load()
  expect(loaded.size).toBe(2)
  expect(loaded.get('1.2.3.4')).toEqual(m.get('1.2.3.4')!)
  expect(loaded.get('5.6.7.8')).toEqual(m.get('5.6.7.8')!)
  await s2.dispose()
})

// ---------- FileStore: debounce ----------

test('FileStore: multiple rapid saves collapse into one write within debounce window', async () => {
  const path = join(dir, 'rl.json')
  const store = createFileStore({ path, debounceMs: 50 })
  // Fire 5 saves back-to-back; only the final snapshot should hit disk.
  for (let i = 0; i < 5; i += 1) {
    const m = new Map<string, RateLimitEntry>()
    m.set('x', mkEntry({ fails: i + 1 }))
    store.save(m)
  }
  // Immediately: file should NOT exist yet (debounce pending).
  expect(existsSync(path)).toBe(false)
  await waitDebounce(120)
  expect(existsSync(path)).toBe(true)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    entries: Record<string, RateLimitEntry>
  }
  // The last save wins.
  expect(parsed.entries['x']?.fails).toBe(5)
  await store.dispose()
})

test('FileStore: dispose() flushes pending save synchronously', async () => {
  const path = join(dir, 'rl.json')
  const store = createFileStore({ path, debounceMs: 10_000 }) // long debounce
  const m = new Map<string, RateLimitEntry>([['ip', mkEntry({ fails: 42 })]])
  store.save(m)
  expect(existsSync(path)).toBe(false) // timer hasn't fired
  await store.dispose()
  expect(existsSync(path)).toBe(true) // dispose flushed
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    entries: Record<string, RateLimitEntry>
  }
  expect(parsed.entries['ip']?.fails).toBe(42)
})

test('FileStore: save() after dispose() is a no-op (resource released)', async () => {
  const path = join(dir, 'rl.json')
  const store = createFileStore({ path, debounceMs: 10 })
  await store.dispose()
  const m = new Map<string, RateLimitEntry>([['ip', mkEntry()]])
  store.save(m)
  await waitDebounce(40)
  expect(existsSync(path)).toBe(false)
})

// ---------- FileStore: load-time pruning ----------

test('FileStore: load() prunes expired entries (lockout done AND window expired)', async () => {
  const path = join(dir, 'rl.json')
  const now = 10_000
  const failWindowMs = 1000
  const lockoutMs = 5000
  // Entry A: locked and still active — keep
  // Entry B: lockout expired AND fail-window expired — drop
  // Entry C: no lockout, still in fail-window — keep
  // Entry D: no lockout, fail-window expired — drop
  const fileData = {
    version: 1,
    savedAt: now - 100,
    entries: {
      a: { fails: 5, firstFailAt: now - 50, lockedUntil: now + 1000 },
      b: { fails: 5, firstFailAt: 0, lockedUntil: 100 },
      c: { fails: 2, firstFailAt: now - 200, lockedUntil: 0 },
      d: { fails: 1, firstFailAt: 0, lockedUntil: 0 },
    },
  }
  writeFileSync(path, JSON.stringify(fileData), 'utf8')

  const opts: FileStoreOptions = {
    path,
    debounceMs: 10,
    now: () => now,
    pruneBefore: { failWindowMs, lockoutMs },
  }
  const store = createFileStore(opts)
  const loaded = await store.load()

  expect(loaded.size).toBe(2)
  expect(loaded.has('a')).toBe(true)
  expect(loaded.has('c')).toBe(true)
  expect(loaded.has('b')).toBe(false)
  expect(loaded.has('d')).toBe(false)
  await store.dispose()
})

test('FileStore: load() without pruneBefore returns all entries as-is', async () => {
  const path = join(dir, 'rl.json')
  const fileData = {
    version: 1,
    savedAt: 0,
    entries: {
      expired: { fails: 5, firstFailAt: 0, lockedUntil: 100 },
    },
  }
  writeFileSync(path, JSON.stringify(fileData), 'utf8')
  const store = createFileStore({ path, debounceMs: 10, now: () => 999999 })
  const loaded = await store.load()
  expect(loaded.size).toBe(1)
  expect(loaded.has('expired')).toBe(true)
  await store.dispose()
})

// ---------- FileStore: corruption handling ----------

test('FileStore: load() returns empty Map + warns on corrupt JSON', async () => {
  const path = join(dir, 'rl.json')
  writeFileSync(path, '{this is not valid json', 'utf8')
  const { warnings, logger } = captureWarnings()
  const store = createFileStore({ path, debounceMs: 10, logger })
  const loaded = await store.load()
  expect(loaded.size).toBe(0)
  expect(warnings.length).toBeGreaterThan(0)
  const w = warnings[0]!
  expect(typeof w.msg).toBe('string')
  expect((w.msg as string).toLowerCase()).toContain('corrupt')
  await store.dispose()
})

test('FileStore: load() tolerates malformed entries (missing fields)', async () => {
  const path = join(dir, 'rl.json')
  // entries field is not an object
  writeFileSync(path, JSON.stringify({ version: 1, entries: 'nope' }), 'utf8')
  const { warnings, logger } = captureWarnings()
  const store = createFileStore({ path, debounceMs: 10, logger })
  const loaded = await store.load()
  expect(loaded.size).toBe(0)
  expect(warnings.length).toBeGreaterThan(0)
  await store.dispose()
})

test('FileStore: load() skips individual entries missing required fields', async () => {
  const path = join(dir, 'rl.json')
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      savedAt: 0,
      entries: {
        good: { fails: 2, firstFailAt: 100, lockedUntil: 0 },
        bad: { fails: 'oops' },
        worse: null,
      },
    }),
    'utf8',
  )
  const store = createFileStore({ path, debounceMs: 10 })
  const loaded = await store.load()
  expect(loaded.size).toBe(1)
  expect(loaded.has('good')).toBe(true)
  await store.dispose()
})

test('FileStore: load() rejects unknown version and returns empty Map + warns', async () => {
  const path = join(dir, 'rl.json')
  writeFileSync(
    path,
    JSON.stringify({
      version: 2,
      savedAt: 0,
      entries: {
        ip1: { fails: 5, firstFailAt: 100, lockedUntil: 0 },
      },
    }),
    'utf8',
  )
  const { warnings, logger } = captureWarnings()
  const store = createFileStore({ path, debounceMs: 10, logger })
  const loaded = await store.load()
  expect(loaded.size).toBe(0)
  expect(warnings.length).toBeGreaterThan(0)
  const w = warnings[0]!
  expect(typeof w.msg).toBe('string')
  expect((w.msg as string).toLowerCase()).toContain('unknown version')
  expect(w.got).toBe(2)
  expect(w.expected).toBe(1)
  await store.dispose()
})

// ---------- FileStore: atomic write ----------

test('FileStore: atomic write leaves no partial file on write failure', async () => {
  const path = join(dir, 'rl.json')
  // Seed with valid data so there's something to preserve.
  writeFileSync(path, JSON.stringify({ version: 1, savedAt: 0, entries: {} }), 'utf8')
  const originalBytes = readFileSync(path, 'utf8')

  // Make the target directory read-only mid-dispose by causing rename failure.
  // We simulate the failure by replacing fsp.rename temporarily.
  const originalRename = fsp.rename
  let renameCalls = 0
  // Use a runtime monkey-patch; we restore it in the finally block.
  ;(fsp as unknown as { rename: typeof fsp.rename }).rename = (async () => {
    renameCalls += 1
    throw new Error('simulated rename failure')
  }) as typeof fsp.rename

  try {
    const store = createFileStore({ path, debounceMs: 10 })
    const m = new Map<string, RateLimitEntry>([['new', mkEntry()]])
    store.save(m)
    // dispose() should attempt the flush; the rename will throw but should
    // not crash the process nor corrupt the existing file.
    await store.dispose()
    expect(renameCalls).toBeGreaterThan(0)
    // Existing file unchanged.
    expect(readFileSync(path, 'utf8')).toBe(originalBytes)
    // No partial tmp files lying around.
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'))
    expect(leftovers.length).toBe(0)
  } finally {
    ;(fsp as unknown as { rename: typeof fsp.rename }).rename = originalRename
  }
})

// ---------- NullStore ----------

test('NullStore: load() returns empty Map, save/dispose are no-ops', async () => {
  const store = createNullStore()
  const loaded = await store.load()
  expect(loaded.size).toBe(0)
  const m = new Map<string, RateLimitEntry>([['ip', mkEntry()]])
  store.save(m)
  // No exceptions; no file IO because there's no path configured.
  await store.dispose()
  // Load still empty.
  const loaded2 = await store.load()
  expect(loaded2.size).toBe(0)
})
