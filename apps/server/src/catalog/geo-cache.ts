// In-memory, TTL-bounded cache for parsed `.dat` entries. Keyed by URL.
// Stale-on-error: if a refresh fails and we have a previous success,
// we return the last good entries plus an `error` string describing
// the refresh failure.
//
// The cache is deliberately small (max 8 URLs) because the only user-
// configurable source is `profile.geox-url.*` plus two defaults. Tests
// inject `fetchImpl` + `now` to avoid real network + real clock.

import { pbScan } from './pb-scan.ts'

export interface FetchResult {
  ok: boolean
  status: number
  body: Uint8Array
}

export type FetchImpl = (url: string) => Promise<FetchResult>

export interface CacheEntry {
  url: string
  entries: string[]
  /** ISO timestamp of last successful fetch, or null if never succeeded. */
  fetched: string | null
  error: string | null
}

export interface CacheOptions {
  ttlMs: number
  fetchImpl?: FetchImpl
  now?: () => number
  maxSize?: number
}

export interface GeoCache {
  get(url: string, opts?: { refresh?: boolean }): Promise<CacheEntry>
}

const DEFAULT_FETCH: FetchImpl = async (url) => {
  const res = await fetch(url)
  const buf = new Uint8Array(await res.arrayBuffer())
  return { ok: res.ok, status: res.status, body: buf }
}

export function createGeoCache(opts: CacheOptions): GeoCache {
  const ttl = opts.ttlMs
  const fetchImpl = opts.fetchImpl ?? DEFAULT_FETCH
  const now = opts.now ?? Date.now
  const maxSize = opts.maxSize ?? 8
  // Internal state: entries + last-fetched epoch millis per URL.
  interface State extends CacheEntry {
    stamp: number | null
  }
  const cache = new Map<string, State>()

  function evictIfNeeded(): void {
    while (cache.size > maxSize) {
      const first = cache.keys().next().value
      if (first === undefined) break
      cache.delete(first)
    }
  }

  return {
    async get(url, getOpts = {}) {
      const existing = cache.get(url)
      const fresh =
        existing !== undefined && existing.stamp !== null && now() - existing.stamp < ttl
      if (!getOpts.refresh && fresh) {
        return toEntry(existing!)
      }
      try {
        const res = await fetchImpl(url)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const entries = pbScan(res.body)
        const state: State = {
          url,
          entries,
          fetched: new Date(now()).toISOString(),
          error: null,
          stamp: now(),
        }
        cache.set(url, state)
        evictIfNeeded()
        return toEntry(state)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (existing !== undefined && existing.entries.length > 0) {
          const state: State = {
            ...existing,
            error: msg,
            // keep existing stamp & fetched; TTL still counts so we don't
            // hammer the upstream when it's down — next refresh after TTL
            // will retry.
          }
          cache.set(url, state)
          return toEntry(state)
        }
        const state: State = {
          url,
          entries: [],
          fetched: null,
          error: msg,
          stamp: null,
        }
        cache.set(url, state)
        evictIfNeeded()
        return toEntry(state)
      }
    },
  }
}

function toEntry(s: {
  url: string
  entries: string[]
  fetched: string | null
  error: string | null
}): CacheEntry {
  return { url: s.url, entries: s.entries, fetched: s.fetched, error: s.error }
}
