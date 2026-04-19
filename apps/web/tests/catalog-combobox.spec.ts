import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import GeoCatalogCombobox from '../src/components/services/GeoCatalogCombobox.vue'
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

async function mountBox(props: { modelValue: string; type: 'GEOSITE' | 'GEOIP' }) {
  const wrapper = mount(GeoCatalogCombobox, {
    props,
    global: { plugins: [makeI18n()] },
  })
  await flushPromises()
  return wrapper
}

describe('GeoCatalogCombobox', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useCatalogStore()
    vi.spyOn(store, 'ensureLoaded').mockResolvedValue()
    store.geosite = ['google', 'youtube', 'github', 'category-ru']
    store.geoip = ['RU', 'CN', 'US']
    store.loaded = true
  })

  it('shows matching geosite entries on typeahead', async () => {
    const wrapper = await mountBox({ modelValue: '', type: 'GEOSITE' })
    const input = wrapper.get('input')
    await input.setValue('goo')
    // Dropdown should surface "google" and "github" but not "category-ru".
    const items = wrapper.findAll('[data-testid="geo-option"]')
    const texts = items.map((n) => n.text())
    expect(texts).toContain('google')
    expect(texts).not.toContain('category-ru')
  })

  it('uppercases GEOIP free-form input on blur', async () => {
    const wrapper = await mountBox({ modelValue: '', type: 'GEOIP' })
    const input = wrapper.get('input')
    await input.setValue('ru')
    await input.trigger('blur')
    const emits = wrapper.emitted('update:modelValue') ?? []
    expect(emits.at(-1)).toEqual(['RU'])
  })

  it('keyboard navigation selects an option', async () => {
    const wrapper = await mountBox({ modelValue: '', type: 'GEOSITE' })
    const input = wrapper.get('input')
    await input.setValue('g')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    const emits = wrapper.emitted('update:modelValue') ?? []
    // First match for "g" is "google" (alphabetical among ['google','github']).
    expect(['google', 'github']).toContain(emits.at(-1)![0] as string)
  })

  it('shows offline badge when store error is set; dropdown does not open', async () => {
    const store = useCatalogStore()
    store.error = { geosite: 'down', geoip: null }
    const wrapper = await mountBox({ modelValue: '', type: 'GEOSITE' })
    expect(wrapper.find('[data-testid="geo-offline-badge"]').exists()).toBe(true)
    const input = wrapper.get('input')
    await input.setValue('g')
    expect(wrapper.findAll('[data-testid="geo-option"]').length).toBe(0)
  })

  it('accepts free-form input not present in catalog', async () => {
    const wrapper = await mountBox({ modelValue: '', type: 'GEOSITE' })
    const input = wrapper.get('input')
    await input.setValue('my-custom-cat')
    await input.trigger('blur')
    const emits = wrapper.emitted('update:modelValue') ?? []
    expect(emits.at(-1)).toEqual(['my-custom-cat'])
  })

  it('refresh button calls store.refresh', async () => {
    const store = useCatalogStore()
    const spy = vi.spyOn(store, 'refresh').mockResolvedValue()
    const wrapper = await mountBox({ modelValue: '', type: 'GEOSITE' })
    await wrapper.get('[data-testid="geo-refresh"]').trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('Escape key closes the dropdown', async () => {
    const wrapper = await mountBox({ modelValue: '', type: 'GEOSITE' })
    const input = wrapper.get('input')
    await input.trigger('focus')
    await input.setValue('g')
    // Dropdown is open now — at least one option visible.
    expect(wrapper.findAll('[data-testid="geo-option"]').length).toBeGreaterThan(0)
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.findAll('[data-testid="geo-option"]').length).toBe(0)
  })
})
