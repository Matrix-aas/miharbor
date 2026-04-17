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

// Recursive redaction walker.
// Hardening (C2):
//   - WeakSet-tracked `seen` detects cycles and returns '[Circular]' instead of
//     blowing the stack.
//   - `Error` instances are serialized to { name, message, stack } — default
//     JSON.stringify drops them to `{}` because Error props are non-enumerable.
//   - `bigint` is stringified because JSON.stringify throws on BigInt.
function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return value
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((v) => redact(v, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '***REDACTED***' : redact(v, seen)
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
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, ...redacted })
    // C3: a broken sink (e.g. closed fd, OOM writer) must not kill the caller.
    // Logging is a side effect — best-effort only.
    try {
      sink(line)
    } catch {
      /* swallow — logger errors must never propagate */
    }
  }
  return {
    debug: (p) => emit('debug', p),
    info: (p) => emit('info', p),
    warn: (p) => emit('warn', p),
    error: (p) => emit('error', p),
  }
}

// I10: singleton removed. All callers must obtain a Logger via bootstrap()
// so level/sink wiring flows through validated env.
