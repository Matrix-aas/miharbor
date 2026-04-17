// Retention formula (spec §9 — "keep N = max(count, days)"):
// keep a snapshot if `index < RETENTION_COUNT` OR `age < RETENTION_DAYS`.
// Delete only when BOTH conditions fail — i.e., too old AND too far back.
//
// `index` is 0-based newest-first: snapshot[0] is the newest. Two knobs,
// neither alone is sufficient: "keep 50 newest" on a noisy day could
// churn critical history within hours, and "keep 30 days" on a quiet
// system leaves only stale snapshots.
//
// Pure function — no I/O, no ambient time. `now` is injected for tests.

import type { SnapshotMeta } from '../transport/transport.ts'

export interface RetentionConfig {
  retentionCount: number
  retentionDays: number
}

export interface RetentionDecision {
  /** Snapshot ids to keep. */
  keep: string[]
  /** Snapshot ids to delete (newest-first order preserved). */
  remove: string[]
}

/**
 * Decide which snapshots survive the retention cutoff.
 *
 * @param snapshots — must be newest-first (caller's responsibility; matches
 *                     `Transport.readSnapshotsDir` contract).
 * @param cfg        — from env (`MIHARBOR_SNAPSHOT_RETENTION_COUNT` /
 *                     `_DAYS`).
 * @param now        — current time as epoch ms; defaults to `Date.now()`.
 */
export function applyRetention(
  snapshots: readonly SnapshotMeta[],
  cfg: RetentionConfig,
  now: number = Date.now(),
): RetentionDecision {
  const keep: string[] = []
  const remove: string[] = []
  const cutoff = now - cfg.retentionDays * 24 * 60 * 60 * 1000
  for (let i = 0; i < snapshots.length; i += 1) {
    const s = snapshots[i]!
    const ts = Date.parse(s.timestamp)
    // If timestamp is unparseable, err on the side of retention (don't
    // eat user data because of bad bookkeeping).
    const age_ok = Number.isFinite(ts) ? ts > cutoff : true
    if (i < cfg.retentionCount || age_ok) {
      keep.push(s.id)
    } else {
      remove.push(s.id)
    }
  }
  return { keep, remove }
}
