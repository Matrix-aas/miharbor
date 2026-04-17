// CIDR evaluator tests.

import { expect, test } from 'bun:test'
import {
  createTrustProxyEvaluator,
  parseCidr,
  ipToBigInt,
  isIPv6,
} from '../../src/auth/trust-proxy.ts'

test('IPv4 /32 exact match', () => {
  const ev = createTrustProxyEvaluator('192.168.1.1/32')
  expect(ev.contains('192.168.1.1')).toBe(true)
  expect(ev.contains('192.168.1.2')).toBe(false)
})

test('IPv4 /24 subnet', () => {
  const ev = createTrustProxyEvaluator('192.168.1.0/24')
  expect(ev.contains('192.168.1.0')).toBe(true)
  expect(ev.contains('192.168.1.255')).toBe(true)
  expect(ev.contains('192.168.2.1')).toBe(false)
})

test('IPv4 default /32 when no prefix given', () => {
  const ev = createTrustProxyEvaluator('10.0.0.5')
  expect(ev.contains('10.0.0.5')).toBe(true)
  expect(ev.contains('10.0.0.6')).toBe(false)
})

test('IPv4 /16 + /8 combinations', () => {
  const ev = createTrustProxyEvaluator('10.0.0.0/8, 172.16.0.0/12')
  expect(ev.contains('10.255.255.1')).toBe(true)
  expect(ev.contains('172.16.5.1')).toBe(true)
  expect(ev.contains('172.32.0.1')).toBe(false)
  expect(ev.contains('192.168.1.1')).toBe(false)
})

test('IPv6 exact /128', () => {
  const ev = createTrustProxyEvaluator('::1/128')
  expect(ev.contains('::1')).toBe(true)
  expect(ev.contains('::2')).toBe(false)
})

test('IPv6 /64 subnet', () => {
  const ev = createTrustProxyEvaluator('fe80::/64')
  expect(ev.contains('fe80::1')).toBe(true)
  expect(ev.contains('fe80::ffff:1234')).toBe(true)
  expect(ev.contains('fe81::1')).toBe(false)
})

test('does NOT mix IPv4 / IPv6 versions', () => {
  const ev = createTrustProxyEvaluator('192.168.1.0/24')
  expect(ev.contains('::1')).toBe(false)
})

test('invalid CIDR entries are dropped, good ones still work', () => {
  const errors: string[] = []
  const ev = createTrustProxyEvaluator('10.0.0.0/8, totally-bogus, 192.168.1.0/24', (raw) => {
    errors.push(raw)
  })
  expect(errors).toContain('totally-bogus')
  expect(ev.contains('10.5.5.5')).toBe(true)
  expect(ev.contains('192.168.1.99')).toBe(true)
})

test('empty CIDR list → contains always false', () => {
  const ev = createTrustProxyEvaluator('')
  expect(ev.contains('127.0.0.1')).toBe(false)
  expect(ev.contains('::1')).toBe(false)
})

test('isIPv6 detection + ipToBigInt round-trip', () => {
  expect(isIPv6('::1')).toBe(true)
  expect(isIPv6('192.168.1.1')).toBe(false)
  expect(ipToBigInt('0.0.0.1', 4)).toBe(1n)
  expect(ipToBigInt('0.0.0.255', 4)).toBe(255n)
  expect(ipToBigInt('255.255.255.255', 4)).toBe((1n << 32n) - 1n)
})

test('parseCidr throws on out-of-range prefix', () => {
  expect(() => parseCidr('10.0.0.0/40')).toThrow(/out of range/)
  expect(() => parseCidr('::/129')).toThrow(/out of range/)
})

test('parseCidr throws on invalid octet', () => {
  expect(() => parseCidr('10.0.0.999/24')).toThrow()
})
