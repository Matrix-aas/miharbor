// Basic Auth middleware for Elysia. Mounts a guard that checks every
// `/api/*` route's Authorization header and blocks on 401 unless either:
//   (a) `MIHARBOR_AUTH_DISABLED=true` (dev mode, passes everything through),
//   (b) the request comes from a trusted proxy CIDR with the configured
//       trust-proxy header set (user is then derived from that header), or
//   (c) Authorization: Basic base64(user:pass) verifies against AuthStore.
//
// Brute-force protection is a concentric responsibility: the middleware
// asks `rateLimiter.check(ip)` up front, returns 429 if locked out, and
// calls `rateLimiter.fail(ip)` for every non-trusted auth failure.

import { Elysia } from 'elysia'
import type { AuthStore } from './password.ts'
import type { RateLimiter } from './rate-limit.ts'
import type { TrustProxyEvaluator } from './trust-proxy.ts'
import type { Logger } from '../observability/logger.ts'

export interface BasicAuthOptions {
  /** Active AuthStore (password verification). */
  authStore: AuthStore
  /** In-memory rate limiter. */
  rateLimiter: RateLimiter
  /** Trust-proxy evaluator (may match zero CIDRs, in which case header is
   *  always ignored). */
  trustProxy: TrustProxyEvaluator
  /** Header name to trust when the request IP is inside a trusted CIDR.
   *  Empty string disables header bypass regardless of CIDR list. */
  trustProxyHeader: string
  /** Dev escape hatch. `true` → middleware passes everything. */
  disabled: boolean
  /** Logger for auth events. */
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  /** Realm string for 401 challenges. Defaults to "miharbor". */
  realm?: string
}

/** Derive the caller's IP from an Elysia request. Order of precedence:
 *  `request.headers.get('x-real-ip')` (from our OWN nginx), else the
 *  socket remote address, else '0.0.0.0' as a last resort. We intentionally
 *  do NOT consult `X-Forwarded-For` here — that's a separate
 *  `trustProxy.contains()` decision made inside the middleware. */
export function extractClientIp(request: Request, fallback = '0.0.0.0'): string {
  // bun provides `request.requesterAddr` in some builds, Elysia surfaces
  // it via the server context, but at the middleware level we rely on
  // what the handler passes us. In doubt, return fallback.
  const forwarded = request.headers.get('x-real-ip') ?? ''
  if (forwarded) return forwarded.trim()
  return fallback
}

/** Build an Elysia plugin that enforces Basic Auth on every route mounted
 *  downstream. Returns a chainable instance so callers can `.use(basicAuth(...))
 *  .group('/api', ...)` in their bootstrap. */
export function basicAuth(opts: BasicAuthOptions): Elysia {
  const realm = opts.realm ?? 'miharbor'
  const logger = opts.logger
  // `as: 'global'` — the lifecycle handler fires on every request routed
  // through the host app that `.use()`s this plugin, not only on routes
  // defined within the plugin itself. Without this scope, Elysia treats
  // the handler as plugin-local and auth is effectively a no-op.
  return new Elysia({ name: 'miharbor-basic-auth' }).onBeforeHandle(
    { as: 'global' },
    async ({ request, set, server }) => {
      if (opts.disabled) return undefined

      // Extract IP — prefer Bun server's live address when available (the
      // socket remote), else fall back to header-derived.
      let ip = '0.0.0.0'
      try {
        const addr = server?.requestIP(request)
        if (addr && typeof addr.address === 'string') ip = addr.address
      } catch {
        /* ignore */
      }
      if (ip === '0.0.0.0') ip = extractClientIp(request, ip)

      // Rate-limit check first — even trusted proxies are subject to lockout
      // if they spam the endpoint, but typically trusted-proxy CIDRs are
      // operator-controlled and won't produce 401s.
      const rl = opts.rateLimiter.check(ip)
      if (rl.locked) {
        set.status = 429
        if (rl.retryAfterMs) {
          set.headers['retry-after'] = String(Math.ceil(rl.retryAfterMs / 1000))
        }
        logger?.warn({ msg: 'auth rate-limit lockout', ip, fails: rl.fails })
        return { code: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs ?? 0 }
      }

      // Trust-proxy header bypass — only from trusted CIDRs + non-empty
      // header name + non-empty header value.
      if (opts.trustProxyHeader.length > 0 && opts.trustProxy.contains(ip)) {
        const spoof = request.headers.get(opts.trustProxyHeader)
        if (spoof && spoof.length > 0) {
          // Pass-through. Attach the identity for downstream handlers via
          // a request-local store. Elysia's `set.headers` isn't the right
          // channel; we stash on the request object via a WeakMap.
          trustedUser.set(request, spoof)
          return undefined
        }
      }

      // Basic Auth verify.
      const auth = request.headers.get('authorization') ?? ''
      if (!auth.toLowerCase().startsWith('basic ')) {
        return respond401(set, realm)
      }
      const b64 = auth.slice('basic '.length).trim()
      let decoded: string
      try {
        decoded = atob(b64)
      } catch {
        opts.rateLimiter.fail(ip)
        return respond401(set, realm)
      }
      const idx = decoded.indexOf(':')
      if (idx < 0) {
        opts.rateLimiter.fail(ip)
        return respond401(set, realm)
      }
      const u = decoded.slice(0, idx)
      const p = decoded.slice(idx + 1)
      if (u !== opts.authStore.getUser()) {
        opts.rateLimiter.fail(ip)
        return respond401(set, realm)
      }
      const ok = await opts.authStore.verifyPassword(p)
      if (!ok) {
        opts.rateLimiter.fail(ip)
        return respond401(set, realm)
      }
      // Success — reset failures + set identity.
      opts.rateLimiter.success(ip)
      trustedUser.set(request, u)
      return undefined
    },
  )
}

/** Per-request identity storage. Handlers read via `getAuthUser(request)`. */
const trustedUser = new WeakMap<Request, string>()

export function getAuthUser(request: Request): string | null {
  return trustedUser.get(request) ?? null
}

// Elysia's `set` has a more specific typed status/headers shape (numbers +
// named HTTP codes; HTTPHeaders for headers) than a plain record. We accept
// a loosely-typed handle here and let Elysia's runtime coerce, so this
// module stays independent of the Elysia internal types.
type ElysiaSetLike = {
  status?: unknown
  headers: Record<string, string | number | undefined> & { [k: string]: unknown }
}

function respond401(set: ElysiaSetLike, realm: string): { code: 'UNAUTHORIZED' } {
  set.status = 401
  set.headers['www-authenticate'] = `Basic realm="${realm}", charset="UTF-8"`
  return { code: 'UNAUTHORIZED' }
}
