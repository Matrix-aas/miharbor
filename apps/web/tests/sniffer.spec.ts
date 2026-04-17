// Sniffer screen component tests (Task 36 AC).
//
// Scope mirrors tests/tun.spec.ts:
//   * Shared port-range validator (validatePortRange) — single / range /
//     comma / out-of-range / reversed.
//   * SniffRulesList add / remove / per-row warning / override-destination
//     checkbox when allowOverride.
//   * yaml-mutator.setSnifferConfig writes a fresh `sniffer:` section with
//     canonical key order + extras round-trip + per-protocol extras survive.
//   * sniffer-view.getSnifferConfig (client mirror) matches the server
//     projection on a representative slice.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { parseDocument } from 'yaml'
import type { SnifferConfig } from 'miharbor-shared'
import { validatePortRange } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import SniffRulesList from '../src/components/sniffer/SniffRulesList.vue'
import { parseDraft, serializeDraft, setSnifferConfig } from '../src/lib/yaml-mutator'
import { getSnifferConfig } from '../src/lib/sniffer-view'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('validatePortRange', () => {
  it('accepts single ports', () => {
    expect(validatePortRange('80')).toBeNull()
    expect(validatePortRange('443')).toBeNull()
    expect(validatePortRange('1')).toBeNull()
    expect(validatePortRange('65535')).toBeNull()
  })

  it('accepts inclusive ranges', () => {
    expect(validatePortRange('80-90')).toBeNull()
    expect(validatePortRange('8080-8090')).toBeNull()
    expect(validatePortRange('1-65535')).toBeNull()
  })

  it('rejects empty / whitespace / undefined', () => {
    expect(validatePortRange('')).toMatch(/empty/i)
    expect(validatePortRange('   ')).toMatch(/empty/i)
    expect(validatePortRange(undefined)).toMatch(/empty/i)
  })

  it('rejects comma-separated lists (must split into multiple entries)', () => {
    expect(validatePortRange('80,443')).toMatch(/comma/i)
    expect(validatePortRange('80, 443')).toMatch(/comma/i)
  })

  it('rejects whitespace inside a range', () => {
    expect(validatePortRange('80 - 90')).toMatch(/whitespace/i)
    expect(validatePortRange('80 -90')).toMatch(/whitespace/i)
  })

  it('rejects out-of-range ports', () => {
    expect(validatePortRange('0')).toMatch(/≥\s*1/)
    expect(validatePortRange('65536')).toMatch(/≤\s*65535/)
    expect(validatePortRange('70000-80000')).toMatch(/≤\s*65535/)
  })

  it('rejects non-integer tokens', () => {
    expect(validatePortRange('80.5')).toMatch(/positive integer/i)
    expect(validatePortRange('abc')).toMatch(/positive integer/i)
    // '-80' is parsed as range split "" / "80" — the empty low part is
    // what fails first, which is fine (still rejected).
    expect(validatePortRange('-80')).not.toBeNull()
  })

  it('rejects reversed ranges', () => {
    expect(validatePortRange('90-80')).toMatch(/reversed/i)
  })

  it('rejects malformed range shapes', () => {
    expect(validatePortRange('80-')).toMatch(/empty/i)
    expect(validatePortRange('-80')).not.toBeNull()
    expect(validatePortRange('80-90-100')).toMatch(/"N" or "N-M"/)
  })
})

describe('SniffRulesList', () => {
  it('renders one row per entry with aria labels', () => {
    const wrapper = mount(SniffRulesList, {
      props: { protocol: 'HTTP', modelValue: ['80', '8080-8090'] },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="sniff-HTTP-row"]')
    expect(rows.length).toBe(2)
    const inputs = wrapper.findAll('[data-testid="sniff-HTTP-input"]')
    for (const input of inputs) {
      expect(input.attributes('aria-label')).toMatch(/HTTP port range \d/)
    }
  })

  it('emits new list on add', async () => {
    const wrapper = mount(SniffRulesList, {
      props: { protocol: 'TLS', modelValue: ['443'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="sniff-TLS-add"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    const last = emitted?.at(-1)?.[0]
    expect(last).toEqual(['443', ''])
  })

  it('emits new list on remove', async () => {
    const wrapper = mount(SniffRulesList, {
      props: { protocol: 'QUIC', modelValue: ['443', '80'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="sniff-QUIC-remove"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    const last = emitted?.at(-1)?.[0]
    expect(last).toEqual(['80'])
  })

  it('renders warning chevron for invalid entries', () => {
    const wrapper = mount(SniffRulesList, {
      props: { protocol: 'HTTP', modelValue: ['80,443', '80'] },
      global: { plugins: [makeI18n()] },
    })
    const warnings = wrapper.findAll('[data-testid="sniff-HTTP-warning"]')
    // Only the "80,443" entry triggers a warning.
    expect(warnings.length).toBe(1)
  })

  it('renders override-destination checkbox when allowOverride is true', () => {
    const wrapper = mount(SniffRulesList, {
      props: {
        protocol: 'HTTP',
        modelValue: ['80'],
        allowOverride: true,
        overrideDestination: true,
      },
      global: { plugins: [makeI18n()] },
    })
    const box = wrapper.find('[data-testid="sniff-HTTP-override"]')
    expect(box.exists()).toBe(true)
    expect((box.element as HTMLInputElement).checked).toBe(true)
  })

  it('omits override-destination checkbox by default', () => {
    const wrapper = mount(SniffRulesList, {
      props: { protocol: 'TLS', modelValue: ['443'] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="sniff-TLS-override"]').exists()).toBe(false)
  })

  it('emits override-destination toggle', async () => {
    const wrapper = mount(SniffRulesList, {
      props: {
        protocol: 'HTTP',
        modelValue: ['80'],
        allowOverride: true,
        overrideDestination: false,
      },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="sniff-HTTP-override"]').setValue(true)
    const emitted = wrapper.emitted('update:overrideDestination') as unknown as boolean[][]
    expect(emitted.at(-1)?.[0]).toBe(true)
  })
})

describe('yaml-mutator.setSnifferConfig', () => {
  const base = `mode: rule\nsniffer:\n  enable: true\n  override-destination: false\n`

  it('replaces the sniffer: section with the given config', () => {
    const doc = parseDraft(base)
    const next: SnifferConfig = {
      enable: true,
      'override-destination': true,
      'parse-pure-ip': true,
      sniff: {
        HTTP: { ports: ['80', '8080-8090'], 'override-destination': true },
        TLS: { ports: ['443'] },
      },
      'force-domain': ['+.netflix.com'],
      'skip-domain': ['+.apple.com'],
    }
    setSnifferConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('enable: true')
    expect(out).toContain('override-destination: true')
    expect(out).toContain('parse-pure-ip: true')
    expect(out).toContain('HTTP:')
    expect(out).toContain('TLS:')
    expect(out).toContain('8080-8090')
    expect(out).toContain('+.netflix.com')
    expect(out).toContain('+.apple.com')
  })

  it('writes known keys in canonical order', () => {
    const doc = parseDraft('mode: rule\n')
    const next: SnifferConfig = {
      'port-whitelist': ['80'],
      'parse-pure-ip': true,
      enable: true,
      'override-destination': false,
      'force-dns-mapping': true,
    }
    setSnifferConfig(doc, next)
    const out = serializeDraft(doc)
    const idxEnable = out.indexOf('enable:')
    const idxOverride = out.indexOf('override-destination:')
    const idxParse = out.indexOf('parse-pure-ip:')
    const idxForceDns = out.indexOf('force-dns-mapping:')
    const idxPortWl = out.indexOf('port-whitelist:')
    expect(idxEnable).toBeLessThan(idxOverride)
    expect(idxOverride).toBeLessThan(idxParse)
    expect(idxParse).toBeLessThan(idxForceDns)
    expect(idxForceDns).toBeLessThan(idxPortWl)
  })

  it('preserves top-level extras verbatim', () => {
    const doc = parseDraft(base)
    const next: SnifferConfig = {
      enable: true,
      extras: { 'future-knob': 42 },
    }
    setSnifferConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('future-knob: 42')
  })

  it('preserves per-protocol extras verbatim', () => {
    const doc = parseDraft(base)
    const next: SnifferConfig = {
      enable: true,
      sniff: {
        HTTP: { ports: ['80'], extras: { 'per-proto-knob': true } },
      },
    }
    setSnifferConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('per-proto-knob: true')
  })

  it('preserves unknown protocols in sniff.extras', () => {
    const doc = parseDraft(base)
    const next: SnifferConfig = {
      sniff: {
        HTTP: { ports: ['80'] },
        extras: { MYSQL: { ports: ['3306'] } },
      },
    }
    setSnifferConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('MYSQL:')
    expect(out).toContain('3306')
  })

  it('deletes the sniffer: key when the config is empty', () => {
    const doc = parseDraft(base)
    setSnifferConfig(doc, {})
    const out = serializeDraft(doc)
    expect(out).not.toContain('sniffer:')
  })
})

describe('sniffer-view.getSnifferConfig (client mirror)', () => {
  it('round-trips the expected shape for a representative config', () => {
    const yaml = `sniffer:\n  enable: true\n  override-destination: false\n  parse-pure-ip: true\n  sniff:\n    HTTP:\n      ports:\n        - "80"\n        - "8080-8090"\n      override-destination: true\n    TLS:\n      ports:\n        - "443"\n    QUIC:\n      ports:\n        - "443"\n  force-domain:\n    - +.netflix.com\n  skip-domain:\n    - +.apple.com\n  port-whitelist:\n    - "80"\n`
    const sn = getSnifferConfig(parseDocument(yaml))
    expect(sn.enable).toBe(true)
    expect(sn['override-destination']).toBe(false)
    expect(sn['parse-pure-ip']).toBe(true)
    expect(sn.sniff?.HTTP?.ports).toEqual(['80', '8080-8090'])
    expect(sn.sniff?.HTTP?.['override-destination']).toBe(true)
    expect(sn.sniff?.TLS?.ports).toEqual(['443'])
    expect(sn.sniff?.QUIC?.ports).toEqual(['443'])
    expect(sn['force-domain']).toEqual(['+.netflix.com'])
    expect(sn['skip-domain']).toEqual(['+.apple.com'])
    expect(sn['port-whitelist']).toEqual(['80'])
  })

  it('moves unknown top-level keys into extras', () => {
    const yaml = `sniffer:\n  enable: true\n  experimental-knob: 3\n`
    const sn = getSnifferConfig(parseDocument(yaml))
    expect(sn.extras).toEqual({ 'experimental-knob': 3 })
  })

  it('moves unknown protocols into sniff.extras', () => {
    const yaml = `sniffer:\n  sniff:\n    HTTP:\n      ports: ["80"]\n    MYSQL:\n      ports: ["3306"]\n`
    const sn = getSnifferConfig(parseDocument(yaml))
    expect(sn.sniff?.HTTP?.ports).toEqual(['80'])
    expect(sn.sniff?.extras?.MYSQL).toEqual({ ports: ['3306'] })
  })

  it('returns {} when sniffer: is absent', () => {
    expect(getSnifferConfig(parseDocument('mode: rule\n'))).toEqual({})
  })
})
