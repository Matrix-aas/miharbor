// Unit tests for SshTransport. `ssh2` is NEVER imported — we inject a
// FakeSshAdapter via the transport's adapter-injection ctor option. That
// keeps CI deterministic (no real sockets) and sidesteps Bun's module-mock
// sharp edges.
//
// The FakeSshAdapter models:
//   - exec() by looking up a command prefix in a list of handlers (first
//     match wins); unmatched commands throw so a test accidentally
//     depending on implicit behaviour surfaces fast.
//   - sftpWriteFile/sftpReadFile with an in-memory filesystem.
//   - connect()/end() counters so tests can assert connection lifecycle.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { SshTransport } from '../../src/transport/ssh.ts'
import {
  buildConnectConfig,
  type HostKeyPolicy,
  type SshAdapter,
  type SshExecResult,
} from '../../src/transport/ssh-adapter.ts'
import { parseKnownHosts } from '../../src/transport/ssh-known-hosts.ts'
import { ConfigChangedExternallyError } from '../../src/transport/transport.ts'

/** Sentinel policy used by tests that don't care about host-key behaviour
 *  (auth selection, connection lifecycle, etc.). Tests exercising the
 *  host-verifier path build their own policy. */
const INSECURE_POLICY: HostKeyPolicy = { kind: 'insecure', accepted: true }

// ---------- FakeSshAdapter ----------

type ExecHandler = (cmd: string) => Promise<SshExecResult> | SshExecResult

interface FakeOptions {
  /** Initial contents of the remote filesystem keyed by absolute path. */
  initialFs?: Record<string, string>
  /** Whether `flock` is available (default: true). */
  hasFlock?: boolean
  /** Whether the lock file is already held when the first
   *  flock-acquire runs (default: false). */
  flockBusy?: boolean
  /** Mihomo validate exit code (default: 0 = success). */
  mihomoExitCode?: number
  /** Mihomo validate stderr (default: ''). */
  mihomoStderr?: string
  /** Mihomo validate stdout (default: 'configuration file test is successful'). */
  mihomoStdout?: string
  /** Extra handlers, tried before the built-in ones. */
  extraHandlers?: Array<[RegExp, ExecHandler]>
}

class FakeSshAdapter implements SshAdapter {
  public fs: Record<string, string>
  public execLog: string[] = []
  public connectCount = 0
  public endCount = 0
  public writeFileModes: Map<string, number> = new Map()
  #alive = false
  readonly #opts: FakeOptions
  #flockPid = 10_000
  #flockHeld = false

  constructor(opts: FakeOptions = {}) {
    this.#opts = opts
    this.fs = { ...(opts.initialFs ?? {}) }
    this.#flockHeld = Boolean(opts.flockBusy)
  }

  async connect(): Promise<void> {
    if (this.#alive) return
    this.#alive = true
    this.connectCount++
  }
  async end(): Promise<void> {
    if (!this.#alive) return
    this.#alive = false
    this.endCount++
  }
  isConnected(): boolean {
    return this.#alive
  }

  async exec(command: string): Promise<SshExecResult> {
    await this.connect()
    this.execLog.push(command)

    // 0) extra (test-specific) handlers
    for (const [re, h] of this.#opts.extraHandlers ?? []) {
      if (re.test(command)) return h(command)
    }

    // 1) flock availability probe
    if (command === 'command -v flock') {
      return ok(
        this.#opts.hasFlock === false ? '' : '/usr/bin/flock',
        '',
        this.#opts.hasFlock === false ? 1 : 0,
      )
    }

    // 2) flock acquire (sh -c '…flock -xn 9 … echo $$ …')
    if (/setsid sh -c .*flock -xn 9/.test(command)) {
      if (this.#flockHeld) return ok('LOCK_FAILED', '', 1)
      this.#flockHeld = true
      const pid = ++this.#flockPid
      return ok(`${pid}\n`, '', 0)
    }

    // 3) flock release: `kill <pid> 2>/dev/null; :`
    const killMatch = /^kill (\d+) /.exec(command)
    if (killMatch) {
      this.#flockHeld = false
      return ok('', '', 0)
    }

    // 4) mkdir lock (fallback)
    if (/mkdir .+ 2>\/dev\/null/.test(command) && /if \[ -d/.test(command)) {
      // acquire via mkdir — succeed if not held, fail if held (unless stale,
      // which we ignore in this fake)
      if (this.#flockHeld) return ok('', '', 1)
      this.#flockHeld = true
      return ok('', '', 0)
    }

    // 5) rmdir (fallback release)
    if (/^rmdir .+ 2>\/dev\/null; :/.test(command)) {
      this.#flockHeld = false
      return ok('', '', 0)
    }

    // 6) atomic rename: `sync && mv <tmp> <target> && chmod <mode> <target>`
    const mvMatch = /^sync && mv '([^']+)' '([^']+)'(?: && chmod \d+ '([^']+)')?$/.exec(command)
    if (mvMatch) {
      const [, src, dst] = mvMatch
      if (!src || !dst || this.fs[src] === undefined) {
        return ok('', `mv: cannot stat '${src}'`, 1)
      }
      this.fs[dst] = this.fs[src]
      delete this.fs[src]
      return ok('', '', 0)
    }

    // 7) mkdir for validate dir
    if (/^mkdir -p '\/tmp\/miharbor-test' && chmod 700/.test(command)) {
      return ok('', '', 0)
    }

    // 8) mihomo -t
    if (/^mihomo -t -d /.test(command)) {
      const code = this.#opts.mihomoExitCode ?? 0
      return ok(
        this.#opts.mihomoStdout ?? 'configuration file test is successful',
        this.#opts.mihomoStderr ?? '',
        code,
      )
    }

    throw new Error(`FakeSshAdapter: unhandled command: ${command}`)
  }

  async sftpWriteFile(path: string, data: Buffer, mode?: number): Promise<void> {
    await this.connect()
    this.fs[path] = data.toString('utf8')
    if (mode !== undefined) {
      this.writeFileModes.set(path, mode)
    }
  }

  async sftpReadFile(path: string): Promise<Buffer> {
    await this.connect()
    const v = this.fs[path]
    if (v === undefined) {
      const err = new Error(`No such file: ${path}`) as Error & { code?: string }
      err.code = 'ENOENT'
      throw err
    }
    return Buffer.from(v, 'utf8')
  }
}

function ok(stdout: string, stderr: string, code: number): SshExecResult {
  return { stdout, stderr, code }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

// ---------- fixtures ----------

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-ssh-test-'))
})
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function makeTransport(opts: FakeOptions = {}, remoteConfigPath = '/etc/mihomo/config.yaml') {
  const adapter = new FakeSshAdapter(opts)
  const t = new SshTransport({
    host: 'test.invalid',
    port: 22,
    username: 'deploy',
    remoteConfigPath,
    remoteLockPath: '/etc/mihomo/.miharbor.lock',
    dataDir,
    mihomoApiUrl: 'http://test:9090',
    mihomoApiSecret: 'beef',
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    adapter,
  })
  return { t, adapter }
}

// ---------- buildConnectConfig auth selection ----------

test('buildConnectConfig uses privateKey when provided', () => {
  const cfg = buildConnectConfig({
    host: 'h',
    port: 22,
    username: 'u',
    privateKey: Buffer.from('FAKE KEY'),
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    hostKeyPolicy: INSECURE_POLICY,
  })
  expect(cfg.privateKey).toBeDefined()
  expect(cfg.agent).toBeUndefined()
})

test('buildConnectConfig forwards passphrase for encrypted key', () => {
  const cfg = buildConnectConfig({
    host: 'h',
    port: 22,
    username: 'u',
    privateKey: Buffer.from('FAKE ENC KEY'),
    passphrase: 'hunter2',
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    hostKeyPolicy: INSECURE_POLICY,
  })
  expect(cfg.passphrase).toBe('hunter2')
})

test('buildConnectConfig falls back to agent socket when no key', () => {
  const cfg = buildConnectConfig({
    host: 'h',
    port: 22,
    username: 'u',
    agentSocket: '/tmp/ssh-agent.sock',
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    hostKeyPolicy: INSECURE_POLICY,
  })
  expect(cfg.agent).toBe('/tmp/ssh-agent.sock')
  expect(cfg.privateKey).toBeUndefined()
})

test('buildConnectConfig throws when neither key nor agent socket set', () => {
  expect(() =>
    buildConnectConfig({
      host: 'h',
      port: 22,
      username: 'u',
      connectTimeoutMs: 1000,
      keepaliveIntervalMs: 5000,
      hostKeyPolicy: INSECURE_POLICY,
    }),
  ).toThrow(/no authentication configured/)
})

test('buildConnectConfig refuses to connect when host-key policy is missing', () => {
  // Refuse-by-default: the operator must pick known_hosts OR explicit
  // insecure. Silent accept-any is NOT a valid default.
  expect(() =>
    buildConnectConfig({
      host: 'h',
      port: 22,
      username: 'u',
      privateKey: Buffer.from('FAKE KEY'),
      connectTimeoutMs: 1000,
      keepaliveIntervalMs: 5000,
    }),
  ).toThrow(/host-key verification is not configured/)
})

// ---------- host-key verification wiring ----------

/** Helper: build a one-line known_hosts entry for `host` with random-ish key. */
function makeKnownHostsFor(host: string, keyBlob: Buffer): string {
  return `${host} ssh-ed25519 ${keyBlob.toString('base64')}\n`
}

test('buildConnectConfig installs a hostVerifier that accepts matching key', () => {
  const host = 'router.lan'
  const goodKey = Buffer.from('this-is-not-really-a-key-but-bytes-equal-bytes')
  const entries = parseKnownHosts(makeKnownHostsFor(host, goodKey))
  const cfg = buildConnectConfig({
    host,
    port: 22,
    username: 'u',
    privateKey: Buffer.from('FAKE KEY'),
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    hostKeyPolicy: { kind: 'known-hosts', entries, sourcePath: '/fake/known_hosts' },
  })
  expect(typeof cfg.hostVerifier).toBe('function')
  // ssh2 calls this callback with the server's public-key bytes. Matching
  // bytes must return truthy; mismatched must return falsy.
  // Sync-form verifier: (key) => boolean.
  const sync = cfg.hostVerifier as (key: Buffer) => boolean
  expect(sync(goodKey)).toBe(true)
})

test('buildConnectConfig installs a hostVerifier that rejects mismatched key', () => {
  const host = 'router.lan'
  const trustedKey = Buffer.from('trusted-public-key-bytes')
  const rogueKey = Buffer.from('attacker-supplied-public-key-bytes')
  const logCalls: Array<{ level: string; payload: Record<string, unknown> }> = []
  const entries = parseKnownHosts(makeKnownHostsFor(host, trustedKey))
  const cfg = buildConnectConfig({
    host,
    port: 22,
    username: 'u',
    privateKey: Buffer.from('FAKE KEY'),
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    hostKeyPolicy: { kind: 'known-hosts', entries, sourcePath: '/fake/known_hosts' },
    log: (level, payload) => {
      logCalls.push({ level, payload })
    },
  })
  const sync = cfg.hostVerifier as (key: Buffer) => boolean
  expect(sync(rogueKey)).toBe(false)
  // Should have logged an error with the offending fingerprint.
  const errs = logCalls.filter((c) => c.level === 'error')
  expect(errs.length).toBe(1)
  expect(String(errs[0]!.payload.msg)).toMatch(/host-key verification FAILED/i)
  expect(String(errs[0]!.payload.offered_fingerprint)).toMatch(/^SHA256:/)
})

test('buildConnectConfig with insecure policy skips hostVerifier and warns', () => {
  const logCalls: Array<{ level: string; payload: Record<string, unknown> }> = []
  const cfg = buildConnectConfig({
    host: 'h',
    port: 22,
    username: 'u',
    privateKey: Buffer.from('FAKE KEY'),
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    hostKeyPolicy: INSECURE_POLICY,
    log: (level, payload) => {
      logCalls.push({ level, payload })
    },
  })
  // No verifier installed — ssh2 falls back to accept-any.
  expect(cfg.hostVerifier).toBeUndefined()
  // Warning surfaced so the operator knows they are exposed.
  const warns = logCalls.filter((c) => c.level === 'warn')
  expect(warns.length).toBe(1)
  expect(String(warns[0]!.payload.msg)).toMatch(/host-key verification disabled/i)
})

// ---------- readConfig ----------

test('readConfig returns remote file content + sha256', async () => {
  const raw = 'mode: rule\n'
  const { t } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': raw },
  })
  const { content, hash } = await t.readConfig()
  expect(content).toBe(raw)
  expect(hash).toBe(sha256(raw))
})

// ---------- writeConfig (atomic) ----------

test('writeConfig uploads tmp sibling then mv into place', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
  })
  await t.writeConfig('new\n', 'unused-local-path')
  // Final file has the new content.
  expect(adapter.fs['/etc/mihomo/config.yaml']).toBe('new\n')
  // The tmp sibling name should not survive after rename.
  const tmpLeftovers = Object.keys(adapter.fs).filter((p) => p.includes('.miharbor.tmp'))
  expect(tmpLeftovers).toEqual([])
  // `mv` must have been issued exactly once.
  expect(adapter.execLog.filter((c) => /^sync && mv /.test(c)).length).toBe(1)
})

test('writeConfig acquires and releases flock', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
  })
  await t.writeConfig('new\n', '/unused')
  const cmds = adapter.execLog
  // First a flock probe
  expect(cmds.some((c) => c === 'command -v flock')).toBe(true)
  // Then a flock-acquire via setsid
  expect(cmds.some((c) => /setsid sh -c/.test(c) && /flock -xn 9/.test(c))).toBe(true)
  // Then a release via kill
  expect(cmds.some((c) => /^kill \d+/.test(c))).toBe(true)
})

test('writeConfig falls back to mkdir lock when flock is absent', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
    hasFlock: false,
  })
  await t.writeConfig('new\n', '/unused')
  const cmds = adapter.execLog
  // mkdir path invoked
  expect(cmds.some((c) => /mkdir .+ 2>\/dev\/null/.test(c) && /if \[ -d/.test(c))).toBe(true)
  // rmdir release
  expect(cmds.some((c) => /^rmdir .+ 2>\/dev\/null; :/.test(c))).toBe(true)
  // No kill command (that would mean we went through the flock path)
  expect(cmds.some((c) => /^kill \d+/.test(c))).toBe(false)
})

test('writeConfig surfaces mv failure as transport error', async () => {
  // Remove the file entry so mv fails.
  const adapter = new FakeSshAdapter({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
    extraHandlers: [
      // Override mv with failure.
      [/^sync && mv /, () => ok('', 'mv: simulated failure', 2)],
    ],
  })
  const t = new SshTransport({
    host: 'test.invalid',
    port: 22,
    username: 'u',
    remoteConfigPath: '/etc/mihomo/config.yaml',
    remoteLockPath: '/etc/mihomo/.miharbor.lock',
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: '',
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    adapter,
  })
  await expect(t.writeConfig('new\n', '/unused')).rejects.toThrow(/atomic rename failed/)
})

test('concurrent writeConfig calls do not corrupt remote file', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
  })
  // We run all three writes sequentially through the lock — not truly
  // concurrent in the socket sense, but the contract is "last writer wins
  // without partial state".
  await Promise.all([
    t.writeConfig('a: 1\n', '/u'),
    t.writeConfig('a: 2\n', '/u'),
    t.writeConfig('a: 3\n', '/u'),
  ])
  const final = adapter.fs['/etc/mihomo/config.yaml']
  expect(final).toBeDefined()
  expect(['a: 1\n', 'a: 2\n', 'a: 3\n']).toContain(final!)
})

// ---------- configWriteMode ----------

test('writeConfig applies default configWriteMode 0o644 to remote config', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
  })
  // When configWriteMode is not specified, default to 0o644.
  await t.writeConfig('new\n', '/unused')
  // The chmod command in the mv pipeline should have been called with the
  // default mode. Extract from execLog and verify.
  const mvCmd = adapter.execLog.find((c) => c.includes('sync && mv'))
  expect(mvCmd).toBeDefined()
  expect(mvCmd).toMatch(/chmod 0?644/)
})

test('writeConfig honours configWriteMode option override', async () => {
  const adapter = new FakeSshAdapter({
    initialFs: { '/etc/mihomo/config.yaml': 'old\n' },
  })
  const t = new SshTransport({
    host: 'test.invalid',
    port: 22,
    username: 'u',
    remoteConfigPath: '/etc/mihomo/config.yaml',
    remoteLockPath: '/etc/mihomo/.miharbor.lock',
    dataDir,
    mihomoApiUrl: 'http://x',
    mihomoApiSecret: '',
    connectTimeoutMs: 1000,
    keepaliveIntervalMs: 5000,
    configWriteMode: 0o600, // Explicit override
    adapter,
  })
  await t.writeConfig('new\n', '/unused')
  // The mv command should use the overridden mode.
  const mvCmd = adapter.execLog.find((c) => c.includes('sync && mv'))
  expect(mvCmd).toBeDefined()
  expect(mvCmd).toMatch(/chmod 0?600/)
})

// ---------- verifyAndWrite (TOCTOU) ----------

test('verifyAndWrite succeeds when remote hash unchanged', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'v1\n' },
  })
  const before = await t.readConfig()
  await t.verifyAndWrite('v2\n', '/u', before.hash)
  expect(adapter.fs['/etc/mihomo/config.yaml']).toBe('v2\n')
})

test('verifyAndWrite throws ConfigChangedExternallyError when remote file mutated', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'v1\n' },
  })
  const before = await t.readConfig()
  // Simulate an out-of-band edit.
  adapter.fs['/etc/mihomo/config.yaml'] = 'v1.5\n'
  let thrown: unknown
  try {
    await t.verifyAndWrite('v2\n', '/u', before.hash)
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(ConfigChangedExternallyError)
  // Remote file must NOT have been overwritten.
  expect(adapter.fs['/etc/mihomo/config.yaml']).toBe('v1.5\n')
})

// ---------- runMihomoValidate ----------

test('runMihomoValidate happy path — mihomo exit 0', async () => {
  const { t, adapter } = makeTransport({})
  const res = await t.runMihomoValidate('mode: rule\n')
  expect(res.ok).toBe(true)
  expect(res.errors).toEqual([])
  // The draft config must have been uploaded.
  expect(adapter.fs['/tmp/miharbor-test/config.yaml']).toBe('mode: rule\n')
  // mkdir and mihomo commands both issued.
  expect(adapter.execLog.some((c) => /^mkdir -p '\/tmp\/miharbor-test'/.test(c))).toBe(true)
  expect(adapter.execLog.some((c) => /^mihomo -t -d /.test(c))).toBe(true)
})

test('runMihomoValidate reports failure with parsed error line', async () => {
  const { t } = makeTransport({
    mihomoExitCode: 1,
    mihomoStdout: '',
    mihomoStderr:
      'INFO[xx] Start initial configuration parsing\nFATA[xx] error parsing rule: invalid rule\n',
  })
  const res = await t.runMihomoValidate('bad: [unclosed\n')
  expect(res.ok).toBe(false)
  expect(res.errors.length).toBeGreaterThan(0)
  expect(res.errors[0]!.message).toMatch(/error|invalid/i)
  expect(res.raw_output).toContain('FATA')
})

test('runMihomoValidate reports no-output failure with a descriptive fallback', async () => {
  const { t } = makeTransport({
    mihomoExitCode: 2,
    mihomoStdout: '',
    mihomoStderr: '',
  })
  const res = await t.runMihomoValidate('a: 1\n')
  expect(res.ok).toBe(false)
  expect(res.errors[0]!.message.length).toBeGreaterThan(0)
})

// ---------- snapshots (local-only) ----------

test('snapshots live in the local dataDir, not on the remote', async () => {
  const { t, adapter } = makeTransport({})
  const meta = {
    id: '2026-04-17T00-00-00.000Z-deadbeef',
    timestamp: '2026-04-17T00:00:00.000Z',
    sha256_original: 'a'.repeat(64),
    sha256_masked: 'b'.repeat(64),
    applied_by: 'user' as const,
    transport: 'ssh' as const,
  }
  await t.writeSnapshot(meta.id, {
    'config.yaml': 'x: 1\n',
    'meta.json': JSON.stringify(meta),
    'diff.patch': '',
  })
  // Local listing shows the snapshot.
  const list = await t.readSnapshotsDir()
  expect(list.map((m) => m.id)).toEqual([meta.id])
  // Remote filesystem must be empty of snapshot paths.
  expect(Object.keys(adapter.fs).some((p) => p.includes('snapshots'))).toBe(false)
  // Round-trip through readSnapshot.
  const got = await t.readSnapshot(meta.id)
  expect(got['config.yaml']).toBe('x: 1\n')
  // Cleanup.
  await t.deleteSnapshot(meta.id)
  expect(await t.readSnapshotsDir()).toEqual([])
})

test('readSnapshotsDir tolerates a pre-existing local dir with broken meta', async () => {
  const { t } = makeTransport({})
  // Seed a broken snapshot manually.
  const badDir = join(dataDir, 'snapshots', 'broken')
  mkdirSync(badDir, { recursive: true })
  writeFileSync(join(badDir, 'meta.json'), '{not json')
  const list = await t.readSnapshotsDir()
  expect(list).toEqual([])
})

// ---------- mihomoApiUrl / mihomoApiSecret ----------

test('mihomoApiUrl + mihomoApiSecret return constructor values', () => {
  const { t } = makeTransport({})
  expect(t.mihomoApiUrl()).toBe('http://test:9090')
  expect(t.mihomoApiSecret()).toBe('beef')
})

// ---------- dispose ----------

test('dispose() closes the SSH connection', async () => {
  const { t, adapter } = makeTransport({
    initialFs: { '/etc/mihomo/config.yaml': 'x\n' },
  })
  // Force a connect.
  await t.readConfig()
  expect(adapter.connectCount).toBe(1)
  await t.dispose()
  expect(adapter.endCount).toBe(1)
})

// ---------- bad auth at construction ----------

test('SshTransport ctor throws when neither key nor agent set', () => {
  expect(
    () =>
      new SshTransport({
        host: 'h',
        port: 22,
        username: 'u',
        remoteConfigPath: '/etc/mihomo/config.yaml',
        remoteLockPath: '/etc/mihomo/.miharbor.lock',
        dataDir,
        mihomoApiUrl: 'http://x',
        mihomoApiSecret: '',
        connectTimeoutMs: 1000,
        keepaliveIntervalMs: 5000,
        // Pass a policy so the error surfaces from the auth path, not the
        // host-key path (both paths are covered; this test pins auth).
        hostKeyPolicy: INSECURE_POLICY,
      }),
  ).toThrow(/no authentication configured/)
})

test('SshTransport ctor throws when host-key policy is missing', () => {
  expect(
    () =>
      new SshTransport({
        host: 'h',
        port: 22,
        username: 'u',
        privateKey: Buffer.from('FAKE KEY'),
        remoteConfigPath: '/etc/mihomo/config.yaml',
        remoteLockPath: '/etc/mihomo/.miharbor.lock',
        dataDir,
        mihomoApiUrl: 'http://x',
        mihomoApiSecret: '',
        connectTimeoutMs: 1000,
        keepaliveIntervalMs: 5000,
      }),
  ).toThrow(/host-key verification is not configured/)
})
