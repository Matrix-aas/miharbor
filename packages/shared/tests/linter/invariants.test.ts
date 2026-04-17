import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { checkUniversalInvariants } from '../../src/linter/invariants-universal.ts'
import type { Issue } from '../../src/types/issue.ts'

const idOf = (i: Issue): string | undefined => (i.params as { id?: string } | undefined)?.id

// --- individual invariants ------------------------------------------------

test('flags too-short secret', () => {
  const doc = parseDocument('secret: "short"\n')
  const issues = checkUniversalInvariants(doc)
  const iss = issues.find((i) => idOf(i) === 'SECRET_LENGTH')
  expect(iss).toBeDefined()
  expect(iss!.level).toBe('error')
  expect(iss!.code).toBe('INVARIANT_SECRET_TOO_SHORT')
  expect(iss!.path).toEqual(['secret'])
})

test('empty secret is allowed (not yet generated)', () => {
  // We want onboarding / minimal configs to pass — empty secret means
  // "not yet set", which is legal at first-run. The length check only fires
  // on non-empty values.
  const doc = parseDocument("secret: ''\n")
  expect(checkUniversalInvariants(doc).find((i) => idOf(i) === 'SECRET_LENGTH')).toBeUndefined()
})

test('adequate-length secret is accepted', () => {
  const doc = parseDocument('secret: "0123456789abcdef"\n') // 16 chars, == min
  expect(checkUniversalInvariants(doc).find((i) => idOf(i) === 'SECRET_LENGTH')).toBeUndefined()
})

test('flags dns.listen 0.0.0.0:53', () => {
  const doc = parseDocument('dns:\n  listen: 0.0.0.0:53\n')
  const issues = checkUniversalInvariants(doc)
  const iss = issues.find((i) => idOf(i) === 'DNS_LISTEN_NOT_ZERO53')
  expect(iss).toBeDefined()
  expect(iss!.code).toBe('INVARIANT_DNS_LISTEN_ZERO53')
  expect(iss!.path).toEqual(['dns', 'listen'])
})

test('flags dns.listen ":53" (shorthand all-interfaces)', () => {
  const doc = parseDocument('dns:\n  listen: ":53"\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'DNS_LISTEN_NOT_ZERO53')).toBe(true)
})

test('dns.listen 127.0.0.1:1053 is accepted', () => {
  const doc = parseDocument('dns:\n  listen: 127.0.0.1:1053\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'DNS_LISTEN_NOT_ZERO53')).toBe(false)
})

test('flags missing interface-name when tun.enable', () => {
  const doc = parseDocument('tun:\n  enable: true\n')
  const issues = checkUniversalInvariants(doc)
  const iss = issues.find((i) => idOf(i) === 'TUN_INTERFACE_NAME_REQUIRED')
  expect(iss).toBeDefined()
  expect(iss!.code).toBe('INVARIANT_TUN_NEEDS_INTERFACE')
  expect(iss!.path).toEqual(['interface-name'])
})

test('empty interface-name still fails the tun check', () => {
  const doc = parseDocument("tun:\n  enable: true\ninterface-name: ''\n")
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'TUN_INTERFACE_NAME_REQUIRED')).toBe(
    true,
  )
})

test('tun.enable false → interface-name not required', () => {
  const doc = parseDocument('tun:\n  enable: false\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'TUN_INTERFACE_NAME_REQUIRED')).toBe(
    false,
  )
})

test('tun section missing → interface-name not required', () => {
  const doc = parseDocument('mode: rule\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'TUN_INTERFACE_NAME_REQUIRED')).toBe(
    false,
  )
})

// --- TUN_DNS_HIJACK_TYPE --------------------------------------------------

test('flags tun.dns-hijack when set to a scalar string', () => {
  // Mihomo rejects this — dns-hijack must be a list of targets, not a flag.
  const doc = parseDocument('tun:\n  dns-hijack: "auto"\n')
  const issues = checkUniversalInvariants(doc)
  const iss = issues.find((i) => idOf(i) === 'TUN_DNS_HIJACK_TYPE')
  expect(iss).toBeDefined()
  expect(iss!.level).toBe('error')
  expect(iss!.code).toBe('INVARIANT_TUN_DNS_HIJACK_MUST_BE_ARRAY')
  expect(iss!.path).toEqual(['tun', 'dns-hijack'])
})

test('empty tun.dns-hijack array is accepted (runbook: disabled for first rollout)', () => {
  const doc = parseDocument('tun:\n  dns-hijack: []\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'TUN_DNS_HIJACK_TYPE')).toBe(false)
})

test('populated tun.dns-hijack list is accepted', () => {
  const doc = parseDocument('tun:\n  dns-hijack:\n    - tcp://any:53\n    - udp://any:53\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'TUN_DNS_HIJACK_TYPE')).toBe(false)
})

test('missing tun.dns-hijack key → not flagged', () => {
  const doc = parseDocument('tun:\n  enable: true\n')
  expect(checkUniversalInvariants(doc).some((i) => idOf(i) === 'TUN_DNS_HIJACK_TYPE')).toBe(false)
})

// --- aggregate happy path -------------------------------------------------

test('no issues for a healthy config', () => {
  const doc = parseDocument(
    [
      'secret: "0000000000000000000000000000000000000000000000000000000000000000"',
      'dns: { listen: 127.0.0.1:1053 }',
      'tun: { enable: true }',
      'interface-name: eth0',
    ].join('\n'),
  )
  expect(checkUniversalInvariants(doc)).toEqual([])
})

test('no issues for an empty-ish doc (nothing tested is present)', () => {
  const doc = parseDocument('mode: rule\n')
  expect(checkUniversalInvariants(doc)).toEqual([])
})
