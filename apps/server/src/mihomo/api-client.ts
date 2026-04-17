// Typed mihomo REST API client.
//
// Scope:
// - `reloadConfig()` — PUT /configs?force=true (force-reload after
//   writeConfig in the deploy pipeline).
// - `getVersion()` — poll /version for healthcheck phase 1.
// - `listProxies()` / `getProxyDelay()` — phase 3 healthcheck + UI.
// - `listProviders()` / `refreshProvider()` — phase 2 / providers screen.
// - `listRules()` — rules overview / linter cross-check.
//
// Auth: Bearer token in `Authorization` header (mihomo docs). A missing
// or wrong token surfaces as `MihomoApiAuthError` so the caller can show
// a targeted message instead of generic "API down".
//
// Timeouts: AbortSignal with a configurable default (10s). Network
// errors, aborts, or non-2xx responses are all wrapped as
// `MihomoApiError` with the status code + endpoint path.

/** Default per-call deadline. */
export const DEFAULT_TIMEOUT_MS = 10_000

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface MihomoApiClientOptions {
  /** Base URL, e.g. `http://127.0.0.1:9090`. Trailing slash ok. */
  baseUrl: string
  /** Bearer secret. Empty string disables the Authorization header. */
  secret: string
  /** Default timeout in ms for every request. */
  timeoutMs?: number
  /** Injected fetch impl for tests. */
  fetchImpl?: FetchLike
}

/** Generic mihomo error — HTTP error, network error, timeout, etc. */
export class MihomoApiError extends Error {
  public readonly status: number | null
  public readonly endpoint: string
  public readonly responseText: string | null
  constructor(msg: string, opts: { status: number | null; endpoint: string; body?: string }) {
    super(msg)
    this.name = 'MihomoApiError'
    this.status = opts.status
    this.endpoint = opts.endpoint
    this.responseText = opts.body ?? null
  }
}

/** 401 from mihomo — wrong Bearer or missing secret. Callers surface this
 *  with a dedicated "mihomo secret invalid" UI hint. */
export class MihomoApiAuthError extends MihomoApiError {
  constructor(endpoint: string, body?: string) {
    super(
      'mihomo API rejected credentials (401)' + (body ? ` — body: ${body.slice(0, 200)}` : ''),
      { status: 401, endpoint, ...(body !== undefined ? { body } : {}) },
    )
    this.name = 'MihomoApiAuthError'
  }
}

export interface MihomoApi {
  /** `GET /version` → mihomo build info. */
  getVersion(): Promise<{ version: string; premium: boolean }>
  /** `PUT /configs?force=true` — reload live config from disk. */
  reloadConfig(): Promise<void>
  /** `GET /proxies` — raw JSON map. */
  listProxies(): Promise<Record<string, unknown>>
  /** `GET /proxies/:name/delay?url=…&timeout=…`. */
  getProxyDelay(name: string, opts?: { url?: string; timeout?: number }): Promise<{ delay: number }>
  /** `GET /providers/proxies` — proxy providers. */
  listProviders(): Promise<Record<string, unknown>>
  /** `PUT /providers/proxies/:name` — refresh a proxy provider. */
  refreshProvider(name: string): Promise<void>
  /** `GET /providers/rules` — rule providers (adblock-lists, geosite, etc.). */
  listRuleProviders(): Promise<Record<string, unknown>>
  /** `PUT /providers/rules/:name` — refresh a rule provider. Same semantics
   *  as `refreshProvider` but targets the rule-provider namespace. */
  refreshRuleProvider(name: string): Promise<void>
  /** `GET /rules` — parsed rules array. */
  listRules(): Promise<unknown[]>
}

export function createMihomoApi(opts: MihomoApiClientOptions): MihomoApi {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')

  async function call(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    const ac = new AbortController()
    const deadline = init.timeoutMs ?? timeoutMs
    const timer = setTimeout(() => ac.abort(new Error(`timeout after ${deadline}ms`)), deadline)
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...Object.fromEntries(Object.entries(init.headers ?? {})),
    }
    if (opts.secret.length > 0) {
      headers.authorization = `Bearer ${opts.secret}`
    }
    let response: Response
    try {
      response = await fetchImpl(baseUrl + path, {
        ...init,
        headers,
        signal: ac.signal,
      })
    } catch (err) {
      // Fetch abort or network error.
      clearTimeout(timer)
      const msg = (err as Error).message || 'fetch failed'
      throw new MihomoApiError(`mihomo API call to ${path} failed: ${msg}`, {
        status: null,
        endpoint: path,
      })
    }
    clearTimeout(timer)
    if (response.status === 401) {
      const bodyText = await safeText(response)
      throw new MihomoApiAuthError(path, bodyText)
    }
    if (!response.ok) {
      const body = await safeText(response)
      throw new MihomoApiError(`mihomo ${path} returned ${response.status}`, {
        status: response.status,
        endpoint: path,
        body,
      })
    }
    return response
  }

  async function callJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await call(path, init)
    try {
      return (await r.json()) as T
    } catch (e) {
      throw new MihomoApiError(`mihomo ${path} returned non-JSON body: ${(e as Error).message}`, {
        status: r.status,
        endpoint: path,
      })
    }
  }

  return {
    getVersion() {
      return callJson<{ version: string; premium: boolean }>('/version')
    },

    async reloadConfig() {
      // mihomo PUT /configs requires a valid JSON body. `{}` reloads from
      // the currently loaded config path on disk; no need to pass path
      // (which would require knowing mihomo's host-side view of the path
      // when miharbor runs in a container).
      await call('/configs?force=true', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    },

    listProxies() {
      return callJson<Record<string, unknown>>('/proxies')
    },

    async getProxyDelay(name, delayOpts = {}) {
      const q = new URLSearchParams()
      q.set('url', delayOpts.url ?? 'http://www.gstatic.com/generate_204')
      q.set('timeout', String(delayOpts.timeout ?? 5000))
      return callJson<{ delay: number }>(
        `/proxies/${encodeURIComponent(name)}/delay?${q.toString()}`,
      )
    },

    listProviders() {
      return callJson<Record<string, unknown>>('/providers/proxies')
    },

    async refreshProvider(name) {
      await call(`/providers/proxies/${encodeURIComponent(name)}`, { method: 'PUT' })
    },

    listRuleProviders() {
      return callJson<Record<string, unknown>>('/providers/rules')
    },

    async refreshRuleProvider(name) {
      await call(`/providers/rules/${encodeURIComponent(name)}`, { method: 'PUT' })
    },

    async listRules() {
      const r = await callJson<{ rules?: unknown[] }>('/rules')
      return r.rules ?? []
    },
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text()
  } catch {
    return ''
  }
}
