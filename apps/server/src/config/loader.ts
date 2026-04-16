// Config loader — reads a mihomo YAML file from disk and returns a
// canonicalized Document + metadata. Pairs with `canonicalize.ts`.
//
// Loader is deliberately thin: no schema validation, no linting. Those are
// separate layers (typebox validation and the shared linter). Here we only
// produce: (a) a parsed Document ready to mutate, (b) the canonical text for
// immediate write-back if `wasCanonicalized` is true, (c) an sha256 of the
// raw on-disk bytes for concurrent-write detection (see spec §5 "hash at load
// + re-check under lock").

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Document } from 'yaml'
import { canonicalize } from './canonicalize.ts'

export interface LoadedConfig {
  /** Parsed Document, already re-parsed from canonical text. */
  doc: Document
  /** Canonical serialized text. `=== rawOnDisk` iff `wasCanonicalized === false`. */
  text: string
  /** sha256 of the raw bytes exactly as read from disk (not canonical). Used
   *  by the deploy pipeline to detect external edits between load and write. */
  originalHash: string
  /** True iff the canonicalization changed anything. Triggers a one-time
   *  "format-only" migration snapshot in the deploy pipeline. */
  wasCanonicalized: boolean
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  const raw = await readFile(path, 'utf8')
  const originalHash = createHash('sha256').update(raw).digest('hex')
  const { doc, text } = canonicalize(raw)
  return {
    doc,
    text,
    originalHash,
    wasCanonicalized: text !== raw,
  }
}

export { serialize, DUMP_OPTS, YamlLoadError } from './canonicalize.ts'
