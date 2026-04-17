// /api/invariants — user-defined invariants CRUD (Task 41).
//
// GET  /api/invariants       → { invariants: UserInvariant[], errors: [...] }
// PUT  /api/invariants       → replaces the list; body { invariants: [...] }
//
// Storage: `${MIHARBOR_DATA_DIR}/invariants.yaml`. The file is written
// atomically (temp sibling + rename) so a crash mid-write can't leave a
// partial YAML document on disk. Malformed entries in the PUT body are
// rejected with 400 + BAD_REQUEST; the file is only written if EVERY entry
// parses.
//
// The route exposes a `loadUserInvariants()` helper that server-bootstrap
// calls at startup so the linter aggregator gets the compiled list without
// re-reading the file on every /api/lint request.

import { Elysia, t } from 'elysia'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import crypto from 'node:crypto'
import type { Logger } from '../observability/logger.ts'
import { parseUserInvariants, type UserInvariant } from 'miharbor-shared'

export interface InvariantsRoutesDeps {
  /** Data dir resolved from env at bootstrap time. */
  dataDir: string
  /** Logger for parse / write failures. */
  logger: Logger
  /** In-memory holder updated whenever PUT succeeds so the linter sees the
   *  new rules without a server restart. Same reference is passed to
   *  runSharedLinters via a getter in server-bootstrap. */
  state: { current: UserInvariant[] }
}

/** Filename (inside $MIHARBOR_DATA_DIR) where the operator's invariants live. */
export const INVARIANTS_FILE = 'invariants.yaml'

/** Atomic write helper — mirror of local-fs.ts's private one. We keep a
 *  dedicated copy here to avoid a cross-module dependency on the transport
 *  layer (which owns the mihomo config, not this file). */
async function atomicWriteFile(targetPath: string, data: string, mode = 0o600): Promise<void> {
  const dir = dirname(targetPath)
  const tmp = join(dir, `.${crypto.randomUUID()}.miharbor.tmp`)
  const fh = await fsp.open(tmp, 'w', mode)
  try {
    await fh.writeFile(data, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, targetPath)
  try {
    await fsp.chmod(targetPath, mode)
  } catch {
    /* non-fatal — see local-fs.ts */
  }
}

/** Load invariants from disk. Missing file → empty list. Malformed YAML →
 *  empty list + warning log. Individual entry failures are absorbed by
 *  parseUserInvariants and returned as `errors` for UI surfacing. */
export async function loadUserInvariants(
  dataDir: string,
  logger: Logger,
): Promise<{ invariants: UserInvariant[]; errors: Array<{ index: number; message: string }> }> {
  const path = join(dataDir, INVARIANTS_FILE)
  let raw: string
  try {
    raw = await fsp.readFile(path, 'utf8')
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { invariants: [], errors: [] }
    }
    logger.warn({
      msg: 'invariants.yaml: read failed — proceeding with empty list',
      path,
      error: (e as Error).message,
    })
    return { invariants: [], errors: [] }
  }
  if (raw.trim().length === 0) {
    return { invariants: [], errors: [] }
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (e) {
    logger.warn({
      msg: 'invariants.yaml: YAML parse failed — proceeding with empty list',
      path,
      error: (e as Error).message,
    })
    return { invariants: [], errors: [{ index: -1, message: (e as Error).message }] }
  }
  return parseUserInvariants(parsed)
}

/** Serialise a validated list back to YAML. We use the parse-then-stringify
 *  round-trip rather than hand-concatenating so the YAML formatting is
 *  stable across writes (sorts by insertion order, preserves null vs ''). */
export function serializeInvariants(invariants: UserInvariant[]): string {
  // Build a plain JS object so yaml@2 can canonicalise.
  const doc = { invariants }
  return stringifyYaml(doc, { lineWidth: 0 })
}

export function invariantsRoutes(deps: InvariantsRoutesDeps) {
  const path = join(deps.dataDir, INVARIANTS_FILE)

  return new Elysia({ prefix: '/api/invariants' })
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') {
        set.status = 400
        const message = error instanceof Error ? error.message : String(error)
        return {
          code: 'BAD_REQUEST',
          errors: [{ message: message || 'Invalid request body' }],
        }
      }
      return undefined
    })
    .get('/', async () => {
      // Always re-read from disk so a sibling process / manual edit is
      // reflected without a restart. The in-memory `state` is the linter's
      // fast path; the API surface returns fresh data.
      const loaded = await loadUserInvariants(deps.dataDir, deps.logger)
      // Sync state so the linter stays consistent with what the UI shows.
      deps.state.current = loaded.invariants
      return { invariants: loaded.invariants, errors: loaded.errors }
    })
    .put(
      '/',
      async ({ body, set }) => {
        // Validate the whole list up-front. Partial success is not offered —
        // either every entry is acceptable or we refuse, so the operator
        // doesn't discover half their file silently dropped.
        const parseResult = parseUserInvariants(body)
        if (parseResult.errors.length > 0) {
          set.status = 400
          return {
            code: 'BAD_REQUEST',
            errors: parseResult.errors.map((e) => ({
              message: `invariant ${e.index}: ${e.message}`,
            })),
          }
        }
        try {
          const yaml = serializeInvariants(parseResult.invariants)
          await atomicWriteFile(path, yaml, 0o600)
        } catch (e) {
          deps.logger.error({
            msg: 'invariants.yaml: write failed',
            path,
            error: (e as Error).message,
          })
          set.status = 500
          return { code: 'WRITE_FAILED', message: (e as Error).message }
        }
        deps.state.current = parseResult.invariants
        return { ok: true, invariants: parseResult.invariants }
      },
      {
        body: t.Object({
          invariants: t.Array(t.Unknown()),
        }),
      },
    )
}
