// Continuous health monitor tests. Uses injectable timers so we don't wait
// 60 seconds for the poll tick.

import { expect, test } from 'bun:test'
import { startHealthMonitor, type HealthEvent } from '../src/health-monitor.ts'
import type { MihomoApi } from '../src/mihomo/api-client.ts'

function makeApi(overrides: Partial<MihomoApi> = {}): MihomoApi {
  return {
    getVersion: async () => ({ version: 't-1.0', premium: false }),
    reloadConfig: async () => {},
    listProxies: async () => ({}),
    getProxyDelay: async () => ({ delay: 1 }),
    listProviders: async () => ({}),
    refreshProvider: async () => {},
    listRuleProviders: async () => ({}),
    refreshRuleProvider: async () => {},
    listRules: async () => [],
    ...overrides,
  }
}

/** Tiny controllable timer that captures fn but never actually fires until
 *  `tick()` is called. */
function controllableTimers(): {
  timers: {
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (h: unknown) => void
  }
  tick: () => void
  stopCount: number
} {
  let storedFn: (() => void) | null = null
  let stopCount = 0
  return {
    timers: {
      setInterval: (fn: () => void, _ms: number) => {
        storedFn = fn
        return 1
      },
      clearInterval: (_h: unknown) => {
        stopCount += 1
      },
    },
    get stopCount() {
      return stopCount
    },
    tick: () => {
      if (storedFn) storedFn()
    },
  }
}

test('emitImmediately fires a mihomo-up event on startup', async () => {
  const api = makeApi()
  const ctl = controllableTimers()
  const events: HealthEvent[] = []
  const mon = startHealthMonitor(api, {
    timers: ctl.timers,
    emitImmediately: true,
  })
  mon.subscribe((e) => events.push(e))
  // Give the initial poll a tick to resolve.
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  expect(events.some((e) => e.type === 'mihomo-up')).toBe(true)
  mon.stop()
})

test('poll tick after startup emits mihomo-up when /version responds', async () => {
  const api = makeApi()
  const ctl = controllableTimers()
  const events: HealthEvent[] = []
  const mon = startHealthMonitor(api, { timers: ctl.timers })
  mon.subscribe((e) => events.push(e))
  ctl.tick()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  expect(events.some((e) => e.type === 'mihomo-up')).toBe(true)
  mon.stop()
})

test('poll emits mihomo-down when /version throws', async () => {
  const api = makeApi({
    getVersion: async () => {
      throw new Error('connection refused')
    },
  })
  const ctl = controllableTimers()
  const events: HealthEvent[] = []
  const mon = startHealthMonitor(api, { timers: ctl.timers })
  mon.subscribe((e) => events.push(e))
  ctl.tick()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  const down = events.find((e) => e.type === 'mihomo-down')
  expect(down).toBeTruthy()
  if (down && down.type === 'mihomo-down') {
    expect(down.reason).toContain('connection refused')
  }
  mon.stop()
})

test('new subscribers get the last known status as a hello packet', async () => {
  const api = makeApi()
  const ctl = controllableTimers()
  const mon = startHealthMonitor(api, { timers: ctl.timers })
  // Tick once so the monitor has a last-status cached.
  ctl.tick()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  // Subscribe AFTER the first poll — should receive the cached status.
  const events: HealthEvent[] = []
  mon.subscribe((e) => events.push(e))
  expect(events.length).toBe(1)
  expect(events[0]!.type).toBe('mihomo-up')
  mon.stop()
})

test('emit() broadcasts a canonicalized event to listeners', async () => {
  const api = makeApi()
  const ctl = controllableTimers()
  const mon = startHealthMonitor(api, { timers: ctl.timers })
  const events: HealthEvent[] = []
  mon.subscribe((e) => events.push(e))
  mon.emit({
    type: 'canonicalized',
    old_hash: 'abc',
    new_hash: 'def',
    snapshot_id: 'snap-1',
    ts: new Date().toISOString(),
  })
  expect(events.some((e) => e.type === 'canonicalized')).toBe(true)
  mon.stop()
})

test('stop() cancels the interval and clears listeners', async () => {
  const api = makeApi()
  const ctl = controllableTimers()
  const mon = startHealthMonitor(api, { timers: ctl.timers })
  const events: HealthEvent[] = []
  mon.subscribe((e) => events.push(e))
  mon.stop()
  expect(ctl.stopCount).toBe(1)
  // After stop, broadcasts are dropped.
  ctl.tick() // poll won't emit because stopped flag is set
  await new Promise((r) => setImmediate(r))
  expect(events.length).toBe(0)
})
