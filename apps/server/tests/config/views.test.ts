import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { getServices } from '../../src/config/views/services.ts'
import { getProxies } from '../../src/config/views/proxies.ts'
import { getMeta } from '../../src/config/views/meta.ts'
import { META_SECRET_SENTINEL } from 'miharbor-shared'

const GOLDEN = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')

test('getServices returns one Service per proxy-group', () => {
  const doc = parseDocument(GOLDEN)
  const services = getServices(doc)
  // Sanity: the golden config has ~40 proxy-groups (38 select + url-test + ad-block).
  expect(services.length).toBeGreaterThan(10)
  const names = new Set(services.map((s) => s.name))
  expect(names.has('YouTube')).toBe(true)
  expect(names.has('Остальной трафик')).toBe(true)
})

test('getServices deduces direction from first proxy of a select group', () => {
  const doc = parseDocument(GOLDEN)
  const services = getServices(doc)
  const youTube = services.find((s) => s.name === 'YouTube')!
  expect(youTube.group.type).toBe('select')
  expect(youTube.group.proxies[0]).toBe('🇳🇱 Нидерланды')
  expect(youTube.direction).toBe('VPN')

  const ru = services.find((s) => s.name === 'RU трафик')!
  expect(ru.direction).toBe('DIRECT') // first proxy is DIRECT

  // url-test group is reported as MIXED
  const hc = services.find((s) => s.name === 'health-check')!
  expect(hc.direction).toBe('MIXED')
  expect(hc.group.type).toBe('url-test')
})

test('getServices attaches relevant rules by target name, with original indices', () => {
  const doc = parseDocument(GOLDEN)
  const services = getServices(doc)
  const openai = services.find((s) => s.name === 'OpenAI')!
  // OpenAI has 5 rules in the golden fixture (GEOSITE + 4 DOMAIN-SUFFIX).
  expect(openai.rules.length).toBeGreaterThanOrEqual(5)
  // indices must be strictly ascending
  for (let i = 1; i < openai.rules.length; i++) {
    expect(openai.rules[i]!.index).toBeGreaterThan(openai.rules[i - 1]!.index)
  }
})

test('getServices handles an empty doc', () => {
  expect(getServices(parseDocument('mode: rule\n'))).toEqual([])
})

test('getProxies projects a WireGuard node with typed keys', () => {
  const doc = parseDocument(GOLDEN)
  const proxies = getProxies(doc)
  expect(proxies).toHaveLength(1)
  const wg = proxies[0]!
  expect(wg.type).toBe('wireguard')
  expect(wg.name).toBe('🇳🇱 Нидерланды')
  expect(wg.server).toBe('198.51.100.1')
  // WireGuard-specific fields present
  expect((wg as { 'public-key': string })['public-key']).toMatch(/=$/)
  expect((wg as { 'amnezia-wg-option': Record<string, number> })['amnezia-wg-option'].jc).toBe(3)
})

test('getProxies returns [] when proxies key is absent', () => {
  expect(getProxies(parseDocument('mode: rule\n'))).toEqual([])
})

test('getMeta surfaces top-level scalars and sub-section projections', () => {
  const doc = parseDocument(GOLDEN)
  const meta = getMeta(doc)
  expect(meta.mode).toBe('rule')
  expect(meta['log-level']).toBe('info')
  expect(meta.ipv6).toBe(false)
  expect(meta['interface-name']).toBe('enp170s0')
  expect(meta['external-controller']).toBe('192.168.1.1:9090')
  // tun sub-projection
  expect(meta.tun?.enable).toBe(true)
  expect(meta.tun?.['dns-hijack']).toEqual([]) // invariant: disabled
  // dns sub-projection
  expect(meta.dns?.listen).toBe('127.0.0.1:1053')
  expect(meta.dns?.['enhanced-mode']).toBe('fake-ip')
})

test('getMeta handles a minimal doc', () => {
  const doc = parseDocument(readFileSync('apps/server/tests/fixtures/config-minimal.yaml', 'utf8'))
  const meta = getMeta(doc)
  expect(meta.mode).toBe('rule')
  expect(meta['interface-name']).toBe('eth0')
  expect(meta.tun?.enable).toBe(true)
  expect(meta.dns?.listen).toBe('127.0.0.1:1053')
})

test('getMeta substitutes secret with META_SECRET_SENTINEL (v0.2.4)', () => {
  const doc = parseDocument(GOLDEN)
  const meta = getMeta(doc)
  // Real value NEVER leaks through /api/config/meta response.
  expect(meta.secret).not.toBe('0000000000000000000000000000000000000000000000000000000000000000')
  expect(meta.secret).toBe(META_SECRET_SENTINEL)
})

test('getMeta leaves absent secret alone — no sentinel injected (v0.2.4)', () => {
  // An operator with `external-controller` on loopback and no secret must
  // NOT get a sentinel that implies a value is set.
  const yaml = `
mode: rule
external-controller: 127.0.0.1:9090
`
  const meta = getMeta(parseDocument(yaml))
  expect(meta.secret).toBeUndefined()
})

test('getMeta leaves empty-string secret alone (v0.2.4)', () => {
  // Edge case: explicit empty secret. We don't inject the sentinel because
  // that would claim a value is set when it isn't.
  const yaml = `
mode: rule
secret: ""
`
  const meta = getMeta(parseDocument(yaml))
  expect(meta.secret).toBe('')
})
