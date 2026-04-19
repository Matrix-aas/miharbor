// Tiny Server-Sent Events helpers. Returns a `Response` with a
// `ReadableStream` body formatted as `event: <name>\ndata: <JSON>\n\n`.
//
// Two flavours:
//   - `sseStreamFromEvents(getQueue)` — poll a queue populated by a
//      concurrent producer (used by /api/deploy + /api/snapshots/:id/rollback
//      where the pipeline emits onStep events).
//   - `sseStreamFromSubscription(subscribe)` — subscribe to an emitter and
//      forward events until the client disconnects (used by /api/health/stream).
//
// Heartbeat. Both helpers flush an SSE comment (`: ...\n\n`, discarded by
// the browser's EventSource parser) every `HEARTBEAT_MS` so the connection
// stays above Bun.serve's idleTimeout (10s by default — an SSE stream
// whose producer has nothing to say goes silent, Bun kills the TCP socket,
// and the browser surfaces `ERR_HTTP2_PROTOCOL_ERROR` behind a reverse
// proxy on the subsequent reconnect). 8s leaves a 2s cushion before the
// 10s server-side cutoff; also tunnels through typical nginx/Caddy
// `proxy_read_timeout` defaults (60s) without trouble.

import type { HealthEvent } from '../health-monitor.ts'

const ENCODER = new TextEncoder()
const HEARTBEAT_MS = 8_000

export interface SseQueueController {
  queue: Array<{ type: string; data: unknown }>
  done: () => boolean
  error: () => Error | null
}

function formatEvent(name: string, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  return ENCODER.encode(`event: ${name}\ndata: ${payload}\n\n`)
}

/** Create a `Response` whose body is an SSE stream drained from the queue
 *  returned by `controllerFactory()`. Polls with `setTimeout(0)` between
 *  checks — the queue is a plain array, so we don't need a promise-based
 *  notifier. Good enough for MVP pipeline streams (2-30s total runtime,
 *  ~20 events). */
export function sseStreamFromEvents(controllerFactory: () => SseQueueController): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ctl = controllerFactory()
      // Initial comment to flush headers through any intermediary.
      controller.enqueue(ENCODER.encode(`: miharbor-stream\n\n`))
      // See the file-level heartbeat comment — keeps the socket above
      // Bun.serve's idleTimeout while the pipeline is between steps.
      let lastFlush = Date.now()
      // Drain loop.
      while (!ctl.done() || ctl.queue.length > 0) {
        if (ctl.queue.length === 0) {
          if (Date.now() - lastFlush >= HEARTBEAT_MS) {
            try {
              controller.enqueue(ENCODER.encode(`: ping\n\n`))
              lastFlush = Date.now()
            } catch {
              return
            }
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          continue
        }
        const ev = ctl.queue.shift()!
        try {
          controller.enqueue(formatEvent(ev.type, ev.data))
          lastFlush = Date.now()
        } catch {
          // Client disconnected — stop.
          return
        }
      }
      // Surface errors if the pipeline didn't already push one.
      const err = ctl.error()
      if (err) {
        try {
          controller.enqueue(
            formatEvent('error', {
              message: err.message,
              code: (err as { code?: string }).code ?? 'UNKNOWN',
            }),
          )
        } catch {
          /* ignore */
        }
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // `connection` is a hop-by-hop header forbidden in HTTP/2 (RFC 7540 §8.1.2.2);
      // setting it causes ERR_HTTP2_PROTOCOL_ERROR behind a reverse proxy.
      'x-accel-buffering': 'no', // nginx: do not buffer
    },
  })
}

/** Create a `Response` that forwards events from `subscribe()` until the
 *  client disconnects. `subscribe` returns an unsubscribe function. */
export function sseStreamFromSubscription(
  subscribe: (push: (event: HealthEvent) => void) => () => void,
): Response {
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial comment so proxies flush headers.
      controller.enqueue(ENCODER.encode(`: miharbor-health-stream\n\n`))
      // Heartbeat — see file-level comment. Health events are rare
      // (transport/mihomo state transitions), so without a periodic
      // keep-alive the socket sits silent for minutes and gets
      // reaped by Bun.serve's idleTimeout.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(ENCODER.encode(`: ping\n\n`))
        } catch {
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
          unsubscribe?.()
        }
      }, HEARTBEAT_MS)
      unsubscribe = subscribe((event) => {
        try {
          controller.enqueue(formatEvent(event.type, event))
        } catch {
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
          unsubscribe?.()
        }
      })
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      unsubscribe?.()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
