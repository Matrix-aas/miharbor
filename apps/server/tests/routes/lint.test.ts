// Integration test for POST /api/lint. Boots a fresh Elysia app per test and
// drives it via `app.handle(new Request(...))` — same code path a real HTTP
// client would hit. No port binding, no fixtures beyond the golden config.

import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { lintRoutes } from '../../src/routes/lint.ts'
import type { Issue } from 'miharbor-shared'

const newApp = () => new Elysia().use(lintRoutes())

// Small helper — POST {yaml} to /api/lint and return the parsed JSON body
// plus the response status so tests can assert on both.
async function postLint(
  app: ReturnType<typeof newApp>,
  bodyJson: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.handle(
    new Request('http://localhost/api/lint/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyJson),
    }),
  )
  const body = (await res.json()) as Record<string, unknown>
  return { status: res.status, body }
}

// --- basic contract -------------------------------------------------------

test('POST /api/lint returns { issues: [] } for a healthy minimal config', async () => {
  const app = newApp()
  const yaml = [
    'mode: rule',
    'interface-name: eth0',
    'dns: { listen: 127.0.0.1:1053 }',
    'tun: { enable: true }',
    'proxies: []',
    'proxy-groups: []',
    'rules:',
    '  - MATCH,DIRECT',
  ].join('\n')
  const { status, body } = await postLint(app, { yaml })
  expect(status).toBe(200)
  expect(body.issues).toBeDefined()
  expect(Array.isArray(body.issues)).toBe(true)
  expect(body.issues).toEqual([])
})

test('POST /api/lint surfaces issues from every shared linter', async () => {
  const app = newApp()
  // One issue from each linter family:
  //   - tun.enable without interface-name → invariants
  //   - DOMAIN-SUFFIX shadow → unreachable
  //   - rule references non-existent group → duplicates (dangling)
  const yaml = [
    'tun: { enable: true }',
    'dns: { listen: 127.0.0.1:1053 }',
    'proxy-groups:',
    '  - {name: A, type: select, proxies: [DIRECT]}',
    'rules:',
    '  - DOMAIN-SUFFIX,com,A',
    '  - DOMAIN-SUFFIX,example.com,A',
    '  - DOMAIN-SUFFIX,other.com,Ghost',
  ].join('\n')
  const { status, body } = await postLint(app, { yaml })
  expect(status).toBe(200)
  const issues = body.issues as Issue[]
  expect(issues.length).toBeGreaterThan(0)
  expect(issues.some((i) => i.code === 'INVARIANT_TUN_NEEDS_INTERFACE')).toBe(true)
  expect(issues.some((i) => i.code === 'LINTER_UNREACHABLE_RULE')).toBe(true)
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_GROUP_REFERENCE')).toBe(true)
})

// --- error paths ----------------------------------------------------------

test('POST /api/lint returns 400 + YAML_PARSE_ERROR on invalid YAML', async () => {
  const app = newApp()
  const { status, body } = await postLint(app, { yaml: 'invalid: : yaml' })
  expect(status).toBe(400)
  expect(body.code).toBe('YAML_PARSE_ERROR')
  // errors array (structured per-error) present when yaml.errors is populated
  expect(Array.isArray(body.errors)).toBe(true)
  expect((body.errors as unknown[]).length).toBeGreaterThan(0)
})

test('POST /api/lint rejects missing yaml field with BAD_REQUEST envelope', async () => {
  const app = newApp()
  const { status, body } = await postLint(app, { notYaml: 'oops' })
  expect(status).toBe(400)
  expect(body.code).toBe('BAD_REQUEST')
  expect(Array.isArray(body.errors)).toBe(true)
  expect((body.errors as unknown[]).length).toBeGreaterThan(0)
})

test('POST /api/lint rejects wrong-typed yaml field with BAD_REQUEST envelope', async () => {
  const app = newApp()
  const { status, body } = await postLint(app, { yaml: 42 })
  expect(status).toBe(400)
  expect(body.code).toBe('BAD_REQUEST')
  expect(Array.isArray(body.errors)).toBe(true)
})

// --- golden fixture baseline ---------------------------------------------

test('runs cleanly on the golden production-shaped fixture', async () => {
  const fixturePath = join(import.meta.dir, '..', 'fixtures', 'config-golden.yaml')
  const yaml = await readFile(fixturePath, 'utf8')
  const app = newApp()
  const { status, body } = await postLint(app, { yaml })
  expect(status).toBe(200)
  const issues = body.issues as Issue[]
  // Sanity-check invariants: no parse errors, issue list is an array. We
  // don't pin the exact count — if the linter gets smarter, the golden
  // fixture may legitimately grow warnings — but the count should stay in
  // a reasonable range so we notice accidental explosions.
  expect(Array.isArray(issues)).toBe(true)
  expect(issues.some((i) => i.code === 'LINTER_RULE_PARSE_ERROR')).toBe(false)
  expect(issues.length).toBeLessThan(200) // generous ceiling, alarm on 10× growth
  // Every issue has the right shape.
  for (const i of issues) {
    expect(typeof i.code).toBe('string')
    expect(['error', 'warning', 'info']).toContain(i.level)
    expect(Array.isArray(i.path)).toBe(true)
  }
})
