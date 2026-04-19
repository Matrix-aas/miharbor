// /api/config/* route tests. Uses the real Elysia app wired with Basic Auth
// DISABLED so we can assert GETs without constructing Basic credentials
// repeatedly.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createDraftStore } from '../../src/draft-store.ts'
import { createVault } from '../../src/vault/vault.ts'
import { configRoutes } from '../../src/routes/config.ts'
import type { AuditLog, AuditRecord } from '../../src/observability/audit-log.ts'

const GOLDEN_CFG = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
const REAL_LOOKING_KEY = 'kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo='
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-cfg-routes-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function buildApp() {
  const transport = new InMemoryTransport({ initialConfig: GOLDEN_CFG })
  const draftStore = createDraftStore()
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  const auditRecords: AuditRecord[] = []
  const audit: AuditLog = {
    async record(r) {
      auditRecords.push(r)
    },
  }
  const app = new Elysia().use(configRoutes({ transport, draftStore, vault, logger, audit }))
  return { app, transport, draftStore, vault, auditRecords }
}

test('GET /api/config/services returns Service[]', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/services'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<{ name: string; direction: string }>
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
  expect(body.some((s) => s.name === 'Google')).toBe(true)
})

test('GET /api/config/proxies returns ProxyNode[]', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/proxies'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<{ name: string; type: string }>
  expect(body.some((p) => p.type === 'wireguard')).toBe(true)
})

test('GET /api/config/proxies MASKS WireGuard key material with key-shaped sentinels (v0.2.4)', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/proxies'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as Array<
    Record<string, unknown> & { type: string; 'private-key'?: string; 'pre-shared-key'?: string }
  >
  const wg = body.find((p) => p.type === 'wireguard')
  expect(wg).toBeDefined()
  // Real bytes from the golden fixture NEVER reach the response.
  const rawText = await (
    await app.handle(new Request('http://localhost/api/config/proxies'))
  ).text()
  expect(rawText).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
  expect(rawText).not.toContain('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=')
  // Sentinels (44 base64 chars) surface instead.
  expect(wg!['private-key']).toBe('MIHARBORMASKEDPRIVATEKEYREENTERTOCHANGE1234=')
  expect(wg!['pre-shared-key']).toBe('MIHARBORMASKEDPRESHAREDKEYREENTERTOCHANGE12=')
})

test('GET /api/config/meta returns top-level settings', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/meta'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { mode?: string }
  expect(body.mode).toBe('rule')
})

test('GET /api/config/meta MASKS secret with META_SECRET_SENTINEL (v0.2.4)', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/meta'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { secret?: string }
  // Real golden secret value NEVER leaks via /meta.
  expect(body.secret).not.toBe('0000000000000000000000000000000000000000000000000000000000000000')
  // Sentinel surfaces instead so the SPA can disable reveal.
  expect(body.secret).toBe('__MIHARBOR_SECRET_SET_NOT_SHOWN__')
})

test('GET /api/config/raw returns MASKED YAML (H4)', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/raw'))
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('text/plain')
  expect(r.headers.get('x-miharbor-masked')).toBe('true')
  const text = await r.text()
  // Non-secret content preserved.
  expect(text).toContain('mode: rule')
  // Secret content (private-key from the WG node) is REPLACED with a sentinel.
  expect(text).not.toContain(REAL_LOOKING_KEY)
  expect(text).toContain('$MIHARBOR_VAULT:')
})

test('PUT /api/config/draft stores + GET /api/config/draft returns it', async () => {
  const { app, draftStore } = await buildApp()
  const putR = await app.handle(
    new Request('http://localhost/api/config/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: 'mode: global\n' }),
    }),
  )
  expect(putR.status).toBe(200)
  const putBody = (await putR.json()) as { ok: boolean }
  expect(putBody.ok).toBe(true)

  const getR = await app.handle(new Request('http://localhost/api/config/draft'))
  const body = (await getR.json()) as { source: string; text: string }
  expect(body.source).toBe('draft')
  expect(body.text).toBe('mode: global\n')
  // Draft store now has 1 entry under 'anonymous'.
  expect(draftStore.size()).toBe(1)
})

test('GET /api/config/draft falls back to live config when no draft', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/draft'))
  const body = (await r.json()) as { source: string; text: string }
  expect(body.source).toBe('current')
  expect(body.text).toContain('mode: rule')
})

test('GET /api/config/draft live-fallback masks secrets, matching /raw byte-for-byte', async () => {
  // Regression guard for v0.2.3: without masking, draftText !== rawLive on
  // every secret line (proxy private-key, mihomo `secret:` Bearer, …) and
  // the SPA's `dirtyCount` trips on fresh login before the operator has
  // touched anything. Both endpoints must return the same masked YAML when
  // no per-user draft exists.
  const { app } = await buildApp()
  const rawR = await app.handle(new Request('http://localhost/api/config/raw'))
  const rawText = await rawR.text()
  const draftR = await app.handle(new Request('http://localhost/api/config/draft'))
  const draftBody = (await draftR.json()) as { source: string; text: string }

  expect(draftBody.source).toBe('current')
  // Secret fields in the golden fixture must be sentinels in the draft too.
  expect(draftBody.text).not.toContain(REAL_LOOKING_KEY)
  expect(draftBody.text).toContain('$MIHARBOR_VAULT:')
  // And the vault-worthy mihomo `secret:` (Bearer token) is also masked —
  // it was `'00...00'` (64 zero-hex) in the fixture; after masking the raw
  // value is gone.
  expect(draftBody.text).not.toContain(
    "secret: '0000000000000000000000000000000000000000000000000000000000000000'",
  )
  // Byte-identical with /raw so `dirtyCount` == 0 on fresh login.
  expect(draftBody.text).toBe(rawText)
})

test('DELETE /api/config/draft clears the draft', async () => {
  const { app, draftStore } = await buildApp()
  await app.handle(
    new Request('http://localhost/api/config/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: 'mode: global\n' }),
    }),
  )
  expect(draftStore.size()).toBe(1)
  await app.handle(new Request('http://localhost/api/config/draft', { method: 'DELETE' }))
  expect(draftStore.size()).toBe(0)
})

test('GET /api/config/draft migrates legacy public-key sentinels (v0.2.5)', async () => {
  const { app, draftStore, vault, auditRecords } = await buildApp()
  const user = 'anonymous'
  const realKey = 'ABCdef123456789012345678901234567890abcdEF='
  const uuid = await vault.store(realKey)
  const legacyDraft = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuid}\n`
  draftStore.put(user, legacyDraft)

  const r = await app.handle(new Request('http://localhost/api/config/draft'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { source: string; text: string }
  expect(body.source).toBe('draft')
  expect(body.text).toContain(`public-key: ${realKey}`)
  expect(body.text).not.toContain('$MIHARBOR_VAULT:')

  // DraftStore was updated so subsequent reads don't re-migrate.
  const stored = draftStore.get(user)
  expect(stored?.text).toContain(realKey)
  expect(stored?.text).not.toContain('$MIHARBOR_VAULT:')

  // Audit log recorded the migration with an accurate count.
  expect(auditRecords).toHaveLength(1)
  const rec = auditRecords[0]!
  expect(rec.action).toBe('migrate')
  expect(rec.user).toBe(user)
  expect((rec.extra as { target: string; count: number }).target).toBe('public-key')
  expect((rec.extra as { target: string; count: number }).count).toBe(1)
})

test('GET /api/config/draft is idempotent — no second migrate after already-clean draft', async () => {
  const { app, draftStore, vault, auditRecords } = await buildApp()
  const user = 'anonymous'
  const realKey = 'ABCdef123456789012345678901234567890abcdEF='
  const uuid = await vault.store(realKey)

  // First GET migrates the legacy sentinel.
  draftStore.put(user, `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuid}\n`)
  await app.handle(new Request('http://localhost/api/config/draft'))
  const firstUpdated = draftStore.get(user)!.updated

  // Second GET on the now-clean draft should NOT call draftStore.put again.
  await app.handle(new Request('http://localhost/api/config/draft'))
  expect(draftStore.get(user)!.updated).toBe(firstUpdated)
  // And only one audit record total.
  expect(auditRecords).toHaveLength(1)
})

test('GET /api/config/draft: non-legacy draft triggers no migration or audit', async () => {
  const { app, draftStore, auditRecords } = await buildApp()
  const user = 'anonymous'
  const cleanDraft = `mode: rule\nproxies:\n  - name: wg1\n    public-key: real=\n`
  draftStore.put(user, cleanDraft)
  const before = draftStore.get(user)!.updated

  await app.handle(new Request('http://localhost/api/config/draft'))
  const after = draftStore.get(user)!.updated
  expect(after).toBe(before) // put() never called — `updated` unchanged
  expect(auditRecords).toHaveLength(0)
})

test('GET /api/config/draft/diff returns empty patch when no draft exists', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/draft/diff'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as {
    patch: string
    added: number
    removed: number
    hasDraft: boolean
  }
  expect(body.hasDraft).toBe(false)
  expect(body.patch).toBe('')
  expect(body.added).toBe(0)
  expect(body.removed).toBe(0)
})

test('GET /api/config/draft/diff returns unified patch with line counters', async () => {
  const { app, draftStore } = await buildApp()
  // Grab the masked live text (same form the UI sees) and build a draft that
  // changes one scalar. Using the existing /draft endpoint to get the masked
  // bytes avoids coupling the test to the internal mask memoisation.
  const liveR = await app.handle(new Request('http://localhost/api/config/draft'))
  const liveBody = (await liveR.json()) as { text: string }
  const live = liveBody.text
  const draft = live.replace('mode: rule', 'mode: global')
  draftStore.put('anonymous', draft)

  const r = await app.handle(new Request('http://localhost/api/config/draft/diff'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as {
    patch: string
    added: number
    removed: number
    hasDraft: boolean
  }
  expect(body.hasDraft).toBe(true)
  expect(body.patch).toContain('--- live')
  expect(body.patch).toContain('+++ draft')
  expect(body.patch).toContain('-mode: rule')
  expect(body.patch).toContain('+mode: global')
  expect(body.added).toBe(1)
  expect(body.removed).toBe(1)
})

test('draft/diff is empty when the draft is a byte-identical copy of live (v0.2.8)', async () => {
  // Canonicalization symmetry contract — if the UI just seeded the draft
  // from /draft (or /raw), serialised it back without changing anything,
  // and PUT it, /draft/diff MUST report an empty patch. Any diff here is
  // a round-trip formatting bug that scares operators away from saving.
  const { app, draftStore } = await buildApp()
  const liveR = await app.handle(new Request('http://localhost/api/config/draft'))
  const live = ((await liveR.json()) as { text: string }).text
  draftStore.put('anonymous', live) // identical copy — no edit
  const r = await app.handle(new Request('http://localhost/api/config/draft/diff'))
  const body = (await r.json()) as { patch: string; added: number; removed: number }
  expect(body.patch).toBe('')
  expect(body.added).toBe(0)
  expect(body.removed).toBe(0)
})

test('draft/diff stays empty after parse→serialize round-trip through the web mutator (v0.2.8)', async () => {
  // Real user path: the SPA parses the live YAML into a yaml.Document,
  // applies zero mutations, serialises it back and PUTs. With canonical
  // DUMP_OPTS shared across server/web, the bytes must match.
  const { app, draftStore } = await buildApp()
  const { parseDocument } = await import('yaml')
  const { DUMP_OPTS } = await import('miharbor-shared')
  const liveR = await app.handle(new Request('http://localhost/api/config/draft'))
  const live = ((await liveR.json()) as { text: string }).text
  const roundTripped = parseDocument(live).toString(DUMP_OPTS)
  expect(roundTripped).toBe(live) // canonical mask ⇔ canonical web serialize
  draftStore.put('anonymous', roundTripped)
  const r = await app.handle(new Request('http://localhost/api/config/draft/diff'))
  const body = (await r.json()) as { patch: string; added: number; removed: number }
  expect(body.patch).toBe('')
  expect(body.added).toBe(0)
  expect(body.removed).toBe(0)
})
