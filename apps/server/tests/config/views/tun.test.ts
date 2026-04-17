// Tests for the TUN view projection (Task 35).
//
// Mirror of dns.test.ts — exercises the known field projection on the golden
// fixture plus round-trip of unknown keys, invalid enum rejection, and the
// absent-section fallback.

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { getTunConfig } from '../../../src/config/views/tun.ts'

const GOLDEN = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
const MINIMAL = readFileSync('apps/server/tests/fixtures/config-minimal.yaml', 'utf8')

test('getTunConfig projects every known field from the golden fixture', () => {
  const tun = getTunConfig(parseDocument(GOLDEN))

  expect(tun.enable).toBe(true)
  expect(tun.stack).toBe('system')
  expect(tun.device).toBe('mihomo-tun')
  expect(tun['dns-hijack']).toEqual([])
  expect(tun['auto-route']).toBe(true)
  expect(tun['auto-redirect']).toBe(false)
  expect(tun['auto-detect-interface']).toBe(false)
  expect(tun['strict-route']).toBe(false)
  expect(tun.mtu).toBe(1500)
  expect(tun['route-exclude-address']).toEqual([
    '198.51.100.1/32',
    '192.168.0.0/16',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '224.0.0.0/4',
    '255.255.255.255/32',
  ])
})

test('getTunConfig handles the minimal fixture (partial fields)', () => {
  const tun = getTunConfig(parseDocument(MINIMAL))
  expect(tun.enable).toBe(true)
  expect(tun.stack).toBe('system')
  expect(tun.device).toBe('mihomo-tun')
  expect(tun['dns-hijack']).toEqual([])
  expect(tun['auto-route']).toBe(true)
  expect(tun['auto-redirect']).toBe(false)
  expect(tun['auto-detect-interface']).toBe(false)
  // Fields absent in the fixture stay undefined.
  expect(tun.mtu).toBeUndefined()
  expect(tun['route-exclude-address']).toBeUndefined()
  expect(tun['strict-route']).toBeUndefined()
})

test('getTunConfig returns {} when the tun: section is absent', () => {
  expect(getTunConfig(parseDocument('mode: rule\n'))).toEqual({})
})

test('getTunConfig preserves unknown keys under extras', () => {
  const yaml = `
tun:
  enable: true
  device: mihomo-tun
  some-future-knob: true
  another-unknown:
    nested: value
`
  const tun = getTunConfig(parseDocument(yaml))
  expect(tun.enable).toBe(true)
  expect(tun.device).toBe('mihomo-tun')
  expect(tun.extras).toBeDefined()
  expect(tun.extras?.['some-future-knob']).toBe(true)
  expect(tun.extras?.['another-unknown']).toEqual({ nested: 'value' })
})

test('getTunConfig rejects invalid stack enum', () => {
  const yaml = `
tun:
  stack: bogus
`
  const tun = getTunConfig(parseDocument(yaml))
  expect(tun.stack).toBeUndefined()
})

test('getTunConfig rejects non-numeric MTU', () => {
  const yaml = `
tun:
  mtu: not-a-number
`
  const tun = getTunConfig(parseDocument(yaml))
  expect(tun.mtu).toBeUndefined()
})

test('getTunConfig returns full list fields', () => {
  const yaml = `
tun:
  dns-hijack:
    - any:53
  route-address:
    - 1.2.3.0/24
  inet4-address:
    - 198.18.0.1/30
  inet6-address:
    - fd00::1/64
  interface-name: enp170s0
  endpoint-independent-nat: true
  exclude-interface:
    - docker0
    - br-+
`
  const tun = getTunConfig(parseDocument(yaml))
  expect(tun['dns-hijack']).toEqual(['any:53'])
  expect(tun['route-address']).toEqual(['1.2.3.0/24'])
  expect(tun['inet4-address']).toEqual(['198.18.0.1/30'])
  expect(tun['inet6-address']).toEqual(['fd00::1/64'])
  expect(tun['interface-name']).toBe('enp170s0')
  expect(tun['endpoint-independent-nat']).toBe(true)
  expect(tun['exclude-interface']).toEqual(['docker0', 'br-+'])
})
