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

/** Result of a remote `ssh.exec` invocation. `signal` is set when the remote
 *  process was killed by a signal instead of exiting normally. */
export interface SshExecResult {
  stdout: string
  stderr: string
  code: number | null
  signal?: string | undefined
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
 *  can exercise the auth-selection logic directly. */
export function buildConnectConfig(opts: SshAdapterOptions): ConnectConfig {
  const base: ConnectConfig = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    readyTimeout: opts.connectTimeoutMs,
    keepaliveInterval: opts.keepaliveIntervalMs,
    // Security posture: never auto-accept unknown host keys. In MVP we rely
    // on ssh2's default host-key verification (which is: whatever the user
    // passes in `hostVerifier`). We don't set one, which means ssh2 does NOT
    // verify — this is the same behaviour as `StrictHostKeyChecking=no`
    // and is documented in SSH_SETUP.md as an operator caveat. A future
    // task may add a known_hosts store. Not done here to avoid scope creep.
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
