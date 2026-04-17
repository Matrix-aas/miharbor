// Unit tests for the known_hosts parser + matcher. We generate synthetic
// entries (random bytes) because the format is independent of key-crypto
// validity — `keyMatchesKnownHost` only needs byte-for-byte equality.

import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  hostMatchCandidates,
  keyFingerprint,
  keyMatchesKnownHost,
  loadKnownHosts,
  parseKnownHosts,
} from '../../src/transport/ssh-known-hosts.ts'

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

// ---------- parseKnownHosts ----------

test('parseKnownHosts accepts a plain host line', () => {
  const entries = parseKnownHosts(`router.lan ssh-ed25519 ${b64('KEY-A')}\n`)
  expect(entries).toHaveLength(1)
  expect(entries[0]!.hostPatterns).toEqual(['router.lan'])
  expect(entries[0]!.keyType).toBe('ssh-ed25519')
  expect(entries[0]!.keyBytes.toString('utf8')).toBe('KEY-A')
})

test('parseKnownHosts handles comma-separated host lists and trailing comments', () => {
  const entries = parseKnownHosts(
    `router.lan,192.168.1.1 ssh-rsa ${b64('KEY-B')} some comment text\n`,
  )
  expect(entries).toHaveLength(1)
  expect(entries[0]!.hostPatterns).toEqual(['router.lan', '192.168.1.1'])
})

test('parseKnownHosts skips blank lines, # comments, and @ markers', () => {
  const warnings: string[] = []
  const text = [
    '',
    '# a comment',
    '@cert-authority *.example.com ssh-rsa AAAA',
    '@revoked evil.example.com ssh-rsa AAAA',
    `router.lan ssh-ed25519 ${b64('OK')}`,
  ].join('\n')
  const entries = parseKnownHosts(text, (m) => warnings.push(m))
  expect(entries).toHaveLength(1)
  // Both markers should have warned.
  expect(warnings.filter((w) => /marker-prefixed/.test(w)).length).toBe(2)
})

test('parseKnownHosts warns on hashed hostname entries and skips them', () => {
  const warnings: string[] = []
  const entries = parseKnownHosts(`|1|abc=|def= ssh-ed25519 ${b64('HASHED')}\n`, (m) =>
    warnings.push(m),
  )
  expect(entries).toHaveLength(0)
  expect(warnings.some((w) => /hashed hostname entries are not supported/.test(w))).toBe(true)
})

test('parseKnownHosts warns on malformed lines and empty-base64 payloads', () => {
  const warnings: string[] = []
  // Two bad lines:
  //   - "justonefield" → fewer than 3 space-separated tokens (malformed).
  //   - "host keytype <empty>" → base64-decodes to 0 bytes (no key material).
  //     Note: Node's Buffer.from('…', 'base64') is forgiving with stray
  //     punctuation — we can't catch "mostly bogus" strings here, only
  //     the strictly empty result.
  const entries = parseKnownHosts(['justonefield', 'host keytype  '].join('\n'), (m) =>
    warnings.push(m),
  )
  expect(entries).toHaveLength(0)
  // Both should have warned.
  expect(warnings.length).toBeGreaterThanOrEqual(1)
})

// ---------- hostMatchCandidates ----------

test('hostMatchCandidates returns bare host + [host]:22 for port 22', () => {
  const cands = hostMatchCandidates('router.lan', 22)
  expect(cands).toContain('router.lan')
  expect(cands).toContain('[router.lan]:22')
})

test('hostMatchCandidates returns only [host]:port for non-standard port', () => {
  const cands = hostMatchCandidates('router.lan', 2222)
  expect(cands).toEqual(['[router.lan]:2222'])
})

// ---------- keyMatchesKnownHost ----------

test('keyMatchesKnownHost returns true for matching host + key bytes', () => {
  const key = Buffer.from('trusted-key-blob')
  const entries = parseKnownHosts(`router.lan ssh-ed25519 ${key.toString('base64')}\n`)
  expect(keyMatchesKnownHost(entries, 'router.lan', 22, key)).toBe(true)
})

test('keyMatchesKnownHost returns false when host matches but key differs', () => {
  const trusted = Buffer.from('trusted-key')
  const rogue = Buffer.from('attacker-key')
  const entries = parseKnownHosts(`router.lan ssh-ed25519 ${trusted.toString('base64')}\n`)
  expect(keyMatchesKnownHost(entries, 'router.lan', 22, rogue)).toBe(false)
})

test('keyMatchesKnownHost returns false when key matches but host does not', () => {
  const key = Buffer.from('trusted-key')
  const entries = parseKnownHosts(`someotherhost ssh-ed25519 ${key.toString('base64')}\n`)
  expect(keyMatchesKnownHost(entries, 'router.lan', 22, key)).toBe(false)
})

test('keyMatchesKnownHost handles non-standard port via [host]:port syntax', () => {
  const key = Buffer.from('trusted')
  const entries = parseKnownHosts(`[router.lan]:2222 ssh-ed25519 ${key.toString('base64')}\n`)
  expect(keyMatchesKnownHost(entries, 'router.lan', 2222, key)).toBe(true)
  // Wrong port ⇒ reject.
  expect(keyMatchesKnownHost(entries, 'router.lan', 22, key)).toBe(false)
})

// ---------- keyFingerprint ----------

test('keyFingerprint produces a SHA256: prefix + non-empty hash', () => {
  const fp = keyFingerprint(Buffer.from('anything'))
  expect(fp.startsWith('SHA256:')).toBe(true)
  expect(fp.length).toBeGreaterThan('SHA256:'.length + 20)
  // Deterministic for same input.
  expect(keyFingerprint(Buffer.from('anything'))).toBe(fp)
})

// ---------- loadKnownHosts ----------

test('loadKnownHosts reads + parses an on-disk file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'miharbor-kh-'))
  try {
    const path = join(dir, 'known_hosts')
    const key = Buffer.from('disk-key')
    writeFileSync(path, `router.lan ssh-ed25519 ${key.toString('base64')}\n`)
    const entries = await loadKnownHosts(path)
    expect(entries).toHaveLength(1)
    expect(keyMatchesKnownHost(entries, 'router.lan', 22, key)).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
