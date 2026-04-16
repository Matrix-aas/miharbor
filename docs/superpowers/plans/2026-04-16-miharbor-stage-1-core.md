# Miharbor — Stage 1: Core / MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать минимально полезный Miharbor MVP — Docker-контейнер с LocalFs-транспортом, UI для Сервисов/Нод/Raw-YAML/Истории, deploy-пайплайн с snapshot/rollback/vault, 4 линтера, Basic Auth — публикуемый в GHCR как `v0.1.0`.

**Tech Stack:** см. overview. В этом этапе не трогаем SshTransport, tree-editor, LLM, DNS/TUN/Sniffer экраны.

**Cross-cutting constraints:**
- TDD: каждая задача имеет тесты **до** реализации.
- Каждая задача — один commit с conventional-commits.
- Type-safety: `tsc --strict --noEmit` зелёный.
- Файл-ответственность: см. `/docs/superpowers/specs/2026-04-16-miharbor-design.md` §14 «Структура репозитория».

---

## Task 1: Init monorepo skeleton + tooling

**Goal:** Создать Bun-workspace с `apps/web`, `apps/server`, `packages/shared`. Настроить TypeScript, eslint, prettier, husky.

**Files:**
- Create: `package.json`, `bun.lockb`, `tsconfig.base.json`, `.gitignore`, `.prettierrc`, `.eslintrc.cjs`, `.editorconfig`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.ts`, `apps/web/src/App.vue`
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/index.ts`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Create: `.husky/pre-commit`, `.lintstagedrc.json`
- Create: `LICENSE` (MIT), `README.md` (stub)

**Acceptance Criteria:**
- [ ] `bun install` успешно в корне
- [ ] `bun run --filter='*' typecheck` зелёный
- [ ] `bun run --filter='*' lint` зелёный
- [ ] `bun run web:dev` стартует Vite dev-сервер на 5173, показывает заглушку `Hello Miharbor`
- [ ] `bun run server:dev` стартует Elysia на 3000, `GET /health` → `{"status":"ok"}`
- [ ] Pre-commit hook блокирует commit файла с `private-key:` (test: создать файл с такой строкой, попытка commit отклоняется)

**Verify:** `bun install && bun run --filter='*' typecheck && bun run --filter='*' lint && curl -s http://localhost:3000/health` → `{"status":"ok"}`

**Steps:**

- [ ] **Step 1: Создать корневой package.json с workspaces**

```json
{
  "name": "miharbor",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "web:dev": "bun --filter miharbor-web dev",
    "server:dev": "bun --filter miharbor-server dev",
    "typecheck": "bun run --filter='*' typecheck",
    "lint": "bun run --filter='*' lint",
    "test": "bun run --filter='*' test"
  },
  "devDependencies": {
    "typescript": "~5.9.3",
    "@types/bun": "~1.3.12",
    "eslint": "~9.19.0",
    "prettier": "~3.4.2",
    "husky": "~9.1.7",
    "lint-staged": "~15.4.3"
  }
}
```

- [ ] **Step 2: tsconfig.base.json (strict)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 3: apps/server/package.json + stub entry**

```json
{
  "name": "miharbor-server",
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "elysia": "~1.2.10"
  }
}
```

```ts
// apps/server/src/index.ts
import { Elysia } from 'elysia'

new Elysia()
  .get('/health', () => ({ status: 'ok' }))
  .listen(Number(Bun.env.PORT) || 3000)

console.log('miharbor-server listening')
```

- [ ] **Step 4: apps/web package + Vite/Vue skeleton**

```json
{
  "name": "miharbor-web",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "vue": "~3.5.13"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "~5.2.1",
    "vite": "~6.0.7",
    "vue-tsc": "~2.2.0"
  }
}
```

```vue
<!-- apps/web/src/App.vue -->
<template>
  <div>Hello Miharbor</div>
</template>
```

- [ ] **Step 5: .gitignore согласно spec § 10.5**

```
node_modules/
dist/
.bun/
.env*
!.env.example
**/secrets.json
**/secrets-vault.enc
**/.vault-key
**/auth.json
**/snapshots/
**/*.key
**/wg-*.conf
*.yaml.bak
.miharbor.lock
.miharbor.draft.yaml
.miharbor.test.yaml
.DS_Store
```

- [ ] **Step 6: husky + lint-staged + secret-guard regex**

`.lintstagedrc.json`:
```json
{
  "*.{ts,vue,js,cjs,mjs}": ["eslint --fix", "prettier --write"],
  "*.{md,json,yaml,yml}": ["prettier --write"],
  "*": "./scripts/guard-secrets.sh"
}
```

`scripts/guard-secrets.sh`:
```bash
#!/usr/bin/env bash
set -e
for f in "$@"; do
  [[ -f "$f" ]] || continue
  if grep -E '^(private-key|pre-shared-key): |^secret: "[a-f0-9]{32,}"' "$f" >/dev/null; then
    echo "ERROR: $f contains secrets — refused by pre-commit guard." >&2
    exit 1
  fi
done
```

- [ ] **Step 7: Write guard-secrets test**

`tests/guard-secrets.test.ts`:
```ts
import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { writeFileSync, unlinkSync } from 'node:fs'

test('guard-secrets blocks WireGuard private-key', async () => {
  const f = '/tmp/mh-test-secret.yaml'
  writeFileSync(f, 'private-key: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n')
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets allows normal file', async () => {
  const f = '/tmp/mh-test-ok.yaml'
  writeFileSync(f, 'mode: rule\nlog-level: info\n')
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).toBe(0)
})
```

- [ ] **Step 8: Verify & commit**

```bash
bun install
bun run typecheck
bun run lint
bun test
git add -A
git commit -m "chore: init monorepo skeleton with bun workspaces"
```

---

## Task 2: Logger + audit-log

**Goal:** Structured JSON logger (`pino`) с redaction для секретов. Отдельный audit-log для deploy-событий.

**Files:**
- Create: `apps/server/src/observability/logger.ts`
- Create: `apps/server/src/observability/audit-log.ts`
- Create: `apps/server/tests/observability/logger.test.ts`
- Create: `apps/server/tests/observability/audit-log.test.ts`
- Modify: `apps/server/src/index.ts` — заменить `console.log` на `logger.info`

**Acceptance Criteria:**
- [ ] Logger redact'ит поля `secret`, `private-key`, `pre-shared-key`, `password`, `uuid`, `api_key` в любой глубине JSON
- [ ] Logger пишет JSON-lines в stdout
- [ ] Audit-log пишет в `$MIHARBOR_DATA_DIR/audit.log` в append-only режиме
- [ ] `MIHARBOR_LOG_LEVEL` env управляет уровнем (default `info`)

**Verify:** `bun test apps/server/tests/observability/` → все зелёные.

**Steps:**

- [ ] **Step 1: Написать failing-test для redaction**

```ts
// apps/server/tests/observability/logger.test.ts
import { expect, test } from 'bun:test'
import { createLogger } from '../../src/observability/logger.ts'

test('logger redacts secret field', async () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ secret: 'ede76fbe...', msg: 'reload' })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.secret).toBe('***REDACTED***')
  expect(parsed.msg).toBe('reload')
})

test('logger redacts nested private-key', async () => {
  const sink: string[] = []
  const log = createLogger({ level: 'info', sink: (line) => sink.push(line) })
  log.info({ proxy: { 'private-key': 'abc', name: 'node1' }, msg: 'added' })
  const parsed = JSON.parse(sink[0]!)
  expect(parsed.proxy['private-key']).toBe('***REDACTED***')
  expect(parsed.proxy.name).toBe('node1')
})

test('logger respects level threshold', async () => {
  const sink: string[] = []
  const log = createLogger({ level: 'warn', sink: (line) => sink.push(line) })
  log.info({ msg: 'should-not-appear' })
  log.warn({ msg: 'should-appear' })
  expect(sink.length).toBe(1)
  expect(JSON.parse(sink[0]!).msg).toBe('should-appear')
})
```

- [ ] **Step 2: Run tests → fail (модуль отсутствует)**

```bash
bun test apps/server/tests/observability/logger.test.ts
# expected: FAIL — cannot find module
```

- [ ] **Step 3: Реализовать logger**

```ts
// apps/server/src/observability/logger.ts
const SECRET_KEYS = new Set([
  'secret', 'private-key', 'pre-shared-key', 'password', 'uuid', 'api_key',
  'api-key', 'token', 'authorization',
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

export interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error'
  sink?: (line: string) => void
}

export function createLogger(opts: LoggerOptions) {
  const threshold = LEVEL_NUM[opts.level] ?? LEVEL_NUM.info!
  const sink = opts.sink ?? ((l) => console.log(l))
  const emit = (lvl: string, payload: Record<string, unknown>) => {
    if (LEVEL_NUM[lvl]! < threshold) return
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, ...redact(payload) as object }))
  }
  return {
    debug: (p: Record<string, unknown>) => emit('debug', p),
    info: (p: Record<string, unknown>) => emit('info', p),
    warn: (p: Record<string, unknown>) => emit('warn', p),
    error: (p: Record<string, unknown>) => emit('error', p),
  }
}

export const logger = createLogger({
  level: (Bun.env.MIHARBOR_LOG_LEVEL as any) ?? 'info',
})
```

- [ ] **Step 4: Audit-log test**

```ts
// apps/server/tests/observability/audit-log.test.ts
import { expect, test, beforeEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuditLog } from '../../src/observability/audit-log.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mh-audit-')) })

test('audit-log writes append-only JSONL', async () => {
  const audit = createAuditLog({ dir })
  await audit.record({ action: 'deploy', user: 'admin', snapshot_id: 'snap-1' })
  await audit.record({ action: 'rollback', user: 'admin', snapshot_id: 'snap-0' })
  const lines = readFileSync(join(dir, 'audit.log'), 'utf8').trim().split('\n')
  expect(lines.length).toBe(2)
  expect(JSON.parse(lines[0]!).action).toBe('deploy')
  expect(JSON.parse(lines[1]!).action).toBe('rollback')
  rmSync(dir, { recursive: true })
})
```

- [ ] **Step 5: Реализовать audit-log**

```ts
// apps/server/src/observability/audit-log.ts
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface AuditRecord {
  action: 'deploy' | 'rollback' | 'auto-rollback' | 'canonicalization' | 'login' | 'logout'
  user?: string
  user_ip?: string
  user_agent?: string
  snapshot_id?: string
  diff_summary?: { added: number; removed: number }
  extra?: Record<string, unknown>
}

export function createAuditLog(opts: { dir: string }) {
  const path = join(opts.dir, 'audit.log')
  return {
    async record(rec: AuditRecord) {
      await mkdir(opts.dir, { recursive: true })
      const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n'
      await appendFile(path, line, { mode: 0o600 })
    },
  }
}
```

- [ ] **Step 6: Tests green + commit**

```bash
bun test apps/server/tests/observability/
git add -A
git commit -m "feat(server): structured logger + audit log with secret redaction"
```

---

## Task 3: ENV schema + config bootstrap

**Goal:** Схема всех ENV-переменных через TypeBox. Загрузка в `bootstrap.ts` с валидацией и дефолтами. Deprecation-маппинг (stub для future releases).

**Files:**
- Create: `apps/server/src/env/schema.ts`
- Create: `apps/server/src/env/deprecations.ts`
- Create: `apps/server/src/bootstrap.ts`
- Create: `apps/server/tests/env/schema.test.ts`
- Modify: `apps/server/src/index.ts` — импортировать bootstrap

**Acceptance Criteria:**
- [ ] Все ENV из спеки перечислены в schema (transport, auth, data-dir, mihomo-api, LLM, etc.)
- [ ] Невалидный ENV (например `MIHARBOR_TRANSPORT=foo`) → сервер падает со структурным сообщением
- [ ] Дефолты документированы в самой schema
- [ ] Deprecated имя → warning в логах + fallback

**Verify:** `bun test apps/server/tests/env/`

**Steps:**

- [ ] **Step 1: Failing test**

```ts
// apps/server/tests/env/schema.test.ts
import { expect, test } from 'bun:test'
import { loadEnv } from '../../src/env/schema.ts'

test('loadEnv fails on invalid transport', () => {
  expect(() => loadEnv({ MIHARBOR_TRANSPORT: 'foo' } as any))
    .toThrow(/MIHARBOR_TRANSPORT/)
})

test('loadEnv applies defaults', () => {
  const env = loadEnv({})
  expect(env.MIHARBOR_TRANSPORT).toBe('local')
  expect(env.MIHARBOR_PORT).toBe(3000)
  expect(env.MIHARBOR_SNAPSHOT_RETENTION_COUNT).toBe(50)
})

test('loadEnv warns on deprecated name', () => {
  const warnings: string[] = []
  const env = loadEnv({ MIHARBOR_CFG_PATH: '/tmp/cfg.yaml' }, (w) => warnings.push(w))
  expect(env.MIHARBOR_CONFIG_PATH).toBe('/tmp/cfg.yaml')
  expect(warnings[0]).toMatch(/deprecated/i)
})
```

- [ ] **Step 2: Реализация schema.ts**

```ts
// apps/server/src/env/schema.ts
import { Type, Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { applyDeprecations } from './deprecations.ts'

const EnvSchema = Type.Object({
  MIHARBOR_PORT: Type.Number({ default: 3000 }),
  MIHARBOR_TRANSPORT: Type.Union([Type.Literal('local'), Type.Literal('ssh')], { default: 'local' }),
  MIHARBOR_CONFIG_PATH: Type.String({ default: '/config/config.yaml' }),
  MIHARBOR_DATA_DIR: Type.String({ default: '/app/data' }),
  MIHOMO_API_URL: Type.String({ default: 'http://host.docker.internal:9090' }),
  MIHOMO_API_SECRET: Type.String({ default: '' }),
  MIHARBOR_AUTH_USER: Type.String({ default: 'admin' }),
  MIHARBOR_AUTH_PASS_HASH: Type.String({ default: '' }),
  MIHARBOR_AUTH_DISABLED: Type.Boolean({ default: false }),
  MIHARBOR_TRUST_PROXY_HEADER: Type.String({ default: '' }),
  MIHARBOR_TRUSTED_PROXY_CIDRS: Type.String({ default: '' }),
  MIHARBOR_VAULT_KEY: Type.String({ default: '' }),
  MIHARBOR_SNAPSHOT_RETENTION_COUNT: Type.Number({ default: 50 }),
  MIHARBOR_SNAPSHOT_RETENTION_DAYS: Type.Number({ default: 30 }),
  MIHARBOR_LOG_LEVEL: Type.Union(
    [Type.Literal('debug'), Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')],
    { default: 'info' },
  ),
  MIHARBOR_AUTO_ROLLBACK: Type.Boolean({ default: true }),
  MIHARBOR_LLM_DISABLED: Type.Boolean({ default: false }),
  MIHARBOR_PRODUCTION: Type.Boolean({ default: false }),
  MIHARBOR_METRICS_DISABLED: Type.Boolean({ default: false }),
  // Validation mode for runMihomoValidate:
  //   'shared-only'  — just shared linter + YAML parse (default; no external dep)
  //   'api'          — use mihomo REST API (PUT /configs with a throwaway file, dry-run-like)
  //   'ssh-exec'     — run `mihomo -t` on target (SSH transport only)
  //   'docker-exec'  — docker exec <mihomo-container> mihomo -t (requires docker socket mount)
  MIHOMO_API_VALIDATION_MODE: Type.Union(
    [Type.Literal('shared-only'), Type.Literal('api'), Type.Literal('ssh-exec'), Type.Literal('docker-exec')],
    { default: 'shared-only' },
  ),
  MIHOMO_CONTAINER_NAME: Type.String({ default: 'mihomo' }),  // for docker-exec mode
  ANTHROPIC_API_KEY: Type.String({ default: '' }),
  OPENAI_API_KEY: Type.String({ default: '' }),
})

export type Env = Static<typeof EnvSchema>

function coerce(raw: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    if (v === 'true') out[k] = true
    else if (v === 'false') out[k] = false
    else if (/^-?\d+$/.test(v)) out[k] = Number(v)
    else out[k] = v
  }
  return out
}

export function loadEnv(raw: Record<string, string | undefined>, warn: (m: string) => void = console.warn): Env {
  const resolved = applyDeprecations(raw, warn)
  const coerced = coerce(resolved)
  const defaults = Value.Default(EnvSchema, coerced) as Record<string, unknown>
  if (!Value.Check(EnvSchema, defaults)) {
    const errors = [...Value.Errors(EnvSchema, defaults)]
    const msg = errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    throw new Error(`Invalid ENV: ${msg}`)
  }
  return defaults as Env
}
```

- [ ] **Step 3: deprecations.ts**

```ts
// apps/server/src/env/deprecations.ts
const DEPRECATIONS: Record<string, string> = {
  MIHARBOR_CFG_PATH: 'MIHARBOR_CONFIG_PATH',
}

export function applyDeprecations(
  raw: Record<string, string | undefined>,
  warn: (m: string) => void,
): Record<string, string | undefined> {
  const out = { ...raw }
  for (const [old, replacement] of Object.entries(DEPRECATIONS)) {
    if (out[old] !== undefined && out[replacement] === undefined) {
      warn(`ENV ${old} is deprecated, use ${replacement}`)
      out[replacement] = out[old]
    }
    delete out[old]
  }
  return out
}
```

- [ ] **Step 4: bootstrap.ts**

```ts
// apps/server/src/bootstrap.ts
import { loadEnv, type Env } from './env/schema.ts'
import { createLogger } from './observability/logger.ts'
import { createAuditLog } from './observability/audit-log.ts'

export interface AppContext {
  env: Env
  logger: ReturnType<typeof createLogger>
  audit: ReturnType<typeof createAuditLog>
}

export function bootstrap(): AppContext {
  const env = loadEnv(Bun.env)
  const logger = createLogger({ level: env.MIHARBOR_LOG_LEVEL })
  const audit = createAuditLog({ dir: env.MIHARBOR_DATA_DIR })
  logger.info({ msg: 'bootstrap', transport: env.MIHARBOR_TRANSPORT, data_dir: env.MIHARBOR_DATA_DIR })
  return { env, logger, audit }
}
```

- [ ] **Step 5: Test + green + commit**

```bash
bun add --filter miharbor-server @sinclair/typebox
bun test apps/server/tests/env/
git add -A && git commit -m "feat(server): ENV schema validation with deprecation support"
```

---

## Task 4: Shared types (Issue, Service, Rule, ProxyNode)

**Goal:** Типизированные интерфейсы — единый контракт между client и server.

**Files:**
- Create: `packages/shared/src/types/issue.ts`
- Create: `packages/shared/src/types/service.ts`
- Create: `packages/shared/src/types/rule.ts`
- Create: `packages/shared/src/types/proxy-node.ts`
- Create: `packages/shared/src/types/index.ts`
- Create: `packages/shared/tests/types.test.ts`

**Acceptance Criteria:**
- [ ] Все типы из спеки §5 описаны
- [ ] TypeBox-схемы для runtime-валидации
- [ ] `export *` из `packages/shared/src/index.ts`

**Verify:** `bun run --filter packages/shared typecheck`

**Steps:**

- [ ] **Step 1: issue.ts**

```ts
// packages/shared/src/types/issue.ts
import { Type, Static } from '@sinclair/typebox'

export const IssueLevel = Type.Union([
  Type.Literal('error'),
  Type.Literal('warning'),
  Type.Literal('info'),
])

export const IssueSchema = Type.Object({
  level: IssueLevel,
  code: Type.String(),  // i18n-key, e.g. "LINTER_UNREACHABLE_RULE"
  path: Type.Array(Type.Union([Type.String(), Type.Number()])),  // YAML path
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  autofix: Type.Optional(Type.Object({
    label: Type.String(),
    patch: Type.Unknown(),
  })),
})

export type Issue = Static<typeof IssueSchema>
```

- [ ] **Step 2: rule.ts**

```ts
// packages/shared/src/types/rule.ts
export type RuleType =
  | 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'DOMAIN-REGEX'
  | 'GEOSITE' | 'GEOIP'
  | 'IP-CIDR' | 'IP-CIDR6' | 'IP-ASN' | 'SRC-IP-CIDR'
  | 'DST-PORT' | 'SRC-PORT' | 'PROCESS-NAME' | 'NETWORK'
  | 'RULE-SET'
  | 'AND' | 'OR' | 'NOT'
  | 'MATCH'

export interface SimpleRule {
  kind: 'simple'
  type: Exclude<RuleType, 'AND' | 'OR' | 'NOT' | 'MATCH'>
  value: string
  target: string            // proxy-group name or DIRECT/PROXY/REJECT
  modifiers?: string[]      // ["no-resolve"]
}

export interface LogicalRule {
  kind: 'logical'
  op: 'AND' | 'OR' | 'NOT'
  children: Rule[]
  target: string
}

export interface MatchRule {
  kind: 'match'
  target: string
}

export type Rule = SimpleRule | LogicalRule | MatchRule
```

- [ ] **Step 3: service.ts**

```ts
// packages/shared/src/types/service.ts
import type { Rule } from './rule.ts'

export type ProxyGroupType = 'select' | 'url-test' | 'fallback' | 'load-balance' | 'relay'

export interface ProxyGroup {
  name: string
  type: ProxyGroupType
  proxies: string[]          // names of other proxies/groups/DIRECT/REJECT
  url?: string
  interval?: number
  hidden?: boolean
}

/**
 * Virtual Miharbor construct — {group, rules routing to this group}.
 * Not a mihomo concept. 1:1 mapping with proxy-groups.
 */
export interface Service {
  name: string               // == group.name
  group: ProxyGroup
  rules: { index: number; rule: Rule }[]   // index in global rules array
  direction: 'VPN' | 'DIRECT' | 'REJECT' | 'MIXED'  // deduced from current selection
  issues: import('./issue.ts').Issue[]
}
```

- [ ] **Step 4: proxy-node.ts**

```ts
// packages/shared/src/types/proxy-node.ts
export type ProxyNodeType =
  | 'wireguard' | 'ss' | 'vmess' | 'trojan' | 'http' | 'socks5' | 'hysteria2'

export interface ProxyNodeBase {
  name: string
  type: ProxyNodeType
  server: string
  port: number
  udp?: boolean
}

export interface WireGuardNode extends ProxyNodeBase {
  type: 'wireguard'
  'private-key': string
  'public-key': string
  'pre-shared-key'?: string
  ip: string
  dns?: string[]
  'allowed-ips'?: string[]
  'persistent-keepalive'?: number
  'amnezia-wg-option'?: Record<string, number>
}

export type ProxyNode = WireGuardNode | (ProxyNodeBase & { type: Exclude<ProxyNodeType, 'wireguard'>; [k: string]: unknown })
```

- [ ] **Step 5: Aggregate + test**

```ts
// packages/shared/src/types/index.ts
export * from './issue.ts'
export * from './rule.ts'
export * from './service.ts'
export * from './proxy-node.ts'
```

```ts
// packages/shared/tests/types.test.ts
import { expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { IssueSchema, type Issue } from '../src/types/issue.ts'

test('IssueSchema accepts valid issue', () => {
  const issue: Issue = { level: 'error', code: 'LINTER_X', path: ['rules', 5] }
  expect(Value.Check(IssueSchema, issue)).toBe(true)
})
test('IssueSchema rejects invalid level', () => {
  expect(Value.Check(IssueSchema, { level: 'fatal', code: 'X', path: [] })).toBe(false)
})
```

- [ ] **Step 6: Commit**

```bash
bun add --filter packages/shared @sinclair/typebox
bun run --filter packages/shared typecheck && bun test packages/shared
git add -A && git commit -m "feat(shared): core type definitions (Issue, Service, Rule, ProxyNode)"
```

---

## Task 5: YAML loader + canonicalize + rule-parser + views

**Goal:** Читать config.yaml как `yaml.Document`, canonicalize при первом импорте, парсить raw-строки правил в типизированные `Rule`, выдавать view-проекции.

**Files:**
- Create: `apps/server/src/config/loader.ts`
- Create: `apps/server/src/config/canonicalize.ts`
- Create: `packages/shared/src/parser/rule-parser.ts` **— shared, используется в линтерах и сервере**
- Create: `packages/shared/tests/parser/rule-parser.test.ts`
- Create: `apps/server/src/config/views/services.ts`
- Create: `apps/server/src/config/views/proxies.ts`
- Create: `apps/server/src/config/views/meta.ts`
- Create: `apps/server/src/config/mutator.ts`
- Create: `apps/server/tests/config/canonicalize.test.ts` (с golden fixture)
- Create: `apps/server/tests/fixtures/config-golden.yaml`
- Create: `apps/server/tests/fixtures/config-minimal.yaml`

**Acceptance Criteria:**
- [ ] `loader.load(path)` → `{ doc, hash, canonicalized: string }`
- [ ] canonicalize идемпотентен (parse → canonicalize → parse → canonicalize == первого результата)
- [ ] Все комментарии из спеки сохраняются (проверка regex'ом по критичным `# ----- ...` строкам)
- [ ] Views: `getServices(doc) → Service[]`, `getProxies(doc) → ProxyNode[]`, `getMeta(doc) → {mode, log-level, ...}`
- [ ] Golden test на `config-golden.yaml` (анонимизированная копия `config-server.yaml`) — canonicalize стабилен по прошлому прогону
- [ ] `parseRule(raw: string) → Rule` корректно разбирает SimpleRule, LogicalRule (AND/OR/NOT с рекурсией), MatchRule
- [ ] `serializeRule(rule: Rule) → string` round-trip: `parseRule(serializeRule(r)) deepEqual r` для всех форматов
- [ ] Fixture-анонимизация в Step 1: после замен — `grep -E '(185\.155\.|78:55:36|ede76fbe|lvsBCoJA|b7XwTc|61QKeVg)' fixture` возвращает 0 совпадений (скрипт-проверка в CI)

**Verify:** `bun test apps/server/tests/config/`

**Steps:**

- [ ] **Step 1: Импортировать config-server.yaml в fixture (анонимизировать)**

Взять `/Users/matrix/WebstormProjects/server-install/mihomo-configs/config-server.yaml`, заменить:
- `secret: "ede76f..."` → `secret: "0000000000000000000000000000000000000000000000000000000000000000"`
- `private-key: lvsB...` → `private-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`
- `public-key: b7Xw...` → `public-key: BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=`
- `pre-shared-key: 61QK...` → `pre-shared-key: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=`
- `91.132.58.113` → `198.51.100.1` (RFC 5737 test IP)
- IP `185.155.17.179`, MAC, domains-containing-matrix → обобщить

Сохранить как `apps/server/tests/fixtures/config-golden.yaml`.

- [ ] **Step 2: canonicalize.ts**

```ts
// apps/server/src/config/canonicalize.ts
import { parseDocument, type Document } from 'yaml'

const DUMP_OPTS = {
  lineWidth: 0,
  minContentWidth: 0,
  flowCollectionPadding: false,
  defaultStringType: 'PLAIN' as const,
  defaultKeyType: 'PLAIN' as const,
  doubleQuotedMinMultiLineLength: 999999,
}

export function canonicalize(rawYaml: string): { doc: Document; text: string } {
  const doc = parseDocument(rawYaml, { keepSourceTokens: false })
  const text = doc.toString(DUMP_OPTS)
  return { doc: parseDocument(text), text }
}

export function serialize(doc: Document): string {
  return doc.toString(DUMP_OPTS)
}
```

- [ ] **Step 3: loader.ts**

```ts
// apps/server/src/config/loader.ts
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { canonicalize, serialize } from './canonicalize.ts'
import type { Document } from 'yaml'

export interface LoadedConfig {
  doc: Document
  text: string           // canonical form
  originalHash: string   // sha256 of the file as read from disk
  wasCanonicalized: boolean
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  const raw = await readFile(path, 'utf8')
  const originalHash = createHash('sha256').update(raw).digest('hex')
  const { doc, text } = canonicalize(raw)
  return { doc, text, originalHash, wasCanonicalized: text !== raw }
}

export { serialize }
```

- [ ] **Step 4: Golden test**

```ts
// apps/server/tests/config/canonicalize.test.ts
import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { canonicalize } from '../../src/config/canonicalize.ts'
import { parseDocument } from 'yaml'

const GOLDEN = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')

test('canonicalize is idempotent', () => {
  const a = canonicalize(GOLDEN).text
  const b = canonicalize(a).text
  expect(a).toBe(b)
})

test('canonicalize preserves semantic content', () => {
  const original = parseDocument(GOLDEN).toJS()
  const canonical = parseDocument(canonicalize(GOLDEN).text).toJS()
  expect(canonical).toEqual(original)
})

test('canonicalize preserves critical comments', () => {
  const out = canonicalize(GOLDEN).text
  const markers = [
    'DISABLED for first rollout',
    'MUST NOT be :53',
    'Prevent self-intercept',
    'runbook 13.3',
    'Runbook hard rule',
  ]
  for (const m of markers) expect(out).toContain(m)
})

test('canonicalize preserves snapshot against committed golden', () => {
  // Golden snapshot stored in canonicalized form; ensures no silent regression.
  const snapshotPath = 'apps/server/tests/fixtures/config-golden.canonical.yaml'
  const actual = canonicalize(GOLDEN).text
  if (Bun.env.UPDATE_GOLDEN === '1') {
    writeFileSync(snapshotPath, actual)
  }
  const expected = readFileSync(snapshotPath, 'utf8')
  expect(actual).toBe(expected)
})
```

- [ ] **Step 5: Создать golden snapshot**

```bash
UPDATE_GOLDEN=1 bun test apps/server/tests/config/canonicalize.test.ts
# produces apps/server/tests/fixtures/config-golden.canonical.yaml
```

- [ ] **Step 5a: Rule parser (shared) — tests first**

```ts
// packages/shared/tests/parser/rule-parser.test.ts
import { expect, test } from 'bun:test'
import { parseRule, serializeRule } from '../../src/parser/rule-parser.ts'

test('parses simple DOMAIN-SUFFIX rule', () => {
  const r = parseRule('DOMAIN-SUFFIX,example.com,MyGroup')
  expect(r).toEqual({ kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'example.com', target: 'MyGroup', modifiers: [] })
})

test('parses rule with modifier no-resolve', () => {
  const r = parseRule('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve')
  expect(r).toEqual({ kind: 'simple', type: 'IP-CIDR', value: '10.0.0.0/8', target: 'DIRECT', modifiers: ['no-resolve'] })
})

test('parses MATCH rule', () => {
  expect(parseRule('MATCH,Default')).toEqual({ kind: 'match', target: 'Default' })
})

test('parses nested AND rule', () => {
  const r = parseRule('AND,((DOMAIN-KEYWORD,discord),(NOT,((DOMAIN-SUFFIX,ru)))),DiscordGroup')
  expect(r.kind).toBe('logical')
  expect((r as any).op).toBe('AND')
  expect((r as any).target).toBe('DiscordGroup')
  expect((r as any).children.length).toBe(2)
})

test('round-trip preservation', () => {
  const samples = [
    'DOMAIN-SUFFIX,example.com,G',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'MATCH,X',
    'AND,((DOMAIN-KEYWORD,a),(NOT,((DOMAIN-SUFFIX,b)))),G',
    'OR,((IP-ASN,714),(DOMAIN-SUFFIX,apple.com)),Apple',
  ]
  for (const s of samples) expect(serializeRule(parseRule(s))).toBe(s)
})
```

- [ ] **Step 5b: Rule parser impl**

```ts
// packages/shared/src/parser/rule-parser.ts
import type { Rule, SimpleRule, LogicalRule, MatchRule } from '../types/rule.ts'

const LOGICAL_OPS = new Set(['AND', 'OR', 'NOT'])

export function parseRule(raw: string): Rule {
  const trimmed = raw.trim()
  if (trimmed.startsWith('MATCH,')) {
    return { kind: 'match', target: trimmed.slice(6).trim() }
  }
  const firstComma = trimmed.indexOf(',')
  const head = trimmed.slice(0, firstComma)
  if (LOGICAL_OPS.has(head)) return parseLogical(trimmed)
  // simple rule: TYPE,VALUE,TARGET[,MOD...]
  const parts = trimmed.split(',')
  if (parts.length < 3) throw new Error(`invalid rule: ${raw}`)
  return {
    kind: 'simple',
    type: parts[0] as SimpleRule['type'],
    value: parts[1]!,
    target: parts[2]!,
    modifiers: parts.slice(3),
  }
}

function parseLogical(raw: string): LogicalRule {
  // Format: OP,((child1),(child2),...),TARGET
  // Parse paren-balanced children; target is last token after closing paren + comma
  const opEnd = raw.indexOf(',')
  const op = raw.slice(0, opEnd) as 'AND' | 'OR' | 'NOT'
  const rest = raw.slice(opEnd + 1)
  // rest looks like: ((child1),(child2)),TARGET
  let depth = 0, cursor = 0
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '(') depth++
    else if (rest[i] === ')') { depth--; if (depth === 0) { cursor = i + 1; break } }
  }
  const childrenBlock = rest.slice(1, cursor - 1) // strip outer ( )
  const target = rest.slice(cursor + 1).trim()  // skip comma
  const children: Rule[] = []
  // split childrenBlock by top-level parens
  let d = 0, start = -1
  for (let i = 0; i < childrenBlock.length; i++) {
    const c = childrenBlock[i]
    if (c === '(') { if (d === 0) start = i + 1; d++ }
    else if (c === ')') { d--; if (d === 0 && start >= 0) { children.push(parseRule(childrenBlock.slice(start, i) + ',__TMP__')); start = -1 } }
  }
  // children were parsed with placeholder target — patch: children targets are not meaningful in logical composition,
  // but Rule type requires target. Use `''` for children (convention) and target for top.
  for (const c of children) (c as any).target = ''
  return { kind: 'logical', op, children, target }
}

export function serializeRule(r: Rule): string {
  if (r.kind === 'match') return `MATCH,${r.target}`
  if (r.kind === 'simple') {
    const base = `${r.type},${r.value},${r.target}`
    return r.modifiers && r.modifiers.length ? `${base},${r.modifiers.join(',')}` : base
  }
  const kids = r.children.map((c) => {
    // serialize child without its (empty) target
    if (c.kind === 'simple') return `(${c.type},${c.value})`
    if (c.kind === 'logical') {
      const inner = serializeRule({ ...c, target: '' })
      return `(${inner.replace(/,$/, '')})`
    }
    return `(${serializeRule(c)})`
  }).join(',')
  return `${r.op},(${kids}),${r.target}`
}
```

- [ ] **Step 5c: Validate golden fixture anonymization**

```bash
# in Task 5 Step 1 after creating fixture:
if grep -qE '(185\.155\.|78:55:36|ede76fbe|lvsBCoJA|b7XwTc|61QKeVg)' apps/server/tests/fixtures/config-golden.yaml; then
  echo "ERROR: fixture still contains production secrets"; exit 1
fi
```

Добавить этот скрипт как `scripts/verify-anon.sh` + вызов в CI.

- [ ] **Step 6: views/services.ts**

```ts
// apps/server/src/config/views/services.ts
import type { Document, YAMLMap } from 'yaml'
import type { Service, ProxyGroup, Rule } from 'miharbor-shared'
import { parseRule } from './rule-parser.ts'

export function getServices(doc: Document): Service[] {
  const groups = doc.getIn(['proxy-groups']) as any
  const rules = doc.getIn(['rules']) as any
  if (!groups || !rules) return []

  const allRules: { index: number; rule: Rule }[] = rules.items.map((it: any, i: number) => ({
    index: i,
    rule: parseRule(it?.value ?? it.toString()),
  }))

  return groups.items.map((g: YAMLMap): Service => {
    const name = g.get('name') as string
    const type = (g.get('type') as ProxyGroup['type']) ?? 'select'
    const proxies = (g.get('proxies') as any)?.toJSON?.() ?? []
    const group: ProxyGroup = { name, type, proxies, hidden: g.get('hidden') as boolean }
    const related = allRules.filter((r) => r.rule.target === name)
    const direction = deduceDirection(group, related)
    return { name, group, rules: related, direction, issues: [] }
  })
}

function deduceDirection(group: ProxyGroup, rules: { rule: Rule }[]): Service['direction'] {
  // for `select` type: first proxy wins as "current"
  const first = group.proxies[0]
  if (first === 'DIRECT') return 'DIRECT'
  if (first === 'REJECT') return 'REJECT'
  if (!first) return 'MIXED'
  return 'VPN'
}
```

(+ `parseRule`, `views/proxies.ts`, `views/meta.ts`, `mutator.ts` аналогично — см. реализацию в спеке §5)

- [ ] **Step 7: Commit**

```bash
bun add --filter miharbor-server yaml
bun test apps/server/tests/config/
git add -A && git commit -m "feat(server): YAML loader, canonicalization and view projections"
```

---

## Task 6: Linter 1 — unreachable rules

**Goal:** Алгоритм детекции перекрытых правил. Shared (`packages/shared/linter/unreachable.ts`).

**Files:**
- Create: `packages/shared/src/linter/unreachable.ts`
- Create: `packages/shared/src/linter/index.ts`
- Create: `packages/shared/tests/linter/unreachable.test.ts`

**Acceptance Criteria:**
- [ ] Детектит `DOMAIN-SUFFIX,example.com,A` ниже `DOMAIN-SUFFIX,com,B`
- [ ] Детектит `DOMAIN-SUFFIX,x.ru,A` ниже `GEOSITE,category-ru,B` (только если есть локальный geosite — иначе info-уровень)
- [ ] Детектит повторяющееся правило с тем же target-ом
- [ ] Не детектит фальшивые срабатывания когда target разный (пользователь может хотеть тот же домен в другую группу — warning, не error)
- [ ] Результат — массив `Issue[]` с точным `path: ['rules', index]`

**Verify:** `bun test packages/shared/tests/linter/unreachable.test.ts`

**Steps:**

- [ ] **Step 1: Failing tests — все 4 case'а выше, каждый в отдельном `test()`**

```ts
// packages/shared/tests/linter/unreachable.test.ts
import { expect, test } from 'bun:test'
import { detectUnreachable } from '../../src/linter/unreachable.ts'
import { parseRule } from '../../src/parser/rule-parser.ts'
import type { Rule } from '../../src/types/rule.ts'

const rules = (arr: string[]): { index: number; rule: Rule }[] =>
  arr.map((s, i) => ({ index: i, rule: parseRule(s) }))

test('detects DOMAIN-SUFFIX shadowed by broader suffix', () => {
  const issues = detectUnreachable(rules([
    'DOMAIN-SUFFIX,com,A',
    'DOMAIN-SUFFIX,example.com,B',
  ]))
  expect(issues.length).toBe(1)
  expect(issues[0]!.code).toBe('LINTER_UNREACHABLE_RULE')
  expect(issues[0]!.path).toEqual(['rules', 1])
  expect((issues[0]!.params as any).covered_by_index).toBe(0)
})

test('no issue when narrower-to-broader same target', () => {
  // Rules same target — technically unreachable but redundant, not dangerous
  const issues = detectUnreachable(rules([
    'DOMAIN-SUFFIX,example.com,A',
    'DOMAIN-SUFFIX,com,A',
  ]))
  // Narrower comes first — still reachable. No issue.
  expect(issues).toEqual([])
})

test('detects duplicate rule', () => {
  const issues = detectUnreachable(rules([
    'DOMAIN-SUFFIX,x.ru,A',
    'DOMAIN-SUFFIX,x.ru,A',
  ]))
  expect(issues[0]!.code).toBe('LINTER_DUPLICATE_RULE')
})

test('ignores MATCH rule (always terminal)', () => {
  const issues = detectUnreachable(rules([
    'MATCH,default',
    'DOMAIN-SUFFIX,x.ru,A',
  ]))
  // Rule after MATCH is unreachable
  expect(issues.some((i) => i.path[1] === 1)).toBe(true)
})
```

- [ ] **Step 2: Реализация**

```ts
// packages/shared/src/linter/unreachable.ts
import type { Rule, SimpleRule, MatchRule, LogicalRule } from '../types/rule.ts'
import type { Issue } from '../types/issue.ts'

type IndexedRule = { index: number; rule: Rule }

export function detectUnreachable(rules: IndexedRule[]): Issue[] {
  const issues: Issue[] = []
  for (let i = 0; i < rules.length; i++) {
    const cur = rules[i]!
    for (let j = 0; j < i; j++) {
      const prev = rules[j]!
      if (prev.rule.kind === 'match') {
        issues.push({
          level: 'error',
          code: 'LINTER_UNREACHABLE_RULE',
          path: ['rules', cur.index],
          params: { covered_by_index: prev.index, reason: 'match_above' },
        })
        break
      }
      if (isExactDuplicate(prev.rule, cur.rule)) {
        issues.push({
          level: 'warning',
          code: 'LINTER_DUPLICATE_RULE',
          path: ['rules', cur.index],
          params: { duplicate_of_index: prev.index },
        })
        break
      }
      if (shadows(prev.rule, cur.rule)) {
        issues.push({
          level: 'warning',
          code: 'LINTER_UNREACHABLE_RULE',
          path: ['rules', cur.index],
          params: { covered_by_index: prev.index },
        })
        break
      }
    }
  }
  return issues
}

function isExactDuplicate(a: Rule, b: Rule): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function shadows(broad: Rule, narrow: Rule): boolean {
  if (broad.kind !== 'simple' || narrow.kind !== 'simple') return false
  if (broad.type !== narrow.type) return false
  if (broad.type === 'DOMAIN-SUFFIX') {
    return narrow.value === broad.value || narrow.value.endsWith('.' + broad.value)
  }
  if (broad.type === 'DOMAIN-KEYWORD') {
    return narrow.value.includes(broad.value)
  }
  // TODO: IP-CIDR subnet containment; for MVP — strict equality only
  return broad.value === narrow.value
}
```

- [ ] **Step 3: Tests green + commit**

```bash
bun test packages/shared/tests/linter/unreachable.test.ts
git add -A && git commit -m "feat(shared): linter — unreachable rules detector"
```

---

## Task 7: Linter 2 — universal invariants

**Goal:** Универсальные mihomo-инварианты (не специфичные для нашего роутера).

**Files:**
- Create: `packages/shared/src/linter/invariants-universal.ts`
- Create: `packages/shared/src/templates/invariants-universal.json`
- Create: `packages/shared/tests/linter/invariants.test.ts`

**Acceptance Criteria:**
- [ ] Проверяет: `secret` если задан — длиной ≥16, `interface-name` задан если `tun.enable: true`, `dns.listen` не равен `0.0.0.0:53`, `tun.dns-hijack` — массив (возможно пустой)
- [ ] Не проверяет user-specific инварианты (вроде `127.0.0.1:1053` — это на этап 2 в user-defined)

**Verify:** `bun test packages/shared/tests/linter/invariants.test.ts`

**Steps:**

- [ ] **Step 1: invariants-universal.json — данные**

```json
{
  "invariants": [
    {
      "id": "SECRET_LENGTH",
      "level": "error",
      "message_key": "INVARIANT_SECRET_TOO_SHORT",
      "path": ["secret"],
      "check": { "type": "min_length_if_present", "min": 16 }
    },
    {
      "id": "DNS_LISTEN_NOT_ZERO53",
      "level": "error",
      "message_key": "INVARIANT_DNS_LISTEN_ZERO53",
      "path": ["dns", "listen"],
      "check": { "type": "not_equals", "forbidden": ["0.0.0.0:53", ":53"] }
    },
    {
      "id": "TUN_INTERFACE_NAME_REQUIRED",
      "level": "error",
      "message_key": "INVARIANT_TUN_NEEDS_INTERFACE",
      "check": { "type": "conditional", "when": ["tun", "enable"], "then_required": ["interface-name"] }
    }
  ]
}
```

- [ ] **Step 2: Failing tests**

```ts
// packages/shared/tests/linter/invariants.test.ts
import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { checkUniversalInvariants } from '../../src/linter/invariants-universal.ts'

test('flags too-short secret', () => {
  const doc = parseDocument('secret: "short"\n')
  const issues = checkUniversalInvariants(doc)
  expect(issues.some((i) => (i.params as any)?.id === 'SECRET_LENGTH')).toBe(true)
})

test('flags dns.listen 0.0.0.0:53', () => {
  const doc = parseDocument('dns:\n  listen: 0.0.0.0:53\n')
  const issues = checkUniversalInvariants(doc)
  expect(issues.some((i) => (i.params as any)?.id === 'DNS_LISTEN_NOT_ZERO53')).toBe(true)
})

test('flags missing interface-name when tun.enable', () => {
  const doc = parseDocument('tun:\n  enable: true\n')
  const issues = checkUniversalInvariants(doc)
  expect(issues.some((i) => (i.params as any)?.id === 'TUN_INTERFACE_NAME_REQUIRED')).toBe(true)
})

test('no issues for healthy config', () => {
  const doc = parseDocument([
    'secret: "0000000000000000000000000000000000000000000000000000000000000000"',
    'dns: { listen: 127.0.0.1:1053 }',
    'tun: { enable: true }',
    'interface-name: eth0',
  ].join('\n'))
  expect(checkUniversalInvariants(doc)).toEqual([])
})
```

- [ ] **Step 3: Реализация**

```ts
// packages/shared/src/linter/invariants-universal.ts
import type { Document } from 'yaml'
import type { Issue } from '../types/issue.ts'
import invariants from '../templates/invariants-universal.json' with { type: 'json' }

export function checkUniversalInvariants(doc: Document): Issue[] {
  const issues: Issue[] = []
  for (const inv of invariants.invariants) {
    const issue = runCheck(doc, inv as any)
    if (issue) issues.push(issue)
  }
  return issues
}

function runCheck(doc: Document, inv: any): Issue | null {
  const check = inv.check
  if (check.type === 'min_length_if_present') {
    const val = doc.getIn(inv.path)
    if (typeof val === 'string' && val.length > 0 && val.length < check.min) {
      return { level: inv.level, code: inv.message_key, path: inv.path, params: { id: inv.id, min: check.min } }
    }
  }
  if (check.type === 'not_equals') {
    const val = doc.getIn(inv.path)
    if (typeof val === 'string' && check.forbidden.includes(val)) {
      return { level: inv.level, code: inv.message_key, path: inv.path, params: { id: inv.id, value: val } }
    }
  }
  if (check.type === 'conditional') {
    const when = doc.getIn(check.when)
    if (when === true) {
      const then = doc.getIn(check.then_required)
      if (then === undefined || then === null || then === '') {
        return { level: inv.level, code: inv.message_key, path: check.then_required, params: { id: inv.id } }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Commit**

```bash
bun test packages/shared/tests/linter/invariants.test.ts
git add -A && git commit -m "feat(shared): linter — universal mihomo invariants"
```

---

## Task 8: Linter 3 — duplicates & dangling references

**Goal:** Детект висячих ссылок и дубликатов.

**Files:**
- Create: `packages/shared/src/linter/duplicates.ts`
- Create: `packages/shared/tests/linter/duplicates.test.ts`

**Acceptance Criteria:**
- [ ] Rule ссылается на несуществующую proxy-group → `LINTER_DANGLING_GROUP_REFERENCE`
- [ ] `RULE-SET,X,Y` где rule-provider X нет → `LINTER_DANGLING_RULESET_REFERENCE`
- [ ] proxy-group ссылается на несуществующую ноду → `LINTER_DANGLING_NODE_REFERENCE`
- [ ] Дублирующийся DOMAIN-SUFFIX внутри одной группы через несколько правил → `LINTER_INTRA_GROUP_DUPLICATE`

**Verify:** `bun test packages/shared/tests/linter/duplicates.test.ts`

**Steps:**

- [ ] **Step 1: Failing tests (5 сценариев + happy path)**

```ts
// packages/shared/tests/linter/duplicates.test.ts
import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { detectDuplicates } from '../../src/linter/duplicates.ts'
import { parseRulesFromDoc } from '../../src/parser/rule-parser.ts'

const run = (yaml: string) => {
  const doc = parseDocument(yaml)
  return detectDuplicates(doc, parseRulesFromDoc(doc))
}

test('dangling proxy-group reference in rule', () => {
  const issues = run([
    'proxy-groups:',
    '  - {name: Real, type: select, proxies: [DIRECT]}',
    'rules:',
    '  - DOMAIN-SUFFIX,example.com,NotExistsGroup',
  ].join('\n'))
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_GROUP_REFERENCE')).toBe(true)
})

test('dangling rule-provider reference', () => {
  const issues = run([
    'rule-providers: {}',
    'proxy-groups:',
    '  - {name: G, type: select, proxies: [DIRECT]}',
    'rules:',
    '  - RULE-SET,missing_provider,G',
  ].join('\n'))
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_RULESET_REFERENCE')).toBe(true)
})

test('proxy-group references missing node', () => {
  const issues = run([
    'proxies: []',
    'proxy-groups:',
    '  - {name: G, type: select, proxies: [NonexistentNode, DIRECT]}',
    'rules:',
    '  - MATCH,G',
  ].join('\n'))
  expect(issues.some((i) => i.code === 'LINTER_DANGLING_NODE_REFERENCE')).toBe(true)
})

test('intra-group duplicate DOMAIN-SUFFIX', () => {
  const issues = run([
    'proxy-groups:',
    '  - {name: G, type: select, proxies: [DIRECT]}',
    'rules:',
    '  - DOMAIN-SUFFIX,example.com,G',
    '  - DOMAIN-SUFFIX,example.com,G',
  ].join('\n'))
  expect(issues.some((i) => i.code === 'LINTER_INTRA_GROUP_DUPLICATE')).toBe(true)
})

test('same domain in two different groups — warning not error', () => {
  const issues = run([
    'proxy-groups:',
    '  - {name: A, type: select, proxies: [DIRECT]}',
    '  - {name: B, type: select, proxies: [DIRECT]}',
    'rules:',
    '  - DOMAIN-SUFFIX,x.com,A',
    '  - DOMAIN-SUFFIX,x.com,B',
  ].join('\n'))
  const iss = issues.find((i) => i.code === 'LINTER_CROSS_GROUP_DUPLICATE')
  expect(iss?.level).toBe('warning')
})

test('happy path: no duplicates, all refs resolve', () => {
  const issues = run([
    'proxies:',
    '  - {name: N1, type: http, server: 1.1.1.1, port: 8080}',
    'rule-providers:',
    '  my_rules: {type: http, behavior: domain, url: "https://x.com/a", path: "./a.mrs", interval: 86400, format: mrs}',
    'proxy-groups:',
    '  - {name: G, type: select, proxies: [N1, DIRECT]}',
    'rules:',
    '  - RULE-SET,my_rules,G',
    '  - MATCH,G',
  ].join('\n'))
  expect(issues).toEqual([])
})
```

- [ ] **Step 2: Implementation**

```ts
// packages/shared/src/linter/duplicates.ts
import type { Document } from 'yaml'
import type { Issue } from '../types/issue.ts'
import type { Rule, SimpleRule } from '../types/rule.ts'

type IndexedRule = { index: number; rule: Rule }

const BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'PROXY', 'GLOBAL', 'REJECT-DROP', 'PASS'])

export function detectDuplicates(doc: Document, rules: IndexedRule[]): Issue[] {
  const issues: Issue[] = []
  const groupNames = new Set<string>()
  const ruleProviderNames = new Set<string>()
  const proxyNames = new Set<string>()

  const groups = (doc.getIn(['proxy-groups']) as any)?.items ?? []
  for (const g of groups) groupNames.add(String(g.get('name')))

  const providers = (doc.getIn(['rule-providers']) as any)?.items ?? []
  for (const p of providers) ruleProviderNames.add(String(p.key))

  const proxies = (doc.getIn(['proxies']) as any)?.items ?? []
  for (const p of proxies) proxyNames.add(String(p.get('name')))

  // 1. proxy-groups → nodes/other groups
  for (const g of groups) {
    const name = String(g.get('name'))
    const proxyList = (g.get('proxies') as any)?.toJSON?.() ?? []
    for (const ref of proxyList) {
      if (BUILTIN_TARGETS.has(ref)) continue
      if (!proxyNames.has(ref) && !groupNames.has(ref)) {
        issues.push({
          level: 'error',
          code: 'LINTER_DANGLING_NODE_REFERENCE',
          path: ['proxy-groups', name, 'proxies'],
          params: { ref },
        })
      }
    }
  }

  // 2. rules → groups / rule-providers
  for (const { index, rule } of rules) {
    const targets = collectTargets(rule)
    for (const target of targets) {
      if (BUILTIN_TARGETS.has(target)) continue
      if (!groupNames.has(target)) {
        issues.push({
          level: 'error',
          code: 'LINTER_DANGLING_GROUP_REFERENCE',
          path: ['rules', index],
          params: { target },
        })
      }
    }
    if (rule.kind === 'simple' && rule.type === 'RULE-SET') {
      if (!ruleProviderNames.has(rule.value)) {
        issues.push({
          level: 'error',
          code: 'LINTER_DANGLING_RULESET_REFERENCE',
          path: ['rules', index],
          params: { provider: rule.value },
        })
      }
    }
  }

  // 3. Duplicate rules
  const seenPerGroup = new Map<string, Set<string>>()
  const seenOverall = new Map<string, number>()  // "TYPE:VALUE" → firstIndex
  for (const { index, rule } of rules) {
    if (rule.kind !== 'simple') continue
    const key = `${rule.type}:${rule.value}`
    const inGroup = seenPerGroup.get(rule.target) ?? new Set()
    if (inGroup.has(key)) {
      issues.push({
        level: 'warning',
        code: 'LINTER_INTRA_GROUP_DUPLICATE',
        path: ['rules', index],
        params: { group: rule.target, key },
      })
    } else {
      inGroup.add(key)
      seenPerGroup.set(rule.target, inGroup)
    }

    const firstIdx = seenOverall.get(key)
    if (firstIdx !== undefined) {
      const firstRule = rules[firstIdx]!.rule as SimpleRule
      if (firstRule.target !== rule.target) {
        issues.push({
          level: 'warning',
          code: 'LINTER_CROSS_GROUP_DUPLICATE',
          path: ['rules', index],
          params: { firstAt: firstIdx, firstTarget: firstRule.target, currentTarget: rule.target },
        })
      }
    } else {
      seenOverall.set(key, index)
    }
  }

  return issues
}

function collectTargets(rule: Rule): string[] {
  if (rule.kind === 'match' || rule.kind === 'simple') return [rule.target]
  // logical: only top-level target
  return [rule.target]
}
```

- [ ] **Step 3: Commit**

```bash
bun test packages/shared/tests/linter/duplicates.test.ts
git add -A && git commit -m "feat(shared): linter — duplicates & dangling reference detector"
```

---

## Task 9: Linter aggregator + server endpoint

**Goal:** Собрать линтеры 1+2+3 в один `runSharedLinters(doc) → Issue[]` и выставить `POST /api/lint`.

**Files:**
- Create: `packages/shared/src/linter/index.ts`
- Create: `apps/server/src/routes/lint.ts`
- Create: `apps/server/tests/routes/lint.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/lint` принимает `{yaml: string}` → `{issues: Issue[]}`
- [ ] Endpoint защищён Basic Auth (stub в MVP — см. Task 20)
- [ ] Невалидный YAML → 400 с `{code: 'YAML_PARSE_ERROR', line, col}`

**Verify:** `bun test apps/server/tests/routes/lint.test.ts`

**Steps:**

- [ ] **Step 1: runSharedLinters**

```ts
// packages/shared/src/linter/index.ts
import { detectUnreachable } from './unreachable.ts'
import { checkUniversalInvariants } from './invariants-universal.ts'
import { detectDuplicates } from './duplicates.ts'
import { parseRulesFromDoc } from './rule-parser.ts'
import type { Document } from 'yaml'
import type { Issue } from '../types/issue.ts'

export function runSharedLinters(doc: Document): Issue[] {
  const rules = parseRulesFromDoc(doc)
  return [
    ...detectUnreachable(rules),
    ...checkUniversalInvariants(doc),
    ...detectDuplicates(doc, rules),
  ]
}
```

- [ ] **Step 2: Elysia endpoint**

```ts
// apps/server/src/routes/lint.ts
import { Elysia, t } from 'elysia'
import { parseDocument } from 'yaml'
import { runSharedLinters } from 'miharbor-shared'

export const lintRoutes = new Elysia({ prefix: '/api/lint' })
  .post('/', ({ body, set }) => {
    try {
      const doc = parseDocument(body.yaml)
      if (doc.errors.length > 0) {
        set.status = 400
        return { code: 'YAML_PARSE_ERROR', errors: doc.errors.map((e) => ({ message: e.message, pos: e.pos })) }
      }
      return { issues: runSharedLinters(doc) }
    } catch (e: any) {
      set.status = 400
      return { code: 'YAML_PARSE_ERROR', message: e.message }
    }
  }, { body: t.Object({ yaml: t.String() }) })
```

- [ ] **Step 3: Integration test + commit**

```bash
bun test apps/server/tests/routes/lint.test.ts
git commit -m "feat(server): /api/lint endpoint with shared linters"
```

---

## Task 10: Transport interface + InMemoryTransport

**Goal:** Определить `Transport` интерфейс. Тестовая имплементация.

**Files:**
- Create: `apps/server/src/transport/transport.ts`
- Create: `apps/server/src/transport/in-memory.ts`
- Create: `apps/server/tests/transport/in-memory.test.ts`

**Acceptance Criteria:**
- [ ] Интерфейс покрывает всё из спеки §6: `readConfig, writeConfig, readSnapshotsDir, writeSnapshot, runMihomoValidate, mihomoApiUrl, mihomoApiSecret`
- [ ] InMemory реализует все методы, используется как test-double

**Verify:** `bun test apps/server/tests/transport/in-memory.test.ts`

**Steps:**

- [ ] **Step 1: Интерфейс**

```ts
// apps/server/src/transport/transport.ts
export interface SnapshotMeta {
  id: string
  timestamp: string
  sha256_original: string
  sha256_masked: string
  applied_by: 'user' | 'rollback' | 'auto-rollback' | 'canonicalization'
  user_ip?: string
  user_agent?: string
  diff_summary?: { added: number; removed: number }
  mihomo_api_version?: string
  transport: 'local' | 'ssh'
}

export interface ValidationResult {
  ok: boolean
  errors: { line?: number; col?: number; message: string }[]
  raw_output: string
}

export interface Transport {
  readConfig(): Promise<{ content: string; hash: string }>
  writeConfig(content: string, lockFile: string): Promise<void>
  readSnapshotsDir(): Promise<SnapshotMeta[]>
  writeSnapshot(id: string, files: { 'config.yaml': string; 'meta.json': string; 'diff.patch': string }): Promise<void>
  readSnapshot(id: string): Promise<{ 'config.yaml': string; meta: SnapshotMeta }>
  deleteSnapshot(id: string): Promise<void>
  runMihomoValidate(content: string): Promise<ValidationResult>
  mihomoApiUrl(): string
  mihomoApiSecret(): string
}
```

- [ ] **Step 2: InMemoryTransport + tests + commit**

```bash
bun test apps/server/tests/transport/in-memory.test.ts
git commit -m "feat(server): Transport interface + InMemoryTransport for tests"
```

---

## Task 11: LocalFsTransport + flock

**Goal:** Файловый транспорт для Docker-режима. Атомарная запись + `proper-lockfile`.

**Files:**
- Create: `apps/server/src/transport/local-fs.ts`
- Create: `apps/server/src/lock/proper-lock.ts`
- Create: `apps/server/tests/transport/local-fs.test.ts`
- Create: `apps/server/tests/lock/proper-lock.test.ts`

**Acceptance Criteria:**
- [ ] `writeConfig` использует `tmp-on-same-mount + rename` (не `/tmp`)
- [ ] Запись под `flock` — параллельная попытка ждёт/падает с понятной ошибкой
- [ ] Hash перечитывается под локом, TOCTOU-race закрыт (тест: модификация файла между read и write детектится)
- [ ] `runMihomoValidate` пишет в `$MIHARBOR_DATA_DIR/mihomo-validate/test.yaml` и вызывает mihomo API `PUT /configs?force=true` на временной копии — но только если `MIHOMO_API_VALIDATION_MODE=api`. Иначе (default для MVP) — только shared-линтер + YAML-parse.

**Verify:** `bun test apps/server/tests/transport/local-fs.test.ts apps/server/tests/lock/`

**Steps:**

- [ ] **Step 1: Lock wrapper**

```ts
// apps/server/src/lock/proper-lock.ts
import lockfile from 'proper-lockfile'

export async function withLock<T>(
  path: string,
  fn: () => Promise<T>,
  opts: { retries?: number } = {},
): Promise<T> {
  const release = await lockfile.lock(path, {
    retries: { retries: opts.retries ?? 10, factor: 1.2, minTimeout: 50, maxTimeout: 500 },
    stale: 30_000,
    realpath: false,
  })
  try {
    return await fn()
  } finally {
    await release()
  }
}
```

- [ ] **Step 2: LocalFsTransport (атомарная запись + TOCTOU-check)** — на темплейт из спеки §6, с unit-тестами на каждую возможную гонку.

- [ ] **Step 3: Commit**

```bash
bun add --filter miharbor-server proper-lockfile
git commit -m "feat(server): LocalFsTransport with atomic write and flock"
```

---

## Task 12: Sentinel vault (AES-256-GCM)

**Goal:** Шифрованное хранилище секретов. Sentinel'ы в снапшотах вместо реальных значений.

**Files:**
- Create: `apps/server/src/vault/vault.ts`
- Create: `apps/server/src/vault/mask.ts`
- Create: `apps/server/tests/vault/vault.test.ts`
- Create: `apps/server/tests/vault/mask.test.ts`

**Acceptance Criteria:**
- [ ] `vault.store(value) → uuid` — шифрует и пишет в `secrets-vault.enc`
- [ ] `vault.resolve(uuid) → value` — расшифровывает
- [ ] `mask(doc) → doc` — заменяет все поля из `SECRET_FIELDS` на `$MIHARBOR_VAULT:<uuid>` (новые uuid)
- [ ] `unmask(doc) → doc` — восстанавливает обратно
- [ ] Корректная обработка отсутствующего `MIHARBOR_VAULT_KEY`: генерация + запись в `.vault-key` (mode 600) + warning лог
- [ ] GC: `vault.gc(referencedUuids) → removedCount`

**Verify:** `bun test apps/server/tests/vault/`

**Steps:**

- [ ] **Step 1: Tests (round-trip, gc, key generation, mask/unmask)**
- [ ] **Step 2: Реализация** (node `crypto` AES-256-GCM + atomic write)
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(server): sentinel-vault AES-256-GCM for snapshot secrets"
```

---

## Task 13: Snapshot manager + retention

**Goal:** Создание/чтение/удаление снапшотов, форматирование meta.json, retention.

**Files:**
- Create: `apps/server/src/deploy/snapshot.ts`
- Create: `apps/server/src/deploy/retention.ts`
- Create: `apps/server/tests/deploy/snapshot.test.ts`
- Create: `apps/server/tests/deploy/retention.test.ts`

**Acceptance Criteria:**
- [ ] `createSnapshot(content, meta) → id` — масштабирует вызовами `vault.mask`, считает `sha256_masked` и `sha256_original`, пишет через transport
- [ ] `diff.patch` создаётся между masked-версией previous и masked-версией current
- [ ] Retention: удаляет снапшот только если `(count > RETENTION_COUNT) AND (age > RETENTION_DAYS)`
- [ ] GC vault: после удаления snapshot вызывает `vault.gc(referenced_uuids_from_remaining_snapshots)`
- [ ] dedupe: `createSnapshot(content, {applied_by: 'auto-rollback'})` идемпотентен если content-hash совпадает с предыдущим

**Verify:** `bun test apps/server/tests/deploy/snapshot.test.ts apps/server/tests/deploy/retention.test.ts`

**Steps:**

- [ ] Tests → impl → commit.

```bash
git commit -m "feat(server): snapshot manager with masked diffs and retention policy"
```

---

## Task 14: Mihomo API client

**Goal:** Типизированный клиент mihomo REST API (reload, providers, proxies, version, /rules).

**Files:**
- Create: `apps/server/src/mihomo/api-client.ts`
- Create: `apps/server/tests/mihomo/api-client.test.ts`

**Acceptance Criteria:**
- [ ] Методы: `getVersion, reloadConfig, listProxies, getProxyDelay, listProviders, refreshProvider, listRules`
- [ ] Bearer auth через `Authorization: Bearer <secret>`
- [ ] Таймауты настраиваемые (default 10 сек)
- [ ] При `401` — специфичная ошибка `MihomoApiAuthError`

**Verify:** `bun test apps/server/tests/mihomo/api-client.test.ts` (mock через `Bun.serve`)

```bash
git commit -m "feat(server): typed mihomo API client"
```

---

## Task 15: Deploy pipeline — стейппер (шаги 1-5)

**Goal:** Реализация шагов 1-5 deploy-пайплайна (без healthcheck — он в следующей задаче).

**Files:**
- Create: `apps/server/src/deploy/pipeline.ts`
- Create: `apps/server/src/deploy/diff.ts`
- Create: `apps/server/tests/deploy/pipeline.test.ts`

**Acceptance Criteria:**
- [ ] `runPipeline({draft, context, onStep}) → {result, snapshot_id}` или throws
- [ ] Emit'ит события шагов через callback (для UI SSE)
- [ ] Шаг 1 (diff): unified diff **masked** current vs **masked** draft (реальные секреты в diff не попадают)
- [ ] Шаг 2 (client lint): `runSharedLinters(draft_doc)` — errors блокируют, warnings логгируются
- [ ] Шаг 3 (snapshot): создаёт snapshot current (через vault.mask + writeSnapshot)
- [ ] Шаг 4 (preflight): `transport.runMihomoValidate(draft)` (если `MIHOMO_API_VALIDATION_MODE != shared-only`)
- [ ] Шаг 5 (write+reload): **explicit unmask шаг** — если draft содержит sentinel'ы (например, rollback), `vault.unmaskDoc(draft)` → получили doc с реальными секретами → serialize → withLock → verifyHash → writeConfig → mihomo.reloadConfig
- [ ] Fallback reload: если `PUT /configs?force=true` падает с 5xx или timeout — попытка `sudo systemctl restart mihomo` (в SSH-режиме через `ssh exec`, в docker-режиме через docker socket `docker restart <MIHOMO_CONTAINER_NAME>`). UI предупреждает «downtime ~5 сек».
- [ ] Секреты никогда не попадают в diff, логи, snapshot, ошибки pipeline'а — ковер тестом: pipeline получает конфиг с private-key, success-path → snapshot `diff.patch` + сам `config.yaml` НЕ содержат `private-key` raw value.

**Verify:** `bun test apps/server/tests/deploy/pipeline.test.ts`

```bash
git commit -m "feat(server): deploy pipeline steps 1-5 (diff, lint, snapshot, preflight, write+reload)"
```

---

## Task 16: Healthcheck (4 фазы) + auto-rollback + continuous monitor

**Goal:** Шаг 6 пайплайна + continuous monitor для UI-бейджа.

**Files:**
- Create: `apps/server/src/deploy/healthcheck.ts`
- Create: `apps/server/src/deploy/rollback.ts`
- Create: `apps/server/src/health-monitor.ts`
- Create: `apps/server/tests/deploy/healthcheck.test.ts`
- Create: `apps/server/tests/deploy/rollback.test.ts`

**Acceptance Criteria:**
- [ ] `runHealthcheck(api, opts) → {ok, failedPhase?}` — 4 фазы по спеке §7
- [ ] Auto-rollback: если фаза 1 упала — немедленно. Фаза 3 — с подтверждением (но при `MIHARBOR_AUTO_ROLLBACK=true` — сразу).
- [ ] Rollback = новый snapshot `applied_by: 'auto-rollback'` + применение предыдущего через pipeline (с рекурсией-guard'ом 1 уровень).
- [ ] `healthMonitor`: `setInterval` 60 сек, emit статус через SSE.

**Verify:** `bun test apps/server/tests/deploy/`

```bash
git commit -m "feat(server): 4-phase healthcheck with auto-rollback + continuous monitor"
```

---

## Task 17: Basic Auth middleware + brute-force rate-limit

**Goal:** Middleware для Basic Auth, rate-limit на `/api/auth/login`, onboarding пароля.

**Files:**
- Create: `apps/server/src/auth/basic-auth.ts`
- Create: `apps/server/src/auth/rate-limit.ts`
- Create: `apps/server/src/auth/trust-proxy.ts`
- Create: `apps/server/tests/auth/basic-auth.test.ts`

**Acceptance Criteria:**
- [ ] Argon2id через `Bun.password.hash`
- [ ] Onboarding: если `auth.json` нет и `MIHARBOR_AUTH_PASS_HASH` пуст — временный `admin/admin` + required redirect на смену
- [ ] Trust-proxy: только от IP в `MIHARBOR_TRUSTED_PROXY_CIDRS` header учитывается
- [ ] Rate-limit: 5 попыток за 5 минут → 15 мин lockout (in-memory map)

**Verify:** `bun test apps/server/tests/auth/`

```bash
git commit -m "feat(server): Basic Auth + rate-limit + trust-proxy with CIDR allowlist"
```

---

## Task 18: Server bootstrap + all routes mounted

**Goal:** Собрать Elysia-приложение со всеми route'ами.

**Files:**
- Modify: `apps/server/src/index.ts`
- Create: `apps/server/src/routes/config.ts` (GET/PUT /api/config views)
- Create: `apps/server/src/routes/snapshots.ts` (list, get, rollback)
- Create: `apps/server/src/routes/deploy.ts` (POST /api/deploy with SSE)
- Create: `apps/server/src/routes/health.ts` (SSE stream)

**Acceptance Criteria:**
- [ ] `GET /api/config/services` → `Service[]`
- [ ] `GET /api/config/proxies` → `ProxyNode[]`
- [ ] `PUT /api/config/draft` → сохраняет draft в memory
- [ ] `POST /api/deploy` → SSE stream с событиями шагов
- [ ] `GET /api/snapshots` → список
- [ ] `POST /api/snapshots/:id/rollback` → rollback
- [ ] **Bootstrap-hook: automatic canonicalization snapshot on first start.** Если при старте `loadConfig()` возвращает `wasCanonicalized === true` — сервер автоматически запускает deploy-пайплайн с `applied_by: 'canonicalization'`: писать canonical-форму в `/etc/mihomo/config.yaml`, создать snapshot, уведомить UI через `/api/health/stream` событие `{type: 'canonicalized', old_hash, new_hash}`. Юзер увидит в UI плашку «формат конфига приведён к каноническому виду; см. snapshot в истории».
- [ ] Если UI получает событие `{type: 'canonicalized'}` до первого логина — показать модалку при логине «при первом запуске Miharbor привёл форматирование конфига к каноническому виду, это разовое действие, логика mihomo не изменилась. Посмотреть diff?» → ссылка в Историю.

**Verify:** `bun run server:dev`, затем `curl -su admin:admin http://localhost:3000/api/config/services`. Отдельный тест: `loadConfig` на non-canonical fixture → bootstrap-hook записал canonical-форму в test-transport.

```bash
git commit -m "feat(server): mount all API routes, SSE deploy stream"
```

---

## Task 19: Vue app skeleton + Tailwind + shadcn-vue + i18n

**Goal:** Frontend каркас.

**Files:**
- Modify: `apps/web/package.json` — add pinia, vue-i18n, tailwind, shadcn-vue
- Create: `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`
- Create: `apps/web/src/main.ts` — setup pinia + i18n
- Create: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ru.json` (пустой placeholder)
- Create: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/api/client.ts` (typed fetch)
- Create: `apps/web/src/stores/config.ts`, `apps/web/src/stores/deploy.ts`, `apps/web/src/stores/auth.ts`
- Create: `apps/web/src/components/ui/` — shadcn-vue init (button, dialog, input, ...)

**Acceptance Criteria:**
- [ ] `bun run web:dev` → Vite запускается без warnings
- [ ] Tailwind работает (test class применяется)
- [ ] i18n-ключ `app.title` рендерится

**Verify:** browser → `http://localhost:5173`, viewport показывает заголовок из i18n.

```bash
git commit -m "feat(web): Vue app skeleton with Tailwind, shadcn-vue, Pinia, vue-i18n"
```

---

## Task 20: Layout — AppShell, Sidebar, Header, DeployStepper skeleton

**Goal:** Каркас C из спеки — группированный сайдбар + header.

**Files:**
- Create: `apps/web/src/components/layout/AppShell.vue`
- Create: `apps/web/src/components/layout/Sidebar.vue`
- Create: `apps/web/src/components/layout/Header.vue`
- Create: `apps/web/src/components/layout/DeployStepper.vue`
- Create: `apps/web/src/components/layout/DiffViewer.vue` (Monaco diff)
- Modify: `apps/web/src/App.vue` — использует AppShell

**Acceptance Criteria:**
- [ ] Sidebar с группами Routing / Инфра / Advanced (но Инфра/Advanced элементы заглушка «скоро»)
- [ ] Header с бейджем несохранённых изменений, кнопкой «Применить» (disabled если draft пусто)
- [ ] DeployStepper открывается по кнопке, показывает 6 шагов (статичные placeholder'ы до Task 25)
- [ ] Переключатель EN/RU работает

**Verify:** screenshot сверяется с мокапом из брейншторма (вариант C).

```bash
git commit -m "feat(web): layout shell with grouped sidebar, header and deploy stepper skeleton"
```

---

## Task 21: Раздел «Сервисы» — master-detail

**Goal:** Экран из спеки §4 — список слева, детали справа.

**Files:**
- Create: `apps/web/src/pages/Services.vue`
- Create: `apps/web/src/components/services/ServiceList.vue`
- Create: `apps/web/src/components/services/ServiceDetail.vue`
- Create: `apps/web/src/components/services/RuleRow.vue`
- Create: `apps/web/src/components/services/RuleEditor.vue`
- Create: `apps/web/src/components/services/AddServiceDialog.vue`

**Acceptance Criteria:**
- [ ] Список сервисов с поиском (debounce 150ms)
- [ ] Badge линтер-issue'ев (красный/жёлтый)
- [ ] Клик → детали справа
- [ ] Переключатель VPN/DIRECT/REJECT — **читает live state из mihomo API `/proxies/<group>.now`** (не из порядка `proxies` в YAML), фоллбэк на `proxies[0]` только если mihomo недоступен (с warning-badge «live state unknown»)
- [ ] Inline-редактирование простых правил
- [ ] AND/OR правила — **read-only row** с badge «сложное правило» + tooltip i18n-ключ `rules.complex.tooltip` (в MVP — ссылка «смотри Raw YAML», в этапе 2 — откроет tree-editor)
- [ ] Добавление правила — форма с dropdown типа
- [ ] Удаление сервиса — confirm-dialog «удалить также N правил?»
- [ ] Все правки отражаются в draft-store, счётчик несохранённых изменений в header

**Verify:** e2e — открыть, добавить правило, увидеть «1 изменение» в header.

```bash
git commit -m "feat(web): Services master-detail screen with rule editor"
```

---

## Task 22: Раздел «Прокси-ноды» (MVP: view + WireGuard add/edit)

**Goal:** Список нод + форма WireGuard.

**Files:**
- Create: `apps/web/src/pages/Proxies.vue`
- Create: `apps/web/src/components/proxies/ProxyList.vue`
- Create: `apps/web/src/components/proxies/WireGuardForm.vue`
- Create: `apps/web/src/components/proxies/ProxyDelayBadge.vue`

**Acceptance Criteria:**
- [ ] Список нод с типом, IP, задержкой (через `/api/mihomo/proxies/:name/delay`)
- [ ] WireGuardForm — все поля по типу `WireGuardNode`, secrets masked-by-default
- [ ] `amnezia-wg-option` — отдельная expand-секция с warning «должно совпадать с сервером»
- [ ] Другие типы (ss/vmess/trojan) — **только view** в MVP, кнопки «edit» disabled + tooltip «поддержка в v0.2»

**Verify:** создал WireGuard ноду — увидел в draft, в диффе появилась секция proxies.

```bash
git commit -m "feat(web): Proxies screen with WireGuard form and delay badges"
```

---

## Task 23: Раздел «Raw YAML» (read-only Monaco)

**Goal:** Monaco editor отображает текущий draft в view-only режиме.

**Files:**
- Create: `apps/web/src/pages/RawYaml.vue`
- Create: `apps/web/src/components/yaml/MonacoYamlView.vue`

**Acceptance Criteria:**
- [ ] Monaco editor с syntax highlight YAML
- [ ] readonly = true в MVP
- [ ] Отображает актуальный draft (обновляется реактивно)
- [ ] В MVP НЕТ кнопки «применить отсюда» (через Services/Proxies only)

**Verify:** открыть страницу, увидеть YAML, попытка редактирования — заблокирована.

```bash
git commit -m "feat(web): Raw YAML read-only view with Monaco"
```

---

## Task 24: Раздел «История» с search/filter/rollback

**Goal:** Таймлайн снапшотов, поиск, откат.

**Files:**
- Create: `apps/web/src/pages/History.vue`
- Create: `apps/web/src/components/history/SnapshotTimeline.vue`
- Create: `apps/web/src/components/history/SnapshotDiffDrawer.vue`

**Acceptance Criteria:**
- [ ] Список снапшотов (дата, autor, diff-summary)
- [ ] Фильтр по `applied_by`
- [ ] Клик → drawer с masked diff
- [ ] Кнопка «Откатить» → запускает pipeline rollback через SSE

**Verify:** создать 2 снапшота, откатить → 3-й снапшот `applied_by: 'rollback'` в истории.

```bash
git commit -m "feat(web): History screen with timeline, search and rollback"
```

---

## Task 25: Раздел «Настройки» (базовый)

**Goal:** Страница настроек для: смена пароля, просмотр ENV в read-only, ввод LLM ключей (UI-заглушка, использование — в этапе 3).

**Files:**
- Create: `apps/web/src/pages/Settings.vue`
- Create: `apps/web/src/components/settings/PasswordChange.vue`
- Create: `apps/web/src/components/settings/EnvReadonly.vue`

**Acceptance Criteria:**
- [ ] Смена пароля через `POST /api/auth/change-password` (current → new)
- [ ] ENV-таблица: read-only с badge «set via ENV» vs «default»
- [ ] LLM-ключи: placeholder поля (сохранение в этапе 3)

```bash
git commit -m "feat(web): Settings page — password change + env readonly"
```

---

## Task 26: DeployStepper — integration с SSE

**Goal:** Подключить DeployStepper к `/api/deploy` SSE. Визуализация 6 шагов.

**Files:**
- Modify: `apps/web/src/components/layout/DeployStepper.vue`
- Create: `apps/web/src/stores/deploy.ts` — полная SSE-интеграция

**Acceptance Criteria:**
- [ ] Клик «Применить» → POST, получаем SSE
- [ ] Каждый event обновляет статус соответствующего шага (○ → ◐ → ● / ✕)
- [ ] При fail шаг подсвечивается + кнопка «Показать логи»
- [ ] При auto-rollback — вспышка красного, потом откат зеленой плашкой

**Verify:** e2e-сценарий: добавил правило → применил → все 6 шагов зелёные.

```bash
git commit -m "feat(web): DeployStepper SSE integration with real deploy pipeline"
```

---

## Task 27: Onboarding при пустом/отсутствующем конфиге

**Goal:** Welcome-экран для новых инсталляций.

**Files:**
- Create: `apps/web/src/pages/Onboarding.vue`
- Create: `apps/server/src/config/seed-template.yaml` (minimal working config)
- Create: `apps/server/src/routes/onboarding.ts`

**Acceptance Criteria:**
- [ ] Если `transport.readConfig()` throws ENOENT — onboarding показывается
- [ ] Шаг 1: «Конфига нет, создать минимальный?» → `POST /api/onboarding/seed`
- [ ] Шаг 2: редирект на Services
- [ ] `seed-template.yaml` **должен проходить**: `runSharedLinters(parseDocument(seed)) === []` (0 issues), `canonicalize(seed).text === seed` (уже canonical), `await transport.runMihomoValidate(seed).ok === true` если validation mode != shared-only. Тест-кейс на seed-template обязателен — защита от выпуска сломанного seed'а.

**Verify:** `docker compose up` с пустым volume → onboarding.

```bash
git commit -m "feat: onboarding flow for empty/missing config"
```

---

## Task 28: Dockerfile + docker-compose.example.yml

**Goal:** Multi-stage build, multi-arch, slim-образ.

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.example.yml`
- Create: `.dockerignore`
- Create: `.env.example`

**Acceptance Criteria:**
- [ ] Stage 1: `oven/bun:1.3-alpine` + `bun install` + `bun run web:build`
- [ ] Stage 2: `oven/bun:1.3-alpine` slim + copy built web + server src + `bun install --production`
- [ ] Final image < 200 MB
- [ ] `docker run` поднимает контейнер, `/health` отвечает
- [ ] `docker-compose.example.yml` документирует все volume-mount'ы и ENV

**Verify:** `docker buildx build --platform linux/amd64,linux/arm64 -t miharbor:test .` без ошибок.

```bash
git commit -m "build: Dockerfile multi-stage + compose example"
```

---

## Task 29: README.md + SECURITY.md + LICENSE

**Goal:** Документация проекта.

**Files:**
- Modify: `README.md`
- Create: `README.ru.md`
- Create: `SECURITY.md`
- Create: `docs/BACKUP.md`

**Acceptance Criteria:**
- [ ] README: quick-start `docker compose up`, пример compose, production checklist, compatibility matrix mihomo versions
- [ ] README.ru: паритетный перевод
- [ ] SECURITY.md: threat model (7 векторов из спеки §10.6), disclosure process
- [ ] BACKUP.md: команды бэкапа, критичность `.vault-key`

```bash
git commit -m "docs: README (EN+RU), SECURITY, BACKUP"
```

---

## Task 30: GitHub Actions — CI

**Goal:** lint + typecheck + test + build на каждый PR.

**Files:**
- Create: `.github/workflows/ci.yml`

**Acceptance Criteria:**
- [ ] Триггеры: push в main + PR
- [ ] Job'ы: `install + lint + typecheck + unit + build` — **один запуск** с Bun 1.3.11 (не matrix)
- [ ] Отдельный job `e2e` — **матрица** mihomo `1.18`, `1.19`, `1.20`; только для PR-in-main, не на каждый PR
- [ ] Время: <5 минут для non-e2e job'ов, e2e — <12 минут

**Verify:** push в тестовую ветку → зелёный workflow, e2e job запускается только при merge в main.

```bash
git commit -m "ci: GitHub Actions CI pipeline"
```

---

## Task 31: GitHub Actions — Release (multi-arch GHCR)

**Goal:** При теге `v*` — сборка multi-arch, пуш в GHCR, SBOM.

**Files:**
- Create: `.github/workflows/release.yml`

**Acceptance Criteria:**
- [ ] Триггер: tag `v*.*.*`
- [ ] `docker buildx build --platform linux/amd64,linux/arm64`
- [ ] Push в `ghcr.io/matrix-aas/miharbor:<version>` + `:latest`
- [ ] SBOM через `anchore/sbom-action`, прикрепляется к release
- [ ] GitHub Release с changelog из commits

**Verify:** `git tag v0.1.0 && git push --tags` → через 5-10 мин image в GHCR.

```bash
git commit -m "ci: release pipeline — multi-arch GHCR + SBOM"
```

---

## Task 32: E2E smoke test (Playwright)

**Goal:** Один happy-path тест: запуск → авторизация → добавление сервиса → deploy → rollback.

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/smoke.spec.ts`
- Create: `e2e-compose.yml` (miharbor + mock mihomo)
- Create: `apps/server/tests/e2e/mock-mihomo.ts` (минимальный mock API)

**Acceptance Criteria:**
- [ ] `bun run e2e` поднимает compose, прогоняет один полный сценарий, тушит compose
- [ ] Сценарий: логин → Services → «+ Сервис» → заполнить → «Применить» → все 6 шагов зелёные → History показывает новый snapshot → Rollback → History показывает auto-rollback

```bash
git commit -m "test: e2e smoke scenario with Playwright and mock mihomo"
```

---

## Task 33: Release v0.1.0

**Goal:** Первый публичный релиз.

**Acceptance Criteria:**
- [ ] Все предыдущие задачи `completed`
- [ ] Full `bun test` зелёный
- [ ] `docker buildx` успешно собирает multi-arch
- [ ] Smoke-scenario из README работает вручную
- [ ] `git tag v0.1.0 && git push --tags` → release workflow собирает и публикует
- [ ] GHCR image доступен по `ghcr.io/matrix-aas/miharbor:v0.1.0`
- [ ] GitHub Release с README + changelog

**Verify:** `docker pull ghcr.io/matrix-aas/miharbor:v0.1.0 && docker run ...` на чистой машине → рабочий контейнер.

---

## Этап 1 — Definition of Done

- Все 33 задачи `completed`.
- CI зелёный.
- Image published to GHCR.
- В реальном деплое (на тестовом dev-роутере с mihomo) прошёл полный happy-path.
- **Code-review по плану** (отдельный шаг после этапа 1) без открытых блокеров.

После этого — недельная пауза на «реальное использование», ловим идиотские UX-промахи, потом этап 2.
