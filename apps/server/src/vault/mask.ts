// Secret-field detection + sentinel-replacement for yaml@2 Documents.
//
// Why AST walk + `yaml.visit` instead of `doc.toJS()`?
// yaml@2's `toJS()` returns a plain-object graph that has NO trace of
// comments, anchor/alias links or block/flow style. Mutating that graph
// and then `doc.setIn` over the top loses every nuance and produces a
// huge visual diff on the very first snapshot. The `visit()` helper
// gives us in-place edit access to the real AST so comments and style
// survive.
//
// Secret field semantics:
// - Exact-match field names from `DEFAULT_SECRET_FIELDS` (overridable
//   via ENV `MIHARBOR_SECRET_FIELDS` — comma separated additions).
// - Suffix match: any field whose key ends with `-key`, `-password`,
//   `-token`, `-secret` is treated as a secret.
// - The match is structural (key text), not context-aware. `uuid:` in a
//   VMess node is a secret; `uuid:` in metadata is a secret too — the
//   MVP accepts this false-positive because it's always safer to mask
//   more than less (rollback via vault is transparent; masking noise
//   never leaks bytes).
//
// What we DON'T mask:
// - Top-level list / scalar values at the document root (not key-value
//   pairs, so the key test does not apply).
// - Values that look like already-masked sentinels (`$MIHARBOR_VAULT:…`)
//   — idempotent on re-mask.

import type { Document } from 'yaml'
import { isMap, isPair, isScalar, visit } from 'yaml'

/** Hard-coded default secret keys. Must stay in sync with spec §9 and
 *  the `.gitignore` patterns in §10.5. */
export const DEFAULT_SECRET_FIELDS = Object.freeze([
  'secret',
  'private-key',
  'pre-shared-key',
  'password',
  'uuid',
  'api_key',
  'api-key',
  'token',
])

/** Keys that LOOK like secrets (match `-key` suffix or share a name) but
 *  are explicitly NOT confidential. Checked BEFORE `DEFAULT_SECRET_FIELDS`
 *  and `SECRET_SUFFIXES` so `public-key` doesn't re-match `-key`. */
export const KNOWN_NON_SECRET_KEYS = Object.freeze(['public-key'])

/** Field-name suffixes that mark a secret-bearing key regardless of prefix. */
export const SECRET_SUFFIXES = Object.freeze(['-key', '-password', '-token', '-secret'])

/** Canonical sentinel prefix — any string starting with this is assumed to
 *  be a vault reference and is not re-masked (idempotence). */
export const SENTINEL_PREFIX = '$MIHARBOR_VAULT:'

/** Parse the ENV-provided `MIHARBOR_SECRET_FIELDS` (comma-separated
 *  additions to the default list). Whitespace trimmed per-entry, empty
 *  entries dropped, duplicates collapsed. */
export function resolveSecretFields(envValue: string | undefined): Set<string> {
  const set = new Set<string>(DEFAULT_SECRET_FIELDS)
  if (!envValue) return set
  for (const raw of envValue.split(',')) {
    const trimmed = raw.trim()
    if (trimmed) set.add(trimmed)
  }
  return set
}

/** `true` iff `key` is recognised as a secret-bearing field.
 *  Precedence: negative list → exact match → suffix match. `key` must
 *  be a plain string; scalar nodes with non-string keys are never secrets
 *  in our schema. */
export function isSecretKey(key: string, fields: Set<string>): boolean {
  if (KNOWN_NON_SECRET_KEYS.includes(key)) return false
  if (fields.has(key)) return true
  for (const suf of SECRET_SUFFIXES) {
    if (key.endsWith(suf)) return true
  }
  return false
}

/** `true` iff `value` is already a vault sentinel and should not be
 *  re-masked (prevents UUID churn on re-runs). */
export function isSentinel(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SENTINEL_PREFIX)
}

/** Callback invoked for every secret scalar the walk encounters. Returns
 *  the replacement string to write back into the AST. Throwing inside
 *  `onSecret` aborts the walk (visit exceptions propagate). */
export type SecretCallback = (currentValue: string) => string

/** Walk a Document in-place, calling `cb` for every secret-bearing scalar
 *  (per `fields`) and replacing the scalar's value with the callback's
 *  return. Comments and key order are preserved by virtue of the
 *  in-place mutation. Returns the set of replaced keys (parent-key
 *  strings, for diagnostics). */
export function walkSecrets(
  doc: Document,
  fields: Set<string>,
  cb: SecretCallback,
): { replaced: number } {
  let replaced = 0
  visit(doc, {
    Pair(_key, pair) {
      if (!isPair(pair)) return
      const keyNode = pair.key
      if (!isScalar(keyNode)) return
      const keyStr = typeof keyNode.value === 'string' ? keyNode.value : String(keyNode.value)
      if (!isSecretKey(keyStr, fields)) return
      const valNode = pair.value
      // Case 1: scalar value — replace in place.
      if (isScalar(valNode) && typeof valNode.value === 'string') {
        if (isSentinel(valNode.value)) return
        valNode.value = cb(valNode.value)
        replaced += 1
        return
      }
      // Case 2: non-string scalar (rare — e.g. `password: 42`). Coerce to
      // string and replace. This is defensive; the mihomo schema expects
      // strings for every secret field we know.
      if (isScalar(valNode) && valNode.value !== null && valNode.value !== undefined) {
        const raw = String(valNode.value)
        if (isSentinel(raw)) return
        valNode.value = cb(raw)
        replaced += 1
        return
      }
      // Case 3: value is a Map/Seq (e.g. a password map with per-user entries).
      // We recurse via the default visit traversal; every nested scalar that
      // happens to match a secret key will be picked up on its own Pair visit.
      // So intentionally no-op here.
      if (isMap(valNode)) return
    },
  })
  return { replaced }
}
