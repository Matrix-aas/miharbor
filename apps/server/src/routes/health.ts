// GET /api/health/stream — SSE stream of `mihomo-up` / `mihomo-down` /
// `canonicalized` events from the continuous monitor. The monitor lives
// on the app context; each subscriber receives the last known status as
// a hello packet (see health-monitor.ts `subscribe()`).

import { Elysia } from 'elysia'
import type { HealthMonitor } from '../health-monitor.ts'
import { sseStreamFromSubscription } from './sse.ts'

export interface HealthRoutesDeps {
  monitor: HealthMonitor
}

export function healthRoutes(deps: HealthRoutesDeps) {
  return new Elysia({ prefix: '/api/health' })
    .get('/', () => {
      const last = deps.monitor.getStatus()
      return { status: last?.type ?? 'unknown', ...(last ?? {}) }
    })
    .get('/stream', () =>
      sseStreamFromSubscription((push) => {
        const unsub = deps.monitor.subscribe(push)
        return unsub
      }),
    )
}
