// Structured JSON logger with recursive secret redaction.
// Pino-compatible shape (`ts`, `level`, ...payload) but zero runtime deps to keep
// the server tree-shakeable.

const SECRET_KEYS = new Set([
  'secret',
  'private-key',
  'pre-shared-key',
  'password',
  'uuid',
  'api_key',
  'api-key',
  'token',
  'authorization',
])

const LEVEL_NUM: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redact)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '***REDACTED***' : redact(v)
  }
  return out
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  level: LogLevel
  sink?: (line: string) => void
}

export interface Logger {
  debug: (p: Record<string, unknown>) => void
  info: (p: Record<string, unknown>) => void
  warn: (p: Record<string, unknown>) => void
  error: (p: Record<string, unknown>) => void
}

export function createLogger(opts: LoggerOptions): Logger {
  const threshold = LEVEL_NUM[opts.level] ?? LEVEL_NUM.info!
  const sink = opts.sink ?? ((l: string): void => console.log(l))
  const emit = (lvl: LogLevel, payload: Record<string, unknown>): void => {
    if ((LEVEL_NUM[lvl] ?? 0) < threshold) return
    const redacted = redact(payload) as Record<string, unknown>
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, ...redacted }))
  }
  return {
    debug: (p) => emit('debug', p),
    info: (p) => emit('info', p),
    warn: (p) => emit('warn', p),
    error: (p) => emit('error', p),
  }
}

export const logger: Logger = createLogger({
  level: (Bun.env.MIHARBOR_LOG_LEVEL as LogLevel | undefined) ?? 'info',
})
