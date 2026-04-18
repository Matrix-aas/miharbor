# Section 3 — WG public-key unmask

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `public-key` from the vault's secret scope so the WG form receives the real value, and migrate legacy drafts on first read.

**Architecture:** Four-step change. (1) `vault.resolveMany()` for batch lookups. (2) `isSecretKey()` gains a negative allow-list checked before exact / suffix matches; `public-key` is removed from defaults. (3) New `migrateDraftPublicKeys()` helper — YAML visit + vault.resolveMany — used on-read by `GET /api/config/draft` when legacy sentinels remain. (4) Route integration + audit-log extension for `migrate` action.

**Tech Stack:** Bun, Elysia, yaml@2, `bun:test`, existing `Vault` + `AuditLog` interfaces.

---

## Task 1: Add `Vault.resolveMany()` batch resolver

**Goal:** Expose a single-payload-read batch-resolve API so the migration helper doesn't trigger N vault-decrypt cycles.

**Files:**

- Modify: `apps/server/src/vault/vault.ts` (interface + factory)
- Test: `apps/server/tests/vault/vault.test.ts` (append new tests)

**Acceptance Criteria:**

- [ ] `Vault.resolveMany(uuids)` resolves known uuids in one payload read and omits unknown uuids from the output map.
- [ ] All existing vault tests still pass — no behavioural change to `resolve`, `store`, `gc`, etc.
- [ ] New tests cover: (a) all uuids known, (b) all uuids unknown, (c) mix, (d) empty input returns empty map, (e) wrong key raises `VaultCorruptError`.

**Verify:** `bun test apps/server/tests/vault/vault.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `apps/server/tests/vault/vault.test.ts`:

```ts
test('resolveMany reads payload once and maps known uuids', async () => {
  const v = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const uuidA = await v.store('alpha')
  const uuidB = await v.store('beta')
  const UNKNOWN = '00000000-0000-0000-0000-000000000000'
  const out = await v.resolveMany([uuidA, UNKNOWN, uuidB])
  expect(out.get(uuidA)).toBe('alpha')
  expect(out.get(uuidB)).toBe('beta')
  expect(out.has(UNKNOWN)).toBe(false)
  expect(out.size).toBe(2)
})

test('resolveMany with empty input returns empty map without reading vault', async () => {
  const v = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const out = await v.resolveMany([])
  expect(out.size).toBe(0)
})

test('resolveMany raises VaultCorruptError when key is wrong', async () => {
  const v1 = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const uuid = await v1.store('x')
  const otherKey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  const v2 = await createVault({ dataDir, vaultKeyEnv: otherKey })
  await expect(v2.resolveMany([uuid])).rejects.toBeInstanceOf(VaultCorruptError)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/server/tests/vault/vault.test.ts -t resolveMany`
Expected: FAIL — `resolveMany is not a function`.

- [ ] **Step 3: Extend the Vault interface and implementation**

In `apps/server/src/vault/vault.ts`, after the existing `resolve` method in the `Vault` interface (around the block starting at line 121), add:

```ts
  /** Batch resolve: reads the vault payload ONCE and returns a Map of
   *  uuid → value for every known uuid in `uuids`. Unknown uuids are
   *  omitted from the returned map (no throw). Empty input → empty map,
   *  skips the payload read entirely. */
  resolveMany(uuids: Iterable<string>): Promise<Map<string, string>>
```

In the factory return-object (after `resolve` implementation around line 225), add:

```ts
    async resolveMany(uuids) {
      const list = Array.from(uuids)
      const out = new Map<string, string>()
      if (list.length === 0) return out
      const payload = await readPayload()
      for (const uuid of list) {
        const entry = payload.entries[uuid]
        if (entry) out.set(uuid, entry.value)
      }
      return out
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/server/tests/vault/vault.test.ts`
Expected: all tests pass including the three new `resolveMany` cases.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/vault/vault.ts apps/server/tests/vault/vault.test.ts
git commit -m "feat(vault): add resolveMany batch resolver"
```

---

## Task 2: Remove `public-key` from vault secret scope

**Goal:** `public-key` stops being masked as a secret. Introduce `KNOWN_NON_SECRET_KEYS` checked before exact / suffix matches so the `-key` suffix doesn't re-match it.

**Files:**

- Modify: `apps/server/src/vault/mask.ts` (predicate + defaults)
- Modify: `apps/server/tests/vault/mask.test.ts` (update broken contracts, add new cases)

**Acceptance Criteria:**

- [ ] `isSecretKey('public-key', defaults)` returns `false`, even though `-key` suffix matches.
- [ ] `isSecretKey('private-key', defaults)` still returns `true`.
- [ ] `isSecretKey('pre-shared-key', defaults)` still returns `true`.
- [ ] `DEFAULT_SECRET_FIELDS` no longer contains `'public-key'`.
- [ ] Existing `walkSecrets` WG test now expects 2 replacements (private-key + pre-shared-key), not 3.
- [ ] New regression test: `public-key: somevalue` in a YAML doc survives `walkSecrets` untouched.

**Verify:** `bun test apps/server/tests/vault/mask.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write / update the failing tests**

In `apps/server/tests/vault/mask.test.ts`, replace the existing `DEFAULT_SECRET_FIELDS` test (currently line 18-34) and `walkSecrets replaces WireGuard …` test (currently line 78-95) with:

```ts
test('DEFAULT_SECRET_FIELDS contains the spec-required keys (public-key EXCLUDED)', () => {
  const expected = [
    'secret',
    'private-key',
    'pre-shared-key',
    'password',
    'uuid',
    'api_key',
    'api-key',
    'token',
  ]
  for (const k of expected) {
    expect(DEFAULT_SECRET_FIELDS).toContain(k)
  }
  // v0.2.5 change: public-key is NOT a secret; vaulting it breaks the WG form.
  expect(DEFAULT_SECRET_FIELDS).not.toContain('public-key')
})

test('walkSecrets replaces WireGuard private-key + pre-shared-key, leaves public-key', () => {
  const doc = parseDocument(WG_FIXTURE)
  const fields = resolveSecretFields('')
  const replacements: string[] = []
  walkSecrets(doc, fields, (v) => {
    replacements.push(v)
    return 'REPLACED'
  })
  // Two secrets swapped; public-key intact.
  expect(replacements).toHaveLength(2)
  const out = doc.toString()
  expect(out).not.toContain('kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo=')
  expect(out).not.toContain('D+gv7oQa2vgmvCbGU68P+3ouuiHU4tPPPHr0rKMlRoo=')
  // Public key (by shape) remains in the serialised output.
  expect(out).toContain('xAIRkwUYcExecs6eRsZUGsbEwqc2HBlEjYzMYNOeTwk=')
  expect(out).toContain('REPLACED')
})

test('isSecretKey treats public-key as NOT a secret even though -key matches (v0.2.5)', () => {
  const f = resolveSecretFields('')
  expect(isSecretKey('public-key', f)).toBe(false)
  // Neighbours still behave as before.
  expect(isSecretKey('private-key', f)).toBe(true)
  expect(isSecretKey('pre-shared-key', f)).toBe(true)
  expect(isSecretKey('wg-key', f)).toBe(true) // unknown -key still secret
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/server/tests/vault/mask.test.ts`
Expected: FAIL — old contract (3 replacements, `public-key` in defaults) no longer holds.

- [ ] **Step 3: Apply the mask.ts change**

In `apps/server/src/vault/mask.ts`, around the `DEFAULT_SECRET_FIELDS` export (line 33-43), change:

```ts
export const DEFAULT_SECRET_FIELDS = Object.freeze([
  'secret',
  'private-key',
  'pre-shared-key',
  'password',
  'uuid',
  'api_key',
  'api-key',
  'token',
])
```

(Removed `'public-key'`.)

Just below that, add a new export:

```ts
/** Keys that LOOK like secrets (match `-key` suffix or share a name) but
 *  are explicitly NOT confidential. Checked BEFORE `DEFAULT_SECRET_FIELDS`
 *  and `SECRET_SUFFIXES` so `public-key` doesn't re-match `-key`. */
export const KNOWN_NON_SECRET_KEYS = Object.freeze(['public-key'])
```

Update `isSecretKey` (currently around line 68-74):

```ts
/** `true` iff `key` is recognised as a secret-bearing field.
 *  Precedence: negative list → exact match → suffix match. `key` must
 *  be a plain string; scalar nodes with non-string keys are never secrets
 *  in our schema. */
export function isSecretKey(key: string, fields: Set<string>): boolean {
  if (KNOWN_NON_SECRET_KEYS.includes(key)) return false
  if (fields.has(key)) return true
  for (const suf of SECRET_SUFFIXES) {
    if (key.endsWith(suf)) return true
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/server/tests/vault/mask.test.ts`
Expected: all pass, including the three new / updated assertions.

Also run related integration tests to confirm no regression:

Run: `bun test apps/server/tests/routes/config.test.ts`
Expected: all pass (the `/api/config/raw` test asserts secrets masked — private-key is still covered).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/vault/mask.ts apps/server/tests/vault/mask.test.ts
git commit -m "fix(vault): treat public-key as non-secret

Public keys are publishable by definition; vaulting them only hides
them from the WG form and breaks validation. Adds KNOWN_NON_SECRET_KEYS
negative list checked before defaults + suffix match."
```

---

## Task 3: Implement `migrateDraftPublicKeys` helper

**Goal:** A standalone function that parses a draft YAML string, finds every `public-key: $MIHARBOR_VAULT:<uuid>` scalar, resolves via `vault.resolveMany`, and writes the real values back. Idempotent; missing uuids are left as-is with a warning log.

**Files:**

- Create: `apps/server/src/vault/migrate-public-keys.ts`
- Create: `apps/server/tests/vault/migrate-public-keys.test.ts`

**Acceptance Criteria:**

- [ ] Draft with 1+ `public-key: $MIHARBOR_VAULT:<uuid>` → real values written, `touched: true`.
- [ ] Draft without sentinels → `touched: false`, text byte-identical to input.
- [ ] Missing uuid in vault → sentinel preserved, warn log recorded, function does not throw.
- [ ] Multiple vaulted public-keys → single `vault.resolveMany` call (verified via spy).
- [ ] Invalid YAML input → `{ text: input, touched: false }`, no throw.
- [ ] Second call over migrated output → `touched: false` (idempotent).

**Verify:** `bun test apps/server/tests/vault/migrate-public-keys.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/vault/migrate-public-keys.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVault, type Vault } from '../../src/vault/vault.ts'
import { migrateDraftPublicKeys } from '../../src/vault/migrate-public-keys.ts'

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
let dataDir: string
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-migrate-'))
})
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function seedVault(values: string[]): Promise<{ vault: Vault; uuids: string[] }> {
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const uuids: string[] = []
  for (const v of values) uuids.push(await vault.store(v))
  return { vault, uuids }
}

test('rewrites public-key sentinel with resolved vault value', async () => {
  const { vault, uuids } = await seedVault(['abc123DEFpublicKeyXYZ='])
  const input = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuids[0]}\n`
  const { text, touched } = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(touched).toBe(true)
  expect(text).toContain('public-key: abc123DEFpublicKeyXYZ=')
  expect(text).not.toContain('$MIHARBOR_VAULT:')
})

test('leaves non-sentinel drafts untouched', async () => {
  const { vault } = await seedVault([])
  const input = `mode: rule\nproxies:\n  - name: wg1\n    public-key: realkey=\n`
  const { text, touched } = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(touched).toBe(false)
  expect(text).toBe(input)
})

test('uses resolveMany exactly once for multiple vaulted public-keys', async () => {
  const { vault, uuids } = await seedVault(['k1=', 'k2=', 'k3='])
  const input = [
    'proxies:',
    `  - name: a\n    public-key: $MIHARBOR_VAULT:${uuids[0]}`,
    `  - name: b\n    public-key: $MIHARBOR_VAULT:${uuids[1]}`,
    `  - name: c\n    public-key: $MIHARBOR_VAULT:${uuids[2]}`,
    '',
  ].join('\n')
  const spy = mock(vault.resolveMany.bind(vault))
  const patched: Vault = { ...vault, resolveMany: spy }
  const { text, touched } = await migrateDraftPublicKeys(input, patched, noopLogger)
  expect(touched).toBe(true)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(text).toContain('public-key: k1=')
  expect(text).toContain('public-key: k2=')
  expect(text).toContain('public-key: k3=')
})

test('preserves sentinel and warns when uuid is unknown to vault', async () => {
  const { vault } = await seedVault([])
  const UNKNOWN = '00000000-0000-0000-0000-000000000000'
  const input = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${UNKNOWN}\n`
  const warns: unknown[] = []
  const logger = { ...noopLogger, warn: (o: unknown) => warns.push(o) }
  const { text, touched } = await migrateDraftPublicKeys(input, vault, logger)
  expect(touched).toBe(false)
  expect(text).toContain(`$MIHARBOR_VAULT:${UNKNOWN}`)
  expect(warns).toHaveLength(1)
})

test('partial success — some resolved, some unknown', async () => {
  const { vault, uuids } = await seedVault(['known-key='])
  const UNKNOWN = '00000000-0000-0000-0000-000000000000'
  const input = [
    'proxies:',
    `  - name: a\n    public-key: $MIHARBOR_VAULT:${uuids[0]}`,
    `  - name: b\n    public-key: $MIHARBOR_VAULT:${UNKNOWN}`,
    '',
  ].join('\n')
  const { text, touched } = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(touched).toBe(true)
  expect(text).toContain('public-key: known-key=')
  expect(text).toContain(`public-key: $MIHARBOR_VAULT:${UNKNOWN}`)
})

test('invalid YAML returns input unchanged without throwing', async () => {
  const { vault } = await seedVault([])
  const bad = 'not: valid: yaml: : :\n  - missing\n'
  const { text, touched } = await migrateDraftPublicKeys(bad, vault, noopLogger)
  expect(touched).toBe(false)
  expect(text).toBe(bad)
})

test('idempotent — second call is a no-op', async () => {
  const { vault, uuids } = await seedVault(['roundtrip='])
  const input = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuids[0]}\n`
  const first = await migrateDraftPublicKeys(input, vault, noopLogger)
  expect(first.touched).toBe(true)
  const second = await migrateDraftPublicKeys(first.text, vault, noopLogger)
  expect(second.touched).toBe(false)
  expect(second.text).toBe(first.text)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/server/tests/vault/migrate-public-keys.test.ts`
Expected: FAIL — `migrate-public-keys.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/server/src/vault/migrate-public-keys.ts`:

```ts
// On-read draft migration — rewrites legacy `public-key: $MIHARBOR_VAULT:<uuid>`
// pairs back to their resolved plaintext values. Used by GET /api/config/draft
// so drafts written BEFORE v0.2.5 (when public-key was vaulted) don't surface
// the sentinel in the WG form.
//
// Idempotent: draft without sentinels returns byte-identical text and
// `touched: false`. Invalid YAML short-circuits to the same shape (we don't
// fix broken drafts, just pass them through). Missing uuids stay as the
// sentinel with a warn-log so the operator sees the blind spot.

import { parseDocument, isPair, isScalar, visit, type Scalar } from 'yaml'
import { SENTINEL_PREFIX } from './mask.ts'
import type { Vault } from './vault.ts'
import type { Logger } from '../observability/logger.ts'

const PUBLIC_KEY = 'public-key'

export interface MigrateResult {
  text: string
  touched: boolean
}

export async function migrateDraftPublicKeys(
  text: string,
  vault: Vault,
  logger: Logger,
): Promise<MigrateResult> {
  let doc
  try {
    doc = parseDocument(text)
    if (doc.errors.length > 0) return { text, touched: false }
  } catch {
    return { text, touched: false }
  }

  // First pass — collect sentinels under `public-key:` pairs.
  const pending: Array<{ scalar: Scalar; uuid: string }> = []
  visit(doc, {
    Pair(_k, pair) {
      if (!isPair(pair)) return
      if (!isScalar(pair.key) || !isScalar(pair.value)) return
      if (pair.key.value !== PUBLIC_KEY) return
      const v = pair.value.value
      if (typeof v !== 'string' || !v.startsWith(SENTINEL_PREFIX)) return
      pending.push({
        scalar: pair.value,
        uuid: v.slice(SENTINEL_PREFIX.length),
      })
    },
  })

  if (pending.length === 0) return { text, touched: false }

  const uuids = pending.map((p) => p.uuid)
  const resolved = await vault.resolveMany(uuids)

  let touched = false
  for (const { scalar, uuid } of pending) {
    const value = resolved.get(uuid)
    if (value === undefined) {
      logger.warn({
        msg: 'migrate: unknown vault uuid — leaving sentinel',
        key: PUBLIC_KEY,
        uuid,
      })
      continue
    }
    scalar.value = value
    touched = true
  }

  if (!touched) return { text, touched: false }
  return { text: doc.toString(), touched: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/server/tests/vault/migrate-public-keys.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/vault/migrate-public-keys.ts apps/server/tests/vault/migrate-public-keys.test.ts
git commit -m "feat(vault): add migrateDraftPublicKeys helper

Rewrites legacy \$MIHARBOR_VAULT:<uuid> sentinels under public-key:
back to their resolved plaintext. Used by the GET /api/config/draft
on-read migration path. Idempotent; missing uuids preserved + warned."
```

---

## Task 4: Wire migration into `GET /api/config/draft` + audit-log extension

**Goal:** Legacy drafts are transparently migrated on first read after upgrade. Audit log records the `migrate` action with per-read counts.

**Files:**

- Modify: `apps/server/src/observability/audit-log.ts` (extend `AuditAction` type)
- Modify: `apps/server/src/routes/config.ts` (add migration call + audit record)
- Modify: `apps/server/tests/routes/config.test.ts` (append migration scenario)

**Acceptance Criteria:**

- [ ] `AuditAction` type includes `'migrate'`.
- [ ] GET /api/config/draft with a legacy vault-sentinel'd public-key returns the unmasked value in `text`.
- [ ] After the GET, `draftStore.get(user).text` contains the resolved value (subsequent GETs don't re-run migration).
- [ ] Concurrent GETs return the same resolved text; idempotent check (`migrated !== draft.text`) avoids redundant `draftStore.put`.
- [ ] Audit log records `{ action: 'migrate', user, extra: { count: N } }` when `touched === true`.

**Verify:** `bun test apps/server/tests/routes/config.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Extend the `AuditAction` type**

In `apps/server/src/observability/audit-log.ts` (line 8-14), update:

```ts
export type AuditAction =
  | 'deploy'
  | 'rollback'
  | 'auto-rollback'
  | 'canonicalization'
  | 'login'
  | 'logout'
  | 'migrate'
```

- [ ] **Step 2: Write the failing route test**

Append to `apps/server/tests/routes/config.test.ts`:

```ts
test('GET /api/config/draft migrates legacy public-key sentinels (v0.2.5)', async () => {
  const { app, draftStore, vault } = await buildApp()
  const user = 'anonymous'
  const realKey = 'ABCdef123456789012345678901234567890abcdEF='
  const uuid = await vault.store(realKey)
  const legacyDraft = `proxies:\n  - name: wg1\n    public-key: $MIHARBOR_VAULT:${uuid}\n`
  draftStore.put(user, legacyDraft)

  const r = await app.handle(new Request('http://localhost/api/config/draft'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { source: string; text: string }
  expect(body.source).toBe('draft')
  expect(body.text).toContain(`public-key: ${realKey}`)
  expect(body.text).not.toContain('$MIHARBOR_VAULT:')

  // DraftStore was updated so subsequent reads don't re-migrate.
  const stored = draftStore.get(user)
  expect(stored?.text).toContain(realKey)
  expect(stored?.text).not.toContain('$MIHARBOR_VAULT:')
})

test('GET /api/config/draft is idempotent — no second put when already migrated', async () => {
  const { app, draftStore } = await buildApp()
  const user = 'anonymous'
  const cleanDraft = `mode: rule\nproxies:\n  - name: wg1\n    public-key: real=\n`
  draftStore.put(user, cleanDraft)
  const before = draftStore.get(user)!.updated

  await app.handle(new Request('http://localhost/api/config/draft'))
  const after = draftStore.get(user)!.updated
  expect(after).toBe(before) // put() never called — `updated` unchanged
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test apps/server/tests/routes/config.test.ts -t 'migrates legacy'`
Expected: FAIL — current route returns the draft verbatim.

- [ ] **Step 4: Wire migration into the route**

In `apps/server/src/routes/config.ts`:

At the top, add an import:

```ts
import { migrateDraftPublicKeys } from '../vault/migrate-public-keys.ts'
import type { AuditLog } from '../observability/audit-log.ts'
import type { Logger } from '../observability/logger.ts'
```

Update `ConfigRoutesDeps` (line 25-29) to include logger + audit:

```ts
export interface ConfigRoutesDeps {
  transport: Transport
  draftStore: DraftStore
  vault: Vault
  logger: Logger
  audit: AuditLog
}
```

Replace the current `.get('/draft', …)` handler (lines 77-90) with:

```ts
    .get('/draft', async ({ request }) => {
      const user = getAuthUser(request) ?? 'anonymous'
      const draft = deps.draftStore.get(user)
      if (draft) {
        const { text: migrated, touched } = await migrateDraftPublicKeys(
          draft.text,
          deps.vault,
          deps.logger,
        )
        if (touched && migrated !== draft.text) {
          const entry = deps.draftStore.put(user, migrated)
          // Best-effort audit — never fail the GET on audit write issues.
          void deps.audit
            .record({
              action: 'migrate',
              user,
              extra: { target: 'public-key', count: countPublicKeyRewrites(draft.text, migrated) },
            })
            .catch(() => undefined)
          return { source: 'draft' as const, text: migrated, updated: entry.updated }
        }
        return { source: 'draft' as const, text: draft.text, updated: draft.updated }
      }
      const text = await maskedLiveText()
      return { source: 'current' as const, text }
    })
```

Add at the bottom of the file (after `configRoutes`):

```ts
/** Counts how many `public-key: ...` lines changed between `before` and
 *  `after`. Used for the audit-log count field. Cheap string compare;
 *  the migrate helper has already decided `touched === true` before we
 *  get here. */
function countPublicKeyRewrites(before: string, after: string): number {
  const linesBefore = before.split('\n')
  const linesAfter = after.split('\n')
  let changed = 0
  const len = Math.min(linesBefore.length, linesAfter.length)
  for (let i = 0; i < len; i++) {
    const b = linesBefore[i] ?? ''
    const a = linesAfter[i] ?? ''
    if (b === a) continue
    if (!b.includes('public-key:')) continue
    changed += 1
  }
  return changed
}
```

- [ ] **Step 5: Update bootstrap wiring**

In `apps/server/src/server-bootstrap.ts`, around line 327, change:

```ts
    .use(configRoutes({ transport, draftStore, vault }))
```

to:

```ts
    .use(configRoutes({ transport, draftStore, vault, logger, audit }))
```

- [ ] **Step 6: Update the test `buildApp` helper**

In `apps/server/tests/routes/config.test.ts` `buildApp()` (line 28-34), expand deps:

```ts
async function buildApp() {
  const transport = new InMemoryTransport({ initialConfig: GOLDEN_CFG })
  const draftStore = createDraftStore()
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  const auditRecords: Array<Record<string, unknown>> = []
  const audit = {
    record: async (r: Record<string, unknown>) => {
      auditRecords.push(r)
    },
  }
  const app = new Elysia().use(configRoutes({ transport, draftStore, vault, logger, audit }))
  return { app, transport, draftStore, vault, auditRecords }
}
```

- [ ] **Step 7: Run the full suite**

Run: `bun test apps/server/tests/routes/config.test.ts`
Expected: all pass including the two new migration scenarios.

Run: `bun test apps/server/tests/server-bootstrap.test.ts`
Expected: all pass (bootstrap test uses the wired `configRoutes` too).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/observability/audit-log.ts \
        apps/server/src/routes/config.ts \
        apps/server/src/server-bootstrap.ts \
        apps/server/tests/routes/config.test.ts
git commit -m "feat(config): migrate legacy public-key vault sentinels on-read

GET /api/config/draft now transparently rewrites
\`public-key: \$MIHARBOR_VAULT:<uuid>\` back to the resolved plaintext
when the draft was saved before v0.2.5. Idempotent: subsequent GETs
don't re-migrate. Records audit action 'migrate' with per-read count."
```

---

## Section close-out

After all four tasks pass:

- [ ] Run full server test suite: `bun test apps/server`
- [ ] Run full web test suite: `bun x vitest run` (under `apps/web/`)
- [ ] Verify the WG form fix manually: open the UI, edit an existing WireGuard node, confirm public-key field shows the real base64 value (no `$MIHARBOR_VAULT:` prefix), and Save succeeds.
- [ ] Proceed to Section 2.
