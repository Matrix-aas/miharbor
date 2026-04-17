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

/** Derive the caller's IP from an Elysia request.
 *
 * Trust-proxy gated: `x-real-ip` / `x-forwarded-for` are ONLY honoured when
 * the socket-level remote address is inside a configured
 * `MIHARBOR_TRUSTED_PROXY_CIDRS` entry. Without this guard an external
 * attacker can spoof `x-real-ip` to evade per-IP rate-limiting or impersonate
 * a trusted operator network.
 *
 * Precedence when trusted:
 *   1. `x-real-ip`
 *   2. first entry of `x-forwarded-for`
 * Otherwise: return the socket IP unchanged. */
export function extractClientIp(
  request: Request,
  socketIp: string,
  trustProxy?: TrustProxyEvaluator,
): string {
  if (trustProxy && socketIp && trustProxy.contains(socketIp)) {
    const realIp = request.headers.get('x-real-ip')
    if (realIp && realIp.trim().length > 0) return realIp.trim()
    const xff = request.headers.get('x-forwarded-for')
    if (xff) {
      const first = xff.split(',')[0]
      if (first && first.trim().length > 0) return first.trim()
    }
  }
  return socketIp || '0.0.0.0'
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

      // Public liveness probe — always unauthenticated so Docker HEALTHCHECK
      // and external monitors (e.g. uptime kuma) can reach it without
      // credentials. This path is registered by server-bootstrap.ts BEFORE
      // any /api/* routes; everything else still goes through auth.
      const url = new URL(request.url)
      if (url.pathname === '/health') return undefined

      // Extract IP — prefer Bun server's live address when available (the
      // socket remote), then apply trust-proxy header evaluation.
      let socketIp = ''
      try {
        const addr = server?.requestIP(request)
        if (addr && typeof addr.address === 'string') socketIp = addr.address
      } catch {
        /* ignore */
      }
      const ip = extractClientIp(request, socketIp || '0.0.0.0', opts.trustProxy)

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
