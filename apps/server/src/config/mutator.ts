// Mutator — apply structured edits to a yaml.Document while preserving
// comments, key order and scalar style. Entry point for every UI-driven
// change (rename a service, add a rule, flip a DNS provider, …).
//
// Stage 1 ships a minimal surface; richer operations arrive in Task 15+.
// Keep the API stable now so the deploy pipeline can depend on it.

import type { Document, Node } from 'yaml'
import { isCollection, isScalar } from 'yaml'
import type { Rule } from 'miharbor-shared'
import { serializeRule } from 'miharbor-shared'

export interface MutatorCtx {
  doc: Document
}

/** Set a scalar (path is a yaml path; value is any JS value). Creates missing
 *  intermediate maps. */
export function setScalar(ctx: MutatorCtx, path: (string | number)[], value: unknown): void {
  ctx.doc.setIn(path, value)
}

/** Delete the node at `path`. True no-op if any intermediate path segment is
 *  missing or is not a collection — matches the JSDoc contract above yaml@2's
 *  stricter `deleteIn`, which throws on non-collection intermediate nodes. */
export function deleteAt(ctx: MutatorCtx, path: (string | number)[]): void {
  try {
    ctx.doc.deleteIn(path)
  } catch {
    // yaml@2 throws "Expected YAML collection at …" when an intermediate path
    // segment resolves to a scalar (or is missing in certain shapes). The
    // contract here is "delete if present; no-op otherwise", so we swallow.
  }
}

/** Insert a rule into the top-level `rules:` array at `atIndex`. If the list
 *  doesn't exist yet it is created. `atIndex === -1` means "append"; any other
 *  negative value is rejected. */
export function insertRule(ctx: MutatorCtx, rule: Rule, atIndex = -1): void {
  // Guard against the foot-gun where `-2` silently appends — only the
  // documented sentinel `-1` is allowed for "end of list".
  if (atIndex !== -1 && atIndex < 0) {
    throw new Error(`insertRule: negative index ${atIndex} not allowed (use -1 for append)`)
  }
  const raw = serializeRule(rule)
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) {
    // Wrap in createNode so we get a YAMLSeq — plain JS arrays don't traverse
    // through `getIn(['rules', 0])`.
    ctx.doc.setIn(['rules'], ctx.doc.createNode([raw]))
    return
  }
  const coll = rules as { items: unknown[] }
  if (atIndex === -1 || atIndex >= coll.items.length) {
    coll.items.push(ctx.doc.createNode(raw) as unknown)
  } else {
    coll.items.splice(atIndex, 0, ctx.doc.createNode(raw) as unknown)
  }
}

/** Replace the rule at `index`. Throws if `rules:` is missing or out of range. */
export function replaceRule(ctx: MutatorCtx, index: number, rule: Rule): void {
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) {
    throw new Error('mutator: rules array missing or not a sequence')
  }
  const coll = rules as { items: unknown[] }
  if (index < 0 || index >= coll.items.length) {
    throw new Error(`mutator: rule index ${index} out of bounds (length=${coll.items.length})`)
  }
  coll.items[index] = ctx.doc.createNode(serializeRule(rule)) as unknown
}

/** Remove the rule at `index`. Throws if `rules:` is missing or out of range.
 *  (Symmetric with replaceRule — the previous silent-no-op on missing `rules:`
 *  was a footgun because it hid typos in call sites.) */
export function removeRule(ctx: MutatorCtx, index: number): void {
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) {
    throw new Error('mutator: rules array missing or not a sequence')
  }
  const coll = rules as { items: unknown[] }
  if (index < 0 || index >= coll.items.length) {
    throw new Error(`mutator: rule index ${index} out of bounds (length=${coll.items.length})`)
  }
  coll.items.splice(index, 1)
}

/** Read back the raw string for a rule at `index` (diagnostic helper). */
export function getRuleRaw(ctx: MutatorCtx, index: number): string | null {
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) return null
  const coll = rules as { items: unknown[] }
  const item = coll.items[index]
  if (item === undefined) return null
  if (isScalar(item as Node)) return String((item as { value: unknown }).value)
  return String(item)
}
