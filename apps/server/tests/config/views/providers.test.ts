// Tests for the rule-providers view projection (Task 38).
//
// Mirrors sniffer.test.ts / tun.test.ts: exercises the known-field
// projection for each transport type, preserves unknown keys, and survives
// malformed entries by stashing them in `extras` verbatim.

import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { getProvidersConfig } from '../../../src/config/views/providers.ts'

test('getProvidersConfig returns {} when the rule-providers: section is absent', () => {
  expect(getProvidersConfig(parseDocument('mode: rule\n'))).toEqual({})
})

test('getProvidersConfig projects an http provider with all fields', () => {
  const yaml = `
rule-providers:
  adblock:
    type: http
    behavior: domain
    format: yaml
    url: https://example.com/adblock.yaml
    interval: 86400
    proxy: PROXY
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.providers?.adblock).toEqual({
    type: 'http',
    behavior: 'domain',
    format: 'yaml',
    url: 'https://example.com/adblock.yaml',
    interval: 86400,
    proxy: 'PROXY',
  })
})

test('getProvidersConfig projects a file provider', () => {
  const yaml = `
rule-providers:
  local-rules:
    type: file
    behavior: classical
    format: text
    path: ./rules/my-rules.txt
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.providers?.['local-rules']).toEqual({
    type: 'file',
    behavior: 'classical',
    format: 'text',
    path: './rules/my-rules.txt',
  })
})

test('getProvidersConfig projects an inline provider with payload', () => {
  const yaml = `
rule-providers:
  blocks:
    type: inline
    behavior: classical
    payload:
      - DOMAIN-SUFFIX,evil.example
      - IP-CIDR,10.0.0.0/8,no-resolve
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.providers?.blocks?.type).toBe('inline')
  expect(rp.providers?.blocks?.behavior).toBe('classical')
  expect(rp.providers?.blocks?.payload).toEqual([
    'DOMAIN-SUFFIX,evil.example',
    'IP-CIDR,10.0.0.0/8,no-resolve',
  ])
})

test('getProvidersConfig preserves unknown per-provider keys in provider.extras', () => {
  const yaml = `
rule-providers:
  adblock:
    type: http
    behavior: domain
    url: https://example.com/adblock.yaml
    interval: 600
    future-knob: 42
    another-thing:
      nested: value
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.providers?.adblock?.extras).toEqual({
    'future-knob': 42,
    'another-thing': { nested: 'value' },
  })
})

test('getProvidersConfig sends malformed entries to top-level extras', () => {
  const yaml = `
rule-providers:
  bad-no-type:
    behavior: domain
    url: https://example.com/x.yaml
  bad-bogus-type:
    type: invalid
    behavior: domain
  good-one:
    type: http
    behavior: domain
    url: https://example.com/y.yaml
    interval: 3600
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.providers?.['good-one']).toBeDefined()
  expect(rp.providers?.['bad-no-type']).toBeUndefined()
  expect(rp.providers?.['bad-bogus-type']).toBeUndefined()
  expect(rp.extras?.['bad-no-type']).toBeDefined()
  expect(rp.extras?.['bad-bogus-type']).toBeDefined()
})

test('getProvidersConfig sends non-object entries to extras', () => {
  const yaml = `
rule-providers:
  scalar-value: "just a string"
  good:
    type: http
    behavior: ipcidr
    url: https://example.com/ip.yaml
    interval: 1800
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.extras?.['scalar-value']).toBe('just a string')
  expect(rp.providers?.good?.behavior).toBe('ipcidr')
})

test('getProvidersConfig returns empty providers map when rule-providers is {}', () => {
  const rp = getProvidersConfig(parseDocument('rule-providers: {}\n'))
  expect(rp).toEqual({})
})

test('getProvidersConfig ignores non-string/non-number field types', () => {
  const yaml = `
rule-providers:
  adblock:
    type: http
    behavior: domain
    url: 42
    interval: "not-a-number"
`
  const rp = getProvidersConfig(parseDocument(yaml))
  expect(rp.providers?.adblock).toEqual({
    type: 'http',
    behavior: 'domain',
  })
})
