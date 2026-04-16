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
import { createDraftStore, type DraftStore } from './draft-store.ts'
import { startHealthMonitor, type HealthMonitor } from './health-monitor.ts'
import { loadConfig } from './config/loader.ts'
import { runPipeline, type DeployContext } from './deploy/pipeline.ts'
import { configRoutes } from './routes/config.ts'
import { snapshotRoutes } from './routes/snapshots.ts'
import { deployRoutes } from './routes/deploy.ts'
import { healthRoutes } from './routes/health.ts'
import { authRoutes } from './routes/auth.ts'
import { lintRoutes } from './routes/lint.ts'
import { mihomoRoutes } from './routes/mihomo.ts'
import { settingsRoutes } from './routes/settings.ts'
import { onboardingRoutes } from './routes/onboarding.ts'
import { join } from 'node:path'
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
  deployCtx: () => DeployContext
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
  const deployCtx = (): DeployContext => ({
    transport,
    vault,
    snapshots,
    mihomoApi,
    logger,
    audit,
    lockFile,
  })

  // ---------- app ----------
  const app = new Elysia()
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
    .use(configRoutes({ transport, draftStore }))
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
