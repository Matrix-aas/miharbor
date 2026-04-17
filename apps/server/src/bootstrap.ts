// Single entry-point for wiring env + logger + audit into an AppContext.
// Called from `src/index.ts` on server start; also reusable by tests that
// need a fully-configured context.

import { loadEnv, type Env } from './env/schema.ts'
import { createLogger, type Logger, type LogLevel } from './observability/logger.ts'
import { createAuditLog, type AuditLog } from './observability/audit-log.ts'

export interface AppContext {
  env: Env
  logger: Logger
  audit: AuditLog
}

export function bootstrap(rawEnv: Record<string, string | undefined> = Bun.env): AppContext {
  // I5: two-phase bootstrap so deprecation warnings go through the structured
  // JSON logger instead of raw console.warn.
  // Phase 1: provisional logger seeded from MIHARBOR_LOG_LEVEL (if set) to
  // capture warnings emitted during env validation.
  const preLevel = (rawEnv.MIHARBOR_LOG_LEVEL as LogLevel | undefined) ?? 'info'
  const tmpLogger = createLogger({
    level: isValidLevel(preLevel) ? preLevel : 'info',
  })
  const env = loadEnv(rawEnv, (m) => tmpLogger.warn({ msg: m, category: 'deprecation' }))
  // Phase 2: final logger aligned with the validated env level.
  const logger =
    env.MIHARBOR_LOG_LEVEL === preLevel
      ? tmpLogger
      : createLogger({ level: env.MIHARBOR_LOG_LEVEL })
  const audit = createAuditLog({ dir: env.MIHARBOR_DATA_DIR, logger })
  logger.info({
    msg: 'bootstrap',
    transport: env.MIHARBOR_TRANSPORT,
    data_dir: env.MIHARBOR_DATA_DIR,
    config_path: env.MIHARBOR_CONFIG_PATH,
  })
  return { env, logger, audit }
}

function isValidLevel(x: string): x is LogLevel {
  return x === 'debug' || x === 'info' || x === 'warn' || x === 'error'
}
