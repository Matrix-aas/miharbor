import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '../src/stores/catalog'
import * as apiClient from '../src/api/client'

function okPayload(geosite: string[], geoip: string[]) {
  return {
    geosite: {
      entries: geosite,
      source: 'https://example/geosite.dat',
      fetched: '2026-04-18T10:00:00.000Z',
      error: null as string | null,
    },
    geoip: {
      entries: geoip,
      source: 'https://example/geoip.dat',
      fetched: '2026-04-18T10:00:00.000Z',
      error: null as string | null,
    },
  }
}

describe('useCatalogStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('ensureLoaded fetches once; subsequent calls are no-ops', async () => {
    const spy = vi
      .spyOn(apiClient.endpoints.catalog, 'geo')
      .mockResolvedValue(okPayload(['a'], ['RU']))
    const store = useCatalogStore()
    await store.ensureLoaded()
    await store.ensureLoaded()
    await store.ensureLoaded()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.geosite).toEqual(['a'])
    expect(store.geoip).toEqual(['RU'])
  })

  it('dedups concurrent ensureLoaded calls', async () => {
    const spy = vi
      .spyOn(apiClient.endpoints.catalog, 'geo')
      .mockResolvedValue(okPayload(['a'], ['b']))
    const store = useCatalogStore()
    await Promise.all([store.ensureLoaded(), store.ensureLoaded(), store.ensureLoaded()])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refresh triggers a fresh fetch with refresh flag', async () => {
    const spy = vi
      .spyOn(apiClient.endpoints.catalog, 'geo')
      .mockResolvedValue(okPayload(['a'], ['b']))
    const store = useCatalogStore()
    await store.ensureLoaded()
    await store.refresh()
    expect(spy).toHaveBeenNthCalledWith(1, false)
    expect(spy).toHaveBeenNthCalledWith(2, true)
  })

  it('populates per-side errors from response', async () => {
    vi.spyOn(apiClient.endpoints.catalog, 'geo').mockResolvedValue({
      geosite: { entries: ['a'], source: 's', fetched: 't', error: null },
      geoip: { entries: [], source: 'g', fetched: null, error: 'down' },
    })
    const store = useCatalogStore()
    await store.ensureLoaded()
    expect(store.error.geosite).toBeNull()
    expect(store.error.geoip).toBe('down')
  })

  it('network failure surfaces as error on both sides', async () => {
    vi.spyOn(apiClient.endpoints.catalog, 'geo').mockRejectedValue(new Error('net'))
    const store = useCatalogStore()
    await store.ensureLoaded()
    expect(store.error.geosite).toBe('net')
    expect(store.error.geoip).toBe('net')
    expect(store.geosite).toEqual([])
    expect(store.geoip).toEqual([])
  })

  it('ensureRuleProvidersLoaded fetches once; subsequent calls are no-ops (v0.2.6)', async () => {
    const spy = vi
      .spyOn(apiClient.endpoints.catalog, 'ruleProviders')
      .mockResolvedValue({
        names: ['ad-block', 'youtube'],
        source: 'profile.rule-providers',
        error: null,
      })
    const store = useCatalogStore()
    await store.ensureRuleProvidersLoaded()
    await store.ensureRuleProvidersLoaded()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.ruleProviders).toEqual(['ad-block', 'youtube'])
    expect(store.error.ruleProviders).toBeNull()
  })

  it('refreshRuleProviders bypasses the dedup gate (v0.2.6)', async () => {
    const spy = vi
      .spyOn(apiClient.endpoints.catalog, 'ruleProviders')
      .mockResolvedValue({ names: ['x'], source: 'profile.rule-providers', error: null })
    const store = useCatalogStore()
    await store.ensureRuleProvidersLoaded()
    await store.refreshRuleProviders()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('rule-providers fetch error surfaces as rule-providers-scoped error (v0.2.6)', async () => {
    vi.spyOn(apiClient.endpoints.catalog, 'ruleProviders').mockRejectedValue(new Error('net'))
    const store = useCatalogStore()
    await store.ensureRuleProvidersLoaded()
    expect(store.error.ruleProviders).toBe('net')
    expect(store.ruleProviders).toEqual([])
    // Geo-side errors must stay untouched — the two loaders are independent.
    expect(store.error.geosite).toBeNull()
    expect(store.error.geoip).toBeNull()
  })
})
