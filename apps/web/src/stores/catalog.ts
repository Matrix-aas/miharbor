// Catalog store — lazy-loads lookup data used by the RuleEditor:
//   * GEOSITE / GEOIP categories from /api/catalog/geo (parsed .dat files).
//   * RULE-SET names from /api/catalog/rule-providers (v0.2.6) — the list
//     of providers declared under `profile.rule-providers` in the live
//     mihomo config. Loaded separately from geo so a RULE-SET-only edit
//     doesn't trigger a geo fetch.
//
// Both loaders deduplicate concurrent callers so multiple comboboxes
// mounting together only trigger one HTTP request each.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { endpoints } from '@/api/client'

export const useCatalogStore = defineStore('catalog', () => {
  const geosite = ref<string[]>([])
  const geoip = ref<string[]>([])
  const ruleProviders = ref<string[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const ruleProvidersLoading = ref(false)
  const ruleProvidersLoaded = ref(false)
  const error = ref<{ geosite: string | null; geoip: string | null; ruleProviders: string | null }>(
    {
      geosite: null,
      geoip: null,
      ruleProviders: null,
    },
  )
  let inflight: Promise<void> | null = null
  let ruleProvidersInflight: Promise<void> | null = null

  async function doLoad(force: boolean): Promise<void> {
    loading.value = true
    try {
      const r = await endpoints.catalog.geo(force)
      geosite.value = r.geosite.entries
      geoip.value = r.geoip.entries
      error.value = {
        ...error.value,
        geosite: r.geosite.error,
        geoip: r.geoip.error,
      }
      loaded.value = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = { ...error.value, geosite: msg, geoip: msg }
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

  async function doLoadRuleProviders(): Promise<void> {
    ruleProvidersLoading.value = true
    try {
      const r = await endpoints.catalog.ruleProviders()
      ruleProviders.value = r.names
      error.value = { ...error.value, ruleProviders: r.error }
      ruleProvidersLoaded.value = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = { ...error.value, ruleProviders: msg }
      ruleProviders.value = []
      ruleProvidersLoaded.value = true
    } finally {
      ruleProvidersLoading.value = false
    }
  }

  async function ensureRuleProvidersLoaded(): Promise<void> {
    if (ruleProvidersLoaded.value) return
    if (ruleProvidersInflight) return ruleProvidersInflight
    ruleProvidersInflight = doLoadRuleProviders().finally(() => {
      ruleProvidersInflight = null
    })
    return ruleProvidersInflight
  }

  async function refreshRuleProviders(): Promise<void> {
    ruleProvidersInflight = doLoadRuleProviders().finally(() => {
      ruleProvidersInflight = null
    })
    return ruleProvidersInflight
  }

  return {
    geosite,
    geoip,
    ruleProviders,
    loading,
    loaded,
    ruleProvidersLoading,
    ruleProvidersLoaded,
    error,
    ensureLoaded,
    refresh,
    ensureRuleProvidersLoaded,
    refreshRuleProviders,
  }
})
