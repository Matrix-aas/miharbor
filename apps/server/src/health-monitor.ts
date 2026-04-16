// Continuous health monitor — polls mihomo every 60s and emits a simple
// `mihomo-up` / `mihomo-down` event stream. Drives the UI's live status
// badge in the top bar via `/api/health/stream` (Task 18).
//
// This is intentionally NOT the 4-phase healthcheck from `deploy/healthcheck.ts`
// — that one is for post-deploy verification and runs delay-checks on proxy
// groups. The monitor here just pings /version; anything heavier would
// hammer mihomo's control plane every minute forever.

import type { MihomoApi } from './mihomo/api-client.ts'
import type { Logger } from './observability/logger.ts'

export type HealthEvent =
  | { type: 'mihomo-up'; version: string; ts: string }
  | { type: 'mihomo-down'; reason: string; ts: string }
  | { type: 'canonicalized'; old_hash: string; new_hash: string; snapshot_id: string; ts: string }

export type HealthEventListener = (event: HealthEvent) => void

export interface HealthMonitorOptions {
  /** Poll interval in ms. Default 60s. */
  intervalMs?: number
  /** Logger for down-events. */
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  /** Override `setInterval`/`clearInterval` for tests. The handle type is
   *  deliberately `unknown` because Node/Bun uses `Timeout` while browser /
   *  minimal DOM lib declarations use `number`; we only pass it back to the
   *  supplied `clearInterval` so we don't care which. */
  timers?: {
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (h: unknown) => void
  }
  /** Emit the first poll immediately on start (vs waiting one interval). */
  emitImmediately?: boolean
}

export interface HealthMonitor {
  /** Subscribe — returns an unsubscribe fn. */
  subscribe(listener: HealthEventListener): () => void
  /** Emit an ad-hoc event (e.g. `canonicalized` from the bootstrap hook). */
  emit(event: HealthEvent): void
  /** Last known status snapshot for new subscribers. */
  getStatus(): HealthEvent | null
  /** Stop polling and clear all listeners. */
  stop(): void
}

export function startHealthMonitor(api: MihomoApi, opts: HealthMonitorOptions = {}): HealthMonitor {
  const intervalMs = opts.intervalMs ?? 60_000
  const logger = opts.logger
  const timers =
    opts.timers ??
    ({
      setInterval: (fn: () => void, ms: number): unknown => setInterval(fn, ms),
      clearInterval: (h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>),
    } as {
      setInterval: (fn: () => void, ms: number) => unknown
      clearInterval: (h: unknown) => void
    })
  const listeners = new Set<HealthEventListener>()
  let lastStatus: HealthEvent | null = null
  let stopped = false

  function broadcast(event: HealthEvent): void {
    // Keep the latest health-related status (not canonicalized events — those
    // are one-shot notifications, not a "steady state"). Subscribers that
    // connect later get `lastStatus` as their hello packet.
    if (event.type === 'mihomo-up' || event.type === 'mihomo-down') {
      lastStatus = event
    }
    for (const l of listeners) {
      try {
        l(event)
      } catch (e) {
        logger?.warn({
          msg: 'health-monitor listener threw — dropping event for this listener',
          error: (e as Error).message,
        })
      }
    }
  }

  async function poll(): Promise<void> {
    if (stopped) return
    try {
      const v = await api.getVersion()
      broadcast({
        type: 'mihomo-up',
        version: v.version,
        ts: new Date().toISOString(),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      broadcast({
        type: 'mihomo-down',
        reason,
        ts: new Date().toISOString(),
      })
    }
  }

  if (opts.emitImmediately) {
    // Fire-and-forget — don't block callers on a mihomo probe at startup.
    void poll()
  }
  const handle = timers.setInterval(() => {
    void poll()
  }, intervalMs)

  return {
    subscribe(listener: HealthEventListener): () => void {
      listeners.add(listener)
      // Send hello packet with last known status so the UI renders an
      // immediate state instead of waiting 60s.
      if (lastStatus) listener(lastStatus)
      return () => listeners.delete(listener)
    },
    emit(event: HealthEvent): void {
      broadcast(event)
    },
    getStatus(): HealthEvent | null {
      return lastStatus
    },
    stop(): void {
      if (stopped) return
      stopped = true
      timers.clearInterval(handle)
      listeners.clear()
    },
  }
}
