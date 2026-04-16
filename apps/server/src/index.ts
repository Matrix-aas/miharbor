import { Elysia } from 'elysia'

new Elysia().get('/health', () => ({ status: 'ok' })).listen(Number(Bun.env.PORT) || 3000)

console.log('miharbor-server listening')
