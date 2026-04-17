// Full server bootstrap — wires env → transport → vault → snapshots →
// mihomo API → auth → routes → HTTP server. Also runs the one-time
// canonicalization deploy-hook: if the live config on disk isn't already
// in canonical form, we rewrite it (and create a dedicated snapshot with
// `applied_by: 'canonicalization'`) before listening for HTTP.
//
// Why do the canonicalization here and not in the deploy pipeline?
//   - The first snapshot in Miharbor's history must capture the operator's
//     existing config VERBATIM (for auditability). But canonicalization
//     changes formatting on disk — so any subsequent diff would always
//     show an n-line "whitespace noise" patch against that verbatim first
//     snapshot. Running canonicalization ONCE at startup collapses this
//     noise into a single well-labelled migration snapshot.
//   - It runs before the HTTP server starts listening, so no user-driven
//     deploys race against it.

import { Elysia } from 'elysia'
import { bootstrap, type AppContext } from './bootstrap.ts'
import { LocalFsTransport } from './transport/local-fs.ts'
import { InMemoryTransport } from './transport/in-memory.ts'
import type { Transport } from './transport/transport.ts'
import { createVault, type Vault } from './vault/vault.ts'
import { createSnapshotManager, type SnapshotManager } from './deploy/snapshot.ts'
import { createMihomoApi, type MihomoApi } from './mihomo/api-client.ts'
import { createAuthStore, type AuthStore } from './auth/password.ts'
import { createRateLimiter, type RateLimiter } from './auth/rate-limit.ts'
import { createTrustProxyEvaluator, type TrustProxyEvaluator } from './auth/trust-proxy.ts'
import { basicAuth } from './auth/basic-auth.ts'
import { securityHeaders } from './middleware/security-headers.ts'
import { createDraftStore, type DraftStore } from './draft-store.ts'
import { startHealthMonitor, type HealthMonitor } from './health-monitor.ts'
import { loadConfig } from './config/loader.ts'
import { runPipeline, type DeployContext, type StepEvent } from './deploy/pipeline.ts'
import { runHealthcheck } from './deploy/healthcheck.ts'
import { applyRollback } from './deploy/rollback.ts'
import { configRoutes } from './routes/config.ts'
import { snapshotRoutes } from './routes/snapshots.ts'
import { deployRoutes } from './routes/deploy.ts'
import { healthRoutes } from './routes/health.ts'
import { authRoutes } from './routes/auth.ts'
import { lintRoutes } from './routes/lint.ts'
import { mihomoRoutes } from './routes/mihomo.ts'
import { settingsRoutes } from './routes/settings.ts'
import { onboardingRoutes } from './routes/onboarding.ts'
import { join, normalize, resolve } from 'node:path'
import type { AuditLog } from './observability/audit-log.ts'
import type { Logger } from './observability/logger.ts'

/** Fully-wired server context. Tests can construct this without starting
 *  a real HTTP listener by calling `wireApp()` directly. */
export interface ServerAppContext extends AppContext {
  transport: Transport
  vault: Vault
  snapshots: SnapshotManager
  mihomoApi: MihomoApi
  authStore: AuthStore
  rateLimiter: RateLimiter
  trustProxy: TrustProxyEvaluator
  draftStore: DraftStore
  monitor: HealthMonitor
  app: Elysia
  /** Shared DeployContext factory — fresh copy per request so we can set
   *  per-request identity (user/user_ip/user_agent) without leaking. */
  deployCtx: (user?: string, user_ip?: string, user_agent?: string) => DeployContext
  /** Stop background tasks (health monitor). Tests MUST call this. */
  stop: () => void
}

/** Build the app + dependencies WITHOUT starting the HTTP server. Pure
 *  wiring so tests can exercise the route tree end-to-end. */
export async function wireApp(
  rawEnv: Record<string, string | undefined> = Bun.env,
): Promise<ServerAppContext> {
  const app0 = bootstrap(rawEnv)
  const { env, logger, audit } = app0

  // ---------- transport ----------
  const transport: Transport =
    env.MIHARBOR_TRANSPORT === 'local'
      ? new LocalFsTransport({
          configPath: env.MIHARBOR_CONFIG_PATH,
          dataDir: env.MIHARBOR_DATA_DIR,
          mihomoApiUrl: env.MIHOMO_API_URL,
          mihomoApiSecret: env.MIHOMO_API_SECRET,
          validationMode: env.MIHOMO_API_VALIDATION_MODE,
          logger,
        })
      : new InMemoryTransport({
          mihomoApiUrl: env.MIHOMO_API_URL,
          mihomoApiSecret: env.MIHOMO_API_SECRET,
        })

  // ---------- vault ----------
  const vault = await createVault({
    dataDir: env.MIHARBOR_DATA_DIR,
    vaultKeyEnv: env.MIHARBOR_VAULT_KEY,
    logger,
  })

  // ---------- snapshots ----------
  const snapshots = createSnapshotManager({
    transport,
    vault,
    retention: {
      retentionCount: env.MIHARBOR_SNAPSHOT_RETENTION_COUNT,
      retentionDays: env.MIHARBOR_SNAPSHOT_RETENTION_DAYS,
    },
    logger,
  })

  // ---------- mihomo API ----------
  const mihomoApi = createMihomoApi({
    baseUrl: env.MIHOMO_API_URL,
    secret: env.MIHOMO_API_SECRET,
  })

  // ---------- auth ----------
  const authStore = await createAuthStore({
    dataDir: env.MIHARBOR_DATA_DIR,
    defaultUser: env.MIHARBOR_AUTH_USER,
    envPassHash: env.MIHARBOR_AUTH_PASS_HASH,
  })
  const rateLimiter = createRateLimiter()
  const trustProxy = createTrustProxyEvaluator(env.MIHARBOR_TRUSTED_PROXY_CIDRS, (raw, reason) => {
    logger.warn({
      msg: 'ignored invalid CIDR in MIHARBOR_TRUSTED_PROXY_CIDRS',
      entry: raw,
      reason,
    })
  })

  // ---------- draft store + health monitor ----------
  const draftStore = createDraftStore()
  const monitor = startHealthMonitor(mihomoApi, {
    logger,
    emitImmediately: true,
  })

  // ---------- deploy context factory ----------
  const lockFile = join(env.MIHARBOR_DATA_DIR, 'config.yaml.lock')
  // `deployCtx` is called once per deploy / rollback request; it wires the
  // healthcheck + auto-rollback hooks so `runPipeline` runs step 6 in
  // production. The inner `applyRollback` shares the SAME base context but
  // marks `auto: true` so the recursion guard in `deploy/rollback.ts` fires
  // if the healthcheck also fails on the restored config.
  const deployCtx = (user?: string, user_ip?: string, user_agent?: string): DeployContext => {
    const ctx: DeployContext = {
      transport,
      vault,
      snapshots,
      mihomoApi,
      logger,
      audit,
      lockFile,
      autoRollback: env.MIHARBOR_AUTO_ROLLBACK,
      runHealthcheck: (api, hcOpts) => runHealthcheck(api, hcOpts ?? {}),
      applyRollback: async ({ targetSnapshotId, onStep }) => {
        // Build a sibling deployCtx scoped to the auto-rollback actor so
        // the audit log / snapshot meta records "system" as the user.
        const sysCtx = deployCtx('auto-rollback', user_ip, user_agent)
        const rbArgs: Parameters<typeof applyRollback>[0] = {
          snapshotId: targetSnapshotId,
          deployCtx: sysCtx,
          snapshots,
          vault,
          logger,
          auto: true,
        }
        if (onStep) {
          ;(rbArgs as { onStep?: StepEvent }).onStep = onStep
        }
        const result = await applyRollback(rbArgs)
        return { snapshot_id: result.snapshot_id }
      },
    }
    if (user !== undefined) ctx.user = user
    if (user_ip !== undefined) ctx.user_ip = user_ip
    if (user_agent !== undefined) ctx.user_agent = user_agent
    return ctx
  }

  // ---------- app ----------
  // `securityHeaders` is mounted FIRST so its onRequest hook fires before
  // any other middleware or route handler — this way security headers end
  // up on every response including auth 401s and router-synthesised 404s.
  // CSP is skipped in dev (NODE_ENV !== 'production') or when the operator
  // explicitly sets MIHARBOR_CSP_DISABLED=true; other headers stay on.
  const cspDisabled = env.NODE_ENV !== 'production' || env.MIHARBOR_CSP_DISABLED
  const app = new Elysia()
    .use(securityHeaders({ cspDisabled, trustProxy }))
    .use(
      basicAuth({
        authStore,
        rateLimiter,
        trustProxy,
        trustProxyHeader: env.MIHARBOR_TRUST_PROXY_HEADER,
        disabled: env.MIHARBOR_AUTH_DISABLED,
        logger,
      }),
    )
    .get('/health', () => ({ status: 'ok' }))
    .use(lintRoutes)
    .use(configRoutes({ transport, draftStore, vault }))
    .use(snapshotRoutes({ snapshots, deployCtx }))
    .use(deployRoutes({ draftStore, deployCtx }))
    .use(healthRoutes({ monitor }))
    .use(authRoutes({ authStore, audit }))
    .use(mihomoRoutes({ mihomoApi }))
    .use(settingsRoutes({ env, rawEnv }))
    .use(
      onboardingRoutes({
        transport,
        snapshots,
        configPath: env.MIHARBOR_CONFIG_PATH,
        lockFile,
        logger,
      }),
    )

  // ---------- SPA static serving ----------
  // When MIHARBOR_WEB_DIST is set (typically in the Docker image), serve the
  // pre-built Vue bundle under `/`. Client-side router paths fall back to
  // index.html. API routes (/api/*) and /health are registered above and so
  // take precedence — Elysia matches specific routes before the catch-all.
  if (env.MIHARBOR_WEB_DIST) {
    const webRoot = resolve(env.MIHARBOR_WEB_DIST)
    const indexPath = join(webRoot, 'index.html')
    try {
      const fs = await import('node:fs/promises')
      await fs.access(webRoot)
      logger.info({ msg: 'serving web UI from static bundle', path: webRoot })
      app.get(
        '/*',
        async ({
          request,
          set,
        }: {
          request: Request
          set: { status?: number; headers: Record<string, string | undefined> }
        }) => {
          const url = new URL(request.url)
          // Elysia routes specific /api/* + /health paths first, so they
          // short-circuit before reaching us. Defensive guard anyway — if
          // the SPA ever introduces a route that starts with /api we don't
          // want to mask an API 404 with index.html.
          const rawPath = url.pathname
          if (rawPath.startsWith('/api/') || rawPath === '/health') {
            set.status = 404
            return 'Not Found'
          }
          const rel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '')
          // Resolve + confine inside webRoot (defence against "../" path
          // traversal attempts). normalize strips "..", resolve re-anchors.
          const target = resolve(webRoot, normalize(rel))
          if (!target.startsWith(webRoot + '/') && target !== webRoot) {
            // Traversal attempt — fall back to index.html rather than 400
            // so SPA deep-links still work.
            return Bun.file(indexPath)
          }
          const file = Bun.file(target)
          if (await file.exists()) {
            // Let Bun set Content-Type from extension. For SPA shell index.html
            // we also set cache headers that prevent stale shells after deploy.
            if (target === indexPath) {
              set.headers['cache-control'] = 'no-cache'
            }
            return file
          }
          // SPA fallback — unknown path, serve index.html so the Vue router
          // can handle it client-side.
          set.headers['cache-control'] = 'no-cache'
          return Bun.file(indexPath)
        },
      )
    } catch (e) {
      logger.warn({
        msg: 'MIHARBOR_WEB_DIST is set but directory is not accessible — serving API-only',
        path: webRoot,
        error: (e as Error).message,
      })
    }
  }

  return {
    ...app0,
    transport,
    vault,
    snapshots,
    mihomoApi,
    authStore,
    rateLimiter,
    trustProxy,
    draftStore,
    monitor,
    app,
    deployCtx,
    stop(): void {
      monitor.stop()
    },
  }
}

/** Run the startup-time canonicalization hook. Safe to call on a server
 *  where the config file doesn't exist — returns null (onboarding mode). */
export async function maybeRunCanonicalization(srv: {
  env: { MIHARBOR_CONFIG_PATH: string; MIHARBOR_TRANSPORT: string }
  transport: Transport
  vault: Vault
  snapshots: SnapshotManager
  mihomoApi: MihomoApi
  logger: Logger
  audit: AuditLog
  monitor: HealthMonitor
  deployCtx: () => DeployContext
}): Promise<{ applied: boolean; snapshot_id?: string; reason?: string }> {
  // Onboarding mode: config file missing on local FS. We don't trigger
  // canonicalization; the UI will show the onboarding screen (Task 27).
  if (srv.env.MIHARBOR_TRANSPORT === 'local') {
    try {
      const fs = await import('node:fs/promises')
      await fs.access(srv.env.MIHARBOR_CONFIG_PATH)
    } catch {
      srv.logger.warn({
        msg: 'canonicalization-bootstrap: config file missing — onboarding mode',
        path: srv.env.MIHARBOR_CONFIG_PATH,
      })
      return { applied: false, reason: 'config-missing' }
    }
  }

  let loaded
  try {
    const { content } = await srv.transport.readConfig()
    loaded = { rawContent: content }
  } catch (e) {
    srv.logger.warn({
      msg: 'canonicalization-bootstrap: cannot read config',
      error: (e as Error).message,
    })
    return { applied: false, reason: 'read-error' }
  }

  // Run canonicalization via the loader. If input fails to parse, log and
  // give up — the operator sees the error on next manual deploy attempt.
  let canonicalResult
  try {
    canonicalResult = await runCanonicalize(loaded.rawContent)
  } catch (e) {
    srv.logger.error({
      msg: 'canonicalization-bootstrap: YAML parse failed; leaving live config untouched',
      error: (e as Error).message,
    })
    return { applied: false, reason: 'parse-error' }
  }

  if (!canonicalResult.wasCanonicalized) {
    srv.logger.debug({
      msg: 'canonicalization-bootstrap: already canonical; no-op',
    })
    return { applied: false, reason: 'already-canonical' }
  }

  srv.logger.info({
    msg: 'canonicalization-bootstrap: rewriting config to canonical form',
    path: (srv.env as { MIHARBOR_CONFIG_PATH?: string }).MIHARBOR_CONFIG_PATH,
  })

  const ctx = srv.deployCtx()
  ctx.user = 'canonicalization'
  try {
    const result = await runPipeline({
      draft: canonicalResult.text,
      ctx,
      appliedBy: 'canonicalization',
    })
    // Emit to the health monitor so the UI shows a one-shot "config was
    // canonicalized" notification.
    srv.monitor.emit({
      type: 'canonicalized',
      old_hash: canonicalResult.originalHash,
      new_hash: canonicalResult.canonicalHash,
      snapshot_id: result.snapshot_id,
      ts: new Date().toISOString(),
    })
    return { applied: true, snapshot_id: result.snapshot_id }
  } catch (e) {
    srv.logger.error({
      msg: 'canonicalization-bootstrap: pipeline failed; live config may be inconsistent',
      error: (e as Error).message,
    })
    return { applied: false, reason: 'pipeline-error' }
  }
}

/** Helper: canonicalize a raw YAML string in-memory (no file IO). */
async function runCanonicalize(raw: string): Promise<{
  text: string
  wasCanonicalized: boolean
  originalHash: string
  canonicalHash: string
}> {
  const { canonicalize } = await import('./config/canonicalize.ts')
  const { createHash } = await import('node:crypto')
  const originalHash = createHash('sha256').update(raw).digest('hex')
  const { text } = canonicalize(raw)
  const canonicalHash = createHash('sha256').update(text).digest('hex')
  return {
    text,
    wasCanonicalized: text !== raw,
    originalHash,
    canonicalHash,
  }
}

// Re-export for lighter imports in tests.
export { loadConfig }
