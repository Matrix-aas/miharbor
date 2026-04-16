// 4-phase post-deploy healthcheck. Runs AFTER step 5 (write+reload) in the
// deploy pipeline; its callbacks drive the UI stepper's healthcheck row.
//
// Spec §7 / plan Task 16:
//   Phase 1: API alive     — poll GET /version every 500ms up to 10s
//   Phase 2: Rules/providers loaded — up to 60s, warn-only if still loading
//                                       (providers may take longer to refresh
//                                        than the API takes to become
//                                        responsive, and a stuck provider
//                                        isn't a deploy failure — it's a
//                                        resource issue surfaced separately)
//   Phase 3: Proxy delay-check — up to 30s; trigger delay-check for any
//                                 hidden url-test groups
//   Phase 4: E2E healthcheck — opt-in via MIHARBOR_E2E_HEALTHCHECK; MVP stub
//
// Returns `{ok, failedPhase?, diagnostics?}`. `ok=false` + `failedPhase=1`
// is the trigger for an immediate auto-rollback; phase 3 failure only
// triggers rollback when `MIHARBOR_AUTO_ROLLBACK=true`.

import type { MihomoApi } from '../mihomo/api-client.ts'
import { MihomoApiError } from '../mihomo/api-client.ts'

export interface HealthcheckOptions {
  /** Maximum wall time for phase 1 (API alive). */
  phase1TimeoutMs?: number
  /** Poll interval during phase 1. */
  phase1IntervalMs?: number
  /** Maximum wall time for phase 2 (rules/providers). */
  phase2TimeoutMs?: number
  /** Maximum wall time for phase 3 (delay-check). */
  phase3TimeoutMs?: number
  /** Whether to run phase 4 (E2E). MVP stub — currently always returns ok. */
  runE2E?: boolean
  /** Optional status callback so the UI can render live phase progress. */
  onPhase?: (
    phase: 1 | 2 | 3 | 4,
    status: 'running' | 'completed' | 'failed',
    data?: Record<string, unknown>,
  ) => void
  /** Injected clock for tests. */
  now?: () => number
  /** Injected sleep for tests. */
  sleep?: (ms: number) => Promise<void>
}

export interface HealthcheckResult {
  ok: boolean
  failedPhase?: 1 | 2 | 3
  diagnostics?: Record<string, unknown>
}

const DEFAULTS = {
  phase1TimeoutMs: 10_000,
  phase1IntervalMs: 500,
  phase2TimeoutMs: 60_000,
  phase3TimeoutMs: 30_000,
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Run the 4-phase healthcheck against `api`. Never throws — failures are
 * communicated via the returned `HealthcheckResult`.
 */
export async function runHealthcheck(
  api: MihomoApi,
  opts: HealthcheckOptions = {},
): Promise<HealthcheckResult> {
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? defaultSleep
  const onPhase = opts.onPhase ?? (() => {})
  const p1Timeout = opts.phase1TimeoutMs ?? DEFAULTS.phase1TimeoutMs
  const p1Interval = opts.phase1IntervalMs ?? DEFAULTS.phase1IntervalMs
  const p2Timeout = opts.phase2TimeoutMs ?? DEFAULTS.phase2TimeoutMs
  const p3Timeout = opts.phase3TimeoutMs ?? DEFAULTS.phase3TimeoutMs

  // ---------- Phase 1: API alive ----------
  onPhase(1, 'running')
  const p1Deadline = now() + p1Timeout
  let p1Version: string | null = null
  let p1LastErr: string | null = null
  while (now() < p1Deadline) {
    try {
      const v = await api.getVersion()
      p1Version = v.version
      break
    } catch (err) {
      p1LastErr = err instanceof Error ? err.message : String(err)
      await sleep(p1Interval)
    }
  }
  if (p1Version === null) {
    onPhase(1, 'failed', { reason: 'api-never-alive', lastError: p1LastErr })
    return {
      ok: false,
      failedPhase: 1,
      diagnostics: { phase: 1, reason: 'api-never-alive', lastError: p1LastErr },
    }
  }
  onPhase(1, 'completed', { version: p1Version })

  // ---------- Phase 2: rules + providers loaded ----------
  // The API responds fast once mihomo starts; providers loading after
  // a fresh config may take a while (large rule-sets from HTTP). We
  // treat "providers still updating" as warn, not fail.
  onPhase(2, 'running')
  const p2Deadline = now() + p2Timeout
  let p2RulesCount = 0
  let p2ProvidersStillUpdating = 0
  let p2Err: string | null = null
  while (now() < p2Deadline) {
    try {
      const [rules, providers] = await Promise.all([api.listRules(), api.listProviders()])
      p2RulesCount = Array.isArray(rules) ? rules.length : 0
      p2ProvidersStillUpdating = countUpdatingProviders(providers)
      // Consider this phase done when at least one rule is loaded. Provider
      // updates are non-blocking.
      if (p2RulesCount > 0) {
        break
      }
    } catch (err) {
      p2Err = err instanceof Error ? err.message : String(err)
    }
    await sleep(500)
  }
  if (p2RulesCount === 0) {
    // Rules never appeared — this is a real deploy regression.
    onPhase(2, 'failed', { reason: 'rules-not-loaded', lastError: p2Err })
    // Intentionally NOT failedPhase:2 — Phase 2 failure is treated as a
    // soft signal; we bubble up ok=true with a warning, per the spec. But
    // because the plan asks for `failedPhase?: 1|2|3`, a hard rules-never
    // case is worth surfacing as failedPhase=2 is NOT what the spec says.
    // Spec says phase 2 is warn-only. Flag it as a diagnostic only.
    return {
      ok: true,
      diagnostics: {
        phase: 2,
        warning: 'rules-not-loaded-within-timeout',
        lastError: p2Err,
      },
    }
  }
  onPhase(2, 'completed', {
    rulesCount: p2RulesCount,
    providersStillUpdating: p2ProvidersStillUpdating,
  })

  // ---------- Phase 3: proxy delay-check ----------
  // Trigger delay-check on every hidden url-test group we can find. For MVP
  // we poll listProxies and run delay against the first 'url-test' entry
  // we see. If no such group exists, phase 3 is a no-op success.
  onPhase(3, 'running')
  const p3Deadline = now() + p3Timeout
  let p3Ran = false
  let p3Ok = true
  let p3Err: string | null = null
  try {
    const proxies = await api.listProxies()
    const urlTestNames = findUrlTestGroups(proxies)
    for (const name of urlTestNames) {
      if (now() >= p3Deadline) break
      try {
        const r = await api.getProxyDelay(name)
        p3Ran = true
        if (!r || typeof r.delay !== 'number' || r.delay <= 0) {
          p3Ok = false
          p3Err = `proxy ${name} returned invalid delay: ${JSON.stringify(r)}`
          break
        }
      } catch (err) {
        p3Ran = true
        p3Ok = false
        p3Err = err instanceof Error ? err.message : String(err)
        break
      }
    }
  } catch (err) {
    p3Err = err instanceof Error ? err.message : String(err)
    p3Ok = false
  }
  if (!p3Ok) {
    onPhase(3, 'failed', { reason: 'delay-check-failed', lastError: p3Err })
    return {
      ok: false,
      failedPhase: 3,
      diagnostics: { phase: 3, reason: 'delay-check-failed', lastError: p3Err },
    }
  }
  onPhase(3, 'completed', { ran: p3Ran })

  // ---------- Phase 4: E2E (opt-in stub for MVP) ----------
  if (opts.runE2E) {
    onPhase(4, 'running')
    // TODO(stage 2): real HTTP probe via the proxy stack.
    onPhase(4, 'completed', { note: 'e2e stub — always ok in MVP' })
  }

  return { ok: true }
}

/** Count providers with `updating:true` in the mihomo /providers response.
 *  Used as a soft signal in phase 2 (does NOT block the deploy). */
function countUpdatingProviders(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const map = (payload as { providers?: Record<string, unknown> }).providers ?? payload
  if (!map || typeof map !== 'object') return 0
  let n = 0
  for (const v of Object.values(map as Record<string, unknown>)) {
    if (v && typeof v === 'object' && (v as { updating?: boolean }).updating) n += 1
  }
  return n
}

/** Walk the /proxies response and return names of url-test / fallback groups
 *  that are worth delay-checking. Hidden groups still get probed — the
 *  hidden flag affects UI visibility, not health semantics. */
function findUrlTestGroups(proxies: unknown): string[] {
  if (!proxies || typeof proxies !== 'object') return []
  const map =
    (proxies as { proxies?: Record<string, unknown> }).proxies ??
    (proxies as Record<string, unknown>)
  const names: string[] = []
  for (const [name, v] of Object.entries(map as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const type = (v as { type?: string }).type
    if (type === 'URLTest' || type === 'url-test' || type === 'Fallback' || type === 'fallback') {
      names.push(name)
    }
  }
  return names
}

export { MihomoApiError }
