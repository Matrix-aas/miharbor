// SSH lock — remote equivalent of proper-lockfile for the SshTransport.
//
// We try two strategies in order:
//   1. `flock(1)` — non-blocking (`-n`) exclusive lock on the sidecar
//      lock file. Acquires by spawning `flock -xn <path> sleep infinity &`
//      in the background and capturing the resulting PID. Release = `kill`
//      that PID. This is the robust path: the lock is tied to a real
//      process, so if the remote shell dies (e.g. SSH connection drops)
//      the lock is released by the kernel.
//
//   2. `mkdir` — advisory fallback when `flock(1)` is absent (rare but
//      possible on stripped containers). `mkdir` is atomic on POSIX; the
//      creator "owns" the lock dir, release = `rmdir`. Downside: if the
//      process holding the lock dies unexpectedly, the dir stays and the
//      next acquire needs a manual stale-break. We mitigate by writing
//      a timestamp file inside and refusing acquisition only if the
//      timestamp is fresh (<30s); older locks are stolen.
//
// Contract: `withSshLock(adapter, path, fn)` runs `fn` under the lock and
// releases it on both success and failure. If acquisition fails after
// retries, throws a clean error so the deploy pipeline can surface it.

import type { SshAdapter } from '../transport/ssh-adapter.ts'

const STALE_MKDIR_MS = 30_000

export interface SshLockOptions {
  /** Retries beyond the first attempt. Default 10, same as proper-lockfile. */
  retries?: number
  /** ms between retries (linear — lock is local-ish so we don't need backoff). */
  retryIntervalMs?: number
  /** Staleness threshold for the mkdir-fallback. */
  staleMs?: number
}

/** Shell-escape a single argument for `sh -c`. We only need this for the
 *  lock path; paths under `/etc/mihomo/` don't contain shell metacharacters
 *  in practice, but we don't assume. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Try to acquire the lock with `flock`. Returns the PID of the sleeper
 *  (which holds the lock), or `null` if flock is unavailable. Throws if
 *  flock is present but the lock is already held. */
async function tryFlockAcquire(
  adapter: SshAdapter,
  lockPath: string,
): Promise<{ pid: number } | null> {
  // Detect flock availability first. `command -v flock` is POSIX and
  // prints the path (exit 0) or nothing (exit 1).
  const probe = await adapter.exec('command -v flock')
  if (probe.code !== 0) return null

  // Acquire: run `flock -xn <path> sleep infinity &` and echo the PID of
  // the sleep process (which holds the open FD => the lock). We wrap in
  // `sh -c` with `setsid` to detach from the controlling TTY so ssh's
  // stream close doesn't SIGHUP the sleeper.
  const cmd = [
    `sh -c`,
    shQuote(
      `touch ${shQuote(lockPath)} && ` +
        `setsid sh -c ${shQuote(`flock -xn 9 || exit 1; echo $$; exec sleep infinity`)} 9> ${shQuote(lockPath)} < /dev/null > /tmp/.miharbor-flock.pid 2>&1 & ` +
        // Give the subshell a beat to print its PID.
        `for i in 1 2 3 4 5; do ` +
        `  if [ -s /tmp/.miharbor-flock.pid ]; then cat /tmp/.miharbor-flock.pid; exit 0; fi; ` +
        `  sleep 0.05; ` +
        `done; ` +
        `echo LOCK_FAILED; exit 1`,
    ),
  ].join(' ')
  const res = await adapter.exec(cmd)
  if (res.code !== 0) {
    throw new Error(`ssh-lock: flock acquire failed: ${res.stderr || res.stdout}`)
  }
  const out = res.stdout.trim()
  if (out === 'LOCK_FAILED' || !/^\d+$/.test(out.split('\n').pop() ?? '')) {
    throw new Error(`ssh-lock: flock busy or unexpected output: ${out}`)
  }
  const pidStr = out.split('\n').pop() ?? ''
  return { pid: parseInt(pidStr, 10) }
}

async function tryFlockRelease(adapter: SshAdapter, pid: number): Promise<void> {
  // Best-effort; if the pid is gone the kill returns 1 and we don't care.
  await adapter.exec(`kill ${pid} 2>/dev/null; :`)
}

/** Try to acquire via `mkdir`. Returns `true` on success, `false` on
 *  fresh-lock-held. Older-than-stale locks are stolen (rmdir + retry).
 *  Intentionally written with POSIX `test -n` / `stat -c` with a macOS
 *  `stat -f %Sm -t %s` fallback so it survives both target OSes — though
 *  Miharbor's remote target is always Linux in practice. */
async function tryMkdirAcquire(
  adapter: SshAdapter,
  lockPath: string,
  staleMs: number,
): Promise<boolean> {
  const q = shQuote(lockPath)
  const inner = shQuote(
    // POSIX: check whether the directory exists and its mtime is older
    // than NOW-stale. If so, rmdir it (best-effort). Then mkdir.
    `if [ -d ${q} ]; then ` +
      // GNU stat first; BSD stat second.
      `  MT=$(stat -c %Y ${q} 2>/dev/null || stat -f %m ${q} 2>/dev/null || echo 0); ` +
      `  NOW=$(date +%s); ` +
      `  AGE=$((NOW - MT)); ` +
      `  if [ "$AGE" -gt ${Math.ceil(staleMs / 1000)} ]; then ` +
      `    rmdir ${q} 2>/dev/null || :; ` +
      `  fi; ` +
      `fi; ` +
      `mkdir ${q} 2>/dev/null`,
  )
  const res = await adapter.exec(`sh -c ${inner}`)
  return res.code === 0
}

async function tryMkdirRelease(adapter: SshAdapter, lockPath: string): Promise<void> {
  await adapter.exec(`rmdir ${shQuote(lockPath)} 2>/dev/null; :`)
}

/** Run `fn` while holding a remote lock on `lockPath`. Releases the lock
 *  on both success and failure. Throws if the lock cannot be acquired
 *  within the retry budget. */
export async function withSshLock<T>(
  adapter: SshAdapter,
  lockPath: string,
  fn: () => Promise<T>,
  opts: SshLockOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 10
  const interval = opts.retryIntervalMs ?? 100
  const stale = opts.staleMs ?? STALE_MKDIR_MS

  let flockPid: number | null = null
  let usingMkdir = false
  let acquired = false

  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Strategy 1: flock
    try {
      const fres = await tryFlockAcquire(adapter, lockPath)
      if (fres !== null) {
        flockPid = fres.pid
        acquired = true
        break
      }
      // flock is unavailable — switch to mkdir and stay there
      const mres = await tryMkdirAcquire(adapter, lockPath, stale)
      if (mres) {
        usingMkdir = true
        acquired = true
        break
      }
      lastErr = new Error('ssh-lock: mkdir lock held by another process')
    } catch (e) {
      lastErr = e as Error
    }
    if (attempt < retries) {
      await new Promise<void>((r) => setTimeout(r, interval))
    }
  }
  if (!acquired) {
    throw new Error(
      `ssh-lock: failed to acquire ${lockPath} after ${retries + 1} attempts: ${lastErr?.message ?? 'unknown'}`,
    )
  }

  try {
    return await fn()
  } finally {
    try {
      if (flockPid !== null) await tryFlockRelease(adapter, flockPid)
      else if (usingMkdir) await tryMkdirRelease(adapter, lockPath)
    } catch {
      // Best-effort — leaking the lock is bad but not as bad as throwing
      // over the real operation result.
    }
  }
}
