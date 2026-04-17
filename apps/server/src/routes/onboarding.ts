// /api/onboarding/* — first-run flow for when the live mihomo config file
// is missing on disk. The UI polls GET /api/onboarding/status on every
// boot; if `needsOnboarding` is true the web router redirects to the
// onboarding screen. The operator then POSTs /api/onboarding/seed which
// writes a minimal (canonical + linter-clean) starter config using a freshly
// generated `secret` and takes an initial "user" snapshot.
//
// Design notes:
//  * The seed template ships with a placeholder secret (`__MIHARBOR_SEED_SECRET__`);
//    we replace it with `crypto.randomBytes(32).toString('hex')` at seed time so
//    every install starts with a unique, 64-char API bearer.
//  * Template passes `runSharedLinters` with zero issues and is already in
//    canonical form — guarded by apps/server/tests/config/seed-template.test.ts.
//  * Writes go through `transport.writeConfig` (under the normal lockFile)
//    so the LocalFs path honours flock just like a deploy would.
//  * Onboarding seed is recorded as `applied_by: 'user'` (the operator
//    initiated it); downstream retention policy treats it like any other.
//  * Endpoint is idempotent-safe in a narrow sense: if the config file
//    already exists it refuses to overwrite it (409).

import { Elysia } from 'elysia'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'
import { runSharedLinters } from 'miharbor-shared'
import { canonicalize } from '../config/canonicalize.ts'
import type { Transport } from '../transport/transport.ts'
import type { SnapshotManager } from '../deploy/snapshot.ts'
import type { Logger } from '../observability/logger.ts'
import { getAuthUser } from '../auth/basic-auth.ts'

export interface OnboardingRoutesDeps {
  transport: Transport
  snapshots: SnapshotManager
  /** Absolute path of the live mihomo config (env.MIHARBOR_CONFIG_PATH). Used
   *  to answer the status endpoint — if the file doesn't exist we flip
   *  `needsOnboarding: true`. */
  configPath: string
  /** Data-dir lockFile for transport.writeConfig. */
  lockFile: string
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
}

/** Sentinel token in the seed YAML replaced with a random secret at runtime. */
const SECRET_PLACEHOLDER = '__MIHARBOR_SEED_SECRET__'

/** Cached template content — loaded once on first request. */
let seedTemplateCache: string | null = null

/** Locate the seed template alongside this module. Works under both
 *  `bun` (ts-native) and compiled JS. */
function seedTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // routes/ → ../config/seed-template.yaml
  return join(here, '..', 'config', 'seed-template.yaml')
}

export async function loadSeedTemplate(): Promise<string> {
  if (seedTemplateCache) return seedTemplateCache
  const text = await readFile(seedTemplatePath(), 'utf8')
  seedTemplateCache = text
  return text
}

/** Replace the placeholder with `secret` and return the realized YAML.
 *  Exported for tests. */
export function renderSeed(template: string, secret: string): string {
  if (!template.includes(SECRET_PLACEHOLDER)) {
    throw new Error(`seed template missing placeholder: ${SECRET_PLACEHOLDER}`)
  }
  return template.replace(SECRET_PLACEHOLDER, secret)
}

export function generateSecret(): string {
  // 32 bytes = 64 hex chars — well above the 16-char invariant minimum.
  return randomBytes(32).toString('hex')
}

export function onboardingRoutes(deps: OnboardingRoutesDeps) {
  return new Elysia({ prefix: '/api/onboarding' })
    .get('/status', async () => {
      // "Onboarding" is only meaningful when the config file is missing. Any
      // read error surfaces as `needsOnboarding: true` so the UI can recover
      // operators out of a broken local install.
      try {
        await deps.transport.readConfig()
        return { needsOnboarding: false, configPath: deps.configPath }
      } catch (e) {
        deps.logger?.warn({
          msg: 'onboarding/status: cannot read config',
          error: (e as Error).message,
        })
        return { needsOnboarding: true, configPath: deps.configPath }
      }
    })
    .post('/seed', async ({ request, set }) => {
      // Guard: refuse to overwrite an existing config. Onboarding is a
      // one-shot "I have no file" path, not a reset. Operators who want to
      // wipe and start over can do that through Raw YAML / deploy.
      try {
        const existing = await deps.transport.readConfig()
        if (existing.content.length > 0) {
          set.status = 409
          return {
            code: 'CONFIG_EXISTS',
            message: 'refusing to overwrite existing config; delete it first to re-onboard',
          }
        }
      } catch {
        // Read-failure is the expected state during onboarding — continue.
      }

      const template = await loadSeedTemplate()
      const secret = generateSecret()
      const yaml = renderSeed(template, secret)

      // Sanity: canonical + linter-clean. This is a hard guarantee of the
      // template, but we double-check at runtime to fail loudly if someone
      // edited the template without running tests.
      const { text: canonical } = canonicalize(yaml)
      if (canonical !== yaml) {
        set.status = 500
        return {
          code: 'SEED_NOT_CANONICAL',
          message: 'internal: seed template failed canonicalization check',
        }
      }
      const issues = runSharedLinters(parseDocument(yaml))
      if (issues.length > 0) {
        set.status = 500
        return {
          code: 'SEED_LINT_FAILED',
          message: 'internal: seed template produced linter errors',
          issues,
        }
      }

      await deps.transport.writeConfig(yaml, deps.lockFile)

      // Capture the initial snapshot so History shows where we started.
      const user = getAuthUser(request) ?? 'anonymous'
      try {
        await deps.snapshots.createSnapshot(yaml, { applied_by: 'user' })
      } catch (e) {
        deps.logger?.warn({
          msg: 'onboarding/seed: initial snapshot failed',
          error: (e as Error).message,
        })
        // Not fatal — the config is written; operator can take a snapshot later.
      }

      deps.logger?.info({
        msg: 'onboarding/seed: wrote starter config',
        path: deps.configPath,
        user,
      })
      set.status = 201
      return {
        success: true,
        path: deps.configPath,
      }
    })
}
