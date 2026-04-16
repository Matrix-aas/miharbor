import { expect, test } from 'bun:test'
import { loadEnv } from '../../src/env/schema.ts'

test('loadEnv fails on invalid transport', () => {
  expect(() => loadEnv({ MIHARBOR_TRANSPORT: 'foo' })).toThrow(/MIHARBOR_TRANSPORT/)
})

test('loadEnv applies defaults', () => {
  const env = loadEnv({})
  expect(env.MIHARBOR_TRANSPORT).toBe('local')
  expect(env.MIHARBOR_PORT).toBe(3000)
  expect(env.MIHARBOR_SNAPSHOT_RETENTION_COUNT).toBe(50)
  expect(env.MIHARBOR_SNAPSHOT_RETENTION_DAYS).toBe(30)
  expect(env.MIHARBOR_LOG_LEVEL).toBe('info')
  expect(env.MIHARBOR_AUTO_ROLLBACK).toBe(true)
  expect(env.MIHARBOR_CONFIG_PATH).toBe('/config/config.yaml')
  expect(env.MIHARBOR_DATA_DIR).toBe('/app/data')
  expect(env.MIHOMO_API_URL).toBe('http://host.docker.internal:9090')
  expect(env.MIHOMO_API_VALIDATION_MODE).toBe('shared-only')
})

test('loadEnv coerces numeric ENV strings', () => {
  const env = loadEnv({ MIHARBOR_PORT: '8080', MIHARBOR_SNAPSHOT_RETENTION_COUNT: '10' })
  expect(env.MIHARBOR_PORT).toBe(8080)
  expect(env.MIHARBOR_SNAPSHOT_RETENTION_COUNT).toBe(10)
})

test('loadEnv coerces boolean ENV strings', () => {
  const env = loadEnv({ MIHARBOR_AUTH_DISABLED: 'true', MIHARBOR_AUTO_ROLLBACK: 'false' })
  expect(env.MIHARBOR_AUTH_DISABLED).toBe(true)
  expect(env.MIHARBOR_AUTO_ROLLBACK).toBe(false)
})

test('loadEnv warns on deprecated name', () => {
  const warnings: string[] = []
  const env = loadEnv({ MIHARBOR_CFG_PATH: '/tmp/cfg.yaml' }, (w) => warnings.push(w))
  expect(env.MIHARBOR_CONFIG_PATH).toBe('/tmp/cfg.yaml')
  expect(warnings[0]).toMatch(/deprecated/i)
})

test('loadEnv fails on invalid log-level', () => {
  expect(() => loadEnv({ MIHARBOR_LOG_LEVEL: 'trace' })).toThrow(/MIHARBOR_LOG_LEVEL/)
})

test('loadEnv accepts valid log-level override', () => {
  const env = loadEnv({ MIHARBOR_LOG_LEVEL: 'debug' })
  expect(env.MIHARBOR_LOG_LEVEL).toBe('debug')
})

test('loadEnv accepts ssh transport', () => {
  const env = loadEnv({ MIHARBOR_TRANSPORT: 'ssh' })
  expect(env.MIHARBOR_TRANSPORT).toBe('ssh')
})

test('loadEnv fails on invalid validation mode', () => {
  expect(() => loadEnv({ MIHOMO_API_VALIDATION_MODE: 'bogus' })).toThrow(
    /MIHOMO_API_VALIDATION_MODE/,
  )
})
