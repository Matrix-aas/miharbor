// /api/deploy route tests — SSE deploy stream

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDraftStore } from '../../src/draft-store.ts'
import { deployRoutes } from '../../src/routes/deploy.ts'
import type { DeployContext } from '../../src/deploy/pipeline.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-deploy-routes-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function buildApp() {
  const draftStore = createDraftStore()
  const deployCtx = (): DeployContext => ({
    transport: {} as any,
    vault: {} as any,
    snapshots: {} as any,
    mihomoApi: {} as any,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    audit: {} as any,
    lockFile: '/tmp/test.lock',
  })
  const app = new Elysia().use(deployRoutes({ draftStore, deployCtx }))
  return { app, draftStore, deployCtx }
}

test('POST /api/deploy with no draft returns 400 NO_DRAFT', async () => {
  const { app } = buildApp()
  const r = await app.handle(new Request('http://localhost/api/deploy', { method: 'POST' }))
  expect(r.status).toBe(400)
  const body = (await r.json()) as { code: string }
  expect(body.code).toBe('NO_DRAFT')
})

test('POST /api/deploy with valid draft starts SSE stream', async () => {
  const { app, draftStore } = buildApp()
  // Store a draft
  draftStore.put('anonymous', 'mode: global\n')
  // POST deploy
  const r = await app.handle(new Request('http://localhost/api/deploy', { method: 'POST' }))
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('text/event-stream')
  const text = await r.text()
  // Should emit some SSE events
  expect(text).toContain('event:')
  expect(text).toContain(': miharbor-stream')
})
