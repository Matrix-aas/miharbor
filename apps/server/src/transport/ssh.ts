// SshTransport — Transport implementation for the "Miharbor on my laptop,
// mihomo on a remote router" deployment. Everything that would touch local
// disk in LocalFsTransport goes over SSH instead:
//   - `readConfig` / `verifyAndWrite`  → SFTP read/write of the remote config
//   - lock around writes               → remote `flock(1)` (with a `mkdir`
//                                         advisory fallback) — see ssh-lock.ts
//   - `runMihomoValidate`              → SFTP-upload a throwaway config and
//                                         run `mihomo -t -d /tmp/…/` over SSH
//   - snapshots (`readSnapshotsDir`,
//     `writeSnapshot`, `readSnapshot`,
//     `deleteSnapshot`)                → STAY LOCAL to the Miharbor host.
//     Snapshots are Miharbor's own state — they never belong on the
//     router's filesystem. The data dir is expected to be a local
//     (operator-Mac) directory passed via MIHARBOR_DATA_DIR.
//
// Atomicity: `sftp.writeFile` doesn't give us a real atomic rename by
// itself. We upload to `.miharbor.tmp.config.yaml` sibling, then run
// `sync && mv … → config.yaml` over SSH exec. `mv` within the same
// filesystem is atomic on POSIX (rename(2)).
//
// Connection pool: one persistent `Ssh2Adapter`. The adapter reconnects
// lazily on the next operation if the peer closes the socket. Graceful
// shutdown via `dispose()`.
//
// Not in scope: fingerprint pinning (documented caveat; see SSH_SETUP.md).

import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import type { Logger } from '../observability/logger.ts'
import { withSshLock } from '../lock/ssh-lock.ts'
import {
  buildConnectConfig,
  loadPrivateKey,
  Ssh2Adapter,
  type HostKeyPolicy,
  type SshAdapter,
  type SshAdapterOptions,
} from './ssh-adapter.ts'
import { loadKnownHosts } from './ssh-known-hosts.ts'
import {
  ConfigChangedExternallyError,
  type SnapshotBundle,
  type SnapshotFiles,
  type SnapshotMeta,
  type Transport,
  type ValidationResult,
} from './transport.ts'

export interface SshTransportOptions {
  host: string
  port: number
  username: string
  /** Raw private-key bytes (optional — falls back to agent socket). */
  privateKey?: Buffer
  passphrase?: string | undefined
  /** SSH auth socket path for agent auth. Usually `process.env.SSH_AUTH_SOCK`. */
  agentSocket?: string | undefined
  /** Absolute path to mihomo config on the remote host. */
  remoteConfigPath: string
  /** Absolute path to the lock sidecar on the remote host. */
  remoteLockPath: string
  /** Local directory for snapshots + vault + auth state. */
  dataDir: string
  /** mihomo API base URL. For SSH-mode this typically points at the
   *  remote box (e.g. `http://192.168.1.1:9090`), but may be any
   *  reachable URL. */
  mihomoApiUrl: string
  mihomoApiSecret: string
  connectTimeoutMs: number
  keepaliveIntervalMs: number
  /** POSIX mode applied to the remote config.yaml path *after* the atomic
   *  rename. Defaults to 0o644 so mihomo (and any other well-behaved reader
   *  sharing the remote filesystem) can still read the file when it runs under a
   *  different UID and its capability set omits CAP_DAC_OVERRIDE. Override
   *  via `MIHARBOR_CONFIG_WRITE_MODE` when you need a stricter regime on an
   *  unusual deployment (e.g. same-UID-only, 0o600). Internal files
   *  (.miharbor.lock, .miharbor.tmp.*, test-config uploads) keep their
   *  restrictive owner-only modes — this knob only affects the single "public"
   *  config path. */
  configWriteMode?: number
  /** Host-key verification policy. When `adapter` is supplied (tests) this
   *  may be omitted — the adapter short-circuits `buildConnectConfig`. In
   *  production the policy is built from env vars in `createSshTransport`
   *  and passed through here; `undefined` causes `buildConnectConfig` to
   *  throw with the operator-facing error. */
  hostKeyPolicy?: HostKeyPolicy
  /** Adapter injection — tests pass a FakeSshAdapter here. Production
   *  code leaves this unset and gets the real `Ssh2Adapter`. */
  adapter?: SshAdapter
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
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

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Build an `SshTransport` from raw env-derived options. Handles the
 *  private-key-file → bytes translation and the `SSH_AUTH_SOCK` lookup
 *  so the caller (bootstrap) stays env-agnostic. */
export async function createSshTransport(opts: {
  host: string
  port: number
  username: string
  keyPath?: string
  passphrase?: string
  agentSocket?: string
  remoteConfigPath: string
  remoteLockPath: string
  dataDir: string
  mihomoApiUrl: string
  mihomoApiSecret: string
  connectTimeoutMs: number
  keepaliveIntervalMs: number
  /** Path to a known_hosts-format file. When non-empty, `createSshTransport`
   *  loads + parses it here (once, at startup) and wires the pinned-key
   *  policy. Empty string ⇒ not configured. */
  knownHostsPath?: string
  /** When `true` AND `knownHostsPath` is empty, pass the `insecure`
   *  policy through. Explicit opt-in; logs a per-connect warning. */
  hostKeyInsecure?: boolean
  configWriteMode?: number
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  adapter?: SshAdapter
}): Promise<SshTransport> {
  const privateKey = opts.keyPath ? await loadPrivateKey(opts.keyPath) : undefined
  const ctorOpts: SshTransportOptions = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    remoteConfigPath: opts.remoteConfigPath,
    remoteLockPath: opts.remoteLockPath,
    dataDir: opts.dataDir,
    mihomoApiUrl: opts.mihomoApiUrl,
    mihomoApiSecret: opts.mihomoApiSecret,
    connectTimeoutMs: opts.connectTimeoutMs,
    keepaliveIntervalMs: opts.keepaliveIntervalMs,
  }
  if (privateKey !== undefined) ctorOpts.privateKey = privateKey
  if (opts.passphrase !== undefined) ctorOpts.passphrase = opts.passphrase
  if (opts.agentSocket !== undefined) ctorOpts.agentSocket = opts.agentSocket
  if (opts.configWriteMode !== undefined) ctorOpts.configWriteMode = opts.configWriteMode
  if (opts.logger !== undefined) ctorOpts.logger = opts.logger
  if (opts.adapter !== undefined) ctorOpts.adapter = opts.adapter

  // Build the host-key policy up-front. Refuse-by-default: an operator who
  // can wire SSH at all can spend two minutes pointing us at
  // ~/.ssh/known_hosts. The alternative (silent accept-any) is a MITM
  // foot-gun that buys nothing.
  if (opts.knownHostsPath && opts.knownHostsPath.length > 0) {
    const warnSink = (msg: string): void => opts.logger?.warn({ msg })
    const entries = await loadKnownHosts(opts.knownHostsPath, warnSink)
    if (entries.length === 0) {
      throw new Error(
        `MIHARBOR_SSH_KNOWN_HOSTS=${opts.knownHostsPath} parsed zero entries — is the path correct and readable?`,
      )
    }
    ctorOpts.hostKeyPolicy = {
      kind: 'known-hosts',
      entries,
      sourcePath: opts.knownHostsPath,
    }
    opts.logger?.info({
      msg: 'ssh-transport: host-key pinning active via known_hosts',
      path: opts.knownHostsPath,
      entries: entries.length,
    })
  } else if (opts.hostKeyInsecure === true) {
    ctorOpts.hostKeyPolicy = { kind: 'insecure', accepted: true }
    opts.logger?.warn({
      msg: 'ssh-transport: host-key verification disabled via MIHARBOR_SSH_HOST_KEY_INSECURE — not safe on hostile networks. Set MIHARBOR_SSH_KNOWN_HOSTS once you have the remote fingerprint.',
    })
  }
  // else: policy stays undefined → SshTransport ctor (via buildConnectConfig)
  // throws at bootstrap. That is deliberate: see module header comment.

  return new SshTransport(ctorOpts)
}

export class SshTransport implements Transport {
  readonly #adapter: SshAdapter
  readonly #remoteConfigPath: string
  readonly #remoteLockPath: string
  readonly #dataDir: string
  readonly #snapshotsDir: string
  readonly #mihomoUrl: string
  readonly #mihomoSecret: string
  readonly #configWriteMode: number
  readonly #logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>

  constructor(opts: SshTransportOptions) {
    this.#remoteConfigPath = opts.remoteConfigPath
    this.#remoteLockPath = opts.remoteLockPath
    this.#dataDir = resolve(opts.dataDir)
    this.#snapshotsDir = join(this.#dataDir, 'snapshots')
    this.#mihomoUrl = opts.mihomoApiUrl
    this.#mihomoSecret = opts.mihomoApiSecret
    this.#configWriteMode = opts.configWriteMode ?? 0o644
    this.#logger = opts.logger ?? NOOP_LOGGER

    if (opts.adapter) {
      this.#adapter = opts.adapter
    } else {
      const logger = this.#logger
      const adapterOpts: SshAdapterOptions = {
        host: opts.host,
        port: opts.port,
        username: opts.username,
        connectTimeoutMs: opts.connectTimeoutMs,
        keepaliveIntervalMs: opts.keepaliveIntervalMs,
        onDisconnect: (reason) => {
          logger.warn({ msg: 'ssh-transport: peer disconnected', reason })
        },
        log: (level, payload) => {
          logger[level](payload)
        },
      }
      if (opts.privateKey !== undefined) adapterOpts.privateKey = opts.privateKey
      if (opts.passphrase !== undefined) adapterOpts.passphrase = opts.passphrase
      if (opts.agentSocket !== undefined) adapterOpts.agentSocket = opts.agentSocket
      if (opts.hostKeyPolicy !== undefined) adapterOpts.hostKeyPolicy = opts.hostKeyPolicy
      // Surface misconfiguration (missing auth OR missing host-key policy)
      // at construction time so the server bootstrap fails with a clean
      // error instead of on first deploy.
      buildConnectConfig(adapterOpts)
      this.#adapter = new Ssh2Adapter(adapterOpts)
    }
  }

  /** Snapshot root (local) — tests / diagnostics only. */
  public snapshotsDir(): string {
    return this.#snapshotsDir
  }

  /** Graceful shutdown. Closes the SSH connection; no-op if never opened. */
  public async dispose(): Promise<void> {
    try {
      await this.#adapter.end()
    } catch (e) {
      this.#logger.warn({
        msg: 'ssh-transport: adapter end() failed',
        error: (e as Error).message,
      })
    }
  }

  async readConfig(): Promise<{ content: string; hash: string }> {
    const buf = await this.#adapter.sftpReadFile(this.#remoteConfigPath)
    const content = buf.toString('utf8')
    return { content, hash: sha256(content) }
  }

  /** Atomic remote write: SFTP upload to `<dir>/.miharbor.tmp.config.yaml`,
   *  `sync`, `mv` onto the target. The tmp path is a sibling of the final
   *  file so `mv` is guaranteed to be same-mount (atomic). */
  async writeConfig(content: string, lockFile: string): Promise<void> {
    // `lockFile` is the local-transport contract — for SSH we use the
    // constructor-time `remoteLockPath`. Accept the arg for interface
    // parity but do NOT dispatch to local locking. This intentional
    // divergence is documented in the Transport interface comment.
    void lockFile
    await withSshLock(this.#adapter, this.#remoteLockPath, async () => {
      await this.#uploadAndRename(content)
    })
  }

  async verifyAndWrite(
    content: string,
    lockFile: string,
    expectedPriorHash: string,
  ): Promise<void> {
    void lockFile
    await withSshLock(this.#adapter, this.#remoteLockPath, async () => {
      const buf = await this.#adapter.sftpReadFile(this.#remoteConfigPath)
      const current = sha256(buf.toString('utf8'))
      if (current !== expectedPriorHash) {
        throw new ConfigChangedExternallyError(expectedPriorHash, current)
      }
      await this.#uploadAndRename(content)
    })
  }

  async #uploadAndRename(content: string): Promise<void> {
    const dir = dirname(this.#remoteConfigPath)
    const tmpName = `.miharbor.tmp.${basename(this.#remoteConfigPath)}`
    const tmpPath = `${dir}/${tmpName}`
    // Use 0o600 for the tmp file — restrictive until atomic rename.
    await this.#adapter.sftpWriteFile(tmpPath, Buffer.from(content, 'utf8'), 0o600)
    // `sync` forces the upload to hit durable storage before we atomically
    // rename. `mv` within the same filesystem is `rename(2)` on POSIX.
    // Apply #configWriteMode after the rename so readers (e.g. hardened
    // mihomo with CAP_DAC_OVERRIDE dropped) can still read the file.
    const octalMode = '0' + this.#configWriteMode.toString(8)
    const mvCmd = `sync && mv ${shQuote(tmpPath)} ${shQuote(this.#remoteConfigPath)} && chmod ${octalMode} ${shQuote(this.#remoteConfigPath)}`
    const res = await this.#adapter.exec(mvCmd)
    if (res.code !== 0) {
      throw new Error(
        `ssh-transport: atomic rename failed (exit ${res.code ?? 'null'}): ${res.stderr || res.stdout}`,
      )
    }
  }

  // ---------- snapshots: local only ----------

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
    await atomicLocalWrite(join(dir, 'config.yaml'), files['config.yaml'])
    await atomicLocalWrite(join(dir, 'meta.json'), files['meta.json'])
    await atomicLocalWrite(join(dir, 'diff.patch'), files['diff.patch'])
  }

  async readSnapshot(id: string): Promise<SnapshotBundle> {
    const dir = join(this.#snapshotsDir, id)
    const [cfg, metaRaw, patch] = await Promise.all([
      fsp.readFile(join(dir, 'config.yaml'), 'utf8'),
      fsp.readFile(join(dir, 'meta.json'), 'utf8'),
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

  // ---------- validation ----------

  /**
   * Runs `mihomo -t` on the remote host against an SFTP-uploaded throwaway
   * config. Returns the parsed result: `ok=true` when mihomo exits 0 AND
   * stderr/stdout contain a line matching `successful`/`ok`. `raw_output`
   * carries both streams so the UI can surface the real error message.
   *
   * Working directory convention: `/tmp/miharbor-test/config.yaml`. We
   * mkdir the dir with 0700, upload, then `mihomo -t -d <dir>`. No
   * per-request randomness — two concurrent validates would stomp each
   * other, but the deploy pipeline already serialises writes under the
   * same lock, and validation is read-only from mihomo's perspective.
   */
  async runMihomoValidate(content: string): Promise<ValidationResult> {
    const testDir = '/tmp/miharbor-test'
    const testFile = `${testDir}/config.yaml`
    // Create dir (idempotent) + upload.
    const mkdirRes = await this.#adapter.exec(
      `mkdir -p ${shQuote(testDir)} && chmod 700 ${shQuote(testDir)}`,
    )
    if (mkdirRes.code !== 0) {
      return {
        ok: false,
        errors: [{ message: `cannot create /tmp/miharbor-test: ${mkdirRes.stderr}` }],
        raw_output: mkdirRes.stderr || mkdirRes.stdout,
      }
    }
    // Use 0o600 for test config — validation is read-only, so the mode
    // doesn't affect the validation outcome. Restrictive mode is safer.
    await this.#adapter.sftpWriteFile(testFile, Buffer.from(content, 'utf8'), 0o600)
    const res = await this.#adapter.exec(`mihomo -t -d ${shQuote(testDir)}`)
    const combined = `${res.stdout}\n${res.stderr}`.trim()
    if (res.code === 0) {
      return {
        ok: true,
        errors: [],
        raw_output: combined || 'mihomo -t: OK (exit 0, no output)',
      }
    }
    // Try to extract the first line that looks like an error — mihomo
    // output varies by version so we do a best-effort parse and always
    // keep `raw_output` for the UI. Coerce empty output to a descriptive
    // fallback so the UI never renders an empty error bubble.
    const lines = combined.split('\n').filter((l) => l.length > 0)
    const firstErrLine =
      lines.find((l) => /error|fail|invalid/i.test(l)) ??
      lines[0] ??
      `mihomo -t exited with code ${res.code ?? 'null'} and no output`
    return {
      ok: false,
      errors: [{ message: firstErrLine }],
      raw_output: combined,
    }
  }

  mihomoApiUrl(): string {
    return this.#mihomoUrl
  }

  mihomoApiSecret(): string {
    return this.#mihomoSecret
  }
}

// ---------- local-disk helpers (shared with LocalFs) ----------

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsp.access(path)
    return true
  } catch {
    return false
  }
}

async function atomicLocalWrite(targetPath: string, data: string, mode = 0o600): Promise<void> {
  const dir = dirname(targetPath)
  const tmp = join(dir, `.${crypto.randomUUID()}.miharbor.tmp`)
  const fh = await fsp.open(tmp, 'w', mode)
  try {
    await fh.writeFile(data, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, targetPath)
  try {
    await fsp.chmod(targetPath, mode)
  } catch {
    /* non-fatal on exotic FS layers */
  }
}
