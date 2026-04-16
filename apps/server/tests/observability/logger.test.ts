import { expect, test } from 'bun:test'
import { createLogger } from '../../src/observability/logger.ts'

test('logger redacts secret field', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ secret: 'ede76fbe...', msg: 'reload' })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.secret).toBe('***REDACTED***')
  expect(parsed.msg).toBe('reload')
})

test('logger redacts nested private-key', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ proxy: { 'private-key': 'abc', name: 'node1' }, msg: 'added' })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.proxy['private-key']).toBe('***REDACTED***')
  expect(parsed.proxy.name).toBe('node1')
})

test('logger respects level threshold', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'warn', sink: (line) => sink.push(line) })
  log.info({ msg: 'should-not-appear' })
  log.warn({ msg: 'should-appear' })
  expect(sink.length).toBe(1)
  expect(JSON.parse(sink[0]!).msg).toBe('should-appear')
})

test('logger redacts pre-shared-key, password, uuid, api_key variants', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({
    'pre-shared-key': 'abc',
    password: 'hunter2',
    uuid: 'deadbeef',
    api_key: 'sk-xxx',
    'api-key': 'sk-yyy',
    token: 'jwt-x',
    Authorization: 'Bearer x',
    msg: 'redaction',
  })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed['pre-shared-key']).toBe('***REDACTED***')
  expect(parsed.password).toBe('***REDACTED***')
  expect(parsed.uuid).toBe('***REDACTED***')
  expect(parsed.api_key).toBe('***REDACTED***')
  expect(parsed['api-key']).toBe('***REDACTED***')
  expect(parsed.token).toBe('***REDACTED***')
  expect(parsed.Authorization).toBe('***REDACTED***')
  expect(parsed.msg).toBe('redaction')
})

test('logger emits JSON lines with ts and level', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ msg: 'hello' })
  const parsed = JSON.parse(sink[0]!)
  expect(typeof parsed.ts).toBe('string')
  expect(parsed.level).toBe('info')
  expect(parsed.msg).toBe('hello')
})

test('logger redacts deeply nested arrays', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ peers: [{ 'private-key': 'x', name: 'a' }], msg: 'peers' })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.peers[0]['private-key']).toBe('***REDACTED***')
  expect(parsed.peers[0].name).toBe('a')
})

test('logger redacts circular references without throwing (C2)', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  const obj: Record<string, unknown> = { name: 'a' }
  obj.self = obj
  expect(() => log.info({ obj, msg: 'cycle' })).not.toThrow()
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.obj.name).toBe('a')
  expect(parsed.obj.self).toBe('[Circular]')
  expect(parsed.msg).toBe('cycle')
})

test('logger redacts indirect circular reference through array (C2)', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  const a: Record<string, unknown> = { name: 'a' }
  const b: Record<string, unknown> = { name: 'b', next: a }
  a.next = b
  expect(() => log.info({ a, msg: 'mutual' })).not.toThrow()
})

test('logger serializes Error with name, message, stack (C2)', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ err: new Error('boom'), msg: 'failed' })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.err.name).toBe('Error')
  expect(parsed.err.message).toBe('boom')
  expect(typeof parsed.err.stack).toBe('string')
  expect(parsed.err.stack.length).toBeGreaterThan(0)
})

test('logger stringifies BigInt (C2)', () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  expect(() => log.info({ n: 9007199254740993n, msg: 'big' })).not.toThrow()
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.n).toBe('9007199254740993')
})

test('logger swallows sink errors — broken pipe does not kill caller (C3)', () => {
  const log = createLogger({
    level: 'info',
    sink: () => {
      throw new Error('broken pipe')
    },
  })
  expect(() => log.info({ msg: 'x' })).not.toThrow()
  expect(() => log.error({ msg: 'y' })).not.toThrow()
  expect(() => log.warn({ msg: 'z' })).not.toThrow()
})
