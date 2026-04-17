// Security-headers middleware — sets a standard set of hardening headers
// on EVERY response (HTML, JSON, 404, static files). Mirrors the basic-auth
// plugin pattern: a factory returning an Elysia sub-app with a global
// lifecycle hook. Registering this BEFORE route handlers in server-bootstrap
// ensures headers are applied to every response the app ever emits,
// including auth 401s and router-synthesised 404s.
//
// Headers:
//   - Content-Security-Policy — omitted in dev / when cspDisabled=true.
//     Vite HMR relies on inline scripts + eval + ws://; we sidestep this
//     by OMITTING CSP entirely in dev (via MIHARBOR_PRODUCTION=0). The
//     SPA in prod bundles no eval-using code EXCEPT Monaco Editor's Web
//     Workers — those need 'unsafe-eval' + blob: in worker-src/script-src.
//     Tailwind JIT emits plain <style> tags, so 'unsafe-inline' is
//     required for style-src.
//   - X-Frame-Options: DENY — no framing; defense-in-depth for SAMEORIGIN
//     browsers that predate frame-ancestors support.
//   - X-Content-Type-Options: nosniff — stop MIME type confusion attacks.
//   - Referrer-Policy: no-referrer — we never need to leak the config URL.
//   - Permissions-Policy — camera/mic/geolocation denied.
//   - Strict-Transport-Security — ONLY when we can VERIFY the request is
//     HTTPS. Two verifications:
//       (a) x-forwarded-proto=https AND socket-IP is in MIHARBOR_TRUSTED_PROXY_CIDRS
//       (b) socket.encrypted === true (direct TLS termination at the listener)
//     Case (b) is not reachable in Bun's current Request object — there's
//     no stable API to check whether the socket was encrypted in `onRequest`.
//     Until Bun exposes that, we only emit HSTS via case (a). Operators who
//     terminate TLS at Miharbor directly (rare — the Docker image has no
//     TLS cert) must front it with a reverse proxy that sets
//     x-forwarded-proto, which is the documented production setup anyway.
//     Never trust x-forwarded-proto from an untrusted source (header
//     spoofing would trick browsers into pinning HSTS on HTTP).

import { Elysia } from 'elysia'
import type { TrustProxyEvaluator } from '../auth/trust-proxy.ts'

export interface HstsOptions {
  /** max-age value in seconds. 0 = disable HSTS entirely. */
  maxAge: number
  /** Whether to include the 'includeSubDomains' directive. */
  includeSubdomains: boolean
  /** Whether to include the 'preload' directive. */
  preload: boolean
}

export interface SecurityHeadersOptions {
  /**
   * Whether to SKIP emitting the Content-Security-Policy header. Compute
   * upstream (e.g. in server-bootstrap) from `!MIHARBOR_PRODUCTION ||
   * MIHARBOR_CSP_DISABLED`. All other headers remain on regardless.
   */
  cspDisabled: boolean
  /**
   * Trust-proxy evaluator. When the socket IP matches a trusted CIDR, the
   * `x-forwarded-proto` header is honoured for deciding HSTS.
   */
  trustProxy: TrustProxyEvaluator
  /**
   * HSTS configuration. If maxAge is 0, no HSTS header is emitted.
   */
  hsts: HstsOptions
}

// Precomputed header values — reuse across requests (no per-request strings).
// connect-src 'self' — SPA currently only calls Miharbor server API. If the
// SPA ever adds direct mihomo/websocket connections, update this directive.
const CSP_VALUE =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-eval' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "worker-src 'self' blob:; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'"

const PERMISSIONS_POLICY_VALUE = 'camera=(), microphone=(), geolocation=()'

/**
 * Build the HSTS header value from options. Returns null if maxAge is 0
 * (HSTS disabled), so the caller can skip header emission.
 */
export function buildHstsValue(opts: HstsOptions): string | null {
  if (opts.maxAge === 0) return null
  let value = `max-age=${opts.maxAge}`
  if (opts.includeSubdomains) value += '; includeSubDomains'
  if (opts.preload) value += '; preload'
  return value
}

/**
 * Decide whether the current request is verified-HTTPS. Returns true only
 * when the socket peer is inside the operator's trusted-proxy CIDR list AND
 * the proxy has labelled the request as https. Spoofing from an untrusted
 * source is ignored by design.
 */
export function isVerifiedHttps(
  request: Request,
  socketIp: string,
  trustProxy: TrustProxyEvaluator,
): boolean {
  if (!socketIp) return false
  if (!trustProxy.contains(socketIp)) return false
  const proto = request.headers.get('x-forwarded-proto')
  if (!proto) return false
  // Standard per RFC 7239 §5.4 ignores comma-separated list beyond the
  // first entry (X-Forwarded-* is the older, less-specified relative) —
  // take the first token conservatively.
  const first = proto.split(',')[0]?.trim().toLowerCase()
  return first === 'https'
}

/**
 * Build an Elysia plugin that sets the security headers on every response.
 * Use in the bootstrap BEFORE route handlers so the hook fires for every
 * request (including onboarding redirects, 404s, and SPA static files).
 */
export function securityHeaders(opts: SecurityHeadersOptions): Elysia {
  // Precompute HSTS value at plugin creation time (not per-request).
  const hstsValue = buildHstsValue(opts.hsts)

  // `onRequest` fires for every incoming request on the host app that `.use()`s
  // this plugin (unlike `onBeforeHandle`, it doesn't need an `as: 'global'`
  // scope — the hook is inherently request-level, not handler-level).
  return new Elysia({ name: 'miharbor-security-headers' }).onRequest(({ request, set, server }) => {
    // Always set the low-gate headers (no env/verification dependency).
    set.headers['x-frame-options'] = 'DENY'
    set.headers['x-content-type-options'] = 'nosniff'
    set.headers['referrer-policy'] = 'no-referrer'
    set.headers['permissions-policy'] = PERMISSIONS_POLICY_VALUE

    if (!opts.cspDisabled) {
      set.headers['content-security-policy'] = CSP_VALUE
    }

    // HSTS — only when request is verified HTTPS and HSTS is not disabled.
    // Resolve socket IP the same way basic-auth does (server.requestIP),
    // fall back to '0.0.0.0' if unavailable (happens in Elysia synthetic-Request unit tests).
    if (hstsValue !== null) {
      let socketIp = ''
      try {
        const addr = server?.requestIP(request)
        if (addr && typeof addr.address === 'string') socketIp = addr.address
      } catch {
        /* ignore — treat as no socket info */
      }
      if (!socketIp) socketIp = '0.0.0.0'
      if (isVerifiedHttps(request, socketIp, opts.trustProxy)) {
        set.headers['strict-transport-security'] = hstsValue
      }
    }
  })
}
