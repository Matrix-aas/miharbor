// Geo-catalog store — lazy-loads the parsed `.dat` category lists from
// /api/catalog/geo on first call. Deduplicates concurrent loads so two
// comboboxes mounting together only trigger one HTTP request.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { endpoints } from '@/api/client'

export const useCatalogStore = defineStore('catalog', () => {
  const geosite = ref<string[]>([])
  const geoip = ref<string[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<{ geosite: string | null; geoip: string | null }>({
    geosite: null,
    geoip: null,
  })
  let inflight: Promise<void> | null = null

  async function doLoad(force: boolean): Promise<void> {
    loading.value = true
    try {
      const r = await endpoints.catalog.geo(force)
      geosite.value = r.geosite.entries
      geoip.value = r.geoip.entries
      error.value = {
        geosite: r.geosite.error,
        geoip: r.geoip.error,
      }
      loaded.value = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = { geosite: msg, geoip: msg }
      // Keep empty arrays so UI falls back to free-form input.
      geosite.value = []
      geoip.value = []
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    if (inflight) return inflight
    inflight = doLoad(false).finally(() => {
      inflight = null
    })
    return inflight
  }

  async function refresh(): Promise<void> {
    // Reset the inflight dedup so a refresh always fires.
    inflight = doLoad(true).finally(() => {
      inflight = null
    })
    return inflight
  }

  return { geosite, geoip, loading, loaded, error, ensureLoaded, refresh }
})
