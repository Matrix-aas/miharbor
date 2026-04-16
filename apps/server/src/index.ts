import { Elysia } from 'elysia'
import { logger } from './observability/logger.ts'

const port = Number(Bun.env.PORT) || 3000

new Elysia().get('/health', () => ({ status: 'ok' })).listen(port)

logger.info({ msg: 'miharbor-server listening', port })
