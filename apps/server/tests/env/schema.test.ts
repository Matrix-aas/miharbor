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

test('loadEnv does NOT coerce digit-only strings for string-typed fields (C1)', () => {
  // Regression: previous coerce() applied /^-?\d+$/ globally and broke API keys
  // like "1234567890" by converting them to Number before schema validation.
  expect(() => loadEnv({ ANTHROPIC_API_KEY: '1234567890' })).not.toThrow()
  const env = loadEnv({ ANTHROPIC_API_KEY: '1234567890' })
  expect(env.ANTHROPIC_API_KEY).toBe('1234567890')
  expect(typeof env.ANTHROPIC_API_KEY).toBe('string')
})

test('loadEnv does NOT coerce digit-only OPENAI_API_KEY (C1)', () => {
  const env = loadEnv({ OPENAI_API_KEY: '9876543210' })
  expect(env.OPENAI_API_KEY).toBe('9876543210')
  expect(typeof env.OPENAI_API_KEY).toBe('string')
})

test('loadEnv still coerces numbers for number-typed fields (C1)', () => {
  const env = loadEnv({ MIHARBOR_PORT: '5000' })
  expect(env.MIHARBOR_PORT).toBe(5000)
  expect(typeof env.MIHARBOR_PORT).toBe('number')
})

test('loadEnv still coerces booleans for boolean-typed fields (C1)', () => {
  const env = loadEnv({ MIHARBOR_LLM_DISABLED: 'true' })
  expect(env.MIHARBOR_LLM_DISABLED).toBe(true)
  expect(typeof env.MIHARBOR_LLM_DISABLED).toBe('boolean')
})

test('loadEnv does NOT coerce "true"/"false" strings for string-typed fields (C1)', () => {
  // Edge case: if an API key literally equals "true", we must keep it as string.
  const env = loadEnv({ MIHARBOR_AUTH_USER: 'true' })
  expect(env.MIHARBOR_AUTH_USER).toBe('true')
  expect(typeof env.MIHARBOR_AUTH_USER).toBe('string')
})

test('loadEnv defaults NODE_ENV to "development" and MIHARBOR_CSP_DISABLED to false', () => {
  const env = loadEnv({})
  expect(env.NODE_ENV).toBe('development')
  expect(env.MIHARBOR_CSP_DISABLED).toBe(false)
})

test('loadEnv accepts NODE_ENV override + MIHARBOR_CSP_DISABLED boolean coercion', () => {
  const env = loadEnv({ NODE_ENV: 'production', MIHARBOR_CSP_DISABLED: 'true' })
  expect(env.NODE_ENV).toBe('production')
  expect(env.MIHARBOR_CSP_DISABLED).toBe(true)
})
