// Typed fetch wrapper around the Miharbor server API. Every browser call
// shares the same cookie/Basic-Auth context (via `credentials: 'include'`)
// so the server's Basic Auth middleware picks up the operator's session.
//
// The client is intentionally minimal: no caching, no retries. Stores
// compose richer behaviour on top.

import type { Issue, UserInvariant } from 'miharbor-shared'

export interface ApiErrorBody {
  code?: string
  message?: string
  errors?: Array<{ message: string; line?: number; col?: number }>
  issues?: Issue[]
  [k: string]: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody | null
  constructor(status: number, message: string, body: ApiErrorBody | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  /**
   * Parse the response as text instead of JSON (e.g. /api/config/raw returns
   * `text/plain`). Default: infer from `content-type`.
   */
  asText?: boolean
  signal?: AbortSignal
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string') {
      body = opts.body
      headers['content-type'] ??= 'text/plain'
    } else {
      body = JSON.stringify(opts.body)
      headers['content-type'] ??= 'application/json'
    }
  }

  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    body,
    signal: opts.signal,
  })

  const contentType = res.headers.get('content-type') ?? ''
  const wantsText = opts.asText ?? !contentType.includes('application/json')

  if (!res.ok) {
    let parsed: ApiErrorBody | null = null
    try {
      if (contentType.includes('application/json')) {
        parsed = (await res.json()) as ApiErrorBody
      } else {
        const text = await res.text()
        parsed = text ? { message: text } : null
      }
    } catch {
      parsed = null
    }
    const message = parsed?.message ?? parsed?.code ?? `HTTP ${res.status}`
    throw new ApiError(res.status, message, parsed)
  }

  if (wantsText) {
    return (await res.text()) as unknown as T
  }
  return (await res.json()) as T
}

// --- Endpoint-typed helpers -----------------------------------------------
// These mirror what the server routes return; wider types stay in miharbor-shared.

export interface AuthStatus {
  user: string
  mustChangePassword: boolean
}

export interface ConfigMeta {
  [k: string]: unknown
}

export interface SnapshotMeta {
  id: string
  /** ISO-8601 UTC timestamp of snapshot creation. */
  timestamp: string
  sha256_original: string
  sha256_masked: string
  applied_by: 'user' | 'rollback' | 'auto-rollback' | 'canonicalization'
  user_ip?: string
  user_agent?: string
  diff_summary?: { added: number; removed: number }
  mihomo_api_version?: string
  transport: 'local' | 'ssh'
  [k: string]: unknown
}

export interface DraftResponse {
  source: 'draft' | 'current'
  text: string
  updated?: string
}

export interface SnapshotDetail {
  meta: SnapshotMeta
  configMasked: string
  /** Unified diff.patch against the previous snapshot's masked content.
   *  Empty string for the first snapshot. */
  diffPatch: string
}

export interface EnvEntry {
  value: string | number | boolean
  source: 'env' | 'default'
  masked?: true
}

export interface OnboardingStatus {
  needsOnboarding: boolean
  configPath: string
}

export const endpoints = {
  auth: {
    status: () => api<AuthStatus>('/api/auth/status'),
    password: (oldPassword: string, newPassword: string) =>
      api<{ ok: true }>('/api/auth/password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      }),
  },
  config: {
    services: () => api<unknown>('/api/config/services'),
    proxies: () => api<unknown>('/api/config/proxies'),
    meta: () => api<ConfigMeta>('/api/config/meta'),
    raw: () => api<string>('/api/config/raw', { asText: true }),
    draft: () => api<DraftResponse>('/api/config/draft'),
    putDraft: (yaml: string) =>
      api<{ ok: true; updated: string }>('/api/config/draft', {
        method: 'PUT',
        body: { yaml },
      }),
    clearDraft: () => api<{ ok: true }>('/api/config/draft', { method: 'DELETE' }),
  },
  snapshots: {
    list: () => api<SnapshotMeta[]>('/api/snapshots'),
    get: (id: string) => api<SnapshotDetail>(`/api/snapshots/${id}`),
    // Rollback returns an SSE stream, not JSON — consumers must use EventSource
    // or fetch+ReadableStream directly. See `stores/deploy.ts::startRollback`.
  },
  settings: {
    env: () => api<Record<string, EnvEntry>>('/api/settings/env'),
  },
  onboarding: {
    status: () => api<OnboardingStatus>('/api/onboarding/status'),
    seed: () => api<{ success: boolean; path: string }>('/api/onboarding/seed', { method: 'POST' }),
  },
  lint: (yaml: string) => api<{ issues: Issue[] }>('/api/lint', { method: 'POST', body: { yaml } }),
  invariants: {
    list: () =>
      api<{ invariants: UserInvariant[]; errors: Array<{ index: number; message: string }> }>(
        '/api/invariants',
      ),
    put: (invariants: UserInvariant[]) =>
      api<{ ok: true; invariants: UserInvariant[] }>('/api/invariants', {
        method: 'PUT',
        body: { invariants },
      }),
  },
  mihomo: {
    version: () => api<{ version: string; premium: boolean }>('/api/mihomo/version'),
    proxies: () => api<Record<string, unknown>>('/api/mihomo/proxies'),
    proxyDelay: (name: string, opts: { url?: string; timeout?: number } = {}) => {
      const params = new URLSearchParams()
      if (opts.url) params.set('url', opts.url)
      if (opts.timeout !== undefined) params.set('timeout', String(opts.timeout))
      const qs = params.toString()
      const suffix = qs.length > 0 ? `?${qs}` : ''
      return api<{ delay: number }>(
        `/api/mihomo/proxies/${encodeURIComponent(name)}/delay${suffix}`,
      )
    },
  },
  providers: {
    refresh: (name: string) =>
      api<{ ok: true; name: string }>(`/api/providers/${encodeURIComponent(name)}/refresh`, {
        method: 'POST',
      }),
  },
}
