// Profile screen component tests (Task 37 AC).
//
// Scope mirrors tests/tun.spec.ts / tests/sniffer.spec.ts:
//   * Shared guardrail helpers (validateIpv6Enabled + validateExternalController).
//   * parseAuthEntry / serialiseAuthEntry round-trips.
//   * ProfileForm emits scalar patches + toggles mask state on the secret
//     field + shows the ipv6 and external-controller guardrails at the right
//     moments.
//   * AuthList renders usernames + hasPassword badge + open/close the
//     password dialog on Edit.
//   * yaml-mutator.setProfileConfig rewrites top-level keys without touching
//     reserved sections + preserves unknown keys.
//   * profile-view.getProfileConfig (client mirror) matches the server
//     projection on a representative slice.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { parseDocument } from 'yaml'
import type { ProfileConfig } from 'miharbor-shared'
import {
  META_SECRET_SENTINEL,
  parseAuthEntry,
  serialiseAuthEntry,
  validateExternalController,
  validateGeoxUrlEntry,
  validateInterfaceNameVsAutoDetect,
  validateIpv6Enabled,
} from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import ProfileForm from '../src/components/profile/ProfileForm.vue'
import AuthList from '../src/components/profile/AuthList.vue'
import { parseDraft, serializeDraft, setProfileConfig } from '../src/lib/yaml-mutator'
import { getProfileConfig } from '../src/lib/profile-view'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('Profile guardrail helpers', () => {
  it('validateIpv6Enabled flags true and accepts false/undefined', () => {
    expect(validateIpv6Enabled(true)).toMatch(/burn-in|runbook|first-rollout/i)
    expect(validateIpv6Enabled(false)).toBeNull()
    expect(validateIpv6Enabled(undefined)).toBeNull()
  })

  it('validateExternalController accepts loopback binds without a secret', () => {
    expect(validateExternalController('127.0.0.1:9090', undefined)).toBeNull()
    expect(validateExternalController('localhost:9090', undefined)).toBeNull()
    // Empty / unset is also fine (nothing bound).
    expect(validateExternalController(undefined, undefined)).toBeNull()
    expect(validateExternalController('', undefined)).toBeNull()
  })

  it('validateExternalController flags LAN bind without a secret', () => {
    expect(validateExternalController('192.168.1.1:9090', undefined)).toMatch(/secret/i)
    expect(validateExternalController('192.168.1.1:9090', '')).toMatch(/secret/i)
    expect(validateExternalController('0.0.0.0:9090', '  ')).toMatch(/secret/i)
  })

  it('validateExternalController passes LAN bind with a secret', () => {
    expect(validateExternalController('192.168.1.1:9090', 'abc123')).toBeNull()
    expect(validateExternalController('0.0.0.0:9090', 'long-token')).toBeNull()
  })

  it('validateInterfaceNameVsAutoDetect flags auto-detect + explicit interface-name (v0.2.4)', () => {
    expect(validateInterfaceNameVsAutoDetect('enp170s0', true)).toMatch(/auto-detect-interface/i)
    expect(validateInterfaceNameVsAutoDetect('enp170s0', false)).toBeNull()
    expect(validateInterfaceNameVsAutoDetect('', true)).toBeNull()
    expect(validateInterfaceNameVsAutoDetect(undefined, true)).toBeNull()
  })

  it('validateGeoxUrlEntry accepts http/https URLs (v0.2.4)', () => {
    expect(validateGeoxUrlEntry('https://example.com/geoip.dat')).toBeNull()
    expect(validateGeoxUrlEntry('http://example.com/a.mmdb')).toBeNull()
    expect(validateGeoxUrlEntry('')).toBeNull()
    expect(validateGeoxUrlEntry(undefined)).toBeNull()
  })

  it('validateGeoxUrlEntry rejects malformed values (v0.2.4)', () => {
    expect(validateGeoxUrlEntry('not-a-url')).toMatch(/URL/i)
    expect(validateGeoxUrlEntry('ftp://example.com/a.dat')).toMatch(/URL/i)
  })
})

describe('parseAuthEntry / serialiseAuthEntry', () => {
  it('parses "user:pass" into user+hasPassword', () => {
    expect(parseAuthEntry('alice:hunter2')).toEqual({ user: 'alice', hasPassword: true })
    expect(parseAuthEntry('alice:')).toEqual({ user: 'alice', hasPassword: false })
    expect(parseAuthEntry('alice')).toEqual({ user: 'alice', hasPassword: false })
  })

  it('serialises round-trip without loss', () => {
    expect(serialiseAuthEntry('alice', 'hunter2')).toBe('alice:hunter2')
    expect(serialiseAuthEntry('bob', '')).toBe('bob:')
  })

  it('preserves colons in passwords (split on first colon only)', () => {
    expect(parseAuthEntry('alice:hunter2:more')).toEqual({ user: 'alice', hasPassword: true })
  })
})

describe('ProfileForm', () => {
  it('emits mode change', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-mode"]').setValue('global')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ mode: 'global' })
  })

  it('emits log-level change', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-log-level"]').setValue('debug')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ 'log-level': 'debug' })
  })

  it('emits mixed-port as a number', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-mixed-port"]').setValue(7890)
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ 'mixed-port': 7890 })
  })

  it('shows ipv6 guardrail when ipv6 is true', () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { ipv6: true } },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-ipv6-guardrail"]').exists()).toBe(true)
  })

  it('hides ipv6 guardrail when ipv6 is false', () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { ipv6: false } },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-ipv6-guardrail"]').exists()).toBe(false)
  })

  it('shows external-controller guardrail when LAN bind + no secret', () => {
    const wrapper = mount(ProfileForm, {
      props: {
        modelValue: { 'external-controller': '192.168.1.1:9090' },
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-external-controller-guardrail"]').exists()).toBe(
      true,
    )
  })

  it('hides external-controller guardrail when loopback bind', () => {
    const wrapper = mount(ProfileForm, {
      props: {
        modelValue: { 'external-controller': '127.0.0.1:9090' },
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-external-controller-guardrail"]').exists()).toBe(
      false,
    )
  })

  it('always shows the permanent secret guardrail', () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-secret-guardrail"]').exists()).toBe(true)
  })

  it('masks the secret input by default', () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { secret: 'super-secret' } },
      global: { plugins: [makeI18n()] },
    })
    const input = wrapper.get('[data-testid="profile-secret"]')
    expect(input.attributes('type')).toBe('password')
  })

  it('reveals the secret when the toggle is clicked', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { secret: 'super-secret' } },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-secret-toggle"]').trigger('click')
    const input = wrapper.get('[data-testid="profile-secret"]')
    expect(input.attributes('type')).toBe('text')
  })

  it('has aria-labels for Show/Hide on the secret toggle', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    const btn = wrapper.get('[data-testid="profile-secret-toggle"]')
    expect(btn.attributes('aria-label')).toMatch(/show/i)
    await btn.trigger('click')
    expect(btn.attributes('aria-label')).toMatch(/hide/i)
  })

  it('emits the secret change on input', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-secret"]').setValue('fresh-secret')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ secret: 'fresh-secret' })
  })

  it('emits ipv6 toggle', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-ipv6"]').setValue(true)
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ ipv6: true })
  })

  it('emits tcp-concurrent toggle', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-tcp-concurrent"]').setValue(true)
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ 'tcp-concurrent': true })
  })

  it('emits store-selected nested toggle', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-store-selected"]').setValue(true)
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ profile: { 'store-selected': true } })
  })

  it('renders the authentication guardrail', () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-auth-guardrail"]').exists()).toBe(true)
  })

  it('emits interface-name change (v0.2.4)', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-interface-name"]').setValue('enp170s0')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ 'interface-name': 'enp170s0' })
  })

  it('shows interface-name guardrail when TUN auto-detect is enabled (v0.2.4)', () => {
    const wrapper = mount(ProfileForm, {
      props: {
        modelValue: { 'interface-name': 'enp170s0' },
        tunAutoDetectInterface: true,
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-interface-name-guardrail"]').exists()).toBe(true)
  })

  it('hides interface-name guardrail when TUN auto-detect is off (v0.2.4)', () => {
    const wrapper = mount(ProfileForm, {
      props: {
        modelValue: { 'interface-name': 'enp170s0' },
        tunAutoDetectInterface: false,
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-interface-name-guardrail"]').exists()).toBe(false)
  })

  it('emits geox-url.geoip change (v0.2.4)', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: {} },
      global: { plugins: [makeI18n()] },
    })
    await wrapper
      .get('[data-testid="profile-geox-url-geoip"]')
      .setValue('https://example.com/geoip.dat')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({
      'geox-url': { geoip: 'https://example.com/geoip.dat' },
    })
  })

  it('clears a geox-url field via the reset button (v0.2.4)', async () => {
    const wrapper = mount(ProfileForm, {
      props: {
        modelValue: { 'geox-url': { geoip: 'https://example.com/geoip.dat' } },
      },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-geox-url-geoip-reset"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    // With the single geoip entry cleared, the whole geox-url block collapses
    // to undefined so the mutator doesn't emit `geox-url: {}`.
    expect(emitted.at(-1)?.[0]).toEqual({ 'geox-url': undefined })
  })

  it('shows an inline error for an invalid geox-url entry (v0.2.4)', () => {
    const wrapper = mount(ProfileForm, {
      props: {
        modelValue: { 'geox-url': { geoip: 'not-a-url' } },
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="profile-geox-url-geoip-error"]').exists()).toBe(true)
  })

  it('disables the reveal-eye + shows hint when secret equals META_SECRET_SENTINEL (v0.2.4)', () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { secret: META_SECRET_SENTINEL } },
      global: { plugins: [makeI18n()] },
    })
    const toggle = wrapper.get('[data-testid="profile-secret-toggle"]')
    expect((toggle.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('[data-testid="profile-secret-sentinel-hint"]').exists()).toBe(true)
  })

  it('keeps the secret input masked when sentinel is the value — click on toggle is a no-op (v0.2.4)', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { secret: META_SECRET_SENTINEL } },
      global: { plugins: [makeI18n()] },
    })
    // The toggle is disabled; clicking must NOT flip type → text.
    await wrapper.get('[data-testid="profile-secret-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="profile-secret"]').attributes('type')).toBe('password')
  })

  it('typing into the secret input replaces the sentinel and emits the new value (v0.2.4)', async () => {
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { secret: META_SECRET_SENTINEL } },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="profile-secret"]').setValue('new-secret-value')
    const emitted = wrapper.emitted('update:modelValue') as unknown as Array<
      Array<Partial<ProfileConfig>>
    >
    expect(emitted.at(-1)?.[0]).toEqual({ secret: 'new-secret-value' })
  })

  it('treats a per-value vault sentinel as masked secret (v0.2.6)', () => {
    // When the draft endpoint seeds the form, the secret arrives as
    // `$MIHARBOR_VAULT:<uuid>` instead of META_SECRET_SENTINEL. The form
    // must treat both identically: disable the reveal-eye, show the hint.
    const vaultSentinel = '$MIHARBOR_VAULT:a45435ca-69a6-4665-a6e1-5de955e3789d'
    const wrapper = mount(ProfileForm, {
      props: { modelValue: { secret: vaultSentinel } },
      global: { plugins: [makeI18n()] },
    })
    const toggle = wrapper.get('[data-testid="profile-secret-toggle"]')
    expect((toggle.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('[data-testid="profile-secret-sentinel-hint"]').exists()).toBe(true)
  })
})

describe('AuthList', () => {
  it('renders a row per entry with username visible', () => {
    const wrapper = mount(AuthList, {
      props: { modelValue: ['alice:hunter2', 'bob:seaWitch'] },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="auth-row"]')
    expect(rows.length).toBe(2)
    const cells = wrapper.findAll('[data-testid="auth-user-cell"]')
    expect(cells[0]?.text()).toBe('alice')
    expect(cells[1]?.text()).toBe('bob')
  })

  it('never renders the password in the DOM', () => {
    const wrapper = mount(AuthList, {
      props: { modelValue: ['alice:hunter2'] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).not.toContain('hunter2')
    expect(wrapper.html()).not.toContain('hunter2')
  })

  it('renders password-badge when an entry has a password', () => {
    const wrapper = mount(AuthList, {
      props: { modelValue: ['alice:hunter2'] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="auth-password-badge"]').exists()).toBe(true)
  })

  it('renders no-password warning when entry has no password', () => {
    const wrapper = mount(AuthList, {
      props: { modelValue: ['alice'] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="auth-no-password"]').exists()).toBe(true)
  })

  it('emits updated list when a row is removed', async () => {
    const wrapper = mount(AuthList, {
      props: { modelValue: ['alice:hunter2', 'bob:seaWitch'] },
      global: { plugins: [makeI18n()] },
    })
    const removeBtns = wrapper.findAll('[data-testid="auth-remove"]')
    await removeBtns[0]!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    expect(emitted?.at(-1)?.[0]).toEqual(['bob:seaWitch'])
  })
})

describe('yaml-mutator.setProfileConfig', () => {
  const base =
    'mode: rule\nlog-level: info\nipv6: false\n' +
    'external-controller: 127.0.0.1:9090\nsecret: ""\n' +
    'tun:\n  enable: true\n' +
    'dns:\n  enable: true\n'

  it('rewrites top-level fields without touching reserved sections', () => {
    const doc = parseDraft(base)
    const next: ProfileConfig = {
      mode: 'global',
      'log-level': 'debug',
      ipv6: false,
      'external-controller': '127.0.0.1:9090',
      secret: 'new-secret',
    }
    setProfileConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('mode: global')
    expect(out).toContain('log-level: debug')
    expect(out).toContain('new-secret')
    // Reserved sections preserved verbatim.
    expect(out).toContain('tun:')
    expect(out).toContain('dns:')
  })

  it('preserves nested sections after round-trip', () => {
    const doc = parseDraft(base)
    setProfileConfig(doc, {})
    const out = serializeDraft(doc)
    // All managed keys removed (they were all in PROFILE_KEY_ORDER).
    expect(out).not.toMatch(/^mode:/m)
    expect(out).not.toMatch(/^log-level:/m)
    expect(out).not.toMatch(/^ipv6:/m)
    // But nested sections are still there.
    expect(out).toContain('tun:')
    expect(out).toContain('dns:')
  })

  it('writes the nested profile sub-section', () => {
    const doc = parseDraft('mode: rule\n')
    setProfileConfig(doc, {
      mode: 'rule',
      profile: { 'store-selected': true, 'store-fake-ip': false },
    })
    const out = serializeDraft(doc)
    expect(out).toMatch(/profile:\s*\n\s+store-selected:\s+true/)
    expect(out).toMatch(/store-fake-ip:\s+false/)
  })

  it('writes the authentication list verbatim', () => {
    const doc = parseDraft('mode: rule\n')
    setProfileConfig(doc, {
      mode: 'rule',
      authentication: ['alice:hunter2', 'bob:seaWitch'],
    })
    const out = serializeDraft(doc)
    expect(out).toContain('alice:hunter2')
    expect(out).toContain('bob:seaWitch')
  })

  it('removes authentication key when list is empty', () => {
    const doc = parseDraft('mode: rule\nauthentication:\n  - alice:x\n')
    setProfileConfig(doc, { mode: 'rule' })
    const out = serializeDraft(doc)
    expect(out).not.toContain('authentication:')
  })

  it('preserves extras verbatim', () => {
    const doc = parseDraft('mode: rule\n')
    setProfileConfig(doc, {
      mode: 'rule',
      extras: { 'future-knob': 42 },
    })
    const out = serializeDraft(doc)
    expect(out).toContain('future-knob: 42')
  })

  it('bootstraps a doc that has no managed keys yet', () => {
    const doc = parseDraft('tun:\n  enable: true\n')
    setProfileConfig(doc, { mode: 'rule', 'log-level': 'info' })
    const out = serializeDraft(doc)
    expect(out).toContain('mode: rule')
    expect(out).toContain('log-level: info')
    expect(out).toContain('tun:')
  })

  it('writes interface-name at the top level (v0.2.4)', () => {
    const doc = parseDraft('mode: rule\n')
    setProfileConfig(doc, { mode: 'rule', 'interface-name': 'enp170s0' })
    const out = serializeDraft(doc)
    expect(out).toContain('interface-name: enp170s0')
  })

  it('removes interface-name when unset (v0.2.4)', () => {
    const doc = parseDraft('mode: rule\ninterface-name: eth0\n')
    setProfileConfig(doc, { mode: 'rule' })
    const out = serializeDraft(doc)
    expect(out).not.toContain('interface-name:')
  })

  it('writes the geox-url sub-block (v0.2.4)', () => {
    const doc = parseDraft('mode: rule\n')
    setProfileConfig(doc, {
      mode: 'rule',
      'geox-url': {
        geoip: 'https://example.com/geoip.dat',
        geosite: 'https://example.com/geosite.dat',
      },
    })
    const out = serializeDraft(doc)
    expect(out).toMatch(/geox-url:\s*\n\s+geoip:\s+https:\/\/example\.com\/geoip\.dat/)
    expect(out).toContain('geosite: https://example.com/geosite.dat')
  })

  it('removes the geox-url block when empty (v0.2.4)', () => {
    const doc = parseDraft('mode: rule\ngeox-url:\n  geoip: https://old.example.com/x\n')
    setProfileConfig(doc, { mode: 'rule' })
    const out = serializeDraft(doc)
    expect(out).not.toContain('geox-url:')
  })

  it('preserves unchanged geox-url sub-map verbatim when only a neighbour toggles (v0.2.8)', () => {
    // Same class of regression as the scalar-quote preservation, but for
    // nested maps: `geox-url:` has `geosite` first and `geoip` second on
    // disk, both double-quoted. Toggling `allow-lan` used to rebuild the
    // whole profile section — `buildGeoxUrl` reorders keys alphabetically
    // and mints PLAIN scalars. The result was a spurious 2-line delete /
    // 2-line add on every unrelated edit.
    const src = [
      'mode: rule',
      'geox-url:',
      '  geosite: "https://example.com/geosite.dat"',
      '  geoip: "https://example.com/geoip.dat"',
      '',
    ].join('\n')
    const doc = parseDraft(src)
    setProfileConfig(doc, {
      mode: 'rule',
      'allow-lan': true,
      'geox-url': {
        geosite: 'https://example.com/geosite.dat',
        geoip: 'https://example.com/geoip.dat',
      },
    })
    const out = serializeDraft(doc)
    // Order and quotes survive identically.
    expect(out).toContain('geosite: "https://example.com/geosite.dat"')
    expect(out).toContain('geoip: "https://example.com/geoip.dat"')
    // And the new key appears somewhere.
    expect(out).toContain('allow-lan: true')
  })

  it('preserves existing quote style on unchanged scalars (v0.2.8)', () => {
    // Regression guard: before v0.2.8 `setProfileConfig` rebuilt EVERY
    // managed key through `doc.createNode()`, which minted fresh PLAIN
    // scalars — the operator's original quote style on unchanged values
    // was lost. That produced spurious formatting diffs on
    // `/api/config/draft/diff` every time the UI toggled any boolean.
    const src = [
      'mode: rule',
      'log-level: info',
      'external-ui-url: "https://example.com/dash.zip"', // QUOTE_DOUBLE
      "bind-address: '0.0.0.0'", // QUOTE_SINGLE
      '',
    ].join('\n')
    const doc = parseDraft(src)
    // Toggle only `allow-lan` — every other managed scalar must round-trip
    // byte-identically, including the explicit quote style.
    setProfileConfig(doc, {
      mode: 'rule',
      'log-level': 'info',
      'external-ui-url': 'https://example.com/dash.zip',
      'bind-address': '0.0.0.0',
      'allow-lan': true,
    })
    const out = serializeDraft(doc)
    expect(out).toContain('external-ui-url: "https://example.com/dash.zip"')
    expect(out).toContain("bind-address: '0.0.0.0'")
    expect(out).toContain('allow-lan: true')
  })
})

describe('profile-view.getProfileConfig (client mirror)', () => {
  it('round-trips the expected shape for a representative config', () => {
    const yaml = `mode: rule
log-level: info
mixed-port: 7890
allow-lan: true
bind-address: "*"
ipv6: false
external-controller: 127.0.0.1:9090
secret: super-secret
external-ui: ./zash
tcp-concurrent: true
unified-delay: false
find-process-mode: "off"
geodata-mode: true
geo-auto-update: true
geo-update-interval: 168
keep-alive-interval: 15
profile:
  store-selected: true
authentication:
  - alice:hunter2
  - bob:seaWitch
`
    const p = getProfileConfig(parseDocument(yaml))
    expect(p.mode).toBe('rule')
    expect(p['log-level']).toBe('info')
    expect(p['mixed-port']).toBe(7890)
    expect(p['allow-lan']).toBe(true)
    expect(p['bind-address']).toBe('*')
    expect(p.ipv6).toBe(false)
    expect(p['external-controller']).toBe('127.0.0.1:9090')
    expect(p.secret).toBe('super-secret')
    expect(p['external-ui']).toBe('./zash')
    expect(p['tcp-concurrent']).toBe(true)
    expect(p['unified-delay']).toBe(false)
    expect(p['find-process-mode']).toBe('off')
    expect(p['geodata-mode']).toBe(true)
    expect(p['geo-auto-update']).toBe(true)
    expect(p['geo-update-interval']).toBe(168)
    expect(p['keep-alive-interval']).toBe(15)
    expect(p.profile?.['store-selected']).toBe(true)
    expect(p.authentication).toEqual(['alice:hunter2', 'bob:seaWitch'])
  })

  it('returns {} when the doc is empty', () => {
    expect(getProfileConfig(parseDocument(''))).toEqual({})
  })

  it('ignores reserved sections from extras', () => {
    const yaml = `dns:\n  enable: true\ntun:\n  enable: true\n`
    const p = getProfileConfig(parseDocument(yaml))
    expect(p.extras).toBeUndefined()
  })

  it('stuffs unknown top-level keys into extras', () => {
    const yaml = `mode: rule\nfuture-knob: 42\n`
    const p = getProfileConfig(parseDocument(yaml))
    expect(p.extras?.['future-knob']).toBe(42)
  })

  it('projects interface-name + geox-url (v0.2.4)', () => {
    const yaml = `mode: rule\ninterface-name: enp170s0\ngeox-url:\n  geoip: https://example.com/geoip.dat\n  asn: https://example.com/asn.mmdb\n`
    const p = getProfileConfig(parseDocument(yaml))
    expect(p['interface-name']).toBe('enp170s0')
    expect(p['geox-url']?.geoip).toBe('https://example.com/geoip.dat')
    expect(p['geox-url']?.asn).toBe('https://example.com/asn.mmdb')
    expect(p['geox-url']?.geosite).toBeUndefined()
  })
})

describe('i18n key parity (profile)', () => {
  it('every English profile key has a Russian counterpart', () => {
    const enProfile = (en as unknown as Record<string, Record<string, unknown>>).pages.profile
    const ruProfile = (ru as unknown as Record<string, Record<string, unknown>>).pages.profile

    function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
      const out: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          out.push(...collectKeys(v as Record<string, unknown>, path))
        } else {
          out.push(path)
        }
      }
      return out
    }

    const enKeys = collectKeys(enProfile as Record<string, unknown>).sort()
    const ruKeys = collectKeys(ruProfile as Record<string, unknown>).sort()
    expect(ruKeys).toEqual(enKeys)
  })
})
