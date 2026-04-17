// Transport abstraction — everything that touches the target filesystem or
// the mihomo API goes through a Transport instance. Two concrete transports
// planned for Stage 1: `LocalFsTransport` (Docker-on-same-host layout, the
// default for shipping Miharbor as an image next to mihomo) and
// `InMemoryTransport` (test double). `SshTransport` arrives in Stage 2.
//
// The interface is deliberately minimal — every method that crosses a
// trust/process boundary lives here, nothing that's pure in-memory YAML
// manipulation. Callers (deploy pipeline, snapshot manager, healthcheck)
// depend only on this interface and are transport-agnostic.
//
// Spec reference: `docs/superpowers/specs/2026-04-16-miharbor-design.md` §6.
//
// Concurrency model (§6): `writeConfig` takes a `lockFile` path so the
// caller can request coarse-grained serialisation (e.g. against the
// `MIHARBOR_CONFIG_PATH` itself on LocalFs, or a sidecar lock on SSH).
// Each implementation decides how to honour it — InMemory runs lock-free,
// LocalFs uses `proper-lockfile`, Ssh will use remote `flock(1)`.

/** Thrown by `LocalFsTransport.verifyAndWrite` when the on-disk config
 *  changed between the caller's read and the hash-guarded write. The deploy
 *  pipeline catches this and emits an SSE `error` with `code` so the UI
 *  can render a dedicated "reload and retry" banner rather than a generic
 *  write error. */
export class ConfigChangedExternallyError extends Error {
  public readonly code = 'CONFIG_CHANGED_EXTERNALLY'
  public readonly expectedHash: string
  public readonly actualHash: string
  constructor(expectedHash: string, actualHash: string) {
    super(
      `writeConfig aborted: config changed on disk (expected ${expectedHash.slice(0, 12)}…, actual ${actualHash.slice(0, 12)}…). Reload and retry.`,
    )
    this.name = 'ConfigChangedExternallyError'
    this.expectedHash = expectedHash
    this.actualHash = actualHash
  }
}

/** Persisted metadata that ships alongside every snapshot directory. All
 *  fields match the on-disk `meta.json` schema. `id` is the snapshot
 *  directory name (`<ISO8601>-<sha256-prefix>`). */
export interface SnapshotMeta {
  /** `<ISO8601>-<sha256-prefix>`; the snapshot directory name. */
  id: string
  /** ISO-8601 UTC timestamp of snapshot creation. */
  timestamp: string
  /** sha256 of the raw (unmasked) config bytes at capture time. Used by the
   *  deploy pipeline to verify "nothing changed externally between load and
   *  snapshot" when we're taking an auto-snapshot of the live file. */
  sha256_original: string
  /** sha256 of the masked snapshot bytes. Primary identity for dedupe — two
   *  snapshots with equal `sha256_masked` describe the same operator-visible
   *  state, even if the underlying secrets differ across rotations. */
  sha256_masked: string
  /** Who produced this snapshot. Used for UI filtering and auto-rollback
   *  recursion guard ("don't auto-rollback an auto-rollback"). */
  applied_by: 'user' | 'rollback' | 'auto-rollback' | 'canonicalization'
  /** Originating IP of the deploy request (set by API layer; absent for
   *  system-generated snapshots like canonicalization migrations). */
  user_ip?: string
  /** Originating User-Agent of the deploy request. */
  user_agent?: string
  /** Summary of the masked diff relative to the previous snapshot. Filled
   *  by the snapshot manager at creation time. */
  diff_summary?: { added: number; removed: number }
  /** mihomo version string at the time of capture (from `GET /version`). */
  mihomo_api_version?: string
  /** Which transport produced this snapshot. */
  transport: 'local' | 'ssh'
}

/** Result of a structural / server-side mihomo validation pass. `ok=false`
 *  blocks the deploy pipeline; errors are surfaced to the UI with line/col
 *  markers where available. `raw_output` is stashed unparsed so the UI can
 *  show the real mihomo stderr on advanced / unknown failures. */
export interface ValidationResult {
  ok: boolean
  errors: Array<{ line?: number; col?: number; message: string }>
  raw_output: string
}

/** The file bundle that makes up a single snapshot directory on disk. Kept
 *  explicit so the transport contract doesn't leak fs/YAML concerns. */
export interface SnapshotFiles {
  'config.yaml': string
  'meta.json': string
  'diff.patch': string
}

/** Read-side shape of a snapshot — the masked config, the unified diff
 *  against the previous masked snapshot, and the parsed meta. `diff.patch`
 *  may be an empty string for the very first snapshot (in which case it
 *  is formatted as a `/dev/null` → target patch). */
export interface SnapshotBundle {
  'config.yaml': string
  'diff.patch': string
  meta: SnapshotMeta
}

export interface Transport {
  /** Read the live mihomo config. Returns raw bytes plus a sha256 hash the
   *  deploy pipeline re-checks under lock before writing (TOCTOU guard). */
  readConfig(): Promise<{ content: string; hash: string }>

  /** Atomically replace the live mihomo config.
   *  @param content  — the new file bytes.
   *  @param lockFile — path to the lock file the transport should hold for
   *                     the duration of the write. Opaque to the caller; on
   *                     LocalFs this is typically `${configPath}.lock`; on
   *                     InMemory it's ignored. */
  writeConfig(content: string, lockFile: string): Promise<void>

  /** List every snapshot currently on disk, newest first. Heavy callers
   *  (retention sweep) rely on this being cheap — implementations may
   *  in-memory cache the parsed meta.json results. */
  readSnapshotsDir(): Promise<SnapshotMeta[]>

  /** Write the 3-file snapshot bundle under `id`. Implementations are
   *  responsible for mode 0600 on `config.yaml`. */
  writeSnapshot(id: string, files: SnapshotFiles): Promise<void>

  /** Read a single snapshot by id. Throws if missing / corrupted. */
  readSnapshot(id: string): Promise<SnapshotBundle>

  /** Remove a snapshot directory. Best-effort; non-existent id is a no-op. */
  deleteSnapshot(id: string): Promise<void>

  /** Validate a draft config against the real mihomo. Two modes are
   *  supported — pure YAML+linter (`shared-only`, default) and the
   *  full mihomo API round-trip (`api`). Callers don't know which mode is
   *  active; they see the same `ValidationResult` either way. */
  runMihomoValidate(content: string): Promise<ValidationResult>

  /** mihomo REST API base URL, e.g. `http://host.docker.internal:9090`. */
  mihomoApiUrl(): string

  /** mihomo REST API Bearer token. Never logged in full by the transport. */
  mihomoApiSecret(): string
}
