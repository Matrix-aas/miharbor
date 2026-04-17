// Rule-providers screen component tests (Task 38 AC).
//
// Scope:
//   * Shared validators (validateProviderName, validateProviderConfig)
//     — cover each type branch + edge cases.
//   * ProviderForm — disabled save while invalid, type-dependent field
//     visibility, name collision on Add, payload editor for inline.
//   * InlineRulesEditor — add/remove, aria labels.
//   * ProviderList — row per entry, refresh button gated on type, edit/
//     delete buttons emit the right events.
//   * yaml-mutator.setProvidersConfig — writes rule-providers: section,
//     canonical key order per provider, extras round-trip, empty → delete.
//   * providers-view.getProvidersConfig (client mirror) matches server
//     projection on a representative slice.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { parseDocument } from 'yaml'
import type { RuleProviderConfig, RuleProvidersConfig } from 'miharbor-shared'
import { validateProviderConfig, validateProviderName } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import InlineRulesEditor from '../src/components/providers/InlineRulesEditor.vue'
import ProviderList from '../src/components/providers/ProviderList.vue'
import ProviderForm from '../src/components/providers/ProviderForm.vue'
import { parseDraft, serializeDraft, setProvidersConfig } from '../src/lib/yaml-mutator'
import { getProvidersConfig } from '../src/lib/providers-view'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

// --------------------------------------------------------------------------
// Shared validators
// --------------------------------------------------------------------------

describe('validateProviderName', () => {
  it('accepts a plain name', () => {
    expect(validateProviderName('adblock')).toBeNull()
    expect(validateProviderName('my-rules_v2')).toBeNull()
  })

  it('rejects empty / undefined', () => {
    expect(validateProviderName('')).toMatch(/required/)
    expect(validateProviderName('   ')).toMatch(/required/)
    expect(validateProviderName(undefined)).toMatch(/required/)
  })

  it('rejects whitespace inside the name', () => {
    expect(validateProviderName('ads list')).toMatch(/whitespace/)
  })

  it('rejects commas inside the name', () => {
    expect(validateProviderName('foo,bar')).toMatch(/comma/)
  })
})

describe('validateProviderConfig', () => {
  it('accepts a valid http config', () => {
    expect(
      validateProviderConfig({
        type: 'http',
        behavior: 'domain',
        url: 'https://example.com/adblock.yaml',
        interval: 86400,
      }),
    ).toBeNull()
  })

  it('rejects http without url', () => {
    expect(validateProviderConfig({ type: 'http', behavior: 'domain', interval: 3600 })).toMatch(
      /url/,
    )
  })

  it('rejects http without interval', () => {
    expect(
      validateProviderConfig({
        type: 'http',
        behavior: 'domain',
        url: 'https://example.com/x.yaml',
      }),
    ).toMatch(/interval/)
  })

  it('rejects http with 0 or negative interval', () => {
    expect(
      validateProviderConfig({
        type: 'http',
        behavior: 'domain',
        url: 'https://example.com/x.yaml',
        interval: 0,
      }),
    ).toMatch(/interval/)
  })

  it('rejects file without path', () => {
    expect(validateProviderConfig({ type: 'file', behavior: 'classical' })).toMatch(/path/)
  })

  it('accepts a valid file config', () => {
    expect(
      validateProviderConfig({ type: 'file', behavior: 'classical', path: './rules.txt' }),
    ).toBeNull()
  })

  it('rejects inline with no payload', () => {
    expect(validateProviderConfig({ type: 'inline', behavior: 'classical' })).toMatch(/payload/)
    expect(validateProviderConfig({ type: 'inline', behavior: 'classical', payload: [] })).toMatch(
      /payload/,
    )
  })

  it('accepts a valid inline config', () => {
    expect(
      validateProviderConfig({
        type: 'inline',
        behavior: 'classical',
        payload: ['DOMAIN-SUFFIX,x.example'],
      }),
    ).toBeNull()
  })
})

// --------------------------------------------------------------------------
// InlineRulesEditor
// --------------------------------------------------------------------------

describe('InlineRulesEditor', () => {
  it('renders one row per entry with aria labels', () => {
    const wrapper = mount(InlineRulesEditor, {
      props: { modelValue: ['DOMAIN-SUFFIX,a.com', 'IP-CIDR,10.0.0.0/8'] },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('[data-testid="inline-rules-row"]')
    expect(rows.length).toBe(2)
    const inputs = wrapper.findAll('[data-testid="inline-rules-input"]')
    for (const input of inputs) {
      expect(input.attributes('aria-label')).toMatch(/Inline rule \d/)
    }
  })

  it('emits new list on add', async () => {
    const wrapper = mount(InlineRulesEditor, {
      props: { modelValue: ['DOMAIN-SUFFIX,a.com'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="inline-rules-add"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    const last = emitted?.at(-1)?.[0]
    expect(last).toEqual(['DOMAIN-SUFFIX,a.com', ''])
  })

  it('emits new list on remove', async () => {
    const wrapper = mount(InlineRulesEditor, {
      props: { modelValue: ['DOMAIN-SUFFIX,a.com', 'DOMAIN-SUFFIX,b.com'] },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="inline-rules-remove"]').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as unknown as string[][][] | undefined
    const last = emitted?.at(-1)?.[0]
    expect(last).toEqual(['DOMAIN-SUFFIX,b.com'])
  })

  it('shows empty-state when modelValue is empty', () => {
    const wrapper = mount(InlineRulesEditor, {
      props: { modelValue: [] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('No inline rules yet.')
  })
})

// --------------------------------------------------------------------------
// ProviderList
// --------------------------------------------------------------------------

describe('ProviderList', () => {
  const sample: Record<string, RuleProviderConfig> = {
    adblock: {
      type: 'http',
      behavior: 'domain',
      format: 'yaml',
      url: 'https://example.com/adblock.yaml',
      interval: 86400,
    },
    'inline-blocks': {
      type: 'inline',
      behavior: 'classical',
      payload: ['DOMAIN-SUFFIX,bad.example'],
    },
  }

  it('renders one row per provider with name/type/behavior', () => {
    const wrapper = mount(ProviderList, {
      props: { providers: sample },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="provider-row-adblock"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-row-inline-blocks"]').exists()).toBe(true)
  })

  it('shows refresh button for http providers only', () => {
    const wrapper = mount(ProviderList, {
      props: { providers: sample },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="provider-refresh-adblock"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-refresh-inline-blocks"]').exists()).toBe(false)
  })

  it('emits refresh / edit / remove with the right name', async () => {
    const wrapper = mount(ProviderList, {
      props: { providers: sample },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="provider-refresh-adblock"]').trigger('click')
    await wrapper.get('[data-testid="provider-edit-adblock"]').trigger('click')
    await wrapper.get('[data-testid="provider-delete-adblock"]').trigger('click')
    expect(wrapper.emitted('refresh')?.[0]).toEqual(['adblock'])
    expect(wrapper.emitted('edit')?.[0]).toEqual(['adblock'])
    expect(wrapper.emitted('remove')?.[0]).toEqual(['adblock'])
  })

  it('shows empty state when no providers', () => {
    const wrapper = mount(ProviderList, {
      props: { providers: {} },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toMatch(/No rule providers configured yet/)
  })

  it('renders updating badge when live state reports updating', () => {
    const wrapper = mount(ProviderList, {
      props: {
        providers: sample,
        liveState: { adblock: { updating: true } },
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="provider-updating-badge"]').exists()).toBe(true)
  })
})

// --------------------------------------------------------------------------
// ProviderForm
// --------------------------------------------------------------------------

describe('ProviderForm', () => {
  it('renders http-specific fields by default', () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: { type: 'http', behavior: 'classical' },
        name: '',
        existingNames: [],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="provider-form-url"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-form-interval"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-form-path"]').exists()).toBe(false)
  })

  it('shows path field when type=file is selected', async () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: { type: 'file', behavior: 'classical' },
        name: '',
        existingNames: [],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="provider-form-path"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-form-url"]').exists()).toBe(false)
  })

  it('shows payload editor when type=inline', () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: { type: 'inline', behavior: 'classical', payload: ['DOMAIN-SUFFIX,a.com'] },
        name: '',
        existingNames: [],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="inline-rules-editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-form-url"]').exists()).toBe(false)
  })

  it('disables save button when config is invalid (http without url)', () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: { type: 'http', behavior: 'classical' },
        name: 'myprov',
        existingNames: [],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    const save = wrapper.get('[data-testid="provider-form-save"]')
    expect(save.attributes('disabled')).toBeDefined()
  })

  it('rejects name collision in Add flow', () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: {
          type: 'http',
          behavior: 'domain',
          url: 'https://example.com/a.yaml',
          interval: 3600,
        },
        name: 'taken-name',
        existingNames: ['taken-name'],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="provider-form-name-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="provider-form-save"]').attributes('disabled')).toBeDefined()
  })

  it('emits submit with the built config when valid', async () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: {
          type: 'http',
          behavior: 'domain',
          format: 'yaml',
          url: 'https://example.com/x.yaml',
          interval: 86400,
        },
        name: 'adblock',
        existingNames: [],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    // Trigger the form's native submit event directly rather than clicking the
    // button — jsdom doesn't propagate button clicks to form submission the
    // way a real browser does.
    await wrapper.get('[data-testid="provider-form"]').trigger('submit.prevent')
    const emitted = wrapper.emitted('submit') as unknown as Array<
      Array<{ name: string; config: RuleProviderConfig }>
    >
    expect(emitted.at(-1)?.[0]).toEqual({
      name: 'adblock',
      config: {
        type: 'http',
        behavior: 'domain',
        format: 'yaml',
        url: 'https://example.com/x.yaml',
        interval: 86400,
      },
    })
  })

  it('emits cancel', async () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: { type: 'http', behavior: 'classical' },
        name: 'x',
        existingNames: [],
        isEdit: false,
      },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.get('[data-testid="provider-form-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('disables name field in edit mode', () => {
    const wrapper = mount(ProviderForm, {
      props: {
        modelValue: {
          type: 'http',
          behavior: 'domain',
          url: 'https://example.com/a.yaml',
          interval: 3600,
        },
        name: 'existing',
        existingNames: ['existing'],
        isEdit: true,
      },
      global: { plugins: [makeI18n()] },
    })
    const nameInput = wrapper.get('[data-testid="provider-form-name"]')
    expect(nameInput.attributes('disabled')).toBeDefined()
    // Save still enabled because in edit mode we skip the name-collision check.
    expect(wrapper.get('[data-testid="provider-form-save"]').attributes('disabled')).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// yaml-mutator.setProvidersConfig
// --------------------------------------------------------------------------

describe('yaml-mutator.setProvidersConfig', () => {
  it('writes an http provider with canonical key order', () => {
    const doc = parseDraft('mode: rule\n')
    const next: RuleProvidersConfig = {
      providers: {
        adblock: {
          type: 'http',
          behavior: 'domain',
          format: 'yaml',
          url: 'https://example.com/adblock.yaml',
          interval: 86400,
          proxy: 'PROXY',
        },
      },
    }
    setProvidersConfig(doc, next)
    const out = serializeDraft(doc)
    // Canonical order: type → behavior → format → url → interval → proxy
    const idxType = out.indexOf('type:')
    const idxBehavior = out.indexOf('behavior:')
    const idxFormat = out.indexOf('format:')
    const idxUrl = out.indexOf('url:')
    const idxInterval = out.indexOf('interval:')
    const idxProxy = out.indexOf('proxy:')
    expect(idxType).toBeLessThan(idxBehavior)
    expect(idxBehavior).toBeLessThan(idxFormat)
    expect(idxFormat).toBeLessThan(idxUrl)
    expect(idxUrl).toBeLessThan(idxInterval)
    expect(idxInterval).toBeLessThan(idxProxy)
  })

  it('writes a file provider', () => {
    const doc = parseDraft('mode: rule\n')
    const next: RuleProvidersConfig = {
      providers: {
        local: {
          type: 'file',
          behavior: 'classical',
          format: 'text',
          path: './rules.txt',
        },
      },
    }
    setProvidersConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('local:')
    expect(out).toContain('type: file')
    expect(out).toContain('path: ./rules.txt')
  })

  it('writes an inline provider with payload', () => {
    const doc = parseDraft('mode: rule\n')
    const next: RuleProvidersConfig = {
      providers: {
        blocks: {
          type: 'inline',
          behavior: 'classical',
          payload: ['DOMAIN-SUFFIX,bad.example', 'IP-CIDR,10.0.0.0/8,no-resolve'],
        },
      },
    }
    setProvidersConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('type: inline')
    expect(out).toContain('DOMAIN-SUFFIX,bad.example')
    expect(out).toContain('IP-CIDR,10.0.0.0/8,no-resolve')
  })

  it('preserves per-provider extras verbatim', () => {
    const doc = parseDraft('mode: rule\n')
    const next: RuleProvidersConfig = {
      providers: {
        adblock: {
          type: 'http',
          behavior: 'domain',
          url: 'https://example.com/a.yaml',
          interval: 3600,
          extras: { 'future-knob': 42 },
        },
      },
    }
    setProvidersConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('future-knob: 42')
  })

  it('preserves top-level extras (malformed entries)', () => {
    const doc = parseDraft('mode: rule\n')
    const next: RuleProvidersConfig = {
      providers: {
        good: {
          type: 'http',
          behavior: 'domain',
          url: 'https://example.com/g.yaml',
          interval: 3600,
        },
      },
      extras: { 'broken-one': { hello: 'world' } },
    }
    setProvidersConfig(doc, next)
    const out = serializeDraft(doc)
    expect(out).toContain('good:')
    expect(out).toContain('broken-one:')
  })

  it('deletes the rule-providers: key when the config is empty', () => {
    const doc = parseDraft(
      'mode: rule\nrule-providers:\n  adblock:\n    type: http\n    behavior: domain\n    url: https://e.c/a.yaml\n    interval: 3600\n',
    )
    setProvidersConfig(doc, {})
    const out = serializeDraft(doc)
    expect(out).not.toContain('rule-providers:')
  })
})

// --------------------------------------------------------------------------
// providers-view.getProvidersConfig (client mirror)
// --------------------------------------------------------------------------

describe('providers-view.getProvidersConfig (client mirror)', () => {
  it('round-trips a representative config', () => {
    const yaml = `rule-providers:
  adblock:
    type: http
    behavior: domain
    format: yaml
    url: https://example.com/adblock.yaml
    interval: 86400
    proxy: PROXY
  local:
    type: file
    behavior: classical
    format: text
    path: ./rules.txt
  blocks:
    type: inline
    behavior: classical
    payload:
      - DOMAIN-SUFFIX,bad.example
`
    const rp = getProvidersConfig(parseDocument(yaml))
    expect(rp.providers?.adblock?.url).toBe('https://example.com/adblock.yaml')
    expect(rp.providers?.adblock?.interval).toBe(86400)
    expect(rp.providers?.adblock?.proxy).toBe('PROXY')
    expect(rp.providers?.local?.path).toBe('./rules.txt')
    expect(rp.providers?.blocks?.payload).toEqual(['DOMAIN-SUFFIX,bad.example'])
  })

  it('sends malformed entries to extras', () => {
    const yaml = `rule-providers:
  bad:
    behavior: domain
  good:
    type: http
    behavior: domain
    url: https://example.com/g.yaml
    interval: 3600
`
    const rp = getProvidersConfig(parseDocument(yaml))
    expect(rp.providers?.good).toBeDefined()
    expect(rp.providers?.bad).toBeUndefined()
    expect(rp.extras?.bad).toBeDefined()
  })

  it('returns {} when rule-providers: is absent', () => {
    expect(getProvidersConfig(parseDocument('mode: rule\n'))).toEqual({})
  })
})
