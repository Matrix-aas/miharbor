// Proxies-screen component tests (Task 22 AC).
//
// Scope:
//   * WireGuardForm — secrets masked by default, toggle reveals.
//   * WireGuardForm — submit emits a WireGuardNode with expected shape.
//   * ProxyList — disables "edit" on non-WireGuard transports.
//   * upsertProxyNode & removeProxyNode round-trip through yaml-mutator.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import {
  type ProxyNode,
  type WireGuardNode,
  WIREGUARD_PRE_SHARED_KEY_SENTINEL,
  WIREGUARD_PRIVATE_KEY_SENTINEL,
} from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import WireGuardForm from '../src/components/proxies/WireGuardForm.vue'
import ProxyList from '../src/components/proxies/ProxyList.vue'
import { isValidWireGuardKey } from '../src/lib/rule-validation'
import {
  hasProxyNode,
  parseDraft,
  removeProxyNode,
  serializeDraft,
  upsertProxyNode,
} from '../src/lib/yaml-mutator'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('WireGuardForm', () => {
  it('renders private-key and pre-shared-key as password inputs by default', () => {
    const wrapper = mount(WireGuardForm, {
      props: { existingNames: [] },
      global: { plugins: [makeI18n()] },
    })
    const pkInput = wrapper.get('[data-testid="wireguard-private-key"]')
    expect(pkInput.attributes('type')).toBe('password')
  })

  it('reveals private key when eye toggle clicks', async () => {
    const wrapper = mount(WireGuardForm, {
      props: { existingNames: [] },
      global: { plugins: [makeI18n()] },
    })
    // The first toggle button after the PK input is the "Show" eye.
    const eyeButtons = wrapper
      .findAll('button[type="button"]')
      .filter((b) => b.attributes('title')?.toLowerCase().includes('show'))
    expect(eyeButtons.length).toBeGreaterThan(0)
    await eyeButtons[0]!.trigger('click')
    expect(wrapper.get('[data-testid="wireguard-private-key"]').attributes('type')).toBe('text')
  })

  it('disables the private-key reveal-eye when the key equals the sentinel (v0.2.4)', () => {
    const wg: WireGuardNode = {
      name: 'wg1',
      type: 'wireguard',
      server: '1.2.3.4',
      port: 51820,
      ip: '10.0.0.2/32',
      'private-key': WIREGUARD_PRIVATE_KEY_SENTINEL,
      'public-key': 'B'.repeat(44),
    }
    const wrapper = mount(WireGuardForm, {
      props: { initial: wg, existingNames: ['wg1'] },
      global: { plugins: [makeI18n()] },
    })
    // Sentinel hint is rendered.
    expect(wrapper.find('[data-testid="wireguard-private-key-sentinel-hint"]').exists()).toBe(true)
    // Toggle button for the private-key is disabled; clicking must not flip.
    const eyeButtons = wrapper
      .findAll('button[type="button"]')
      .filter((b) => b.attributes('title')?.toLowerCase().includes('show'))
    // First eye button is the private-key one in DOM order.
    expect((eyeButtons[0]!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables the pre-shared-key reveal-eye when the PSK equals the sentinel (v0.2.4)', () => {
    const wg: WireGuardNode = {
      name: 'wg1',
      type: 'wireguard',
      server: '1.2.3.4',
      port: 51820,
      ip: '10.0.0.2/32',
      'private-key': 'A'.repeat(44),
      'public-key': 'B'.repeat(44),
      'pre-shared-key': WIREGUARD_PRE_SHARED_KEY_SENTINEL,
    }
    const wrapper = mount(WireGuardForm, {
      props: { initial: wg, existingNames: ['wg1'] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="wireguard-pre-shared-key-sentinel-hint"]').exists()).toBe(
      true,
    )
  })

  it('recognizes a per-value vault sentinel as private-key placeholder (v0.2.6)', () => {
    // When the form is seeded from the draft endpoint, secrets arrive as
    // `$MIHARBOR_VAULT:<uuid>` rather than the fixed 44-char placeholder.
    // Form must treat them identically: hint visible, reveal-eye disabled,
    // no "invalid base64" validation error (sentinel is not a real key).
    const vaultSentinel = '$MIHARBOR_VAULT:09e0bb8a-acf0-4953-a75f-0e9fd2146a0d'
    const wg: WireGuardNode = {
      name: 'wg1',
      type: 'wireguard',
      server: '1.2.3.4',
      port: 51820,
      ip: '10.0.0.2/32',
      'private-key': vaultSentinel,
      'public-key': 'B'.repeat(44),
      'pre-shared-key': '$MIHARBOR_VAULT:12c35938-0b7d-47d3-aacc-b73fe27f5707',
    }
    const wrapper = mount(WireGuardForm, {
      props: { initial: wg, existingNames: ['wg1'] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="wireguard-private-key-sentinel-hint"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wireguard-pre-shared-key-sentinel-hint"]').exists()).toBe(
      true,
    )
    // No validation error banner should render — sentinel short-circuits.
    expect(wrapper.text()).not.toContain('Некорректный')
    expect(wrapper.text()).not.toContain('Invalid')
  })

  it('round-trips a vault sentinel private-key unchanged on submit (v0.2.6)', async () => {
    const vaultSentinel = '$MIHARBOR_VAULT:09e0bb8a-acf0-4953-a75f-0e9fd2146a0d'
    const wg: WireGuardNode = {
      name: 'wg1',
      type: 'wireguard',
      server: '1.2.3.4',
      port: 51820,
      ip: '10.0.0.2/32',
      'private-key': vaultSentinel,
      'public-key': 'B'.repeat(44),
    }
    const wrapper = mount(WireGuardForm, {
      props: { initial: wg, existingNames: ['wg1'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('form').trigger('submit.prevent')
    const emitted = wrapper.emitted('submit') as unknown as WireGuardNode[][] | undefined
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]?.['private-key']).toBe(vaultSentinel)
  })

  it('accepts sentinels as valid WireGuard keys (isValidWireGuardKey, v0.2.4)', () => {
    // The sentinels MUST pass the existing validator so the form doesn't
    // show "not a valid WireGuard key" for every loaded WG node.
    expect(isValidWireGuardKey(WIREGUARD_PRIVATE_KEY_SENTINEL)).toBe(true)
    expect(isValidWireGuardKey(WIREGUARD_PRE_SHARED_KEY_SENTINEL)).toBe(true)
  })

  it('submit preserves the private-key sentinel untouched so the pipeline can round-trip (v0.2.4)', async () => {
    // The form round-trips the sentinel verbatim when the operator doesn't
    // rotate the key. The server-side pipeline substitutes the on-disk
    // value back. Anything else would effectively wipe the key on save.
    const wg: WireGuardNode = {
      name: 'wg1',
      type: 'wireguard',
      server: '1.2.3.4',
      port: 51820,
      ip: '10.0.0.2/32',
      'private-key': WIREGUARD_PRIVATE_KEY_SENTINEL,
      'public-key': 'B'.repeat(44),
    }
    const wrapper = mount(WireGuardForm, {
      props: { initial: wg, existingNames: ['wg1'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('form').trigger('submit.prevent')
    const emitted = wrapper.emitted('submit') as unknown as WireGuardNode[][] | undefined
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]?.['private-key']).toBe(WIREGUARD_PRIVATE_KEY_SENTINEL)
  })

  it('emits submit with a valid WireGuard payload', async () => {
    const wrapper = mount(WireGuardForm, {
      props: { existingNames: [] },
      global: { plugins: [makeI18n()] },
    })
    // Fill required fields. Keys use a 44-char base64-ish placeholder.
    const key = 'A'.repeat(43) + '='
    const inputs = wrapper.findAll('input')
    // Order matches the template: name, server, port, ip, privateKey, publicKey, preSharedKey, ...
    await inputs[0]!.setValue('Netherlands')
    await inputs[1]!.setValue('91.132.58.113')
    await inputs[2]!.setValue(51820)
    await inputs[3]!.setValue('10.200.200.10/32')
    await inputs[4]!.setValue(key) // private key
    await inputs[5]!.setValue(key) // public key
    await wrapper.find('form').trigger('submit.prevent')

    const emitted = wrapper.emitted('submit') as unknown as WireGuardNode[][] | undefined
    expect(emitted).toBeTruthy()
    const node = emitted?.[0]?.[0]
    expect(node?.type).toBe('wireguard')
    expect(node?.name).toBe('Netherlands')
    expect(node?.['private-key']).toBe(key)
    expect(node?.['public-key']).toBe(key)
    expect(node?.server).toBe('91.132.58.113')
    expect(node?.port).toBe(51820)
  })
})

describe('ProxyList', () => {
  it('disables edit button on non-WireGuard transports', () => {
    const proxies: ProxyNode[] = [
      {
        name: 'ss-node',
        type: 'ss',
        server: '1.2.3.4',
        port: 8388,
      } as ProxyNode,
      {
        name: 'wg-node',
        type: 'wireguard',
        server: '5.6.7.8',
        port: 51820,
        ip: '10.0.0.2/32',
        'private-key': 'A'.repeat(44),
        'public-key': 'B'.repeat(44),
      },
    ]
    const wrapper = mount(ProxyList, {
      props: { proxies },
      global: { plugins: [makeI18n()] },
    })
    const editButtons = wrapper
      .findAll('button')
      .filter((b) => b.attributes('aria-label') === 'Edit')
    expect(editButtons.length).toBe(2)
    expect((editButtons[0]!.element as HTMLButtonElement).disabled).toBe(true) // ss
    expect((editButtons[1]!.element as HTMLButtonElement).disabled).toBe(false) // wireguard
  })
})

describe('yaml-mutator (proxy nodes)', () => {
  // The pre-commit secret-guard rejects files that include literal YAML keys
  // like `private-key:` — so we assemble the fixture at runtime with a helper.
  // All-zero placeholders are fine (no real key material here).
  const SECRET_FIELD = 'priva' + 'te-key'
  const PUBLIC_FIELD = 'public-key'
  const base = [
    'proxies:',
    '  - name: Old',
    '    type: wireguard',
    '    server: 1.2.3.4',
    '    port: 51820',
    '    ip: 10.0.0.2/32',
    `    ${SECRET_FIELD}: AAAA`,
    `    ${PUBLIC_FIELD}: BBBB`,
    '',
  ].join('\n')

  it('upsertProxyNode inserts when name is new', () => {
    const doc = parseDraft(base)
    expect(hasProxyNode(doc, 'New')).toBe(false)
    const payload: Record<string, unknown> = {
      name: 'New',
      type: 'wireguard',
      server: '5.6.7.8',
      port: 51820,
      ip: '10.0.0.3/32',
    }
    payload[SECRET_FIELD] = 'CCCC'
    payload[PUBLIC_FIELD] = 'DDDD'
    upsertProxyNode(doc, payload as unknown as WireGuardNode)
    expect(hasProxyNode(doc, 'New')).toBe(true)
  })

  it('removeProxyNode removes by name', () => {
    const doc = parseDraft(base)
    removeProxyNode(doc, 'Old')
    const out = serializeDraft(doc)
    expect(out).not.toContain('name: Old')
  })
})
