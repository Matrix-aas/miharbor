// RuleSetCombobox tests (v0.2.6). Mirrors catalog-combobox.spec.ts but
// targets the separate rule-providers source (no uppercase normalisation,
// simpler UX).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import RuleSetCombobox from '../src/components/services/RuleSetCombobox.vue'
import { useCatalogStore } from '../src/stores/catalog'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

async function mountBox(props: { modelValue: string } = { modelValue: '' }) {
  const wrapper = mount(RuleSetCombobox, {
    props,
    global: { plugins: [makeI18n()] },
  })
  await flushPromises()
  return wrapper
}

describe('RuleSetCombobox', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useCatalogStore()
    vi.spyOn(store, 'ensureRuleProvidersLoaded').mockResolvedValue()
    store.ruleProviders = ['ad-block', 'category-ru', 'youtube-domains']
    store.ruleProvidersLoaded = true
  })

  it('surfaces matching rule-providers on typeahead', async () => {
    const wrapper = await mountBox()
    const input = wrapper.get('input')
    await input.setValue('yo')
    const items = wrapper.findAll('[data-testid="rule-set-option"]')
    const texts = items.map((n) => n.text())
    expect(texts).toContain('youtube-domains')
    expect(texts).not.toContain('ad-block')
  })

  it('emits the selected option value verbatim (no uppercase normalisation)', async () => {
    const wrapper = await mountBox()
    const input = wrapper.get('input')
    await input.setValue('ad')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    const emits = wrapper.emitted('update:modelValue') ?? []
    expect(emits.at(-1)).toEqual(['ad-block'])
  })

  it('accepts free-form input not declared in rule-providers', async () => {
    const wrapper = await mountBox()
    const input = wrapper.get('input')
    await input.setValue('my-custom-provider')
    await input.trigger('blur')
    const emits = wrapper.emitted('update:modelValue') ?? []
    expect(emits.at(-1)).toEqual(['my-custom-provider'])
  })

  it('shows offline badge when ruleProviders error is set', async () => {
    const store = useCatalogStore()
    store.error = { geosite: null, geoip: null, ruleProviders: 'read failed' }
    const wrapper = await mountBox()
    expect(wrapper.find('[data-testid="rule-set-offline-badge"]').exists()).toBe(true)
    // No dropdown options render while offline.
    const input = wrapper.get('input')
    await input.setValue('yo')
    expect(wrapper.findAll('[data-testid="rule-set-option"]').length).toBe(0)
  })

  it('refresh button calls store.refreshRuleProviders', async () => {
    const store = useCatalogStore()
    const spy = vi.spyOn(store, 'refreshRuleProviders').mockResolvedValue()
    const wrapper = await mountBox()
    await wrapper.get('[data-testid="rule-set-refresh"]').trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('Escape key closes the dropdown', async () => {
    const wrapper = await mountBox()
    const input = wrapper.get('input')
    await input.trigger('focus')
    await input.setValue('y')
    expect(wrapper.findAll('[data-testid="rule-set-option"]').length).toBeGreaterThan(0)
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.findAll('[data-testid="rule-set-option"]').length).toBe(0)
  })
})
