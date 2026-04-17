// In-memory token-bucket-ish rate limiter for auth brute-force protection.
//
// Policy: 5 failed auth attempts within 5 minutes from the same IP locks
// that IP out for 15 minutes. Successful auth resets the counter. All
// state is per-IP in a Map; on restart everything resets (acceptable for
// single-node MVP — Stage 2 could swap to Redis if multiple Miharbor
// replicas ever share an LB).
//
// The limiter is invoked from the Basic Auth middleware around every
// auth decision. Successful requests hit `.success(ip)`; 401 responses
// hit `.fail(ip)`. Before each check, `.check(ip)` returns a lock state
// that the middleware translates into a 429 response.

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
  const entries = new Map<string, RateLimitEntry>()

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
        return { locked: false }
      }
      entry.fails += 1
      if (entry.fails >= maxFails) {
        entry.lockedUntil = t + lockoutMs
        return { locked: true, retryAfterMs: lockoutMs }
      }
      return { locked: false }
    },
    success(ip: string): void {
      entries.delete(ip)
    },
    reset(): void {
      entries.clear()
    },
    _entries(): Map<string, RateLimitEntry> {
      return entries
    },
  }
}
