import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import RuleEditor from '../src/components/services/RuleEditor.vue'
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

function mountEditor(target = 'Gemini') {
  return mount(RuleEditor, {
    props: { target, existingRules: [] },
    global: { plugins: [makeI18n()] },
  })
}

describe('RuleEditor geo integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useCatalogStore()
    vi.spyOn(store, 'ensureLoaded').mockResolvedValue()
    store.geosite = ['google', 'youtube']
    store.geoip = ['RU', 'CN']
    store.loaded = true
  })

  it('renders combobox for GEOSITE', async () => {
    const wrapper = mountEditor()
    await wrapper.get('select').setValue('GEOSITE')
    await flushPromises()
    expect(wrapper.find('[data-testid="geo-refresh"]').exists()).toBe(true)
  })

  it('renders combobox for GEOIP', async () => {
    const wrapper = mountEditor()
    await wrapper.get('select').setValue('GEOIP')
    await flushPromises()
    expect(wrapper.find('[data-testid="geo-refresh"]').exists()).toBe(true)
  })

  it('renders combobox for SRC-GEOIP', async () => {
    const wrapper = mountEditor()
    await wrapper.get('select').setValue('SRC-GEOIP')
    await flushPromises()
    expect(wrapper.find('[data-testid="geo-refresh"]').exists()).toBe(true)
  })

  it('renders plain Input for non-geo types', async () => {
    const wrapper = mountEditor()
    await wrapper.get('select').setValue('IP-CIDR')
    await flushPromises()
    expect(wrapper.find('[data-testid="geo-refresh"]').exists()).toBe(false)
  })
})
