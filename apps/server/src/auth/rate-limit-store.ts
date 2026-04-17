// Disk-backed persistence for the Basic-Auth rate limiter.
//
// Why: without persistence, an attacker who trips the 5-fail / 15-minute
// lockout can simply `docker restart` Miharbor to wipe the counter and try
// again. The FileStore writes the limiter's Map to a JSON file on disk with
// an atomic tmp+rename pattern + internal debounce so the hot `fail()` path
// doesn't block on IO.
//
// Wire-up: `auth/index.ts` constructs a FileStore at
// `$MIHARBOR_DATA_DIR/rate-limit.state.json` and passes it to
// `createRateLimiter`. When the env var is unset (test harnesses, some
// non-local transports), a NullStore is used and behaviour is identical to
// the pre-HF4 pure-in-memory limiter.
//
// Concurrency: single-writer. Only one Miharbor process is assumed per data
// directory; if we ever support multi-replica HA, swap the FileStore for a
// Redis-backed implementation — the `RateLimitStore` interface is the
// abstraction boundary for that.
//
// On-disk format (v1):
//   {
//     "version": 1,
//     "savedAt": <ms-epoch>,
//     "entries": { "<ip>": { "fails": N, "firstFailAt": ms, "lockedUntil": ms }, ... }
//   }
// The `version` field lets future refactors migrate the schema without
// crashing on old files. Corrupt / malformed files are logged and replaced
// with an empty Map — NEVER crash the server on a bad state file, because
// auth is on the critical path.

import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Logger } from '../observability/logger.ts'
import type { RateLimitEntry } from './rate-limit.ts'

const FILE_VERSION = 1

export interface RateLimitStore {
  /** Load persisted entries. Returns empty Map if file missing or corrupt. */
  load(): Promise<Map<string, RateLimitEntry>>
  /** Queue a save. Debounced internally — multiple rapid calls collapse into
   *  one write. The implementation MUST NOT block the caller on IO. */
  save(entries: Map<string, RateLimitEntry>): void
  /** Flush any pending save and release resources. Call on SIGTERM/shutdown. */
  dispose(): Promise<void>
}

export interface FileStoreOptions {
  /** Absolute path of the state file. */
  path: string
  /** Debounce window in ms before a queued save actually hits disk.
   *  Default 1000. Short enough that a crash loses < 1s of activity;
   *  long enough that a burst of 5 fails in a few ms coalesces to 1 write. */
  debounceMs?: number
  /** Injected clock for tests. Defaults to `Date.now()`. */
  now?: () => number
  /** Optional logger. Falls back to console.warn for corrupt-file warnings. */
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  /** Load-time prune policy. When provided, entries that can no longer
   *  produce a lockout (lockedUntil in the past AND firstFailAt older than
   *  failWindowMs) are dropped on load. Keeps the state file from growing
   *  unbounded across weeks of low-volume attack traffic. */
  pruneBefore?: { failWindowMs: number; lockoutMs: number }
}

/** On-disk shape — kept as a local type so `load()` can validate
 *  incoming JSON structurally before trusting it. */
interface PersistedFile {
  version: number
  savedAt: number
  entries: Record<string, RateLimitEntry>
}

/** Atomic write: write tmp sibling, fsync, rename onto target. `rename(2)`
 *  is atomic within a single filesystem so readers never see a partial file.
 *  Ensures parent directory exists (mkdir recursive 0700) before writing.
 *  Mirrors the helper in `transport/local-fs.ts` (kept local so this module
 *  has no cross-subsystem coupling). */
async function atomicWriteJson(targetPath: string, data: unknown, mode = 0o600): Promise<void> {
  const dir = dirname(targetPath)
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.${crypto.randomUUID()}.miharbor.rl.tmp`)
  const payload = JSON.stringify(data)
  const fh = await fsp.open(tmp, 'w', mode)
  try {
    await fh.writeFile(payload, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await fsp.rename(tmp, targetPath)
  } catch (e) {
    // Rename failed — clean up the tmp so we don't pollute the data dir,
    // then rethrow so the caller (FileStore#flush) can log.
    try {
      await fsp.unlink(tmp)
    } catch {
      /* ignore secondary error */
    }
    throw e
  }
  try {
    await fsp.chmod(targetPath, mode)
  } catch {
    /* non-fatal: some volume drivers refuse chmod */
  }
}

export function createFileStore(opts: FileStoreOptions): RateLimitStore {
  const path = opts.path
  const debounceMs = opts.debounceMs ?? 1000
  const now = opts.now ?? ((): number => Date.now())
  const logger = opts.logger
  const warn = (payload: Record<string, unknown>): void => {
    if (logger) logger.warn(payload)
    else console.warn(JSON.stringify({ level: 'warn', ...payload }))
  }

  let pending: Map<string, RateLimitEntry> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  async function flush(): Promise<void> {
    if (!pending) return
    const snapshot = pending
    pending = null
    const payload: PersistedFile = {
      version: FILE_VERSION,
      savedAt: now(),
      entries: Object.fromEntries(snapshot),
    }
    try {
      await atomicWriteJson(path, payload)
    } catch (e) {
      warn({
        msg: 'rate-limit state save failed',
        path,
        error: (e as Error).message,
      })
    }
  }

  function scheduleFlush(): void {
    if (timer) return // already scheduled — coalesce
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, debounceMs)
    // Never keep the event loop alive just for a pending rate-limit save.
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      ;(timer as unknown as { unref: () => void }).unref()
    }
  }

  function shouldPrune(entry: RateLimitEntry): boolean {
    if (!opts.pruneBefore) return false
    const t = now()
    const lockoutDone = entry.lockedUntil <= t // 0 (never locked) or past
    const windowExpired = t - entry.firstFailAt > opts.pruneBefore.failWindowMs
    return lockoutDone && windowExpired
  }

  function coerceEntry(v: unknown): RateLimitEntry | null {
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    if (
      typeof o.fails !== 'number' ||
      typeof o.firstFailAt !== 'number' ||
      typeof o.lockedUntil !== 'number'
    ) {
      return null
    }
    return { fails: o.fails, firstFailAt: o.firstFailAt, lockedUntil: o.lockedUntil }
  }

  return {
    async load(): Promise<Map<string, RateLimitEntry>> {
      const out = new Map<string, RateLimitEntry>()
      let raw: string
      try {
        raw = await fsp.readFile(path, 'utf8')
      } catch (e) {
        // ENOENT is the normal "fresh start" path — silent. Any other
        // error is worth a warning (permissions, disk full on read path,
        // etc.) but still resolves to an empty Map.
        const err = e as NodeJS.ErrnoException
        if (err.code !== 'ENOENT') {
          warn({
            msg: 'rate-limit state read failed',
            path,
            error: err.message,
          })
        }
        return out
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (e) {
        warn({
          msg: 'rate-limit state file is corrupt — starting with empty state',
          path,
          error: (e as Error).message,
        })
        return out
      }
      if (!parsed || typeof parsed !== 'object') {
        warn({ msg: 'rate-limit state file is corrupt (not an object)', path })
        return out
      }
      const p = parsed as Partial<PersistedFile>
      if (typeof p.version !== 'number' || p.version !== FILE_VERSION) {
        warn({
          msg: 'rate-limit state file has unknown version — starting with empty state',
          path,
          got: p.version,
          expected: FILE_VERSION,
        })
        return out
      }
      if (!p.entries || typeof p.entries !== 'object' || Array.isArray(p.entries)) {
        warn({
          msg: 'rate-limit state file is corrupt (entries missing or not an object)',
          path,
        })
        return out
      }
      for (const [ip, rawEntry] of Object.entries(p.entries)) {
        const entry = coerceEntry(rawEntry)
        if (!entry) continue
        if (shouldPrune(entry)) continue
        out.set(ip, entry)
      }
      return out
    },

    save(entries: Map<string, RateLimitEntry>): void {
      if (disposed) return
      // Snapshot the caller's map by copying — they might mutate it under us.
      pending = new Map(entries)
      scheduleFlush()
    },

    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await flush()
    },
  }
}

export function createNullStore(): RateLimitStore {
  return {
    async load(): Promise<Map<string, RateLimitEntry>> {
      return new Map()
    },
    save(): void {
      /* no-op */
    },
    async dispose(): Promise<void> {
      /* no-op */
    },
  }
}
