// TUN screen component tests (Task 35 AC).
//
// Scope mirrors tests/dns.spec.ts:
//   * Shared guardrail helpers (validateTunDevice + findMissingRouteExcludes).
//   * TunConfigForm emits scalar patches + shows device/auto-detect warnings.
//   * RouteExcludeList renders proxy-IP match badges + surfaces missing IPs.
//   * yaml-mutator.setTunConfig writes a fresh `tun:` section with canonical
//     key order + extras roundtrip.
//   * tun-view.getTunConfig (client mirror) matches the server projection
//     on a golden-ish slice.
//   * listProxyServerIps collects from `proxies:` in the draft.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { parseDocument } from 'yaml'
import type { TunConfig } from 'miharbor-shared'
import { findMissingRouteExcludes, validateTunDevice } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import TunConfigForm from '../src/components/tun/TunConfigForm.vue'
import RouteExcludeList from '../src/components/tun/RouteExcludeList.vue'
import {
  listProxyServerIps,
  parseDraft,
  serializeDraft,
  setTunConfig,
} from '../src/lib/yaml-mutator'
import { getTunConfig } from '../src/lib/tun-view'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('TUN guardrail helpers', () => {
  it('validateTunDevice flags an empty device', () => {
    expect(validateTunDevice(undefined)).toMatch(/unset|default/i)
    expect(validateTunDevice('')).toMatch(/unset|default/i)
    expect(validateTunDevice('   ')).toMatch(/unset|default/i)
  })

  it('validateTunDevice accepts a non-empty device', () => {
    expect(validateTunDevice('mihomo-tun')).toBeNull()
  })

  it('findMissingRouteExcludes returns empty when every IP is covered', () => {
    expect(findMissingRouteExcludes(['91.132.58.113'], ['91.132.58.113/32'])).toEqual([])
    expect(findMissingRouteExcludes(['91.132.58.113'], ['91.132.58.113'])).toEqual([])
    // Wider subnet covers the bare IP.
    expect(findMissingRouteExcludes(['10.0.0.5'], ['10.0.0.0/8'])).toEqual([])
  })

  it('findMissingRouteExcludes reports uncovered proxy IPs', () => {
    expect(findMissingRouteExcludes(['91.132.58.113', '1.2.3.4'], ['1.2.3.4/32'])).toEqual([
      '91.132.58.113',
    ])
  })

  it('findMissingRouteExcludes handles an empty inputs list', () => {
    expect(findMissingRouteExcludes([], ['10.0.0.0/8'])).toEqual([])
    expect(findMissingRouteExcludes(['1.2.3.4'], undefined)).toEqual(['1.2.3.4'])
  })
})

describe('TunConfigForm', () => {
  it('emits enable toggle', async () => {
    const wrapper = mount(TunConfigForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="tun-enable"]').setValue(true)
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<TunConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ enable: true })
  })

  it('shows the device-empty guardrail when device is unset', () => {
    const wrapper = mount(TunConfigForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    const plate = wrapper.find('[data-testid="tun-device-guardrail"]')
    expect(plate.exists()).toBe(true)
  })

  it('hides the device-empty guardrail when device is set', () => {
    const wrapper = mount(TunConfigForm, {
      props: { modelValue: { device: 'mihomo-tun' } },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="tun-device-guardrail"]').exists()).toBe(false)
  })

  it('shows the auto-detect-interface guardrail when it is enabled', () => {
    const wrapper = mount(TunConfigForm, {
      props: { modelValue: { 'auto-detect-interface': true } },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="tun-auto-detect-guardrail"]').exists()).toBe(true)
  })

  it('emits stack selector change', async () => {
    const wrapper = mount(TunConfigForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="tun-stack"]').setValue('gvisor')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<TunConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ stack: 'gvisor' })
  })

  it('emits mtu as a number', async () => {
    const wrapper = mount(TunConfigForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="tun-mtu"]').setValue(9000)
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<TunConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ mtu: 9000 })
  })
})

describe('RouteExcludeList', () => {
  it('renders one row per entry', () => {
    const wrapper = mount(RouteExcludeList, {
      props: { modelValue: ['1.2.3.4/32', '10.0.0.0/8'], proxyServerIps: [] },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="route-exclude-row"]')
    expect(rows.length).toBe(2)
  })

  it('renders a green badge on rows that match a proxy-server IP', () => {
    const wrapper = mount(RouteExcludeList, {
      props: {
        modelValue: ['91.132.58.113/32', '10.0.0.0/8'],
        proxyServerIps: ['91.132.58.113'],
      },
      global: { plugins: [makeI18n()] },
    })
    const badges = wrapper.findAll('[data-testid="route-exclude-badge"]')
    expect(badges.length).toBe(1)
  })

  it('surfaces missing-proxy-IP warning plate when a proxy is uncovered', () => {
    const wrapper = mount(RouteExcludeList, {
      props: {
        modelValue: ['10.0.0.0/8'],
        proxyServerIps: ['91.132.58.113'],
      },
      global: { plugins: [makeI18n()] },
    })
    const plate = wrapper.find('[data-testid="route-exclude-missing"]')
    expect(plate.exists()).toBe(true)
    expect(plate.text()).toContain('91.132.58.113')
  })

  it('hides the missing-proxy plate when all are covered', () => {
    const wrapper = mount(RouteExcludeList, {
      props: {
        modelValue: ['91.132.58.113/32'],
        proxyServerIps: ['91.132.58.113'],
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="route-exclude-missing"]').exists()).toBe(false)
  })

  it('add button emits update:modelValue with a new empty slot', async () => {
    const wrapper = mount(RouteExcludeList, {
      props: { modelValue: ['1.2.3.4/32'], proxyServerIps: [] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="route-exclude-add"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    const last = emitted?.at(-1)?.[0]
    expect(last).toEqual(['1.2.3.4/32', ''])
  })
})

describe('yaml-mutator.setTunConfig', () => {
  const base = `mode: rule\ntun:\n  enable: true\n  device: mihomo-tun\n  stack: system\n`

  it('replaces the tun: section with the given config', () => {
    const doc = parseDraft(base)
    const next: TunConfig = {
      enable: true,
      device: 'mihomo-tun',
      stack: 'gvisor',
      'auto-route': true,
      mtu: 9000,
      'route-exclude-address': ['91.132.58.113/32'],
    }
    setTunConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('stack: gvisor')
    expect(out).toContain('mtu: 9000')
    expect(out).toContain('91.132.58.113/32')
    expect(out).not.toContain('stack: system')
  })

  it('writes known keys in canonical order', () => {
    const doc = parseDraft('mode: rule\n')
    const next: TunConfig = {
      mtu: 9000,
      enable: true,
      stack: 'system',
      'auto-route': true,
      device: 'mihomo-tun',
    }
    setTunConfig(doc, next)
    const out = serializeDraft(doc)
    // `enable` appears before `device` which appears before `stack` which
    // appears before `mtu` which appears before `auto-route` — our
    // TUN_KEY_ORDER decision.
    const idxEnable = out.indexOf('enable:')
    const idxDevice = out.indexOf('device:')
    const idxStack = out.indexOf('stack:')
    const idxMtu = out.indexOf('mtu:')
    const idxAutoRoute = out.indexOf('auto-route:')
    expect(idxEnable).toBeLessThan(idxDevice)
    expect(idxDevice).toBeLessThan(idxStack)
    expect(idxStack).toBeLessThan(idxMtu)
    expect(idxMtu).toBeLessThan(idxAutoRoute)
  })

  it('preserves extras verbatim', () => {
    const doc = parseDraft(base)
    const next: TunConfig = {
      enable: true,
      extras: { 'future-knob': 42 },
    }
    setTunConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('future-knob: 42')
  })

  it('deletes the tun: key when the config is empty', () => {
    const doc = parseDraft(base)
    setTunConfig(doc, {})
    const out = serializeDraft(doc)
    expect(out).not.toContain('tun:')
  })
})

describe('tun-view.getTunConfig (client mirror)', () => {
  it('round-trips the expected shape for a representative config', () => {
    const yaml = `tun:\n  enable: true\n  device: mihomo-tun\n  stack: system\n  auto-route: true\n  auto-redirect: false\n  auto-detect-interface: false\n  mtu: 9000\n  dns-hijack: []\n  route-exclude-address:\n    - 91.132.58.113/32\n    - 10.0.0.0/8\n`
    const tun = getTunConfig(parseDocument(yaml))
    expect(tun.enable).toBe(true)
    expect(tun.device).toBe('mihomo-tun')
    expect(tun.stack).toBe('system')
    expect(tun['auto-route']).toBe(true)
    expect(tun['auto-detect-interface']).toBe(false)
    expect(tun.mtu).toBe(9000)
    expect(tun['dns-hijack']).toEqual([])
    expect(tun['route-exclude-address']).toEqual(['91.132.58.113/32', '10.0.0.0/8'])
  })

  it('moves unknown keys into extras', () => {
    const yaml = `tun:\n  enable: true\n  experimental-knob: 3\n`
    const tun = getTunConfig(parseDocument(yaml))
    expect(tun.extras).toEqual({ 'experimental-knob': 3 })
  })

  it('returns {} when tun: is absent', () => {
    expect(getTunConfig(parseDocument('mode: rule\n'))).toEqual({})
  })
})

describe('listProxyServerIps', () => {
  it('collects bare server IPs from `proxies:` entries', () => {
    const yaml = `proxies:\n  - name: wg-nl\n    type: wireguard\n    server: 91.132.58.113\n    port: 51820\n  - name: ss-de\n    type: ss\n    server: 1.2.3.4\n    port: 8388\n`
    const ips = listProxyServerIps(parseDocument(yaml))
    expect(ips).toEqual(['91.132.58.113', '1.2.3.4'])
  })

  it('returns [] when proxies: is missing', () => {
    expect(listProxyServerIps(parseDocument('mode: rule\n'))).toEqual([])
  })

  it('skips entries without a server key', () => {
    const yaml = `proxies:\n  - name: broken\n    type: wireguard\n    port: 51820\n`
    expect(listProxyServerIps(parseDocument(yaml))).toEqual([])
  })
})
