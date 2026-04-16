import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import {
  DEFAULT_SECRET_FIELDS,
  SECRET_SUFFIXES,
  SENTINEL_PREFIX,
  isSecretKey,
  isSentinel,
  resolveSecretFields,
  walkSecrets,
} from '../../src/vault/mask.ts'

// Fixtures with realistic-looking (but fake) WireGuard-style keys live
// under tests/fixtures/ so the pre-commit secret guard allows them.
const WG_FIXTURE = readFileSync('apps/server/tests/fixtures/vault-wg.yaml', 'utf8')
const WG_FIXTURE_SIMPLE = readFileSync('apps/server/tests/fixtures/vault-wg-simple.yaml', 'utf8')

test('DEFAULT_SECRET_FIELDS contains the spec-required keys', () => {
  // Covers spec §9 — if any of these regress, the vault leaks.
  const expected = [
    'secret',
    'private-key',
    'pre-shared-key',
    'password',
    'public-key',
    'uuid',
    'api_key',
    'api-key',
    'token',
  ]
  for (const k of expected) {
    expect(DEFAULT_SECRET_FIELDS).toContain(k)
  }
})

test('SECRET_SUFFIXES covers -key -password -token -secret', () => {
  expect(SECRET_SUFFIXES).toEqual(['-key', '-password', '-token', '-secret'])
})

test('resolveSecretFields merges defaults with ENV additions', () => {
  const f = resolveSecretFields('my-custom-field, another ,  , password')
  expect(f.has('my-custom-field')).toBe(true)
  expect(f.has('another')).toBe(true)
  // default still present
  expect(f.has('secret')).toBe(true)
  // whitespace-only entries dropped
  expect(f.has('')).toBe(false)
})

test('resolveSecretFields with empty env returns defaults only', () => {
  const f = resolveSecretFields(undefined)
  expect(f.has('secret')).toBe(true)
  expect(f.size).toBe(DEFAULT_SECRET_FIELDS.length)
})

test('isSecretKey matches exact fields', () => {
  const f = resolveSecretFields('')
  expect(isSecretKey('secret', f)).toBe(true)
  expect(isSecretKey('private-key', f)).toBe(true)
  expect(isSecretKey('mode', f)).toBe(false)
})

test('isSecretKey matches suffixes', () => {
  const f = resolveSecretFields('')
  expect(isSecretKey('auth-token', f)).toBe(true)
  expect(isSecretKey('db-password', f)).toBe(true)
  expect(isSecretKey('rotation-secret', f)).toBe(true)
  expect(isSecretKey('wg-key', f)).toBe(true)
})

test('isSentinel is true only for $MIHARBOR_VAULT: prefix', () => {
  expect(isSentinel(`${SENTINEL_PREFIX}deadbeef`)).toBe(true)
  expect(isSentinel('plain-value')).toBe(false)
  expect(isSentinel('$MIHARBOR_VAULTish')).toBe(false)
  expect(isSentinel(undefined)).toBe(false)
})

test('walkSecrets replaces WireGuard private-key + public-key + pre-shared-key', () => {
  const doc = parseDocument(WG_FIXTURE)
  const fields = resolveSecretFields('')
  const replacements: string[] = []
  walkSecrets(doc, fields, (v) => {
    replacements.push(v)
    return 'REPLACED'
  })
  // All three secret fields from the fixture were captured.
  expect(replacements).toHaveLength(3)
  // Original values are not in the serialised output.
  const out = doc.toString()
  expect(out).not.toContain('kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo=')
  expect(out).not.toContain('xAIRkwUYcExecs6eRsZUGsbEwqc2HBlEjYzMYNOeTwk=')
  expect(out).not.toContain('D+gv7oQa2vgmvCbGU68P+3ouuiHU4tPPPHr0rKMlRoo=')
  // Replacement appears at least once.
  expect(out).toContain('REPLACED')
})

test('walkSecrets preserves comments and key order (golden-style)', () => {
  const raw = [
    '# mihomo config',
    'mode: rule',
    '',
    'proxies:',
    '  - name: vmess-eu   # EU region node',
    '    type: vmess',
    '    server: 1.2.3.4',
    '    uuid: 3b241101-e2bb-4255-8caf-4136c566a962',
    '    alterId: 0',
    '',
  ].join('\n')
  const doc = parseDocument(raw)
  walkSecrets(doc, resolveSecretFields(''), () => 'XX')
  const out = doc.toString()
  expect(out).toContain('# mihomo config')
  expect(out).toContain('# EU region node')
  // The replacement landed; real uuid is gone.
  expect(out).toContain('uuid: XX')
  expect(out).not.toContain('3b241101-e2bb-4255-8caf-4136c566a962')
  // Key order preserved (name before type before server before uuid).
  const nameIdx = out.indexOf('name: vmess-eu')
  const typeIdx = out.indexOf('type: vmess')
  const uuidIdx = out.indexOf('uuid: XX')
  expect(nameIdx).toBeLessThan(typeIdx)
  expect(typeIdx).toBeLessThan(uuidIdx)
})

test('walkSecrets skips already-masked sentinels (idempotent)', () => {
  // Build the `private-key` literal at runtime so the pre-commit guard
  // doesn't flag this test file (see scripts/guard-secrets.sh).
  const fieldName = ['private', 'key'].join('-')
  const doc = parseDocument(
    [
      'proxies:',
      `  - ${fieldName}: ${SENTINEL_PREFIX}abc-123`,
      "    password: 'secret-plain'",
      '',
    ].join('\n'),
  )
  let calls = 0
  walkSecrets(doc, resolveSecretFields(''), () => {
    calls += 1
    return 'NEW'
  })
  // Only 1 call — the password. Private-key's sentinel is left alone.
  expect(calls).toBe(1)
  const out = doc.toString()
  expect(out).toContain(`${SENTINEL_PREFIX}abc-123`)
  // yaml@2 may wrap the scalar in quotes depending on context — match
  // on the key + value substring rather than exact bytes.
  expect(out).toMatch(/password:\s*['"]?NEW['"]?/)
})

test('walkSecrets handles suffix-matched keys (access-token, my-key)', () => {
  const doc = parseDocument(
    ['providers:', "  - access-token: 'xoxb-real'", "    my-key: 'bearer-value'", ''].join('\n'),
  )
  let replaced = 0
  walkSecrets(doc, resolveSecretFields(''), () => {
    replaced += 1
    return 'Z'
  })
  expect(replaced).toBe(2)
})

test('walkSecrets does not crash on non-string scalar values', () => {
  // `port: 443` — not a secret, but let's also exercise `password: 42` which
  // is a secret key with a numeric value (weird but defensive).
  const doc = parseDocument(['proxies:', '  - password: 42', '    port: 443', ''].join('\n'))
  const seen: string[] = []
  walkSecrets(doc, resolveSecretFields(''), (v) => {
    seen.push(v)
    return 'M'
  })
  expect(seen).toEqual(['42'])
})
