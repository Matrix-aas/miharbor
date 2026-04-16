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

/** Delete the node at `path`. No-op if missing. */
export function deleteAt(ctx: MutatorCtx, path: (string | number)[]): void {
  ctx.doc.deleteIn(path)
}

/** Insert a rule into the top-level `rules:` array at `atIndex`. If the list
 *  doesn't exist yet it is created. `atIndex === -1` means "append". */
export function insertRule(ctx: MutatorCtx, rule: Rule, atIndex = -1): void {
  const raw = serializeRule(rule)
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) {
    // Wrap in createNode so we get a YAMLSeq — plain JS arrays don't traverse
    // through `getIn(['rules', 0])`.
    ctx.doc.setIn(['rules'], ctx.doc.createNode([raw]))
    return
  }
  const coll = rules as { items: unknown[] }
  if (atIndex < 0 || atIndex >= coll.items.length) {
    coll.items.push(ctx.doc.createNode(raw) as unknown)
  } else {
    coll.items.splice(atIndex, 0, ctx.doc.createNode(raw) as unknown)
  }
}

/** Replace the rule at `index`. Throws if out of range. */
export function replaceRule(ctx: MutatorCtx, index: number, rule: Rule): void {
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) {
    throw new Error('mutator: rules array missing')
  }
  const coll = rules as { items: unknown[] }
  if (index < 0 || index >= coll.items.length) {
    throw new Error(`mutator: rule index ${index} out of range (len=${coll.items.length})`)
  }
  coll.items[index] = ctx.doc.createNode(serializeRule(rule)) as unknown
}

/** Remove the rule at `index`. Throws if out of range. */
export function removeRule(ctx: MutatorCtx, index: number): void {
  const rules = ctx.doc.getIn(['rules']) as unknown
  if (!rules || !isCollection(rules as Node)) return
  const coll = rules as { items: unknown[] }
  if (index < 0 || index >= coll.items.length) {
    throw new Error(`mutator: rule index ${index} out of range (len=${coll.items.length})`)
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
