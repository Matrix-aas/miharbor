// In-memory token-bucket-ish rate limiter for auth brute-force protection.
//
// Policy: 5 failed auth attempts within 5 minutes from the same IP locks
// that IP out for 15 minutes. Successful auth resets the counter.
//
// Persistence (HF4): when a `RateLimitStore` is injected, every state
// mutation (`fail` / `success` / `reset`) is queued to the store which
// debounces + atomically writes to disk. On restart, `createRateLimiterAsync`
// loads + prunes expired entries before handing control to the middleware.
// Without a store (or with a NullStore), behaviour is pure-in-memory like
// the pre-HF4 limiter.
//
// The limiter is invoked from the Basic Auth middleware around every
// auth decision. Successful requests hit `.success(ip)`; 401 responses
// hit `.fail(ip)`. Before each check, `.check(ip)` returns a lock state
// that the middleware translates into a 429 response.

import type { RateLimitStore } from './rate-limit-store.ts'

export interface RateLimitEntry {
  fails: number
  firstFailAt: number
  lockedUntil: number
}

export interface RateLimitOptions {
  /** Max fails in the window before triggering a lockout. Default 5. */
  maxFails?: number
  /** Fail-window duration in ms. Default 5 minutes. */
  failWindowMs?: number
  /** Lockout duration in ms. Default 15 minutes. */
  lockoutMs?: number
  /** Injected clock for tests. */
  now?: () => number
  /** Optional disk-backed persistence. If provided, the limiter schedules
   *  a debounced save on every state mutation. To seed entries from disk,
   *  either use `createRateLimiterAsync` (which awaits `store.load()`
   *  before construction) or pre-populate via `initialEntries`. */
  store?: RateLimitStore
  /** Pre-populated entries — typically the result of `store.load()`. Used
   *  by `createRateLimiterAsync`. Consumers of the sync `createRateLimiter`
   *  factory that already have entries in hand may pass them here. */
  initialEntries?: Map<string, RateLimitEntry>
}

export interface RateLimiter {
  /** Returns the current state for the IP (side-effect free). */
  check(ip: string): { locked: boolean; retryAfterMs?: number; fails: number }
  /** Record a failed auth attempt for the IP; returns whether it
   *  crossed the threshold. */
  fail(ip: string): { locked: boolean; retryAfterMs?: number }
  /** Reset the IP's counter on a successful auth. */
  success(ip: string): void
  /** Clear all state. */
  reset(): void
  /** Map accessor for tests / diagnostics. */
  _entries(): Map<string, RateLimitEntry>
  /** Flush pending saves + release the store. Safe to call without a store;
   *  no-op in that case. Call from the shutdown path. */
  dispose(): Promise<void>
}

const DEFAULTS = {
  maxFails: 5,
  failWindowMs: 5 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

export function createRateLimiter(opts: RateLimitOptions = {}): RateLimiter {
  const maxFails = opts.maxFails ?? DEFAULTS.maxFails
  const failWindowMs = opts.failWindowMs ?? DEFAULTS.failWindowMs
  const lockoutMs = opts.lockoutMs ?? DEFAULTS.lockoutMs
  const now = opts.now ?? (() => Date.now())
  const store = opts.store
  const entries = new Map<string, RateLimitEntry>()
  if (opts.initialEntries) {
    for (const [ip, entry] of opts.initialEntries) {
      entries.set(ip, { ...entry })
    }
  }

  // Debounced persistence hook. We call this from every mutation site.
  // The store itself owns the debounce window — we just hand off the
  // current snapshot each time.
  function persist(): void {
    if (!store) return
    store.save(entries)
  }

  function currentState(ip: string): { locked: boolean; retryAfterMs?: number; fails: number } {
    const entry = entries.get(ip)
    if (!entry) return { locked: false, fails: 0 }
    const t = now()
    if (entry.lockedUntil > t) {
      return { locked: true, retryAfterMs: entry.lockedUntil - t, fails: entry.fails }
    }
    // Expired lock — clear so `fail()` starts a fresh window.
    if (entry.lockedUntil > 0 && entry.lockedUntil <= t) {
      entries.delete(ip)
      return { locked: false, fails: 0 }
    }
    // Expired fail-window without lockout — also reset.
    if (t - entry.firstFailAt > failWindowMs) {
      entries.delete(ip)
      return { locked: false, fails: 0 }
    }
    return { locked: false, fails: entry.fails }
  }

  return {
    check(ip: string) {
      return currentState(ip)
    },
    fail(ip: string): { locked: boolean; retryAfterMs?: number } {
      const t = now()
      const entry = entries.get(ip)
      // Start a fresh window when there's no entry, the fail-window has
      // expired, or a previous lockout has already ended (lockedUntil>0 AND
      // already passed). Note: `lockedUntil === 0` means "never locked" and
      // must NOT reset — otherwise the fails counter never climbs past 1
      // because each fail clobbers the previous entry.
      const lockoutExpired = entry ? entry.lockedUntil > 0 && entry.lockedUntil <= t : false
      if (!entry || t - entry.firstFailAt > failWindowMs || lockoutExpired) {
        const fresh: RateLimitEntry = {
          fails: 1,
          firstFailAt: t,
          lockedUntil: 0,
        }
        entries.set(ip, fresh)
        persist()
        return { locked: false }
      }
      entry.fails += 1
      if (entry.fails >= maxFails) {
        entry.lockedUntil = t + lockoutMs
        persist()
        return { locked: true, retryAfterMs: lockoutMs }
      }
      persist()
      return { locked: false }
    },
    success(ip: string): void {
      const had = entries.delete(ip)
      if (had) persist()
    },
    reset(): void {
      entries.clear()
      persist()
    },
    _entries(): Map<string, RateLimitEntry> {
      return entries
    },
    async dispose(): Promise<void> {
      if (store) await store.dispose()
    },
  }
}

/** Async factory: loads persisted state from the store (pruning expired
 *  entries using the same failWindowMs/lockoutMs as the runtime config)
 *  before handing off to `createRateLimiter`. Preferred call site for
 *  production wiring; the sync `createRateLimiter` stays around for the
 *  30+ existing unit tests that don't care about persistence. */
export async function createRateLimiterAsync(opts: RateLimitOptions = {}): Promise<RateLimiter> {
  let initialEntries: Map<string, RateLimitEntry> | undefined
  if (opts.store) {
    initialEntries = await opts.store.load()
  }
  const merged: RateLimitOptions = { ...opts }
  if (initialEntries) merged.initialEntries = initialEntries
  return createRateLimiter(merged)
}
