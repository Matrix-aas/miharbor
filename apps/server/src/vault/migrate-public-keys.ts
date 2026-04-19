// On-read draft migration — rewrites legacy `public-key: $MIHARBOR_VAULT:<uuid>`
// pairs back to their resolved plaintext values. Used by GET /api/config/draft
// so drafts written BEFORE v0.2.5 (when public-key was vaulted) don't surface
// the sentinel in the WG form.
//
// Idempotent: draft without sentinels returns byte-identical text and
// `touched: false`. Invalid YAML short-circuits to the same shape (we don't
// fix broken drafts, just pass them through). Missing uuids stay as the
// sentinel with a warn-log so the operator sees the blind spot.

import { parseDocument, isPair, isScalar, visit, type Scalar } from 'yaml'
import { DUMP_OPTS } from 'miharbor-shared'
import { SENTINEL_PREFIX } from './mask.ts'
import type { Vault } from './vault.ts'
import type { Logger } from '../observability/logger.ts'

const PUBLIC_KEY = 'public-key'

export interface MigrateResult {
  text: string
  touched: boolean
  /** Number of public-key scalars that were successfully rewritten. */
  count: number
}

export async function migrateDraftPublicKeys(
  text: string,
  vault: Vault,
  logger: Logger,
): Promise<MigrateResult> {
  let doc
  try {
    doc = parseDocument(text)
    if (doc.errors.length > 0) return { text, touched: false, count: 0 }
  } catch {
    return { text, touched: false, count: 0 }
  }

  // First pass — collect sentinels under `public-key:` pairs.
  const pending: Array<{ scalar: Scalar; uuid: string }> = []
  visit(doc, {
    Pair(_k, pair) {
      if (!isPair(pair)) return
      if (!isScalar(pair.key) || !isScalar(pair.value)) return
      if (pair.key.value !== PUBLIC_KEY) return
      const v = pair.value.value
      if (typeof v !== 'string' || !v.startsWith(SENTINEL_PREFIX)) return
      pending.push({
        scalar: pair.value,
        uuid: v.slice(SENTINEL_PREFIX.length),
      })
    },
  })

  if (pending.length === 0) return { text, touched: false, count: 0 }

  const uuids = pending.map((p) => p.uuid)
  const resolved = await vault.resolveMany(uuids)

  let count = 0
  for (const { scalar, uuid } of pending) {
    const value = resolved.get(uuid)
    if (value === undefined) {
      logger.warn({
        msg: 'migrate: unknown vault uuid — leaving sentinel',
        key: PUBLIC_KEY,
        uuid,
      })
      continue
    }
    scalar.value = value
    count += 1
  }

  if (count === 0) return { text, touched: false, count: 0 }
  // Canonical serializer — see routes/config.ts for the symmetry rationale.
  return { text: doc.toString(DUMP_OPTS), touched: true, count }
}
