// Config store — caches services/proxies/meta/raw plus the draft diff.
// The "dirty counter" exposed here is what the Header uses to enable or
// disable the Apply button: it compares the draft length to the last loaded
// live config (coarse but good enough for the skeleton). Subsequent tasks
// (21+) replace this with a proper diff against canonical YAML.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { endpoints, ApiError } from '@/api/client'
import type { DraftResponse } from '@/api/client'

export const useConfigStore = defineStore('config', () => {
  const services = ref<unknown>(null)
  const proxies = ref<unknown>(null)
  const meta = ref<Record<string, unknown> | null>(null)
  const rawLive = ref<string | null>(null)
  const draft = ref<DraftResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasDraft = computed(() => draft.value?.source === 'draft' && draft.value.text.length > 0)

  /** Coarse dirtiness heuristic for the skeleton Header. A real diff is
   *  computed in Task 21 once the Services screen produces structured
   *  mutations. */
  const dirtyCount = computed<number>(() => {
    if (!hasDraft.value) return 0
    if (!rawLive.value) return 1
    return draft.value!.text === rawLive.value ? 0 : 1
  })

  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [svc, prx, mta, raw, drft] = await Promise.all([
        endpoints.config.services(),
        endpoints.config.proxies(),
        endpoints.config.meta(),
        endpoints.config.raw(),
        endpoints.config.draft(),
      ])
      services.value = svc
      proxies.value = prx
      meta.value = mta as Record<string, unknown>
      rawLive.value = raw
      draft.value = drft
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function putDraft(yaml: string): Promise<void> {
    await endpoints.config.putDraft(yaml)
    draft.value = { source: 'draft', text: yaml, updated: new Date().toISOString() }
  }

  async function clearDraft(): Promise<void> {
    await endpoints.config.clearDraft()
    if (rawLive.value !== null) {
      draft.value = { source: 'current', text: rawLive.value }
    } else {
      draft.value = null
    }
  }

  return {
    services,
    proxies,
    meta,
    rawLive,
    draft,
    loading,
    error,
    hasDraft,
    dirtyCount,
    loadAll,
    putDraft,
    clearDraft,
  }
})
