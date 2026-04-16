// Snapshot manager — the only public API for creating, listing, and
// retiring snapshots. Every snapshot is MASKED before write (spec §9):
// the raw YAML goes through `vault.maskDoc` so `$DATA_DIR/snapshots/*/`
// can be read by backup tools without exposing raw credentials.
//
// Responsibilities (what goes IN / OUT of this module):
//   IN:   rawConfig (real secrets), partial meta (applied_by, user_ip, …)
//   OUT:  SnapshotMeta written to disk via Transport; vault references
//          linked to the snapshot id; UUID bookkeeping for GC.
//
// Dedupe: when `applied_by === 'auto-rollback'` and the new snapshot's
// sha256_masked equals the previous snapshot's sha256_masked, we do NOT
// create a new entry. Returns null. This protects against the cycle
// "rollback → v14 → rollback" filling retention with no-op entries.
//
// Diff: `diff.patch` is a unified diff of MASKED content, previous vs
// current. Secrets never appear in diffs (they're all sentinels by the
// time diff runs). Uses `diff@9` `createTwoFilesPatch`.
//
// Retention: `applyRetention()` sweeps — deletes only snapshots that
// fail BOTH count AND age checks. After delete, runs `vault.gc` on the
// surviving uuid set.
//
// Design caveat (MVP): snapshot dir IDs are `<ISO8601>-<hash8>`. Because
// ISO strings contain `:` which some filesystems dislike in dir names,
// we substitute `-` for `:` — matching the format used in tests.

import { createHash } from 'node:crypto'
import { createTwoFilesPatch } from 'diff'
import { parseDocument, type Document, isPair, isScalar, visit } from 'yaml'
import type { Logger } from '../observability/logger.ts'
import type { SnapshotMeta, Transport } from '../transport/transport.ts'
import type { Vault } from '../vault/vault.ts'
import { SENTINEL_PREFIX } from '../vault/mask.ts'
import { applyRetention, type RetentionConfig } from './retention.ts'

export interface SnapshotManagerOptions {
  transport: Transport
  vault: Vault
  retention: RetentionConfig
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  /** Injected for deterministic IDs in tests. */
  now?: () => Date
}

export interface CreateSnapshotMeta {
  applied_by: SnapshotMeta['applied_by']
  user_ip?: string
  user_agent?: string
  mihomo_api_version?: string
  transport?: SnapshotMeta['transport']
}

export interface SnapshotManager {
  /** Create a snapshot of `rawConfig`. Masks secrets via vault, computes
   *  diff vs previous masked snapshot, dedupes auto-rollbacks.
   *  Returns the persisted meta, or null if deduped. */
  createSnapshot(rawConfig: string, meta: CreateSnapshotMeta): Promise<SnapshotMeta | null>
  /** Newest-first list. */
  listSnapshots(): Promise<SnapshotMeta[]>
  /** Read a snapshot — returns masked config + meta + unified diff.patch.
   *  Caller runs `vault.unmaskDoc` to get the rollback-ready bytes. The
   *  `diffPatch` is the unified patch against the previous snapshot's masked
   *  content; empty string for the first snapshot. */
  getSnapshot(id: string): Promise<{ configMasked: string; meta: SnapshotMeta; diffPatch: string }>
  /** Apply retention sweep + vault GC. Returns ids actually removed. */
  applyRetention(): Promise<{ removed: string[] }>
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

function sha256Short(s: string): string {
  return sha256(s).slice(0, 8)
}

/** `<ISO8601>-<hash8>` — colons replaced with `-` for FS-friendly names. */
function snapshotId(now: Date, hash8: string): string {
  const iso = now.toISOString().replace(/:/g, '-')
  return `${iso}-${hash8}`
}

/** Extract all vault sentinel uuids used in a masked YAML document. Used
 *  to populate `referenced_by` in the vault and to feed `vault.gc`. */
export function extractSentinelUuids(doc: Document): string[] {
  const out = new Set<string>()
  visit(doc, {
    Pair(_k, pair) {
      if (!isPair(pair)) return
      if (!isScalar(pair.value)) return
      const v = pair.value.value
      if (typeof v !== 'string') return
      if (!v.startsWith(SENTINEL_PREFIX)) return
      out.add(v.slice(SENTINEL_PREFIX.length))
    },
  })
  return [...out]
}

/** Compute a line-based added/removed summary from a unified-diff string.
 *  Counts `+` / `-` lines but skips the `+++` / `---` headers. */
function summarizeDiff(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

export function createSnapshotManager(opts: SnapshotManagerOptions): SnapshotManager {
  const logger = opts.logger ?? NOOP_LOGGER
  const now = opts.now ?? (() => new Date())
  const transportKind: SnapshotMeta['transport'] = 'local'

  const api: SnapshotManager = {
    async createSnapshot(rawConfig, inMeta) {
      const sha256_original = sha256(rawConfig)

      // Mask the doc via vault. Pre-mint a snapshot-id so vault sees it
      // as the `referenced_by` owner at mask time.
      const doc = parseDocument(rawConfig)
      if (doc.errors.length > 0) {
        throw new Error(
          `snapshot: config YAML failed to parse (${doc.errors.length} errors); first: ${doc.errors[0]!.message}`,
        )
      }
      // Don't pass snapshotId to maskDoc yet — we need sha256_masked first
      // to compute the final id. We'll bookkeep references after the fact.
      const mintedUuids = await opts.vault.maskDoc(doc)
      const maskedText = doc.toString({
        lineWidth: 0,
        minContentWidth: 0,
      })
      const sha256_masked = sha256(maskedText)

      // Dedupe check for auto-rollback. Pull the newest existing snapshot;
      // if its masked hash matches, skip.
      if (inMeta.applied_by === 'auto-rollback') {
        const existing = await opts.transport.readSnapshotsDir()
        const prev = existing[0]
        if (prev && prev.sha256_masked === sha256_masked) {
          // Roll back the vault entries we just minted — they're not
          // referenced anywhere.
          await opts.vault.gc(new Set())
          logger.info({
            msg: 'snapshot dedupe: auto-rollback content matches previous snapshot; skipping',
            prev_id: prev.id,
            sha256_masked: sha256_masked.slice(0, 12),
          })
          return null
        }
      }

      const ts = now()
      const id = snapshotId(ts, sha256Short(maskedText))

      // Link vault uuids to this snapshot id for refcount bookkeeping.
      await opts.vault.addReferences(id, mintedUuids)

      // Compute diff vs previous masked snapshot.
      const existing = await opts.transport.readSnapshotsDir()
      const prev = existing[0]
      let diffPatch = ''
      let diff_summary: SnapshotMeta['diff_summary']
      if (prev) {
        const prevBundle = await opts.transport.readSnapshot(prev.id)
        diffPatch = createTwoFilesPatch(
          prev.id,
          id,
          prevBundle['config.yaml'],
          maskedText,
          undefined,
          undefined,
          { context: 3 },
        )
        diff_summary = summarizeDiff(diffPatch)
      } else {
        // First snapshot — "diff" is a patch from /dev/null.
        diffPatch = createTwoFilesPatch('/dev/null', id, '', maskedText, undefined, undefined, {
          context: 3,
        })
        diff_summary = summarizeDiff(diffPatch)
      }

      const meta: SnapshotMeta = {
        id,
        timestamp: ts.toISOString(),
        sha256_original,
        sha256_masked,
        applied_by: inMeta.applied_by,
        ...(inMeta.user_ip ? { user_ip: inMeta.user_ip } : {}),
        ...(inMeta.user_agent ? { user_agent: inMeta.user_agent } : {}),
        diff_summary,
        ...(inMeta.mihomo_api_version ? { mihomo_api_version: inMeta.mihomo_api_version } : {}),
        transport: inMeta.transport ?? transportKind,
      }

      await opts.transport.writeSnapshot(id, {
        'config.yaml': maskedText,
        'meta.json': JSON.stringify(meta, null, 2) + '\n',
        'diff.patch': diffPatch,
      })
      return meta
    },

    async listSnapshots() {
      return opts.transport.readSnapshotsDir()
    },

    async getSnapshot(id) {
      const bundle = await opts.transport.readSnapshot(id)
      return {
        configMasked: bundle['config.yaml'],
        meta: bundle.meta,
        diffPatch: bundle['diff.patch'],
      }
    },

    async applyRetention() {
      const snapshots = await opts.transport.readSnapshotsDir()
      const decision = applyRetention(snapshots, opts.retention, Date.now())
      for (const id of decision.remove) {
        await opts.transport.deleteSnapshot(id)
        await opts.vault.dropSnapshotReferences(id)
      }
      // Post-sweep vault GC: walk the surviving snapshots, collect every
      // sentinel uuid they reference, and prune the rest.
      const survivors = await opts.transport.readSnapshotsDir()
      const live = new Set<string>()
      for (const meta of survivors) {
        const bundle = await opts.transport.readSnapshot(meta.id)
        const doc = parseDocument(bundle['config.yaml'])
        for (const uuid of extractSentinelUuids(doc)) live.add(uuid)
      }
      const gcRemoved = await opts.vault.gc(live)
      if (decision.remove.length > 0 || gcRemoved > 0) {
        logger.info({
          msg: 'retention sweep',
          removed_snapshots: decision.remove.length,
          gc_vault_entries: gcRemoved,
        })
      }
      return { removed: decision.remove }
    },
  }
  return api
}
