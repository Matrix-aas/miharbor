// Single entry-point for wiring env + logger + audit into an AppContext.
// Called from `src/index.ts` on server start; also reusable by tests that
// need a fully-configured context.

import { loadEnv, type Env } from './env/schema.ts'
import { createLogger, type Logger } from './observability/logger.ts'
import { createAuditLog, type AuditLog } from './observability/audit-log.ts'

export interface AppContext {
  env: Env
  logger: Logger
  audit: AuditLog
}

export function bootstrap(): AppContext {
  const env = loadEnv(Bun.env)
  const logger = createLogger({ level: env.MIHARBOR_LOG_LEVEL })
  const audit = createAuditLog({ dir: env.MIHARBOR_DATA_DIR })
  logger.info({
    msg: 'bootstrap',
    transport: env.MIHARBOR_TRANSPORT,
    data_dir: env.MIHARBOR_DATA_DIR,
    config_path: env.MIHARBOR_CONFIG_PATH,
  })
  return { env, logger, audit }
}
