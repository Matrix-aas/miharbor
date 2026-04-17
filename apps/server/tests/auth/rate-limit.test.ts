// Rate-limiter tests. Uses an injected clock so the 5-minute fail window
// and 15-minute lockout don't hold up the suite.

import { expect, test } from 'bun:test'
import {
  createRateLimiter,
  createRateLimiterAsync,
  type RateLimitEntry,
} from '../../src/auth/rate-limit.ts'
import type { RateLimitStore } from '../../src/auth/rate-limit-store.ts'

/** In-memory store for restart-scenario tests. Mimics the disk store's
 *  contract but keeps everything in a local Map so tests are deterministic. */
function createFakeStore(initial?: Map<string, RateLimitEntry>): RateLimitStore & {
  snapshot: () => Map<string, RateLimitEntry>
  saveCount: () => number
} {
  let storage = initial ? new Map(initial) : new Map<string, RateLimitEntry>()
  let saves = 0
  return {
    async load(): Promise<Map<string, RateLimitEntry>> {
      return new Map(storage)
    },
    save(entries: Map<string, RateLimitEntry>): void {
      saves += 1
      storage = new Map(entries)
    },
    async dispose(): Promise<void> {
      /* no timer to flush in this fake */
    },
    snapshot(): Map<string, RateLimitEntry> {
      return new Map(storage)
    },
    saveCount(): number {
      return saves
    },
  }
}

test('fresh IP: check returns unlocked with 0 fails', () => {
  const limiter = createRateLimiter({ now: () => 0 })
  const s = limiter.check('1.2.3.4')
  expect(s.locked).toBe(false)
  expect(s.fails).toBe(0)
})

test('5 fails in window trips lockout', () => {
  let t = 0
  const limiter = createRateLimiter({ now: () => t })
  for (let i = 0; i < 4; i += 1) {
    const r = limiter.fail('1.2.3.4')
    expect(r.locked).toBe(false)
  }
  const fifth = limiter.fail('1.2.3.4')
  expect(fifth.locked).toBe(true)
  expect(fifth.retryAfterMs).toBeGreaterThan(0)

  // Check now reports locked.
  const check = limiter.check('1.2.3.4')
  expect(check.locked).toBe(true)
})

test('success() resets fails counter', () => {
  let t = 0
  const limiter = createRateLimiter({ now: () => t })
  limiter.fail('1.2.3.4')
  limiter.fail('1.2.3.4')
  expect(limiter.check('1.2.3.4').fails).toBe(2)
  limiter.success('1.2.3.4')
  expect(limiter.check('1.2.3.4').fails).toBe(0)
})

test('fail window slides — after window expires, counter resets', () => {
  let t = 0
  const limiter = createRateLimiter({
    now: () => t,
    failWindowMs: 1000,
    lockoutMs: 5000,
  })
  limiter.fail('1.2.3.4')
  limiter.fail('1.2.3.4')
  expect(limiter.check('1.2.3.4').fails).toBe(2)
  // Advance past the window.
  t = 1500
  expect(limiter.check('1.2.3.4').fails).toBe(0)
})

test('lockout ends after duration', () => {
  let t = 0
  const limiter = createRateLimiter({
    now: () => t,
    maxFails: 2,
    lockoutMs: 1000,
    failWindowMs: 60_000,
  })
  limiter.fail('1.2.3.4')
  const second = limiter.fail('1.2.3.4')
  expect(second.locked).toBe(true)
  // Advance past lockout.
  t = 1500
  const check = limiter.check('1.2.3.4')
  expect(check.locked).toBe(false)
})

test('per-IP isolation — 1.2.3.4 lockout does not affect 5.6.7.8', () => {
  const limiter = createRateLimiter({ now: () => 0, maxFails: 2 })
  limiter.fail('1.2.3.4')
  limiter.fail('1.2.3.4')
  expect(limiter.check('1.2.3.4').locked).toBe(true)
  expect(limiter.check('5.6.7.8').locked).toBe(false)
})

test('reset() clears everything', () => {
  const limiter = createRateLimiter({ now: () => 0 })
  limiter.fail('1.2.3.4')
  limiter.fail('5.6.7.8')
  expect(limiter._entries().size).toBe(2)
  limiter.reset()
  expect(limiter._entries().size).toBe(0)
})

// ---------- Persistence / restart scenarios (HF4) ----------

test('persistence: mutations trigger store.save()', () => {
  const store = createFakeStore()
  const limiter = createRateLimiter({ now: () => 0, store })
  limiter.fail('1.2.3.4')
  limiter.fail('1.2.3.4')
  limiter.success('5.6.7.8') // no-op, no save
  expect(store.saveCount()).toBeGreaterThanOrEqual(2)
  const snap = store.snapshot()
  expect(snap.get('1.2.3.4')?.fails).toBe(2)
})

test('persistence: createRateLimiterAsync seeds from store.load()', async () => {
  const initial = new Map<string, RateLimitEntry>([
    ['9.9.9.9', { fails: 4, firstFailAt: 0, lockedUntil: 0 }],
  ])
  const store = createFakeStore(initial)
  const limiter = await createRateLimiterAsync({ now: () => 100, store })
  // One more fail → locks out at maxFails=5.
  const r = limiter.fail('9.9.9.9')
  expect(r.locked).toBe(true)
})

test('restart scenario: limiter1 locks, dispose → limiter2 still locked', async () => {
  const store = createFakeStore()
  let t = 0
  const lockoutMs = 15 * 60 * 1000
  const limiter1 = await createRateLimiterAsync({
    now: () => t,
    store,
    maxFails: 5,
    lockoutMs,
    failWindowMs: 5 * 60 * 1000,
  })
  for (let i = 0; i < 5; i += 1) limiter1.fail('attacker')
  expect(limiter1.check('attacker').locked).toBe(true)
  await limiter1.dispose()

  // "Restart" — time hasn't advanced; build a new limiter pointed at the
  // same store.
  const limiter2 = await createRateLimiterAsync({
    now: () => t,
    store,
    maxFails: 5,
    lockoutMs,
    failWindowMs: 5 * 60 * 1000,
  })
  const state = limiter2.check('attacker')
  expect(state.locked).toBe(true)
  expect(state.retryAfterMs).toBeGreaterThan(0)
})

test('restart with expired lockout: new limiter reports unlocked', async () => {
  const store = createFakeStore()
  let t = 0
  const lockoutMs = 1000
  const limiter1 = await createRateLimiterAsync({
    now: () => t,
    store,
    maxFails: 2,
    lockoutMs,
    failWindowMs: 60_000,
  })
  limiter1.fail('x')
  limiter1.fail('x') // triggers lockout
  expect(limiter1.check('x').locked).toBe(true)
  await limiter1.dispose()

  // Advance clock past the lockout.
  t = 5000
  const limiter2 = await createRateLimiterAsync({
    now: () => t,
    store,
    maxFails: 2,
    lockoutMs,
    failWindowMs: 60_000,
  })
  expect(limiter2.check('x').locked).toBe(false)
})

test('dispose() is safe without a store', async () => {
  const limiter = createRateLimiter({ now: () => 0 })
  await limiter.dispose() // should not throw
})
