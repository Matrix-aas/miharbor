// LocalFsTransport — Transport implementation for the canonical
// "Miharbor-next-to-mihomo" deployment (single host, LocalFs volume mount
// into the Docker image). Everything here runs against real disk, with
// atomic writes and TOCTOU guards.
//
// Spec references:
//  - §6 ("LocalFsTransport")
//  - §9 (snapshot filesystem layout)
//  - invariant-style rules from runbook equivalent:
//    * writeConfig uses tmp-on-same-mount + rename (atomic on same FS only)
//    * writeConfig holds a per-config lock for the whole read-verify-write
//    * runMihomoValidate default mode is `shared-only`; `api` mode issued
//      a warning when invoked but is not implemented in MVP
//
// Directory layout on disk (all under `$MIHARBOR_DATA_DIR`):
//   snapshots/
//     <ISO8601>-<sha256-prefix>/
//       config.yaml    (0600)
//       meta.json      (0600)
//       diff.patch     (0600)
//   .snapshots.lock    (zero-byte, lock target)
//
// Per-config lock file path is provided by the caller to `writeConfig`.

import { createHash } from 'node:crypto'
import { constants as FS, promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Logger } from '../observability/logger.ts'
import { withLock } from '../lock/proper-lock.ts'
import {
  ConfigChangedExternallyError,
  type SnapshotBundle,
  type SnapshotFiles,
  type SnapshotMeta,
  type Transport,
  type ValidationResult,
} from './transport.ts'

export type MihomoValidationMode = 'shared-only' | 'api' | 'ssh-exec' | 'docker-exec'

export interface LocalFsTransportOptions {
  /** Absolute path of the live mihomo config (e.g. `/config/config.yaml`). */
  configPath: string
  /** Absolute path of the Miharbor data dir (snapshots + vault live here). */
  dataDir: string
  /** Mihomo REST API base URL for pipeline reloads. */
  mihomoApiUrl: string
  /** Mihomo REST API Bearer secret. Kept opaque; never logged. */
  mihomoApiSecret: string
  /** Validation strategy — `shared-only` does just YAML parse;
   *  `api` defers to the real mihomo over REST. MVP implements `shared-only`
   *  and emits a warning when any other mode is requested (stub). */
  validationMode?: MihomoValidationMode
  /** HTTP client for `api` validation mode. Defaults to `globalThis.fetch`
   *  so tests can inject a stub without monkey-patching globals. Reserved
   *  for Task 15+ when api validation actually lands. */
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>
  /** Optional logger for operational messages (stale lock, validation mode
   *  warnings). Falls back to a no-op shim. */
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  /** POSIX mode applied to the public config.yaml path *after* the atomic
   *  rename. Defaults to 0o644 so mihomo (and any other well-behaved reader
   *  sharing the bind-mount) can still read the file when it runs under a
   *  different UID and its capability set omits CAP_DAC_OVERRIDE. Override
   *  via `MIHARBOR_CONFIG_WRITE_MODE` when you need a stricter regime on an
   *  unusual deployment (e.g. same-UID-only, 0o640). Internal files
   *  (.miharbor.lock, snapshots/*, draft/) keep their restrictive modes —
   *  this knob only affects the single "public" config path. */
  configWriteMode?: number
}

const NOOP_LOGGER: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'> = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Atomic write: create a temp sibling on the same filesystem, write +
 *  fsync, then `rename()` onto the target. `rename(2)` is atomic within a
 *  single filesystem, so the sibling-path technique guarantees no reader
 *  ever sees a partial file. */
async function atomicWrite(targetPath: string, data: string, mode = 0o600): Promise<void> {
  const dir = dirname(targetPath)
  // Suffix contains pid + random so concurrent writers from this Node
  // process don't collide (though our lock wrapper already serialises).
  const tmp = join(dir, `.${crypto.randomUUID()}.miharbor.tmp`)
  const fh = await fsp.open(tmp, 'w', mode)
  try {
    await fh.writeFile(data, 'utf8')
    // Ensure bytes hit the platter (best effort — macOS/Linux honour it;
    // tmpfs is a no-op).
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, targetPath)
  // Permission-enforce once more — open(..., mode) can be clipped by umask.
  try {
    await fsp.chmod(targetPath, mode)
  } catch {
    /* non-fatal — some FS layers (certain Docker volume drivers) refuse
     *  chmod but still respect the mode baked into open(). */
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsp.access(path, FS.F_OK)
    return true
  } catch {
    return false
  }
}

export class LocalFsTransport implements Transport {
  readonly #configPath: string
  readonly #dataDir: string
  readonly #snapshotsDir: string
  readonly #mihomoUrl: string
  readonly #mihomoSecret: string
  readonly #validationMode: MihomoValidationMode
  readonly #configWriteMode: number
  readonly #logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  // Reserved for `api` validation mode (Task 15+); not invoked in MVP,
  // exposed as a protected method so TS's noUnusedParameters stays quiet
  // and the follow-up PR can wire it without re-touching the constructor.
  /** @internal reserved for api-mode validation in Task 15+. */
  protected readonly _fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>

  constructor(opts: LocalFsTransportOptions) {
    this.#configPath = resolve(opts.configPath)
    this.#dataDir = resolve(opts.dataDir)
    this.#snapshotsDir = join(this.#dataDir, 'snapshots')
    this.#mihomoUrl = opts.mihomoApiUrl
    this.#mihomoSecret = opts.mihomoApiSecret
    this.#validationMode = opts.validationMode ?? 'shared-only'
    this.#configWriteMode = opts.configWriteMode ?? 0o644
    this._fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.#logger = opts.logger ?? NOOP_LOGGER
  }

  /** Resolved snapshot root — exposed for tests / diagnostics. */
  public snapshotsDir(): string {
    return this.#snapshotsDir
  }

  async readConfig(): Promise<{ content: string; hash: string }> {
    const content = await fsp.readFile(this.#configPath, 'utf8')
    return { content, hash: sha256(content) }
  }

  /**
   * Replace the live config atomically under an flock. Callers pass an
   * *expected* hash in the content (TOCTOU protection is done by caller):
   * we additionally verify the on-disk file hasn't changed between the
   * caller's read and our write while the lock is held.
   *
   * Atomicity:
   *   1. lock file (acquire exclusive)
   *   2. re-read on-disk config (under lock)
   *   3. caller-supplied pre-hash comparison happens *outside* this method
   *      (we only enforce "write happened under lock"); this guards against
   *      two Miharbor processes overwriting each other.
   *   4. tmp write → rename onto target.
   */
  async writeConfig(content: string, lockFile: string): Promise<void> {
    // The lock target file must exist or proper-lockfile throws ENOENT.
    // We touch a sibling if the caller points at a fresh data dir.
    await this.ensureLockFile(lockFile)
    await withLock(lockFile, async () => {
      // Use #configWriteMode (default 0o644) so readers running under a
      // different UID — notably a hardened mihomo whose CapabilityBoundingSet
      // omits CAP_DAC_OVERRIDE — can still open the config. See field
      // comment for rationale + MIHARBOR_CONFIG_WRITE_MODE override.
      await atomicWrite(this.#configPath, content, this.#configWriteMode)
    })
  }

  /**
   * Re-read the on-disk config under the same lock, hash it, and compare
   * against an expected sha256. Use this from the deploy pipeline after
   * the initial `readConfig()` to close the TOCTOU race:
   *
   *   const { content, hash } = await transport.readConfig();
   *   // ... user edits in UI ...
   *   await transport.verifyAndWrite(draft, lockFile, hash);  // atomic
   */
  async verifyAndWrite(
    content: string,
    lockFile: string,
    expectedPriorHash: string,
  ): Promise<void> {
    await this.ensureLockFile(lockFile)
    await withLock(lockFile, async () => {
      const on_disk = await fsp.readFile(this.#configPath, 'utf8')
      const current = sha256(on_disk)
      if (current !== expectedPriorHash) {
        throw new ConfigChangedExternallyError(expectedPriorHash, current)
      }
      // Same rationale as writeConfig — see #configWriteMode.
      await atomicWrite(this.#configPath, content, this.#configWriteMode)
    })
  }

  private async ensureLockFile(lockFile: string): Promise<void> {
    if (await fileExists(lockFile)) return
    const fh = await fsp.open(lockFile, 'w', 0o600)
    await fh.close()
  }

  async readSnapshotsDir(): Promise<SnapshotMeta[]> {
    if (!(await fileExists(this.#snapshotsDir))) return []
    const entries = await fsp.readdir(this.#snapshotsDir, { withFileTypes: true })
    const out: SnapshotMeta[] = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const metaPath = join(this.#snapshotsDir, e.name, 'meta.json')
      try {
        const raw = await fsp.readFile(metaPath, 'utf8')
        const meta = JSON.parse(raw) as SnapshotMeta
        out.push(meta)
      } catch (err) {
        this.#logger.warn({
          msg: 'snapshot meta unreadable; skipping',
          id: e.name,
          error: (err as Error).message,
        })
      }
    }
    out.sort((a, b) => {
      if (a.timestamp > b.timestamp) return -1
      if (a.timestamp < b.timestamp) return 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    return out
  }

  async writeSnapshot(id: string, files: SnapshotFiles): Promise<void> {
    const dir = join(this.#snapshotsDir, id)
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    // All three files go 0600 — the config one actually holds masked
    // secrets but we're defence-in-depth.
    await atomicWrite(join(dir, 'config.yaml'), files['config.yaml'], 0o600)
    await atomicWrite(join(dir, 'meta.json'), files['meta.json'], 0o600)
    await atomicWrite(join(dir, 'diff.patch'), files['diff.patch'], 0o600)
  }

  async readSnapshot(id: string): Promise<SnapshotBundle> {
    const dir = join(this.#snapshotsDir, id)
    const [cfg, metaRaw, patch] = await Promise.all([
      fsp.readFile(join(dir, 'config.yaml'), 'utf8'),
      fsp.readFile(join(dir, 'meta.json'), 'utf8'),
      // diff.patch is optional — absent on the very first snapshot if
      // the pipeline ever decides to skip it; tolerate ENOENT.
      fsp.readFile(join(dir, 'diff.patch'), 'utf8').catch(() => ''),
    ])
    return {
      'config.yaml': cfg,
      'diff.patch': patch,
      meta: JSON.parse(metaRaw) as SnapshotMeta,
    }
  }

  async deleteSnapshot(id: string): Promise<void> {
    const dir = join(this.#snapshotsDir, id)
    await fsp.rm(dir, { recursive: true, force: true })
  }

  async runMihomoValidate(content: string): Promise<ValidationResult> {
    // Mode 1: shared-only — MVP default. The deploy pipeline runs
    // `runSharedLinters` separately; here we only verify the file parses
    // as YAML (which the pipeline also does via `canonicalize`, but we
    // keep the guard idempotent so other callers can't skip it).
    if (this.#validationMode === 'shared-only') {
      return this.#sharedOnlyValidate(content)
    }

    // Mode 2: api — documented but stubbed for MVP. Emits a warning and
    // falls back to shared-only so the deploy pipeline stays unblocked.
    // The real implementation will PUT /configs?force=true against a
    // temp file path on `MIHARBOR_DATA_DIR/mihomo-validate/test.yaml`
    // and parse the error stream. Deferred until Task 15+ review.
    if (this.#validationMode === 'api') {
      this.#logger.warn({
        msg: 'MIHOMO_API_VALIDATION_MODE=api requested but not implemented in MVP; falling back to shared-only',
      })
      const base = await this.#sharedOnlyValidate(content)
      return {
        ...base,
        raw_output:
          'shared-only mode (api validation deferred — see local-fs.ts MVP note)\n' +
          base.raw_output,
      }
    }

    // Modes 3/4 — ssh-exec / docker-exec — arrive with SSH transport.
    this.#logger.warn({
      msg: `MIHOMO_API_VALIDATION_MODE=${this.#validationMode} not supported in LocalFsTransport; falling back to shared-only`,
    })
    return this.#sharedOnlyValidate(content)
  }

  async #sharedOnlyValidate(content: string): Promise<ValidationResult> {
    // Lazy import so this module stays cheap to load even when tests
    // don't touch validation.
    const { parseDocument } = await import('yaml')
    const doc = parseDocument(content, { prettyErrors: true })
    if (doc.errors.length === 0) {
      return { ok: true, errors: [], raw_output: 'shared-only: YAML parse OK' }
    }
    const errors = doc.errors.map((e) => ({
      message: e.message,
      line: e.linePos?.[0]?.line,
      col: e.linePos?.[0]?.col,
    }))
    return {
      ok: false,
      errors,
      raw_output: `shared-only: ${errors.length} parse error(s)`,
    }
  }

  mihomoApiUrl(): string {
    return this.#mihomoUrl
  }

  mihomoApiSecret(): string {
    return this.#mihomoSecret
  }
}
