// /api/invariants route tests — Task 41.
//
// Covers:
//  * loadUserInvariants returns empty list for missing file.
//  * Malformed YAML on disk yields empty list + logged warning.
//  * GET returns the list (+ parse errors).
//  * PUT atomically writes a valid list and the written YAML round-trips
//    through parse again.
//  * PUT rejects malformed entries with 400 + BAD_REQUEST.
//  * In-memory state (shared with lint route) is updated on PUT.

import { afterEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../../src/observability/logger.ts'
import {
  INVARIANTS_FILE,
  invariantsRoutes,
  loadUserInvariants,
  serializeInvariants,
} from '../../src/routes/invariants.ts'
import type { UserInvariant } from 'miharbor-shared'

// --- test helpers ---------------------------------------------------------

function silentLogger() {
  return createLogger({ level: 'error', sink: () => undefined })
}

async function makeTempDir(label: string): Promise<string> {
  const dir = join('/tmp', `miharbor-invariants-${label}-${Math.random().toString(36).slice(2)}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

const cleanups: string[] = []
afterEach(async () => {
  while (cleanups.length > 0) {
    const d = cleanups.pop()!
    try {
      await fsp.rm(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

// --- loadUserInvariants ---------------------------------------------------

test('loadUserInvariants returns empty list when file is missing', async () => {
  const dir = await makeTempDir('missing')
  cleanups.push(dir)
  const res = await loadUserInvariants(dir, silentLogger())
  expect(res.invariants).toEqual([])
  expect(res.errors).toEqual([])
})

test('loadUserInvariants handles empty file gracefully', async () => {
  const dir = await makeTempDir('empty')
  cleanups.push(dir)
  await fsp.writeFile(join(dir, INVARIANTS_FILE), '', 'utf8')
  const res = await loadUserInvariants(dir, silentLogger())
  expect(res.invariants).toEqual([])
})

test('loadUserInvariants reports a warning for malformed YAML but still returns [] rather than throwing', async () => {
  const dir = await makeTempDir('malformed')
  cleanups.push(dir)
  // `:` with no key is a YAML syntax error.
  await fsp.writeFile(join(dir, INVARIANTS_FILE), ': :\n', 'utf8')
  const res = await loadUserInvariants(dir, silentLogger())
  expect(res.invariants).toEqual([])
  // An error is reported in the returned `errors` array — schema violation
  // OR parse error.
  expect(res.errors.length).toBeGreaterThan(0)
})

test('loadUserInvariants parses a valid file', async () => {
  const dir = await makeTempDir('valid')
  cleanups.push(dir)
  const invariants: UserInvariant[] = [
    {
      id: 'dns-listen',
      name: 'DNS listener',
      level: 'error',
      rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
    },
  ]
  await fsp.writeFile(join(dir, INVARIANTS_FILE), serializeInvariants(invariants), 'utf8')
  const res = await loadUserInvariants(dir, silentLogger())
  expect(res.invariants.length).toBe(1)
  expect(res.invariants[0]!.id).toBe('dns-listen')
})

// --- GET / PUT routes -----------------------------------------------------

function newApp(dir: string, state: { current: UserInvariant[] } = { current: [] }) {
  return new Elysia().use(invariantsRoutes({ dataDir: dir, logger: silentLogger(), state }))
}

test('GET /api/invariants returns { invariants: [], errors: [] } when no file exists', async () => {
  const dir = await makeTempDir('get-empty')
  cleanups.push(dir)
  const app = newApp(dir)
  const r = await app.handle(new Request('http://localhost/api/invariants'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { invariants: unknown[]; errors: unknown[] }
  expect(body.invariants).toEqual([])
  expect(body.errors).toEqual([])
})

test('PUT /api/invariants writes a valid list to disk and round-trips via GET', async () => {
  const dir = await makeTempDir('put-valid')
  cleanups.push(dir)
  const state: { current: UserInvariant[] } = { current: [] }
  const app = newApp(dir, state)
  const body = {
    invariants: [
      {
        id: 'wg-excluded',
        name: 'WG proxy excluded',
        level: 'error',
        rule: {
          kind: 'path-must-contain-all',
          path: 'tun.route-exclude-address',
          values: ['91.132.58.113/32'],
        },
      },
    ],
  }
  const putR = await app.handle(
    new Request('http://localhost/api/invariants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  expect(putR.status).toBe(200)
  const putBody = (await putR.json()) as { ok: true; invariants: UserInvariant[] }
  expect(putBody.ok).toBe(true)
  expect(putBody.invariants[0]!.id).toBe('wg-excluded')

  // State is updated so the linter picks it up.
  expect(state.current[0]!.id).toBe('wg-excluded')

  // File is on disk in valid YAML shape.
  const disk = await fsp.readFile(join(dir, INVARIANTS_FILE), 'utf8')
  expect(disk).toContain('wg-excluded')

  // GET reflects what we wrote.
  const getR = await app.handle(new Request('http://localhost/api/invariants'))
  expect(getR.status).toBe(200)
  const getBody = (await getR.json()) as { invariants: UserInvariant[] }
  expect(getBody.invariants.length).toBe(1)
  expect(getBody.invariants[0]!.rule.kind).toBe('path-must-contain-all')
})

test('PUT /api/invariants rejects malformed entries with 400 BAD_REQUEST', async () => {
  const dir = await makeTempDir('put-bad')
  cleanups.push(dir)
  const app = newApp(dir)
  const body = {
    invariants: [
      {
        // Missing `name` and bad `id` pattern.
        id: '  whitespace',
        rule: { kind: 'path-must-equal', path: 'x', value: 1 },
      },
    ],
  }
  const r = await app.handle(
    new Request('http://localhost/api/invariants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  expect(r.status).toBe(400)
  const got = (await r.json()) as { code: string; errors: Array<{ message: string }> }
  expect(got.code).toBe('BAD_REQUEST')
  expect(got.errors.length).toBeGreaterThan(0)

  // File was NOT written.
  const exists = await fsp
    .access(join(dir, INVARIANTS_FILE))
    .then(() => true)
    .catch(() => false)
  expect(exists).toBe(false)
})

test('PUT /api/invariants rejects a wrong-shape body (missing invariants key) via BAD_REQUEST', async () => {
  const dir = await makeTempDir('put-shape')
  cleanups.push(dir)
  const app = newApp(dir)
  const r = await app.handle(
    new Request('http://localhost/api/invariants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    }),
  )
  expect(r.status).toBe(400)
  const got = (await r.json()) as { code: string }
  expect(got.code).toBe('BAD_REQUEST')
})

test('PUT /api/invariants accepts empty list (clearing previous entries)', async () => {
  const dir = await makeTempDir('put-empty')
  cleanups.push(dir)
  // Seed with one invariant.
  await fsp.writeFile(
    join(dir, INVARIANTS_FILE),
    serializeInvariants([
      {
        id: 'seed',
        name: 'seed',
        rule: { kind: 'path-must-equal', path: 'x', value: 1 },
      },
    ]),
    'utf8',
  )
  const state: { current: UserInvariant[] } = { current: [] }
  const app = newApp(dir, state)
  const r = await app.handle(
    new Request('http://localhost/api/invariants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invariants: [] }),
    }),
  )
  expect(r.status).toBe(200)
  expect(state.current).toEqual([])
  const getR = await app.handle(new Request('http://localhost/api/invariants'))
  const body = (await getR.json()) as { invariants: unknown[] }
  expect(body.invariants).toEqual([])
})
