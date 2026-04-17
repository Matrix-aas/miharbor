// /api/health/* route tests — health status, stream

import { beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { healthRoutes } from '../../src/routes/health.ts'
import type { HealthMonitor, HealthEvent } from '../../src/health-monitor.ts'

let monitor: HealthMonitor

beforeEach(() => {
  // Simple mock health monitor
  const statusEvent: HealthEvent = {
    type: 'mihomo-up',
    version: '1.19.23',
    ts: new Date().toISOString(),
  }
  monitor = {
    subscribe: (callback: (event: HealthEvent) => void) => {
      // Immediately emit a status event
      callback(statusEvent)
      // Return unsubscribe
      return () => {}
    },
    emit: () => {},
    getStatus: () => statusEvent,
    stop: () => {},
  }
})

function buildApp() {
  return new Elysia().use(healthRoutes({ monitor }))
}

test('GET /api/health/ returns current health', async () => {
  const app = buildApp()
  const r = await app.handle(new Request('http://localhost/api/health/'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as {
    status: string
    mihomo?: { ok: boolean }
    transport?: { ok: boolean }
  }
  expect(body.status).toBeDefined()
})

test('GET /api/health/stream returns Response with correct headers', () => {
  const app = buildApp()
  // Don't await the full text read since the stream never closes
  const req = new Request('http://localhost/api/health/stream')
  // Just verify the response status and headers are correct
  const res = app.handle(req).then((r) => {
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    return r
  })
  return res
})
