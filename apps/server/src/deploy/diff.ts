// Unified-diff helper — thin wrapper around `diff@9`'s `createTwoFilesPatch`
// tuned for the deploy pipeline's "masked current vs masked draft" step.
//
// Why a separate module? The snapshot manager already uses `createTwoFilesPatch`
// for its previous-vs-current diff; the deploy pipeline wants the same format
// but between two *in-flight* YAML buffers (neither of which is on disk yet),
// plus a line-based `{added, removed}` summary that drives the UI's "+N/-M"
// badge on the diff step. Keeping this in one place means both callsites agree
// on the file header labels and the summary heuristic.

import { createTwoFilesPatch } from 'diff'

export interface UnifiedDiffResult {
  /** The unified-diff patch in the standard format (`--- / +++ / @@ …`). */
  patch: string
  /** Count of `+` lines (excluding the `+++` header). */
  added: number
  /** Count of `-` lines (excluding the `---` header). */
  removed: number
}

/** Produce a unified diff between two YAML buffers. The returned patch is
 *  safe to render in a plain-text UI pane. Empty input is tolerated — an
 *  empty `current` produces a `/dev/null` → `draft` patch shape. */
export function unifiedDiff(
  current: string,
  draft: string,
  labels: { from: string; to: string } = { from: 'current', to: 'draft' },
): UnifiedDiffResult {
  const patch = createTwoFilesPatch(labels.from, labels.to, current, draft, undefined, undefined, {
    context: 3,
  })
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { patch, added, removed }
}
