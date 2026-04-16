import { Elysia } from 'elysia'
import { bootstrap } from './bootstrap.ts'

const { env, logger } = bootstrap()

new Elysia().get('/health', () => ({ status: 'ok' })).listen(env.MIHARBOR_PORT)

logger.info({ msg: 'miharbor-server listening', port: env.MIHARBOR_PORT })
