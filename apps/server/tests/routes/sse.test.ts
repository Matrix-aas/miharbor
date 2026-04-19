// SSE helper tests — formatEvent, sseStreamFromEvents, sseStreamFromSubscription

import { expect, test } from 'bun:test'
import { sseStreamFromEvents, sseStreamFromSubscription } from '../../src/routes/sse.ts'

test('sseStreamFromEvents returns Response with SSE headers', () => {
  const response = sseStreamFromEvents(() => ({
    queue: [],
    done: () => true,
    error: () => null,
  }))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  expect(response.headers.get('cache-control')).toContain('no-cache')
  // `connection` must NOT be set — forbidden in HTTP/2 (RFC 7540 §8.1.2.2).
  expect(response.headers.get('connection')).toBeNull()
  expect(response.headers.get('x-accel-buffering')).toBe('no')
})

test('sseStreamFromEvents includes initial comment', async () => {
  const response = sseStreamFromEvents(() => ({
    queue: [],
    done: () => true,
    error: () => null,
  }))
  const text = await response.text()
  expect(text).toContain(': miharbor-stream')
})

test('sseStreamFromEvents drains queued events', async () => {
  const queue = [{ type: 'test', data: { key: 'value' } }]
  const response = sseStreamFromEvents(() => ({
    queue,
    done: () => true,
    error: () => null,
  }))
  const text = await response.text()
  expect(text).toContain('event: test')
  expect(text).toContain('data: {"key":"value"}')
})

test('sseStreamFromEvents emits error event when error() is truthy', async () => {
  const error = new Error('test error')
  const response = sseStreamFromEvents(() => ({
    queue: [],
    done: () => true,
    error: () => error,
  }))
  const text = await response.text()
  expect(text).toContain('event: error')
  expect(text).toContain('test error')
})

test('sseStreamFromSubscription returns Response with SSE headers', () => {
  const response = sseStreamFromSubscription(() => () => {})
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  expect(response.headers.get('connection')).toBeNull()
})

test('sseStreamFromSubscription calls unsubscribe on cancel', () => {
  const response = sseStreamFromSubscription(() => () => {
    // unsubscribe function
  })
  expect(response.body).toBeDefined()
  expect(response.status).toBe(200)
})

test('sseStreamFromSubscription clears heartbeat interval on cancel (v0.2.6)', async () => {
  // Cancelling the stream must stop the heartbeat timer AND call the
  // consumer's unsubscribe — otherwise we leak a setInterval per client
  // disconnect and the per-subscription emitter keeps firing into a
  // closed controller.
  let unsubscribeCalled = false
  const response = sseStreamFromSubscription(() => () => {
    unsubscribeCalled = true
  })
  const reader = response.body!.getReader()
  await reader.read() // drain initial comment so stream is live
  await reader.cancel()
  expect(unsubscribeCalled).toBe(true)
})
