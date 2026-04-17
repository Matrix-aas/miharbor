// Tests for the Profile view projection (Task 37).
//
// Mirror of dns.test.ts / tun.test.ts / sniffer.test.ts — exercises the known
// field projection on the golden fixture plus round-trip of unknown keys,
// invalid enum rejection, and the reserved-section isolation rule.

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { getProfileConfig } from '../../../src/config/views/profile.ts'

const GOLDEN = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
const MINIMAL = readFileSync('apps/server/tests/fixtures/config-minimal.yaml', 'utf8')

test('getProfileConfig projects every known field from the golden fixture', () => {
  const p = getProfileConfig(parseDocument(GOLDEN))

  expect(p.mode).toBe('rule')
  expect(p['log-level']).toBe('info')
  expect(p.ipv6).toBe(false)
  expect(p['tcp-concurrent']).toBe(true)
  expect(p['unified-delay']).toBe(true)
  expect(p['geo-auto-update']).toBe(true)
  expect(p['geo-update-interval']).toBe(168)
  expect(p['geodata-mode']).toBe(true)
  expect(p['external-controller']).toBe('192.168.1.1:9090')
  expect(p.secret).toBe('0000000000000000000000000000000000000000000000000000000000000000')
  expect(p['external-ui']).toBe('./zash')
  expect(p['external-ui-url']).toBe(
    'https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip',
  )
  expect(p['find-process-mode']).toBe('off')
  expect(p['keep-alive-interval']).toBe(15)
  expect(p.profile?.['store-selected']).toBe(true)
})

test('getProfileConfig handles the minimal fixture', () => {
  const p = getProfileConfig(parseDocument(MINIMAL))
  expect(p.mode).toBe('rule')
  expect(p['log-level']).toBe('info')
  expect(p.ipv6).toBe(false)
  expect(p['external-controller']).toBe('127.0.0.1:9090')
  expect(p.secret).toBe('')
  // Fields absent in the fixture stay undefined.
  expect(p['mixed-port']).toBeUndefined()
  expect(p['tcp-concurrent']).toBeUndefined()
  expect(p.authentication).toBeUndefined()
})

test('getProfileConfig returns {} on an empty doc', () => {
  expect(getProfileConfig(parseDocument(''))).toEqual({})
})

test('getProfileConfig returns {} on a doc with only reserved sections', () => {
  const yaml = `
dns:
  enable: true
tun:
  enable: true
rules:
  - MATCH,DIRECT
`
  // The projection ignores known reserved sections — extras stays empty.
  const p = getProfileConfig(parseDocument(yaml))
  expect(p).toEqual({})
})

test('getProfileConfig preserves unknown top-level keys under extras', () => {
  const yaml = `
mode: rule
some-future-knob: true
another-unknown:
  nested: value
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p.mode).toBe('rule')
  expect(p.extras).toBeDefined()
  expect(p.extras?.['some-future-knob']).toBe(true)
  expect(p.extras?.['another-unknown']).toEqual({ nested: 'value' })
})

test('getProfileConfig ignores reserved section keys (they are not extras)', () => {
  const yaml = `
mode: rule
dns:
  enable: true
tun:
  enable: true
sniffer:
  enable: true
rules: []
proxies: []
proxy-groups: []
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p.mode).toBe('rule')
  expect(p.extras).toBeUndefined()
})

test('getProfileConfig rejects invalid enum values', () => {
  const yaml = `
mode: bogus
log-level: verbose
find-process-mode: maybe
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p.mode).toBeUndefined()
  expect(p['log-level']).toBeUndefined()
  expect(p['find-process-mode']).toBeUndefined()
})

test('getProfileConfig parses the nested profile sub-section', () => {
  const yaml = `
profile:
  store-selected: true
  store-fake-ip: false
  experimental-sub: 1
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p.profile?.['store-selected']).toBe(true)
  expect(p.profile?.['store-fake-ip']).toBe(false)
  expect(p.profile?.extras?.['experimental-sub']).toBe(1)
})

test('getProfileConfig keeps authentication verbatim (no parsing)', () => {
  const yaml = `
authentication:
  - alice:hunter2
  - bob:seaWitch
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p.authentication).toEqual(['alice:hunter2', 'bob:seaWitch'])
})

test('getProfileConfig handles scalar type coercion', () => {
  const yaml = `
mode: rule
mixed-port: 7890
allow-lan: true
bind-address: "*"
external-controller: "127.0.0.1:9090"
secret: "abc123"
tcp-concurrent: true
unified-delay: false
global-client-fingerprint: chrome
geodata-mode: false
geo-auto-update: true
geo-update-interval: 24
keep-alive-interval: 15
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p.mode).toBe('rule')
  expect(p['mixed-port']).toBe(7890)
  expect(p['allow-lan']).toBe(true)
  expect(p['bind-address']).toBe('*')
  expect(p['external-controller']).toBe('127.0.0.1:9090')
  expect(p.secret).toBe('abc123')
  expect(p['tcp-concurrent']).toBe(true)
  expect(p['unified-delay']).toBe(false)
  expect(p['global-client-fingerprint']).toBe('chrome')
  expect(p['geodata-mode']).toBe(false)
  expect(p['geo-auto-update']).toBe(true)
  expect(p['geo-update-interval']).toBe(24)
  expect(p['keep-alive-interval']).toBe(15)
})

test('getProfileConfig rejects non-numeric number fields', () => {
  const yaml = `
mixed-port: not-a-number
geo-update-interval: banana
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p['mixed-port']).toBeUndefined()
  expect(p['geo-update-interval']).toBeUndefined()
})

test('getProfileConfig projects interface-name (v0.2.4)', () => {
  const p = getProfileConfig(parseDocument(GOLDEN))
  expect(p['interface-name']).toBe('enp170s0')
})

test('getProfileConfig projects geox-url block with known subfields (v0.2.4)', () => {
  const yaml = `
geox-url:
  geoip: https://example.com/geoip.dat
  geosite: https://example.com/geosite.dat
  mmdb: https://example.com/Country.mmdb
  asn: https://example.com/ASN.mmdb
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p['geox-url']?.geoip).toBe('https://example.com/geoip.dat')
  expect(p['geox-url']?.geosite).toBe('https://example.com/geosite.dat')
  expect(p['geox-url']?.mmdb).toBe('https://example.com/Country.mmdb')
  expect(p['geox-url']?.asn).toBe('https://example.com/ASN.mmdb')
})

test('getProfileConfig preserves unknown sub-keys on geox-url via extras (v0.2.4)', () => {
  const yaml = `
geox-url:
  geoip: https://example.com/geoip.dat
  experimental-source: https://example.com/future.dat
`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p['geox-url']?.geoip).toBe('https://example.com/geoip.dat')
  expect(p['geox-url']?.extras?.['experimental-source']).toBe('https://example.com/future.dat')
})

test('getProfileConfig omits geox-url entirely when block is empty (v0.2.4)', () => {
  const yaml = `mode: rule\n`
  const p = getProfileConfig(parseDocument(yaml))
  expect(p['geox-url']).toBeUndefined()
})
