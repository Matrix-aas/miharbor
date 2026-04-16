import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withLock } from '../../src/lock/proper-lock.ts'

let tmpDir: string
let target: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'miharbor-lock-'))
  target = join(tmpDir, 'target.yaml')
  writeFileSync(target, 'placeholder')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test('withLock returns fn result on success', async () => {
  const v = await withLock(target, async () => 42)
  expect(v).toBe(42)
})

test('withLock releases on success — subsequent call succeeds immediately', async () => {
  await withLock(target, async () => 1)
  const t0 = Date.now()
  const v = await withLock(target, async () => 2)
  expect(v).toBe(2)
  // No contention → should be effectively instant.
  expect(Date.now() - t0).toBeLessThan(200)
})

test('withLock releases on throw — subsequent call succeeds', async () => {
  await expect(
    withLock(target, async () => {
      throw new Error('boom')
    }),
  ).rejects.toThrow(/boom/)
  const v = await withLock(target, async () => 'ok')
  expect(v).toBe('ok')
})

test('second withLock waits for the first to release (serial execution)', async () => {
  const observations: number[] = []
  const first = withLock(target, async () => {
    observations.push(1)
    // Hold the lock briefly so the second caller has to wait.
    await new Promise((r) => setTimeout(r, 80))
    observations.push(2)
  })
  // Give the first lock time to actually acquire.
  await new Promise((r) => setTimeout(r, 5))
  const second = withLock(target, async () => {
    observations.push(3)
  })
  await Promise.all([first, second])
  expect(observations).toEqual([1, 2, 3])
})

test('withLock with realpath:false tolerates missing target (creates .lock sibling)', async () => {
  // proper-lockfile in realpath:false mode uses `<path>.lock` as a mkdir
  // sentinel. It does not require `<path>` to exist — documented on the
  // project README. We codify that so a refactor that flips `realpath`
  // to true will regress this test.
  const v = await withLock(join(tmpDir, 'missing.yaml'), async () => 'ran', { retries: 0 })
  expect(v).toBe('ran')
})

test('withLock respects retries=0 on contention', async () => {
  const release = withLock(target, async () => {
    await new Promise((r) => setTimeout(r, 150))
  })
  await new Promise((r) => setTimeout(r, 5))
  // 0 retries + short maxTimeout ⇒ the second call should fail fast
  // rather than block for 150ms+.
  await expect(withLock(target, async () => 1, { retries: 0 })).rejects.toBeDefined()
  await release
})
