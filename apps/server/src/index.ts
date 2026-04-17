// Miharbor server entry point. Wires every subsystem via `wireApp()`,
// runs the canonicalization bootstrap hook, and starts the Elysia HTTP
// listener. Graceful shutdown handlers stop the health monitor so Bun
// can exit cleanly on SIGINT/SIGTERM.
//
// Fatal-boot behaviour: if the canonicalization step errors (parse failure,
// etc.) we still start the HTTP server so operators can log in and fix
// the config through the UI — the error is logged and surfaced via the
// `/api/health/stream` event.

import { wireApp, maybeRunCanonicalization } from './server-bootstrap.ts'

const srv = await wireApp()

try {
  await maybeRunCanonicalization(srv)
} catch (e) {
  // maybeRunCanonicalization should never throw — it catches everything —
  // but be defensive. The server still starts so the operator can recover.
  srv.logger.error({
    msg: 'canonicalization-bootstrap threw unexpectedly; continuing to listen',
    error: (e as Error).message,
  })
}

srv.app.listen(srv.env.MIHARBOR_PORT)
srv.logger.info({
  msg: 'miharbor-server listening',
  port: srv.env.MIHARBOR_PORT,
  auth_disabled: srv.env.MIHARBOR_AUTH_DISABLED,
})

// Graceful shutdown — stop the polling interval so Bun exits.
const shutdown = (signal: string): void => {
  srv.logger.info({ msg: 'shutdown', signal })
  srv.stop()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
