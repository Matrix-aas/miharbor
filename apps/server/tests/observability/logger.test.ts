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
