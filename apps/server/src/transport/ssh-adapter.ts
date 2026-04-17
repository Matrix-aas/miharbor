// SshAdapter — a thin, Promise-based adapter around `ssh2.Client` and its
// SFTP sub-client. The transport layer (ssh.ts) only depends on this
// interface, never on `ssh2` directly, so tests can inject a FakeSshAdapter
// without wrestling with Bun's module mocking.
//
// Why a hand-rolled adapter and not `ssh2-promise`? Two reasons:
//   1. We need tight control over error shape and timeout behaviour for the
//      few operations we actually use — a general-purpose wrapper ships a
//      larger surface and its own bug budget.
//   2. The adapter is <150 lines. Re-rolling is cheaper than auditing a 3rd
//      party dep for `ssh2` version compatibility.
//
// Not in scope: pty/shell, port forwarding, signing, agent forwarding
// (we use agent auth, which is transparent to `ssh2.connect`, not the same
// as forwarding). If a future caller needs any of those, add dedicated
// methods — do not expose the raw `ssh2.Client`.
//
// Connection model: one persistent connection per transport instance.
// `connect()` is idempotent (returns immediately if already connected).
// `end()` tears it down; the transport calls this on graceful shutdown.
// Automatic reconnect is the caller's job (SshTransport reconnects lazily
// on the next operation if the underlying stream has emitted `close`).

import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { readFile } from 'node:fs/promises'
import { keyFingerprint, keyMatchesKnownHost, type KnownHostEntry } from './ssh-known-hosts.ts'

/** Result of a remote `ssh.exec` invocation. `signal` is set when the remote
 *  process was killed by a signal instead of exiting normally. */
export interface SshExecResult {
  stdout: string
  stderr: string
  code: number | null
  signal?: string | undefined
}

/** Host-key verification policy. Exactly one shape is active at any time.
 *
 * Why refuse-by-default rather than "warn and accept"? An operator who can
 * wire up SSH at all can also spend two minutes pointing Miharbor at
 * `~/.ssh/known_hosts`. The cost of surfacing the misconfiguration at
 * startup is ~0. The cost of a silent MITM against an un-pinned
 * SshTransport is every secret the mihomo config has ever held.
 */
export type HostKeyPolicy =
  | {
      kind: 'known-hosts'
      /** Parsed entries from `MIHARBOR_SSH_KNOWN_HOSTS`. */
      entries: KnownHostEntry[]
      /** Absolute path — only used to improve error messages. */
      sourcePath: string
    }
  | {
      kind: 'insecure'
      /** Always `true` — encodes the explicit operator opt-in. */
      accepted: true
    }

export interface SshAdapterOptions {
  host: string
  port: number
  username: string
  /** Private key bytes (overrides agent if set). Unencrypted OR encrypted
   *  (then `passphrase` is used). */
  privateKey?: Buffer
  passphrase?: string | undefined
  /** Path to SSH auth socket — usually `process.env.SSH_AUTH_SOCK`. When
   *  set and `privateKey` is absent, falls back to agent auth. */
  agentSocket?: string | undefined
  connectTimeoutMs: number
  /** Keepalive interval; 0 disables. */
  keepaliveIntervalMs: number
  /** Optional hook invoked whenever the underlying connection is lost
   *  (either peer disconnect or local error). Consumers use this to
   *  trigger lazy reconnect on the next operation. */
  onDisconnect?: (reason: string) => void
  /** REQUIRED: how the ssh2 host-key check is wired. `undefined` is
   *  rejected by `buildConnectConfig` — we never fall back to silent
   *  acceptance. See HostKeyPolicy docs. */
  hostKeyPolicy?: HostKeyPolicy
  /** Optional logger hook. Used only to surface host-key decisions. */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', payload: Record<string, unknown>) => void
}

export interface SshAdapter {
  /** Open the connection if not already open. Idempotent. */
  connect(): Promise<void>
  /** Close the connection. No-op if already closed. */
  end(): Promise<void>
  /** Returns `true` while a live connection is open. */
  isConnected(): boolean
  /** Execute a shell command, buffer stdout/stderr, return exit code. */
  exec(command: string): Promise<SshExecResult>
  /** Upload local bytes to a remote absolute path via SFTP. Overwrites. */
  sftpWriteFile(remotePath: string, data: Buffer, mode?: number): Promise<void>
  /** Read a remote file via SFTP into a Buffer. */
  sftpReadFile(remotePath: string): Promise<Buffer>
}

/** Build an ssh2 ConnectConfig from our adapter options. Separated so tests
 *  can exercise the auth-selection logic directly.
 *
 *  Host-key verification wiring:
 *    - `policy.kind === 'known-hosts'` → install a synchronous `hostVerifier`
 *      that compares the server's offered public key against the parsed
 *      entries. Mismatch returns `false`; ssh2 tears down the connection
 *      with `All configured authentication methods failed` / a KEX error
 *      — a clear signal to the operator to re-run `ssh-keyscan` and
 *      update the file.
 *    - `policy.kind === 'insecure'` → DO NOT install a verifier (ssh2's
 *      default behaviour is to accept anything). We emit a WARN once per
 *      connect to keep the operator aware.
 *    - `policy === undefined` → reject. Callers must pick one of the two
 *      shapes; see `createSshTransport` for the wiring from env vars.
 *
 *  Why a sync verifier: the known_hosts file is already loaded and parsed
 *  before connect time (cached per-path in the transport). Blocking on
 *  an ed25519 key comparison is a ~microsecond operation; there's no
 *  benefit to the async variant.
 */
export function buildConnectConfig(opts: SshAdapterOptions): ConnectConfig {
  const base: ConnectConfig = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    readyTimeout: opts.connectTimeoutMs,
    keepaliveInterval: opts.keepaliveIntervalMs,
  }

  // Host-key policy is MANDATORY. Without it we'd be silently equivalent
  // to `StrictHostKeyChecking=no` — the very thing this change closes.
  if (!opts.hostKeyPolicy) {
    throw new Error(
      'SshAdapter: host-key verification is not configured — set MIHARBOR_SSH_KNOWN_HOSTS to a known_hosts-format file (recommended) or MIHARBOR_SSH_HOST_KEY_INSECURE=true to explicitly accept any host key (NOT SAFE on hostile networks)',
    )
  }

  if (opts.hostKeyPolicy.kind === 'known-hosts') {
    const policy = opts.hostKeyPolicy
    const log = opts.log
    const host = opts.host
    const port = opts.port
    // Sync verifier — see docstring. `true` ⇒ accept, `false` ⇒ ssh2 closes.
    base.hostVerifier = (key: Buffer): boolean => {
      const match = keyMatchesKnownHost(policy.entries, host, port, key)
      if (!match) {
        const fp = keyFingerprint(key)
        // Safe to log: fingerprint is a public-key hash, not secret material.
        log?.('error', {
          msg: 'ssh-transport: host-key verification FAILED — offered key not in known_hosts',
          host,
          port,
          offered_fingerprint: fp,
          known_hosts_path: policy.sourcePath,
        })
      } else {
        log?.('debug', {
          msg: 'ssh-transport: host-key verified against known_hosts',
          host,
          port,
          fingerprint: keyFingerprint(key),
        })
      }
      return match
    }
  } else {
    // `insecure` — accept everything, but make noise about it.
    opts.log?.('warn', {
      msg: 'ssh-transport: host-key verification disabled via MIHARBOR_SSH_HOST_KEY_INSECURE — not safe on hostile networks',
      host: opts.host,
      port: opts.port,
    })
  }

  if (opts.privateKey) {
    base.privateKey = opts.privateKey
    if (opts.passphrase) {
      base.passphrase = opts.passphrase
    }
    return base
  }
  if (opts.agentSocket) {
    base.agent = opts.agentSocket
    return base
  }
  throw new Error(
    'SshAdapter: no authentication configured — set MIHARBOR_SSH_KEY_PATH or ensure SSH_AUTH_SOCK is available for agent auth',
  )
}

/** Load a private key from disk. Returned Buffer is fed to ssh2 as-is —
 *  ssh2 parses OpenSSH-format, PEM-PKCS1 and PEM-PKCS8 keys (encrypted or
 *  not). Throws a readable error wrapping the underlying FS error. */
export async function loadPrivateKey(path: string): Promise<Buffer> {
  try {
    return await readFile(path)
  } catch (e) {
    throw new Error(
      `SshAdapter: cannot read MIHARBOR_SSH_KEY_PATH=${path}: ${(e as Error).message}`,
    )
  }
}

/** Real-ssh2 implementation. Exported for `ssh.ts` only — tests should use
 *  a FakeSshAdapter instead. */
export class Ssh2Adapter implements SshAdapter {
  readonly #opts: SshAdapterOptions
  #client: Client | null = null
  #connecting: Promise<void> | null = null
  #alive = false

  constructor(opts: SshAdapterOptions) {
    this.#opts = opts
  }

  isConnected(): boolean {
    return this.#alive
  }

  async connect(): Promise<void> {
    if (this.#alive && this.#client) return
    if (this.#connecting) return this.#connecting
    const cfg = buildConnectConfig(this.#opts)
    const client = new Client()
    this.#client = client
    const disconnectHook = this.#opts.onDisconnect
    this.#connecting = new Promise<void>((resolve, reject) => {
      let settled = false
      const onReady = (): void => {
        if (settled) return
        settled = true
        this.#alive = true
        resolve()
      }
      const onError = (err: Error): void => {
        if (settled) return
        settled = true
        this.#alive = false
        this.#client = null
        reject(err)
      }
      client.once('ready', onReady)
      client.once('error', onError)
      client.once('close', () => {
        this.#alive = false
        this.#client = null
        if (disconnectHook) disconnectHook('close')
      })
      try {
        client.connect(cfg)
      } catch (e) {
        onError(e as Error)
      }
    })
    try {
      await this.#connecting
    } finally {
      this.#connecting = null
    }
  }

  async end(): Promise<void> {
    const c = this.#client
    if (!c) return
    this.#alive = false
    this.#client = null
    return new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      c.once('close', done)
      c.once('end', done)
      try {
        c.end()
      } catch {
        done()
      }
    })
  }

  async exec(command: string): Promise<SshExecResult> {
    await this.connect()
    const c = this.#client
    if (!c) throw new Error('SshAdapter.exec: not connected')
    return new Promise<SshExecResult>((resolve, reject) => {
      c.exec(command, (err, stream: ClientChannel) => {
        if (err) {
          reject(err)
          return
        }
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        stream.once('close', (code: number | null, signal: string | null | undefined) => {
          const res: SshExecResult = { stdout, stderr, code }
          if (signal !== null && signal !== undefined) res.signal = signal
          resolve(res)
        })
        stream.once('error', (e: Error) => reject(e))
      })
    })
  }

  async sftpWriteFile(remotePath: string, data: Buffer, mode = 0o600): Promise<void> {
    await this.connect()
    const c = this.#client
    if (!c) throw new Error('SshAdapter.sftpWriteFile: not connected')
    return new Promise<void>((resolve, reject) => {
      c.sftp((err, sftp) => {
        if (err) {
          reject(err)
          return
        }
        sftp.writeFile(remotePath, data, { mode }, (wErr) => {
          sftp.end()
          if (wErr) reject(wErr)
          else resolve()
        })
      })
    })
  }

  async sftpReadFile(remotePath: string): Promise<Buffer> {
    await this.connect()
    const c = this.#client
    if (!c) throw new Error('SshAdapter.sftpReadFile: not connected')
    return new Promise<Buffer>((resolve, reject) => {
      c.sftp((err, sftp) => {
        if (err) {
          reject(err)
          return
        }
        sftp.readFile(remotePath, (rErr, data) => {
          sftp.end()
          if (rErr) reject(rErr)
          else resolve(data)
        })
      })
    })
  }
}
