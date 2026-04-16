// Healthcheck tests — drive a mock MihomoApi and verify each of the 4
// phases in isolation. We use a fake clock + fake sleep so the tests don't
// wait 10s for phase 1 to time out.

import { expect, test } from 'bun:test'
import { runHealthcheck } from '../../src/deploy/healthcheck.ts'
import type { MihomoApi } from '../../src/mihomo/api-client.ts'

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

function makeApi(overrides: Partial<MihomoApi> = {}): MihomoApi {
  return {
    getVersion: async () => ({ version: 'test-1.0', premium: false }),
    reloadConfig: async () => {},
    listProxies: async () => ({}),
    getProxyDelay: async () => ({ delay: 42 }),
    listProviders: async () => ({}),
    refreshProvider: async () => {},
    listRules: async () => [{ type: 'MATCH', target: 'DIRECT' }],
    ...overrides,
  }
}

test('phase 1 success on first poll → immediately advances to phase 2', async () => {
  const clock = makeClock()
  const api = makeApi()
  const events: Array<{ phase: number; status: string }> = []
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
    onPhase: (phase, status) => {
      events.push({ phase, status })
    },
  })
  expect(result.ok).toBe(true)
  expect(result.failedPhase).toBeUndefined()
  const phase1Events = events.filter((e) => e.phase === 1)
  expect(phase1Events).toEqual([
    { phase: 1, status: 'running' },
    { phase: 1, status: 'completed' },
  ])
})

test('phase 1 fail: /version never responds within timeout → failedPhase=1', async () => {
  const clock = makeClock()
  const api = makeApi({
    getVersion: async () => {
      throw new Error('connection refused')
    },
  })
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
    phase1TimeoutMs: 1000, // shorter so it's quicker
  })
  expect(result.ok).toBe(false)
  expect(result.failedPhase).toBe(1)
  expect(result.diagnostics?.phase).toBe(1)
  expect(result.diagnostics?.lastError).toContain('connection refused')
})

test('phase 2 warn-only: rules never load → ok=true + diagnostic warning', async () => {
  const clock = makeClock()
  const api = makeApi({
    listRules: async () => [],
    listProviders: async () => ({}),
  })
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
    phase2TimeoutMs: 1000,
  })
  // Per spec, phase 2 is warn-only; overall ok=true
  expect(result.ok).toBe(true)
  expect(result.diagnostics?.phase).toBe(2)
  expect(result.diagnostics?.warning).toContain('rules-not-loaded')
})

test('phase 3 fail (delay-check fails) → failedPhase=3', async () => {
  const clock = makeClock()
  const api = makeApi({
    listProxies: async () => ({
      'health-check': { type: 'url-test' },
    }),
    getProxyDelay: async () => {
      throw new Error('gstatic probe failed')
    },
  })
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
  })
  expect(result.ok).toBe(false)
  expect(result.failedPhase).toBe(3)
  expect(result.diagnostics?.phase).toBe(3)
})

test('no url-test groups → phase 3 is a no-op success', async () => {
  const clock = makeClock()
  const api = makeApi({
    listProxies: async () => ({
      'my-select': { type: 'Selector' },
    }),
  })
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
  })
  expect(result.ok).toBe(true)
})

test('phase 4 stub: opt-in runs but always returns ok', async () => {
  const clock = makeClock()
  const api = makeApi()
  const events: Array<{ phase: number; status: string }> = []
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
    runE2E: true,
    onPhase: (phase, status) => events.push({ phase, status }),
  })
  expect(result.ok).toBe(true)
  expect(events.some((e) => e.phase === 4 && e.status === 'completed')).toBe(true)
})

test('phase 2 happy: rules loaded + providers not updating', async () => {
  const clock = makeClock()
  const api = makeApi({
    listRules: async () => [{ type: 'MATCH', target: 'DIRECT' }],
    listProviders: async () => ({
      hagezi_pro: { updating: false, behavior: 'domain' },
    }),
  })
  const events: Array<{ phase: number; status: string; data?: Record<string, unknown> }> = []
  const result = await runHealthcheck(api, {
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms)
    },
    onPhase: (phase, status, data) => events.push({ phase, status, ...(data ? { data } : {}) }),
  })
  expect(result.ok).toBe(true)
  const phase2Done = events.find((e) => e.phase === 2 && e.status === 'completed')
  expect(phase2Done?.data?.rulesCount).toBe(1)
  expect(phase2Done?.data?.providersStillUpdating).toBe(0)
})
