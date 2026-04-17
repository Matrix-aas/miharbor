// Tests for the DNS view projection (Task 34).
//
// Uses the same golden fixture as the other view tests; adds one small
// inline fixture for round-tripping unknown keys into `extras`.

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { getDnsConfig } from '../../../src/config/views/dns.ts'

const GOLDEN = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
const MINIMAL = readFileSync('apps/server/tests/fixtures/config-minimal.yaml', 'utf8')

test('getDnsConfig projects every known field from the golden fixture', () => {
  const dns = getDnsConfig(parseDocument(GOLDEN))

  expect(dns.enable).toBe(true)
  expect(dns.listen).toBe('127.0.0.1:1053')
  expect(dns.ipv6).toBe(false)
  expect(dns['cache-algorithm']).toBe('arc')
  expect(dns['enhanced-mode']).toBe('fake-ip')
  expect(dns['fake-ip-range']).toBe('198.18.0.1/16')
  expect(dns['use-hosts']).toBe(true)
  expect(dns['respect-rules']).toBe(true)

  expect(dns['direct-nameserver']).toEqual([
    'https://common.dot.dns.yandex.net/dns-query',
    'https://dns.adguard-dns.com/dns-query',
    'https://cloudflare-dns.com/dns-query',
    'https://dns.google/dns-query',
  ])
  expect(dns['proxy-server-nameserver']).toEqual(['1.1.1.1', '8.8.8.8'])
  expect(dns['default-nameserver']).toEqual(['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4'])
  expect(dns.nameserver).toEqual([
    'https://cloudflare-dns.com/dns-query',
    'https://doh.opendns.com/dns-query',
    'https://dns.google/dns-query',
  ])
  expect(dns.fallback).toEqual(['https://dns.google/dns-query', 'tls://dns.google'])

  expect(dns['fallback-filter']).toBeDefined()
  expect(dns['fallback-filter']?.geoip).toBe(true)
  expect(dns['fallback-filter']?.['geoip-code']).toBe('RU')
  expect(dns['fallback-filter']?.ipcidr).toEqual(['240.0.0.0/4'])

  expect(dns['fake-ip-filter-mode']).toBe('blacklist')
  expect(dns['fake-ip-filter']).toContain('*.lan')
  expect(dns['fake-ip-filter']).toContain('+.msftconnecttest.com')

  expect(dns['nameserver-policy']).toEqual({
    '+.supercell.net': 'https://dns.google/dns-query',
    '+.brawlstarsgame.com': 'https://dns.google/dns-query',
  })
})

test('getDnsConfig handles the minimal fixture (partial fields)', () => {
  const dns = getDnsConfig(parseDocument(MINIMAL))
  expect(dns.enable).toBe(true)
  expect(dns.listen).toBe('127.0.0.1:1053')
  expect(dns.ipv6).toBe(false)
  expect(dns['enhanced-mode']).toBe('fake-ip')
  expect(dns['fake-ip-range']).toBe('198.18.0.1/16')
  expect(dns['default-nameserver']).toEqual(['1.1.1.1', '8.8.8.8'])
  expect(dns.nameserver).toEqual(['https://cloudflare-dns.com/dns-query'])
  // Fields absent in the fixture stay undefined.
  expect(dns.fallback).toBeUndefined()
  expect(dns['proxy-server-nameserver']).toBeUndefined()
  expect(dns['nameserver-policy']).toBeUndefined()
  expect(dns['cache-algorithm']).toBeUndefined()
})

test('getDnsConfig returns {} when the dns: section is absent', () => {
  expect(getDnsConfig(parseDocument('mode: rule\n'))).toEqual({})
})

test('getDnsConfig preserves unknown keys under extras', () => {
  const yaml = `
dns:
  enable: true
  listen: 127.0.0.1:1053
  some-future-knob: true
  another-unknown:
    nested: value
`
  const dns = getDnsConfig(parseDocument(yaml))
  expect(dns.enable).toBe(true)
  expect(dns.listen).toBe('127.0.0.1:1053')
  expect(dns.extras).toBeDefined()
  expect(dns.extras?.['some-future-knob']).toBe(true)
  expect(dns.extras?.['another-unknown']).toEqual({ nested: 'value' })
})

test('getDnsConfig normalises nameserver-policy values to string | string[]', () => {
  const yaml = `
dns:
  nameserver-policy:
    single.example.com: https://dns.google/dns-query
    multi.example.com:
      - https://cloudflare-dns.com/dns-query
      - https://dns.google/dns-query
`
  const dns = getDnsConfig(parseDocument(yaml))
  expect(dns['nameserver-policy']).toEqual({
    'single.example.com': 'https://dns.google/dns-query',
    'multi.example.com': ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'],
  })
})

test('getDnsConfig rejects invalid enum values (enhanced-mode, fake-ip-filter-mode, cache-algorithm)', () => {
  const yaml = `
dns:
  enhanced-mode: bogus
  fake-ip-filter-mode: not-a-mode
  cache-algorithm: xyz
`
  const dns = getDnsConfig(parseDocument(yaml))
  expect(dns['enhanced-mode']).toBeUndefined()
  expect(dns['fake-ip-filter-mode']).toBeUndefined()
  expect(dns['cache-algorithm']).toBeUndefined()
})
