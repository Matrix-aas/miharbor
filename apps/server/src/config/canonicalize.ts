// YAML canonicalizer — parses a mihomo config file into a yaml.Document and
// emits a canonically-formatted string with comments, key order and nesting
// preserved. Idempotent: after the first canonicalization, re-running it
// yields the exact same bytes. Serializer options come from the PoC
// (docs/superpowers/poc-yaml/stability.ts:8-15) which was validated against
// the production config-server.yaml.
//
// Why canonicalize? yaml@2.x doesn't preserve column-alignment inside flow
// mappings (e.g. `{name: 'Gemini',     type: select, ...}` collapses to
// `{name: 'Gemini', type: select, ...}`) and loses runs of multiple spaces
// before inline comments. If we don't normalize up front, the *first* mutation
// produces a visually noisy diff. A one-time canonicalization flattens this
// into a trackable, idempotent format and then every subsequent mutation
// shows a precise +N/-M line diff.

import { parseDocument, type Document, type ToStringOptions } from 'yaml'

// I use `satisfies` to keep TS on-side with yaml's overload signatures while
// still letting the caller hand the opts straight to `doc.toString`.
export const DUMP_OPTS = {
  lineWidth: 0,
  minContentWidth: 0,
  flowCollectionPadding: false,
  defaultStringType: 'PLAIN' as const,
  defaultKeyType: 'PLAIN' as const,
  doubleQuotedMinMultiLineLength: 999999,
} satisfies ToStringOptions

export interface CanonicalizeResult {
  /** The re-parsed Document (parsed from the canonical text). Safe to mutate
   *  — its output will flow through the same serializer. */
  doc: Document
  /** The canonical text. Idempotent under canonicalize. */
  text: string
}

/** Parse raw YAML and emit a canonical string + re-parsed Document. */
export function canonicalize(rawYaml: string): CanonicalizeResult {
  const doc = parseDocument(rawYaml)
  const text = doc.toString(DUMP_OPTS)
  // Re-parse the canonical text so downstream mutations serialize identically.
  return { doc: parseDocument(text), text }
}

/** Serialize an in-memory Document with the canonical options. */
export function serialize(doc: Document): string {
  return doc.toString(DUMP_OPTS)
}
