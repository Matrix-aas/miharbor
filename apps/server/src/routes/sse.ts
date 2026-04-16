// Tiny Server-Sent Events helpers. Returns a `Response` with a
// `ReadableStream` body formatted as `event: <name>\ndata: <JSON>\n\n`.
//
// Two flavours:
//   - `sseStreamFromEvents(getQueue)` — poll a queue populated by a
//      concurrent producer (used by /api/deploy + /api/snapshots/:id/rollback
//      where the pipeline emits onStep events).
//   - `sseStreamFromSubscription(subscribe)` — subscribe to an emitter and
//      forward events until the client disconnects (used by /api/health/stream).

import type { HealthEvent } from '../health-monitor.ts'

const ENCODER = new TextEncoder()

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
      // Drain loop.
      while (!ctl.done() || ctl.queue.length > 0) {
        if (ctl.queue.length === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          continue
        }
        const ev = ctl.queue.shift()!
        try {
          controller.enqueue(formatEvent(ev.type, ev.data))
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
      connection: 'keep-alive',
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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial comment so proxies flush headers.
      controller.enqueue(ENCODER.encode(`: miharbor-health-stream\n\n`))
      unsubscribe = subscribe((event) => {
        try {
          controller.enqueue(formatEvent(event.type, event))
        } catch {
          unsubscribe?.()
        }
      })
    },
    cancel() {
      unsubscribe?.()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
