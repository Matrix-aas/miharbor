import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import PendingChangesDialog from '../src/components/layout/PendingChangesDialog.vue'
import { useConfigStore } from '../src/stores/config'
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

// Dialog content is teleported by radix-vue into document.body, so we attach
// the wrapper there and query against document — mirrors the pattern in
// apps/web/tests/template-suggester.spec.ts.
function mountDialog() {
  return mount(PendingChangesDialog, {
    props: { open: true },
    attachTo: document.body,
    global: { plugins: [makeI18n()] },
  })
}

// Dynamic `import('diff2html')` resolves across macrotask boundaries in
// vitest's jsdom environment, so plain `flushPromises()` (microtask-only)
// is not enough. Poll on setTimeout(0) + flushPromises until the predicate
// holds (max ~20 iterations).
async function waitFor(predicate: () => boolean, iters = 20): Promise<void> {
  for (let i = 0; i < iters; i++) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}

describe('PendingChangesDialog', () => {
  let wrappers: Array<VueWrapper<unknown>> = []
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
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

  it('renders "no changes" when hasDraft=false', async () => {
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch: '',
      added: 0,
      removed: 0,
      hasDraft: false,
    })
    track(mountDialog())
    await flushPromises()
    expect(document.body.innerHTML).toContain('No changes')
    const resetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="pending-reset-button"]',
    )
    expect(resetBtn).toBeTruthy()
    expect(resetBtn!.disabled).toBe(true)
  })

  it('fetches + renders diff2html output with line stats', async () => {
    const patch = [
      '--- live',
      '+++ draft',
      '@@ -1,1 +1,1 @@',
      '-mode: rule',
      '+mode: global',
      '',
    ].join('\n')
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch,
      added: 1,
      removed: 1,
      hasDraft: true,
    })
    track(mountDialog())
    // Wait for dynamic import of diff2html + render to flush.
    await waitFor(() => document.body.innerHTML.includes('d2h-wrapper'))
    // diff2html wraps the changed word in `<ins>` tags (so `mode: global`
    // surfaces as `mode: <ins>global</ins>`); we don't assert the exact
    // HTML but do confirm the added content + stats landed.
    expect(document.body.innerHTML).toContain('d2h-wrapper')
    expect(document.body.innerHTML).toContain('global')
    expect(document.body.innerHTML).toContain('+1')
    expect(document.body.innerHTML).toContain('−1')
  })

  it('shows error banner + retry when fetch fails', async () => {
    const spy = vi.spyOn(apiClient.endpoints.config, 'draftDiff')
    spy.mockRejectedValueOnce(new Error('boom'))
    track(mountDialog())
    await flushPromises()
    expect(document.body.innerHTML).toContain('Failed to load diff')
    spy.mockResolvedValueOnce({ patch: '', added: 0, removed: 0, hasDraft: false })
    const retry = document.querySelector<HTMLButtonElement>('[data-testid="pending-retry"]')
    expect(retry).toBeTruthy()
    retry!.click()
    await flushPromises()
    expect(document.body.innerHTML).toContain('No changes')
  })

  it('clicking reset → confirm → calls config.clearDraft + emits close', async () => {
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch: '--- live\n+++ draft\n@@ -1,1 +1,1 @@\n-a\n+b\n',
      added: 1,
      removed: 1,
      hasDraft: true,
    })
    const store = useConfigStore()
    const clearSpy = vi.spyOn(store, 'clearDraft').mockResolvedValue()
    const wrapper = track(mountDialog())
    await flushPromises()
    const resetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="pending-reset-button"]',
    )
    expect(resetBtn).toBeTruthy()
    resetBtn!.click()
    await flushPromises()
    // ConfirmDialog emits 'confirm' from its primary button. We find the
    // ConfirmDialog component instance inside the wrapper tree and trigger
    // the event directly — matches how the parent listens (@confirm).
    const confirmDialog = wrapper.findComponent({ name: 'ConfirmDialog' })
    expect(confirmDialog.exists()).toBe(true)
    await confirmDialog.vm.$emit('confirm')
    await flushPromises()
    expect(clearSpy).toHaveBeenCalledOnce()
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
