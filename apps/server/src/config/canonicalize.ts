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

/**
 * Structured YAML parse failure. Thrown by `canonicalize` when the raw input
 * has syntactic errors (yaml@2's `doc.errors` non-empty). Contains every
 * collected error with line/column when available, so API callers can surface
 * a useful payload instead of a generic "Document with errors cannot be
 * stringified" exception.
 */
export class YamlLoadError extends Error {
  public readonly errors: Array<{ message: string; line?: number; col?: number }>
  constructor(
    errors: Array<{ message: string; line?: number; col?: number }>,
    message = 'YAML parse failed',
  ) {
    super(message)
    this.name = 'YamlLoadError'
    this.errors = errors
  }
}

type YamlParseError = {
  message: string
  linePos?: Array<{ line: number; col: number }>
  pos?: [number, number]
}

function mapYamlError(err: YamlParseError): { message: string; line?: number; col?: number } {
  // yaml@2 populates `linePos` on most parse errors (prettyErrors is the
  // expensive path; we want positions even without it — hence the pos fallback
  // is intentionally absent, the tuple `pos` is an offset, not a coordinate).
  const first = err.linePos?.[0]
  return {
    message: err.message,
    line: first?.line,
    col: first?.col,
  }
}

/** Parse raw YAML and emit a canonical string + re-parsed Document. Throws
 *  `YamlLoadError` with structured diagnostics when the parser collects any
 *  errors (so callers never have to `try { doc.toString() } catch`). */
export function canonicalize(rawYaml: string): CanonicalizeResult {
  const doc = parseDocument(rawYaml, { prettyErrors: true })
  if (doc.errors.length > 0) {
    throw new YamlLoadError(doc.errors.map((e) => mapYamlError(e as unknown as YamlParseError)))
  }
  const text = doc.toString(DUMP_OPTS)
  // Re-parse the canonical text so downstream mutations serialize identically.
  return { doc: parseDocument(text), text }
}

/** Serialize an in-memory Document with the canonical options. */
export function serialize(doc: Document): string {
  return doc.toString(DUMP_OPTS)
}
