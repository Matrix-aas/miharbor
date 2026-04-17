// Tests for the Sniffer view projection (Task 36).
//
// Mirror of tun.test.ts — exercises the known-field projection, per-protocol
// sniff-map projection, round-trip of unknown keys, and the absent-section
// fallback.

import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { getSnifferConfig } from '../../../src/config/views/sniffer.ts'

test('getSnifferConfig returns {} when the sniffer: section is absent', () => {
  expect(getSnifferConfig(parseDocument('mode: rule\n'))).toEqual({})
})

test('getSnifferConfig projects scalar fields', () => {
  const yaml = `
sniffer:
  enable: true
  override-destination: false
  parse-pure-ip: true
  force-dns-mapping: true
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.enable).toBe(true)
  expect(sn['override-destination']).toBe(false)
  expect(sn['parse-pure-ip']).toBe(true)
  expect(sn['force-dns-mapping']).toBe(true)
})

test('getSnifferConfig projects list fields', () => {
  const yaml = `
sniffer:
  force-domain:
    - +.netflix.com
    - +.google.com
  skip-domain:
    - +.apple.com
  port-whitelist:
    - "80"
    - "443"
    - "8080-8090"
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn['force-domain']).toEqual(['+.netflix.com', '+.google.com'])
  expect(sn['skip-domain']).toEqual(['+.apple.com'])
  expect(sn['port-whitelist']).toEqual(['80', '443', '8080-8090'])
})

test('getSnifferConfig projects per-protocol sniff map', () => {
  const yaml = `
sniffer:
  sniff:
    HTTP:
      ports:
        - "80"
        - "8080-8090"
      override-destination: true
    TLS:
      ports:
        - "443"
    QUIC:
      ports:
        - "443"
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.sniff?.HTTP?.ports).toEqual(['80', '8080-8090'])
  expect(sn.sniff?.HTTP?.['override-destination']).toBe(true)
  expect(sn.sniff?.TLS?.ports).toEqual(['443'])
  expect(sn.sniff?.QUIC?.ports).toEqual(['443'])
})

test('getSnifferConfig preserves unknown top-level keys in extras', () => {
  const yaml = `
sniffer:
  enable: true
  some-future-knob: 42
  another-unknown:
    nested: value
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.enable).toBe(true)
  expect(sn.extras).toBeDefined()
  expect(sn.extras?.['some-future-knob']).toBe(42)
  expect(sn.extras?.['another-unknown']).toEqual({ nested: 'value' })
})

test('getSnifferConfig preserves unknown protocols in sniff.extras', () => {
  const yaml = `
sniffer:
  sniff:
    HTTP:
      ports:
        - "80"
    MYSQL:
      ports:
        - "3306"
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.sniff?.HTTP?.ports).toEqual(['80'])
  expect(sn.sniff?.extras?.MYSQL).toEqual({ ports: ['3306'] })
})

test('getSnifferConfig preserves unknown per-protocol keys in protocol.extras', () => {
  const yaml = `
sniffer:
  sniff:
    HTTP:
      ports:
        - "80"
      future-per-proto-knob: true
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.sniff?.HTTP?.ports).toEqual(['80'])
  expect(sn.sniff?.HTTP?.extras).toEqual({ 'future-per-proto-knob': true })
})

test('getSnifferConfig ignores non-boolean scalars in boolean fields', () => {
  const yaml = `
sniffer:
  enable: "not-a-bool"
  override-destination: 1
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.enable).toBeUndefined()
  expect(sn['override-destination']).toBeUndefined()
})

test('getSnifferConfig returns an empty sniff map when sniff: {} is explicit', () => {
  const yaml = `
sniffer:
  sniff: {}
`
  const sn = getSnifferConfig(parseDocument(yaml))
  expect(sn.sniff).toEqual({})
})
