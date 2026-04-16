import { Elysia } from 'elysia'
import { bootstrap } from './bootstrap.ts'
import { lintRoutes } from './routes/lint.ts'

const { env, logger } = bootstrap()

new Elysia()
  .get('/health', () => ({ status: 'ok' }))
  .use(lintRoutes)
  .listen(env.MIHARBOR_PORT)

logger.info({ msg: 'miharbor-server listening', port: env.MIHARBOR_PORT })
