// POST /api/lint — accepts a YAML document, runs the shared linter suite
// against it, and returns `{ issues: Issue[] }`. Pure-function endpoint: no
// filesystem I/O, no config locking, safe to call on any doc (including
// ones that aren't the live config).
//
// Auth: none yet. Task 17 wraps the whole server in Basic Auth middleware.
// Until then the endpoint is open on LAN (router-fw blocks WAN anyway).
//
// Error shape for invalid YAML mirrors the UI contract sketched in the spec:
//   { code: 'YAML_PARSE_ERROR', errors: [{ message, line?, col? }] }
// with HTTP 400. `line` / `col` come from yaml@2's LinePos on the parse
// error's `.linePos[0]` (present on most syntax errors; absent on a few
// deeper parser bailouts, in which case we drop them).
//
// Schema-validation failures (wrong body shape) get the same `{code, errors}`
// envelope with `code: 'BAD_REQUEST'` and HTTP 400 — consistent with the
// YAML-parse path so UIs have a single decode rule.

import { Elysia, t } from 'elysia'
import { parseDocument } from 'yaml'
import { runSharedLinters } from 'miharbor-shared'

export const lintRoutes = new Elysia({ prefix: '/api/lint' })
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      const message = error instanceof Error ? error.message : String(error)
      return {
        code: 'BAD_REQUEST',
        errors: [{ message: message || 'Invalid request body' }],
      }
    }
    // Other error codes (NOT_FOUND, PARSE, INTERNAL_SERVER_ERROR, …) bubble
    // up to Elysia's default handler — we only intercept schema validation.
    return undefined
  })
  .post(
    '/',
    ({ body, set }) => {
      try {
        const doc = parseDocument(body.yaml, { prettyErrors: true })
        if (doc.errors.length > 0) {
          set.status = 400
          return {
            code: 'YAML_PARSE_ERROR',
            errors: doc.errors.map((e) => {
              const linePos = e.linePos?.[0]
              return {
                message: e.message,
                line: linePos?.line,
                col: linePos?.col,
              }
            }),
          }
        }
        return { issues: runSharedLinters(doc) }
      } catch (e) {
        // Covers anything the parser throws synchronously — usually a malformed
        // document that skipped the `errors` array (rare). Fall back to 400.
        set.status = 400
        return {
          code: 'YAML_PARSE_ERROR',
          message: e instanceof Error ? e.message : String(e),
        }
      }
    },
    { body: t.Object({ yaml: t.String() }) },
  )
