// Rate-limiter tests. Uses an injected clock so the 5-minute fail window
// and 15-minute lockout don't hold up the suite.

import { expect, test } from 'bun:test'
import { createRateLimiter } from '../../src/auth/rate-limit.ts'

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
