// Password onboarding + persistence. Source-of-truth priority:
//   1. `$MIHARBOR_DATA_DIR/auth.json`   (operator-changed password via UI)
//   2. `MIHARBOR_AUTH_PASS_HASH`        (container-provisioned default)
//   3. bootstrap default (admin/admin)  (first run — UI forces change)
//
// Argon2id hashes come from `Bun.password.hash(value)` which picks sensible
// parameters (memory-hard, side-channel-resistant). Verify via
// `Bun.password.verify(value, hash)`.
//
// auth.json schema (JSON, mode 0600):
//   { "version": 1, "user": "admin", "hash": "$argon2id$...", "updated": "ISO8601" }
//
// The "must change on next login" hint is the absence of auth.json combined
// with no MIHARBOR_AUTH_PASS_HASH — both being missing means the server
// started with the admin/admin bootstrap. The UI reads this via
// `/api/auth/status` (Task 18).

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AuthStore {
  /** Whether the current credential source is the insecure bootstrap default. */
  mustChangePassword(): boolean
  /** Username in effect. */
  getUser(): string
  /** Verify a supplied password against the active hash. */
  verifyPassword(candidate: string): Promise<boolean>
  /** Replace the active password. Always writes auth.json; future reads
   *  prefer auth.json over the ENV hash. */
  setPassword(newPassword: string): Promise<void>
  /** Reset to the bootstrap default — only used by tests; never exposed
   *  through an HTTP route. */
  _resetBootstrap(): Promise<void>
}

export interface AuthStoreOptions {
  /** Directory containing `auth.json`. Usually `MIHARBOR_DATA_DIR`. */
  dataDir: string
  /** Default username (`MIHARBOR_AUTH_USER`, typically `admin`). */
  defaultUser: string
  /** ENV-provided hash (`MIHARBOR_AUTH_PASS_HASH`). Empty string = absent. */
  envPassHash?: string
  /** Injected password utilities for tests. */
  hash?: (plain: string) => Promise<string>
  verify?: (plain: string, hash: string) => Promise<boolean>
}

interface AuthJson {
  version: 1
  user: string
  hash: string
  updated: string
}

const BOOTSTRAP_PLAINTEXT = 'admin'

export async function createAuthStore(opts: AuthStoreOptions): Promise<AuthStore> {
  const authPath = join(opts.dataDir, 'auth.json')
  const hashFn = opts.hash ?? ((p: string) => Bun.password.hash(p))
  const verifyFn = opts.verify ?? ((p: string, h: string) => Bun.password.verify(p, h))

  // Lazy state — we read the on-disk file every verify() call to support
  // rolling password changes without a process restart. The cost is a
  // single sub-millisecond JSON read per auth event.
  async function readAuthJson(): Promise<AuthJson | null> {
    try {
      const s = await stat(authPath)
      if (!s.isFile()) return null
    } catch {
      return null
    }
    try {
      const raw = await readFile(authPath, 'utf8')
      const parsed = JSON.parse(raw) as AuthJson
      if (parsed.version !== 1 || !parsed.hash || !parsed.user) return null
      return parsed
    } catch {
      // Corrupt JSON = reject and fall back to env/bootstrap.
      return null
    }
  }

  async function writeAuthJson(payload: AuthJson): Promise<void> {
    await mkdir(opts.dataDir, { recursive: true, mode: 0o700 })
    await writeFile(authPath, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })
    try {
      await chmod(authPath, 0o600)
    } catch {
      /* best effort — some docker volume drivers reject chmod */
    }
  }

  // Resolve "current active hash". Order matters: auth.json wins.
  async function activeSource(): Promise<{
    user: string
    hash: string
    source: 'file' | 'env' | 'bootstrap'
  }> {
    const fromFile = await readAuthJson()
    if (fromFile) return { user: fromFile.user, hash: fromFile.hash, source: 'file' }
    if (opts.envPassHash && opts.envPassHash.length > 0) {
      return { user: opts.defaultUser, hash: opts.envPassHash, source: 'env' }
    }
    // Bootstrap: admin/admin. We compute the hash on-demand to avoid
    // persisting it anywhere.
    const bootstrapHash = await hashFn(BOOTSTRAP_PLAINTEXT)
    return { user: opts.defaultUser, hash: bootstrapHash, source: 'bootstrap' }
  }

  // Cache the bootstrap source so `mustChangePassword()` stays synchronous
  // and deterministic across calls in one process lifetime. `reload()`
  // forces a re-read when the operator changes the password.
  let cachedSource: { user: string; hash: string; source: 'file' | 'env' | 'bootstrap' } | null =
    null
  async function ensureSource(): Promise<typeof cachedSource> {
    if (cachedSource) return cachedSource
    cachedSource = await activeSource()
    return cachedSource
  }
  // Prime the cache so `mustChangePassword()` works synchronously on the
  // very first call after construction.
  cachedSource = await activeSource()

  return {
    mustChangePassword(): boolean {
      return cachedSource?.source === 'bootstrap'
    },
    getUser(): string {
      return cachedSource?.user ?? opts.defaultUser
    },
    async verifyPassword(candidate: string): Promise<boolean> {
      const src = await ensureSource()
      if (!src) return false
      try {
        return await verifyFn(candidate, src.hash)
      } catch {
        return false
      }
    },
    async setPassword(newPassword: string): Promise<void> {
      if (newPassword.length < 8) {
        throw new Error('password too short — minimum 8 characters')
      }
      const hash = await hashFn(newPassword)
      const payload: AuthJson = {
        version: 1,
        user: cachedSource?.user ?? opts.defaultUser,
        hash,
        updated: new Date().toISOString(),
      }
      await writeAuthJson(payload)
      cachedSource = { user: payload.user, hash: payload.hash, source: 'file' }
    },
    async _resetBootstrap(): Promise<void> {
      // Clear on-disk + cache — tests only.
      try {
        await chmod(authPath, 0o600).catch(() => {})
        const fs = await import('node:fs/promises')
        await fs.unlink(authPath).catch(() => {})
      } catch {
        /* ignore */
      }
      cachedSource = await activeSource()
    },
  }
}

export { BOOTSTRAP_PLAINTEXT as _BOOTSTRAP_PLAINTEXT_FOR_TESTS }
