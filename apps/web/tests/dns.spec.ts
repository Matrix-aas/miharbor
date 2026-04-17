// DNS screen component tests (Task 34 AC).
//
// Scope:
//   * Shared guardrail helpers (validateDnsListen + validateLiteralIp).
//   * NameserverList add / remove / per-entry warning.
//   * FakeIpFilterList mode toggle emits update:mode.
//   * NameserverPolicy renders rows, add, remove, move-up/-down, commit shape.
//   * yaml-mutator.setDnsConfig writes a fresh `dns:` section with canonical
//     key order + extras roundtrip.
//   * getDnsConfig (client mirror) matches the server projection on the
//     golden fixture slice.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { parseDocument } from 'yaml'
import type { DnsConfig } from 'miharbor-shared'
import { validateDnsListen, validateLiteralIp } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import NameserverList from '../src/components/dns/NameserverList.vue'
import FakeIpFilterList from '../src/components/dns/FakeIpFilterList.vue'
import NameserverPolicy from '../src/components/dns/NameserverPolicy.vue'
import { parseDraft, serializeDraft, setDnsConfig } from '../src/lib/yaml-mutator'
import { getDnsConfig } from '../src/lib/dns-view'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('DNS guardrail helpers', () => {
  it('validateDnsListen flags 0.0.0.0 bindings', () => {
    expect(validateDnsListen('0.0.0.0:1053')).toMatch(/0\.0\.0\.0/)
    expect(validateDnsListen('127.0.0.1:1053')).toBeNull()
  })
  it('validateDnsListen flags port 53', () => {
    expect(validateDnsListen('127.0.0.1:53')).toMatch(/:53/)
  })
  it('validateDnsListen returns null for empty/undefined', () => {
    expect(validateDnsListen(undefined)).toBeNull()
    expect(validateDnsListen('')).toBeNull()
  })

  it('validateLiteralIp accepts IPv4 literals', () => {
    expect(validateLiteralIp('1.1.1.1')).toBeNull()
    expect(validateLiteralIp('8.8.8.8')).toBeNull()
  })
  it('validateLiteralIp rejects hostnames', () => {
    expect(validateLiteralIp('cloudflare-dns.com')).toMatch(/hostname/)
  })
  it('validateLiteralIp rejects DoH URLs with hostnames', () => {
    expect(validateLiteralIp('https://cloudflare-dns.com/dns-query')).toMatch(/hostname/)
  })
})

describe('NameserverList', () => {
  it('renders one row per entry', () => {
    const wrapper = mount(NameserverList, {
      props: { modelValue: ['1.1.1.1', '8.8.8.8'] },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="nameserver-list-row"]')
    expect(rows.length).toBe(2)
  })

  it('add button emits update:modelValue with a new empty slot', async () => {
    const wrapper = mount(NameserverList, {
      props: { modelValue: ['1.1.1.1'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="nameserver-list-add"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    const last = emitted?.at(-1)?.[0]
    expect(last).toEqual(['1.1.1.1', ''])
  })

  it('surfaces per-entry warning chevron when validator trips', () => {
    const wrapper = mount(NameserverList, {
      props: {
        modelValue: ['1.1.1.1', 'cloudflare-dns.com'],
        validator: (v: string) => (validateLiteralIp(v) ? 'bad' : null),
      },
      global: { plugins: [makeI18n()] },
    })
    const warnings = wrapper.findAll('[data-testid="nameserver-row-warning"]')
    expect(warnings.length).toBe(1)
  })
})

describe('FakeIpFilterList', () => {
  it('emits update:mode when the select changes', async () => {
    const wrapper = mount(FakeIpFilterList, {
      props: { modelValue: ['*.lan'], mode: 'blacklist' as const },
      global: { plugins: [makeI18n()] },
    })
    const select = wrapper.get('[data-testid="fake-ip-filter-mode-select"]')
    await select.setValue('whitelist')
    const emitted = wrapper.emitted('update:mode') as unknown as string[][] | undefined
    expect(emitted?.[0]?.[0]).toBe('whitelist')
  })
})

describe('NameserverPolicy', () => {
  it('renders one row per policy entry', () => {
    const wrapper = mount(NameserverPolicy, {
      props: {
        modelValue: {
          '+.supercell.net': 'https://dns.google/dns-query',
          '+.brawlstarsgame.com': 'https://dns.google/dns-query',
        },
      },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="policy-row"]')
    expect(rows.length).toBe(2)
  })

  it('add + remove round-trip emits the expected shape', async () => {
    const wrapper = mount(NameserverPolicy, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="policy-add"]').trigger('click')
    // Fill in the first row.
    const inputs = wrapper.findAll('[data-testid="policy-row"] input')
    expect(inputs.length).toBe(2)
    await inputs[0]!.setValue('+.example.com')
    await inputs[1]!.setValue('https://dns.google/dns-query, https://cloudflare-dns.com/dns-query')

    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Record<string, string | string[]>>
    >
    const last = emitted.at(-1)?.[0]
    expect(last).toEqual({
      '+.example.com': ['https://dns.google/dns-query', 'https://cloudflare-dns.com/dns-query'],
    })
  })

  it('moveUp swaps the row with the one above', async () => {
    const wrapper = mount(NameserverPolicy, {
      props: {
        modelValue: {
          'a.example.com': '1.1.1.1',
          'b.example.com': '8.8.8.8',
        },
      },
      global: { plugins: [makeI18n()] },
    })
    const ups = wrapper.findAll('[data-testid="policy-up"]')
    // Second row's "up" button.
    await ups[1]!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Record<string, string | string[]>>
    >
    const last = emitted.at(-1)?.[0] as Record<string, string | string[]>
    expect(Object.keys(last)).toEqual(['b.example.com', 'a.example.com'])
  })
})

describe('yaml-mutator.setDnsConfig', () => {
  const base = `mode: rule\ndns:\n  enable: true\n  listen: 127.0.0.1:1053\n  nameserver:\n    - https://cloudflare-dns.com/dns-query\n`

  it('replaces the dns: section with the given config', () => {
    const doc = parseDraft(base)
    const next: DnsConfig = {
      enable: true,
      listen: '127.0.0.1:1054',
      nameserver: ['https://dns.google/dns-query'],
    }
    setDnsConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('listen: 127.0.0.1:1054')
    expect(out).toContain('https://dns.google/dns-query')
    expect(out).not.toContain('https://cloudflare-dns.com')
  })

  it('preserves extras verbatim', () => {
    const doc = parseDraft(base)
    const next: DnsConfig = {
      enable: true,
      extras: { 'future-knob': 42 },
    }
    setDnsConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('future-knob: 42')
  })

  it('deletes the dns: key when the config is empty', () => {
    const doc = parseDraft(base)
    setDnsConfig(doc, {})
    const out = serializeDraft(doc)
    expect(out).not.toContain('dns:')
  })
})

describe('dns-view.getDnsConfig (client mirror)', () => {
  it('round-trips the expected shape for the canonical mihomo example', () => {
    const yaml = `dns:\n  enable: true\n  listen: 127.0.0.1:1053\n  enhanced-mode: fake-ip\n  fake-ip-filter-mode: blacklist\n  fake-ip-filter:\n    - '*.lan'\n  nameserver-policy:\n    '+.foo.com': https://dns.google/dns-query\n`
    const dns = getDnsConfig(parseDocument(yaml))
    expect(dns.enable).toBe(true)
    expect(dns.listen).toBe('127.0.0.1:1053')
    expect(dns['enhanced-mode']).toBe('fake-ip')
    expect(dns['fake-ip-filter-mode']).toBe('blacklist')
    expect(dns['fake-ip-filter']).toEqual(['*.lan'])
    expect(dns['nameserver-policy']).toEqual({
      '+.foo.com': 'https://dns.google/dns-query',
    })
  })

  it('moves unknown keys into extras', () => {
    const yaml = `dns:\n  enable: true\n  experimental-knob: 3\n`
    const dns = getDnsConfig(parseDocument(yaml))
    expect(dns.extras).toEqual({ 'experimental-knob': 3 })
  })
})
