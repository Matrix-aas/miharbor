// InMemoryTransport — a Map-based Transport for tests. Behaves like a fresh
// Transport on each construction. No concurrency primitives; relies on the
// JS event-loop's single-threaded nature (which is sufficient for unit
// tests but would be unsafe in production).
//
// Design notes:
// - `readConfig` computes sha256 on every call (so tests can assert that
//   external mutation is reflected in the hash).
// - `writeConfig` ignores `lockFile` — lock semantics belong to
//   LocalFs/Ssh; making InMemory lock-aware would complicate tests without
//   adding coverage value.
// - `runMihomoValidate` is a hook — tests can inject a result via the
//   constructor option. Default is `ok=true` with no errors.
// - Secret handling: this transport is never given real secrets. The mihomo
//   URL/secret are plain strings passed through.

import { createHash } from 'node:crypto'
import type {
  SnapshotBundle,
  SnapshotFiles,
  SnapshotMeta,
  Transport,
  ValidationResult,
} from './transport.ts'

export interface InMemoryTransportOptions {
  /** Initial value returned by `readConfig`. Defaults to `''` (empty file). */
  initialConfig?: string
  /** Stubbed validator. When absent, validate succeeds silently. */
  validate?: (content: string) => Promise<ValidationResult> | ValidationResult
  /** Mihomo API URL reported to callers. */
  mihomoApiUrl?: string
  /** Mihomo API secret reported to callers. */
  mihomoApiSecret?: string
}

interface SnapshotEntry {
  files: SnapshotFiles
  meta: SnapshotMeta
}

export class InMemoryTransport implements Transport {
  #config: string
  #snapshots = new Map<string, SnapshotEntry>()
  #validate: InMemoryTransportOptions['validate']
  #mihomoUrl: string
  #mihomoSecret: string
  /** Count of write operations — handy for tests that want to assert "no
   *  writes happened on the lint path" without introducing spies. */
  public writeCount = 0

  constructor(opts: InMemoryTransportOptions = {}) {
    this.#config = opts.initialConfig ?? ''
    this.#validate = opts.validate
    this.#mihomoUrl = opts.mihomoApiUrl ?? 'http://localhost:9090'
    this.#mihomoSecret = opts.mihomoApiSecret ?? ''
  }

  /** Test helper — synchronously swap the stored config without going
   *  through `writeConfig`, to simulate an out-of-band mutation (e.g. user
   *  edits config.yaml with vim while deploy is running). */
  public setConfigRaw(content: string): void {
    this.#config = content
  }

  async readConfig(): Promise<{ content: string; hash: string }> {
    const hash = createHash('sha256').update(this.#config).digest('hex')
    return { content: this.#config, hash }
  }

  async writeConfig(content: string, _lockFile: string): Promise<void> {
    this.#config = content
    this.writeCount += 1
  }

  async readSnapshotsDir(): Promise<SnapshotMeta[]> {
    // Newest-first by timestamp, stable on ties by id.
    return [...this.#snapshots.values()]
      .map((e) => e.meta)
      .sort((a, b) => {
        if (a.timestamp > b.timestamp) return -1
        if (a.timestamp < b.timestamp) return 1
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
  }

  async writeSnapshot(id: string, files: SnapshotFiles): Promise<void> {
    const meta = JSON.parse(files['meta.json']) as SnapshotMeta
    if (meta.id !== id) {
      throw new Error(`InMemoryTransport.writeSnapshot: meta.id (${meta.id}) !== id arg (${id})`)
    }
    this.#snapshots.set(id, { files, meta })
  }

  async readSnapshot(id: string): Promise<SnapshotBundle> {
    const entry = this.#snapshots.get(id)
    if (!entry) throw new Error(`snapshot not found: ${id}`)
    return { 'config.yaml': entry.files['config.yaml'], meta: entry.meta }
  }

  async deleteSnapshot(id: string): Promise<void> {
    this.#snapshots.delete(id)
  }

  async runMihomoValidate(content: string): Promise<ValidationResult> {
    if (this.#validate) return this.#validate(content)
    return { ok: true, errors: [], raw_output: '' }
  }

  mihomoApiUrl(): string {
    return this.#mihomoUrl
  }

  mihomoApiSecret(): string {
    return this.#mihomoSecret
  }
}
