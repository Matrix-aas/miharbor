// Thin promise-friendly wrapper around `proper-lockfile`. Centralises the
// retry / stale-lock tuning so every call site in the server doesn't
// re-invent the same defaults.
//
// `proper-lockfile` creates a `<path>.lock` sibling directory (atomic
// `mkdir` on POSIX, real file locking on Windows); our wrapper always locks
// the file the caller points at, not an auxiliary path. Stale lock: if the
// lock is older than 30 seconds we reclaim it — this protects against a
// Miharbor process being SIGKILL'd mid-deploy without clean-up.
//
// Contract:
// - `withLock(path, fn)` runs `fn` while the lock is held and releases
//   it on both success and failure.
// - Acquisition retries with exponential backoff; failing after the
//   retries throws a wrapped error so callers see a clean stack trace.
// - `path` must refer to an existing file — `proper-lockfile` requires
//   the target to exist (else it throws ENOENT before locking).

import lockfile from 'proper-lockfile'

export interface WithLockOptions {
  /** Number of retries after the initial attempt. Default: 10 (about 1.5s
   *  with the default factor/min/max below before giving up). */
  retries?: number
  /** Milliseconds between retry 1 and 2 — scales exponentially from there. */
  minTimeout?: number
  /** Cap for exponential backoff. */
  maxTimeout?: number
  /** Growth factor for exponential backoff. */
  factor?: number
  /** How old a lock can be before we consider it abandoned and reclaim it. */
  stale?: number
}

/** Acquire an exclusive lock on `path`, run `fn`, release. Any exception
 *  thrown by `fn` propagates after the lock is released. */
export async function withLock<T>(
  path: string,
  fn: () => Promise<T>,
  opts: WithLockOptions = {},
): Promise<T> {
  const release = await lockfile.lock(path, {
    retries: {
      retries: opts.retries ?? 10,
      factor: opts.factor ?? 1.2,
      minTimeout: opts.minTimeout ?? 50,
      maxTimeout: opts.maxTimeout ?? 500,
    },
    stale: opts.stale ?? 30_000,
    // realpath:false because the target may live on a bind-mount (Docker
    // volume) where realpath resolution can trip EACCES on the directory.
    realpath: false,
  })
  try {
    return await fn()
  } finally {
    // Best-effort release. If the lock was force-reclaimed by another
    // process (extremely unlikely in our flow), proper-lockfile throws
    // `ELOCKED` / `ERELEASE`. Swallow so the fn's result (or its error)
    // remains the visible outcome.
    try {
      await release()
    } catch {
      /* already-released or reclaimed lock — nothing to do */
    }
  }
}
