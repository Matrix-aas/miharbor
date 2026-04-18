import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import Header from '../src/components/layout/Header.vue'
import { useConfigStore } from '../src/stores/config'
import { useDeployStore } from '../src/stores/deploy'
import * as apiClient from '../src/api/client'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

// Header mounts PendingChangesDialog whose content is portaled to
// document.body (radix-vue), so we attach + query there.
function mountHeader() {
  return mount(Header, {
    attachTo: document.body,
    global: {
      plugins: [makeI18n()],
      stubs: { 'router-link': true, HealthBadge: true },
    },
  })
}

describe('Header dirty badge', () => {
  let wrappers: Array<VueWrapper<unknown>> = []

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch: '',
      added: 0,
      removed: 0,
      hasDraft: false,
    })
    const deploy = useDeployStore()
    vi.spyOn(deploy, 'open').mockImplementation(() => {})
    vi.spyOn(deploy, 'startDeploy').mockResolvedValue()
    vi.spyOn(deploy, 'reset').mockImplementation(() => {})
    wrappers = []
  })

  afterEach(() => {
    for (const w of wrappers) w.unmount()
    document.body.innerHTML = ''
  })

  function track(w: VueWrapper<unknown>) {
    wrappers.push(w)
    return w
  }

  it('renders "No changes" badge when dirtyCount is 0', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const wrapper = track(mountHeader())
    await flushPromises()
    expect(wrapper.html()).toContain('No changes')
    expect(wrapper.find('[data-testid="header-pending-badge"]').exists()).toBe(false)
  })

  it('renders clickable "Pending changes" badge when dirty; click opens dialog', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: global\n'
    const wrapper = track(mountHeader())
    await flushPromises()
    const badge = wrapper.get('[data-testid="header-pending-badge"]')
    expect(badge.text()).toContain('Pending changes')
    await badge.trigger('click')
    await flushPromises()
    // Dialog content is portaled to document.body — look there for the
    // mocked draftDiff response's "no changes" empty state.
    expect(document.body.innerHTML).toMatch(/No changes|Loading diff/)
  })

  it('during initial load (rawLive=null), dirtyCount=0 so no pending button renders', async () => {
    // dirtyCount short-circuits to 0 when rawLive OR draftText is null
    // (apps/web/src/stores/config.ts:172-176). Header should render the
    // muted "No changes" badge instead of a clickable pending button.
    const store = useConfigStore()
    store.rawLive = null
    store.draftText = 'mode: global\n'
    const wrapper = track(mountHeader())
    await flushPromises()
    expect(wrapper.find('[data-testid="header-pending-badge"]').exists()).toBe(false)
    expect(wrapper.html()).toContain('No changes')
  })
})
