# Section 2 — Pending-changes dialog + reset

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Header dirty badge clickable, open a modal with unified diff between the live config and the draft, and provide a destructive "Reset all changes" action. Retire the misleading "1 изменение" label.

**Architecture:** New server endpoint `GET /api/config/draft/diff` reuses the existing `unifiedDiff` helper (server-side diff@9). Client fetches the patch and renders with `diff2html` (already shipped). Reset button calls the existing `config.clearDraft()` store action (which reseeds `draftText` from `rawLive`). No new dependencies.

**Tech Stack:** Elysia, diff@9 (server), Vue 3.5, Pinia, diff2html@3 (client), vitest.

---

## Task 5: Server `GET /api/config/draft/diff` endpoint

**Goal:** Return a unified patch + {added, removed} counters between the masked live config and the stored draft. No authentication side-road — route sits alongside existing `/api/config/*` behind the same `basicAuth` middleware.

**Files:**

- Modify: `apps/server/src/routes/config.ts` (add route)
- Modify: `apps/server/tests/routes/config.test.ts` (append test cases)

**Acceptance Criteria:**

- [ ] GET /api/config/draft/diff with no draft → `{ patch: "", added: 0, removed: 0, hasDraft: false }`.
- [ ] GET with draft differing from live → `hasDraft: true`, `patch` contains `+++ draft` / `--- live` headers, `added` & `removed` match the unified-diff line counts.
- [ ] Both sides of the diff are MASKED (the existing `maskedLiveText` cache is reused; draft text is returned from `DraftStore` verbatim since it's stored already-masked).
- [ ] Route is behind basic-auth middleware (verified indirectly — all other `/api/config/*` tests pass the same gate).

**Verify:** `bun test apps/server/tests/routes/config.test.ts -t 'draft/diff'` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/tests/routes/config.test.ts`:

```ts
test('GET /api/config/draft/diff returns empty patch when no draft exists', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/config/draft/diff'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as {
    patch: string
    added: number
    removed: number
    hasDraft: boolean
  }
  expect(body.hasDraft).toBe(false)
  expect(body.patch).toBe('')
  expect(body.added).toBe(0)
  expect(body.removed).toBe(0)
})

test('GET /api/config/draft/diff returns unified patch with line counters', async () => {
  const { app, draftStore } = await buildApp()
  // Grab the masked live text (same form the UI sees) and build a draft that
  // changes one scalar. Using the existing /draft endpoint to get the masked
  // bytes avoids coupling the test to the internal mask memoisation.
  const liveR = await app.handle(new Request('http://localhost/api/config/draft'))
  const liveBody = (await liveR.json()) as { text: string }
  const live = liveBody.text
  const draft = live.replace('mode: rule', 'mode: global')
  draftStore.put('anonymous', draft)

  const r = await app.handle(new Request('http://localhost/api/config/draft/diff'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as {
    patch: string
    added: number
    removed: number
    hasDraft: boolean
  }
  expect(body.hasDraft).toBe(true)
  expect(body.patch).toContain('--- live')
  expect(body.patch).toContain('+++ draft')
  expect(body.patch).toContain('-mode: rule')
  expect(body.patch).toContain('+mode: global')
  expect(body.added).toBe(1)
  expect(body.removed).toBe(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/server/tests/routes/config.test.ts -t 'draft/diff'`
Expected: FAIL — route does not exist (404).

- [ ] **Step 3: Register the route**

In `apps/server/src/routes/config.ts`, add an import at the top:

```ts
import { unifiedDiff } from '../deploy/diff.ts'
```

Add a new handler just after `.delete('/draft', …)` (around line 105), inside the same `.use`-chain:

```ts
    .get('/draft/diff', async ({ request }) => {
      const user = getAuthUser(request) ?? 'anonymous'
      const draftEntry = deps.draftStore.get(user)
      if (!draftEntry) {
        return { patch: '', added: 0, removed: 0, hasDraft: false as const }
      }
      const liveMasked = await maskedLiveText()
      const { patch, added, removed } = unifiedDiff(liveMasked, draftEntry.text, {
        from: 'live',
        to: 'draft',
      })
      return { patch, added, removed, hasDraft: true as const }
    })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/server/tests/routes/config.test.ts`
Expected: all pass including the two new `draft/diff` scenarios.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/config.ts apps/server/tests/routes/config.test.ts
git commit -m "feat(config): add GET /api/config/draft/diff endpoint

Returns a unified patch (diff@9) + added/removed counters between the
masked live config and the user's current draft. Reused by the Pending
Changes dialog; no new client-side dependency."
```

---

## Task 6: Client API binding + `PendingChangesDialog` component

**Goal:** New `endpoints.config.draftDiff()` on the client, new `PendingChangesDialog.vue` that fetches the patch and renders via `diff2html`. Destructive reset button wired to the existing `config.clearDraft()` store action.

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/layout/PendingChangesDialog.vue`
- Create: `apps/web/tests/pending-changes-dialog.spec.ts`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/ru.json`

**Acceptance Criteria:**

- [ ] `endpoints.config.draftDiff()` returns `{ patch, added, removed, hasDraft }`.
- [ ] Dialog mounted with `:open="true"` fetches `draftDiff`, shows skeleton → diff HTML.
- [ ] `hasDraft === false` path renders "No changes" text, reset button disabled.
- [ ] Error from server shows error banner + retry button.
- [ ] "Reset all" button opens an inner `ConfirmDialog` — confirm triggers `config.clearDraft()` then emits `update:open=false`.
- [ ] All i18n keys exist in both `en.json` and `ru.json`.

**Verify:** `bun x vitest run apps/web/tests/pending-changes-dialog.spec.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add API binding**

In `apps/web/src/api/client.ts`, add to the `config` endpoints block (around line 148-160) — right after `clearDraft`:

```ts
    draftDiff: () =>
      api<{ patch: string; added: number; removed: number; hasDraft: boolean }>(
        '/api/config/draft/diff',
      ),
```

- [ ] **Step 2: Add i18n keys**

In `apps/web/src/i18n/en.json`, append to the root object (alphabetical — near `"pages"`):

```jsonc
  "pending_changes": {
    "title": "Pending changes",
    "stats": "+{added} / −{removed}",
    "no_changes": "No changes",
    "loading": "Loading diff…",
    "retry": "Retry",
    "error_generic": "Failed to load diff",
    "reset_button": "Reset all changes",
    "reset_confirm_title": "Reset local edits?",
    "reset_confirm_body": "All changes will be discarded. The draft will be re-seeded from the current mihomo config. This cannot be undone.",
    "reset_confirm_action": "Reset",
    "close": "Close"
  },
```

In `apps/web/src/i18n/ru.json`, append the Russian counterpart:

```jsonc
  "pending_changes": {
    "title": "Ожидающие изменения",
    "stats": "+{added} / −{removed}",
    "no_changes": "Изменений нет",
    "loading": "Загрузка диффа…",
    "retry": "Повторить",
    "error_generic": "Не удалось загрузить дифф",
    "reset_button": "Сбросить все изменения",
    "reset_confirm_title": "Сбросить локальные правки?",
    "reset_confirm_body": "Все изменения будут удалены. Draft снова будет собран из актуального mihomo-конфига. Действие необратимо.",
    "reset_confirm_action": "Сбросить",
    "close": "Закрыть"
  },
```

- [ ] **Step 3: Write the failing tests**

Create `apps/web/tests/pending-changes-dialog.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import PendingChangesDialog from '../src/components/layout/PendingChangesDialog.vue'
import { useConfigStore } from '../src/stores/config'
import * as apiClient from '../src/api/client'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

// Dialog content is teleported by radix-vue into document.body, so we attach
// the wrapper there and query against document — mirrors the pattern in
// apps/web/tests/template-suggester.spec.ts.
function mountDialog() {
  return mount(PendingChangesDialog, {
    props: { open: true },
    attachTo: document.body,
    global: { plugins: [makeI18n()] },
  })
}

describe('PendingChangesDialog', () => {
  let wrappers: Array<VueWrapper<unknown>> = []
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    wrappers = []
  })
  afterEach(() => {
    for (const w of wrappers) w.unmount()
    document.body.innerHTML = ''
  })

  function track(w: VueWrapper<unknown>) {
    wrappers.push(w)
    return w
  }

  it('renders "no changes" when hasDraft=false', async () => {
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch: '',
      added: 0,
      removed: 0,
      hasDraft: false,
    })
    track(mountDialog())
    await flushPromises()
    expect(document.body.innerHTML).toContain('No changes')
    const resetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="pending-reset-button"]',
    )
    expect(resetBtn).toBeTruthy()
    expect(resetBtn!.disabled).toBe(true)
  })

  it('fetches + renders diff2html output with line stats', async () => {
    const patch = [
      '--- live',
      '+++ draft',
      '@@ -1,1 +1,1 @@',
      '-mode: rule',
      '+mode: global',
      '',
    ].join('\n')
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch,
      added: 1,
      removed: 1,
      hasDraft: true,
    })
    track(mountDialog())
    await flushPromises()
    // diff2html emits `<span class="d2h-ins">` for adds; we don't assert
    // the exact HTML but do confirm content + stats landed.
    expect(document.body.innerHTML).toContain('mode: global')
    expect(document.body.innerHTML).toContain('+1')
    expect(document.body.innerHTML).toContain('−1')
  })

  it('shows error banner + retry when fetch fails', async () => {
    const spy = vi.spyOn(apiClient.endpoints.config, 'draftDiff')
    spy.mockRejectedValueOnce(new Error('boom'))
    track(mountDialog())
    await flushPromises()
    expect(document.body.innerHTML).toContain('Failed to load diff')
    spy.mockResolvedValueOnce({ patch: '', added: 0, removed: 0, hasDraft: false })
    const retry = document.querySelector<HTMLButtonElement>('[data-testid="pending-retry"]')
    expect(retry).toBeTruthy()
    retry!.click()
    await flushPromises()
    expect(document.body.innerHTML).toContain('No changes')
  })

  it('clicking reset → confirm → calls config.clearDraft + emits close', async () => {
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch: '--- live\n+++ draft\n@@ -1,1 +1,1 @@\n-a\n+b\n',
      added: 1,
      removed: 1,
      hasDraft: true,
    })
    const store = useConfigStore()
    const clearSpy = vi.spyOn(store, 'clearDraft').mockResolvedValue()
    const wrapper = track(mountDialog())
    await flushPromises()
    const resetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="pending-reset-button"]',
    )
    expect(resetBtn).toBeTruthy()
    resetBtn!.click()
    await flushPromises()
    // ConfirmDialog emits 'confirm' from its primary button. We find the
    // ConfirmDialog component instance inside the wrapper tree and trigger
    // the event directly — matches how the parent listens (@confirm).
    const confirmDialog = wrapper.findComponent({ name: 'ConfirmDialog' })
    expect(confirmDialog.exists()).toBe(true)
    await confirmDialog.vm.$emit('confirm')
    await flushPromises()
    expect(clearSpy).toHaveBeenCalledOnce()
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
```

Note: `useConfigStore().clearDraft` is a setup-store action (Pinia composition API), and `vi.spyOn(store, 'clearDraft').mockResolvedValue()` works because setup stores expose actions as regular fields on the store object — no `createTestingPinia` needed. If a future Pinia upgrade wraps actions in read-only accessors, switch the test to `vi.spyOn(store, 'clearDraft' as any).mockImplementation(async () => {})` or use `createTestingPinia({ stubActions: false })`.

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun x vitest run apps/web/tests/pending-changes-dialog.spec.ts`
Expected: FAIL — `PendingChangesDialog.vue` does not exist.

- [ ] **Step 5: Implement the dialog**

Create `apps/web/src/components/layout/PendingChangesDialog.vue`:

```vue
<script setup lang="ts">
// PendingChangesDialog — modal presenting the current draft vs. live
// unified diff and offering a destructive "reset all" action. Fetches
// the patch from GET /api/config/draft/diff and renders it via
// diff2html (lazy-imported to keep the chunk out of the initial bundle).

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, X } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/services/ConfirmDialog.vue'
import { endpoints } from '@/api/client'
import { useConfigStore } from '@/stores/config'

interface Props {
  open: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const config = useConfigStore()

const openComputed = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

const loading = ref(false)
const error = ref<string | null>(null)
const patch = ref<string>('')
const added = ref<number>(0)
const removed = ref<number>(0)
const hasDraft = ref<boolean>(false)
const diffHtml = ref<string | null>(null)

const showConfirm = ref(false)
const resetting = ref(false)

async function renderDiffHtml(raw: string): Promise<string> {
  const { html } = await import('diff2html')
  return html(raw, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: 'line-by-line',
  })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  diffHtml.value = null
  try {
    const r = await endpoints.config.draftDiff()
    patch.value = r.patch
    added.value = r.added
    removed.value = r.removed
    hasDraft.value = r.hasDraft
    if (r.hasDraft && r.patch.trim().length > 0) {
      diffHtml.value = await renderDiffHtml(r.patch)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('pending_changes.error_generic')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load()
    else {
      diffHtml.value = null
      error.value = null
    }
  },
  { immediate: true },
)

function askReset(): void {
  showConfirm.value = true
}

async function confirmReset(): Promise<void> {
  resetting.value = true
  try {
    await config.clearDraft()
    showConfirm.value = false
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('pending_changes.error_generic')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="openComputed">
    <DialogContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <span>{{ t('pending_changes.title') }}</span>
          <Badge v-if="hasDraft" variant="secondary" data-testid="pending-stats">
            +{{ added }} / −{{ removed }}
          </Badge>
        </DialogTitle>
        <DialogDescription v-if="error">
          <span class="text-destructive">{{ t('pending_changes.error_generic') }}</span>
        </DialogDescription>
      </DialogHeader>

      <div
        class="max-h-[60vh] overflow-auto rounded-md border border-border bg-card/40 p-2 text-xs"
      >
        <p v-if="loading" class="py-4 text-center text-muted-foreground">
          {{ t('pending_changes.loading') }}
        </p>
        <div
          v-else-if="error"
          class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="flex-1 space-y-2">
            <p>{{ error }}</p>
            <Button variant="outline" size="sm" data-testid="pending-retry" @click="load">
              {{ t('pending_changes.retry') }}
            </Button>
          </div>
        </div>
        <p v-else-if="!hasDraft" class="py-4 text-center text-muted-foreground">
          {{ t('pending_changes.no_changes') }}
        </p>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else-if="diffHtml" class="diff-drawer" v-html="diffHtml" />
      </div>

      <DialogFooter>
        <Button
          variant="destructive"
          size="sm"
          data-testid="pending-reset-button"
          :disabled="!hasDraft || loading || resetting"
          @click="askReset"
        >
          {{ t('pending_changes.reset_button') }}
        </Button>
        <Button variant="outline" size="sm" @click="openComputed = false">
          {{ t('pending_changes.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    :open="showConfirm"
    :title="t('pending_changes.reset_confirm_title')"
    :body="t('pending_changes.reset_confirm_body')"
    :confirm-label="t('pending_changes.reset_confirm_action')"
    @update:open="(v: boolean) => (showConfirm = v)"
    @confirm="confirmReset"
  />
</template>

<style scoped>
/* Minimal diff2html CSS subset — same slice used by SnapshotDiffDrawer.vue. */
.diff-drawer :deep(.d2h-wrapper) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.diff-drawer :deep(.d2h-file-header) {
  display: none;
}
.diff-drawer :deep(.d2h-diff-table) {
  width: 100%;
  border-collapse: collapse;
}
.diff-drawer :deep(.d2h-code-linenumber) {
  color: hsl(var(--muted-foreground));
  padding: 0 0.5rem;
}
.diff-drawer :deep(.d2h-code-line) {
  padding: 0 0.5rem;
}
.diff-drawer :deep(.d2h-ins) {
  background: rgba(16, 185, 129, 0.15);
}
.diff-drawer :deep(.d2h-del) {
  background: rgba(244, 63, 94, 0.15);
}
.diff-drawer :deep(.d2h-info) {
  color: hsl(var(--muted-foreground));
  background: transparent;
}
.diff-drawer :deep(.d2h-cntx) {
  color: hsl(var(--muted-foreground));
}
</style>
```

`ConfirmDialog` (`apps/web/src/components/services/ConfirmDialog.vue`) emits `confirm` + `update:open` and takes `{ open, title, body, confirmLabel, cancelLabel?, destructive? }`. The test dispatches the `confirm` event directly on the ConfirmDialog component (via `findComponent`) — this mirrors how the parent listens (`@confirm="confirmReset"`) and doesn't rely on DOM structure inside the dialog.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun x vitest run apps/web/tests/pending-changes-dialog.spec.ts`
Expected: all 4 cases pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/client.ts \
        apps/web/src/components/layout/PendingChangesDialog.vue \
        apps/web/tests/pending-changes-dialog.spec.ts \
        apps/web/src/i18n/en.json \
        apps/web/src/i18n/ru.json
git commit -m "feat(ui): add PendingChangesDialog with diff + reset

Fetches GET /api/config/draft/diff, renders the patch via diff2html,
and offers a destructive reset-all action wired to config.clearDraft()."
```

---

## Task 7: Clickable Header badge + retire `changes_count`

**Goal:** The "N changes" badge in Header becomes a `<button>` that opens the new modal. The misleading `{count} change | changes` i18n key is replaced with a flag-based label. Badge is disabled until `rawLive` + `draftText` finish loading.

**Files:**

- Modify: `apps/web/src/components/layout/Header.vue`
- Modify: `apps/web/src/i18n/en.json` (remove `header.changes_count`, add `header.pending_changes` / `header.pending_tooltip`)
- Modify: `apps/web/src/i18n/ru.json` (same)
- Create: `apps/web/tests/header.spec.ts`

**Acceptance Criteria:**

- [ ] Clickable `<button>` badge appears when `dirtyCount === 1` (which already implies `rawLive !== null && draftText !== null`, per the store's computed guard).
- [ ] Badge click sets `pendingOpen = true`, which renders `PendingChangesDialog`.
- [ ] Label text is `t('header.pending_changes')`, never a count.
- [ ] Old `header.changes_count` key removed from both locales AND no other reference survives (`grep -r "header\.changes_count" apps/web` is empty).
- [ ] `dirtyCount === 0` case still renders `header.no_changes` muted badge.
- [ ] During initial load (`rawLive` / `draftText` both null), `dirtyCount` is already 0 by the store's logic (`apps/web/src/stores/config.ts:172-176`), so the muted badge shows — NOT a spurious "Pending changes" button. This is the intended UX for the load race.

**Verify:** `bun x vitest run apps/web/tests/header.spec.ts` → all pass.

**Steps:**

- [ ] **Step 1: Update i18n**

In `apps/web/src/i18n/en.json`, in the `"header"` block:

- Remove the line: `"changes_count": "{count} change | {count} changes",`
- Add: `"pending_changes": "Pending changes",`
- Add: `"pending_tooltip": "Show changes",`

In `apps/web/src/i18n/ru.json`, in the `"header"` block:

- Remove: `"changes_count": "{count} изменение | {count} изменения | {count} изменений",`
- Add: `"pending_changes": "Ожидающие изменения",`
- Add: `"pending_tooltip": "Показать изменения",`

- [ ] **Step 2: Write the failing Header test**

Create `apps/web/tests/header.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import Header from '../src/components/layout/Header.vue'
import { useConfigStore } from '../src/stores/config'
import { useDeployStore } from '../src/stores/deploy'
import * as apiClient from '../src/api/client'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

// Header mounts PendingChangesDialog whose content is portaled to
// document.body (radix-vue), so we attach + query there.
function mountHeader() {
  return mount(Header, {
    attachTo: document.body,
    global: {
      plugins: [makeI18n()],
      stubs: { 'router-link': true, HealthBadge: true },
    },
  })
}

describe('Header dirty badge', () => {
  let wrappers: Array<VueWrapper<unknown>> = []

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(apiClient.endpoints.config, 'draftDiff').mockResolvedValue({
      patch: '',
      added: 0,
      removed: 0,
      hasDraft: false,
    })
    const deploy = useDeployStore()
    vi.spyOn(deploy, 'open').mockImplementation(() => {})
    vi.spyOn(deploy, 'startDeploy').mockResolvedValue()
    vi.spyOn(deploy, 'reset').mockImplementation(() => {})
    wrappers = []
  })

  afterEach(() => {
    for (const w of wrappers) w.unmount()
    document.body.innerHTML = ''
  })

  function track(w: VueWrapper<unknown>) {
    wrappers.push(w)
    return w
  }

  it('renders "No changes" badge when dirtyCount is 0', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const wrapper = track(mountHeader())
    await flushPromises()
    expect(wrapper.html()).toContain('No changes')
    expect(wrapper.find('[data-testid="header-pending-badge"]').exists()).toBe(false)
  })

  it('renders clickable "Pending changes" badge when dirty; click opens dialog', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: global\n'
    const wrapper = track(mountHeader())
    await flushPromises()
    const badge = wrapper.get('[data-testid="header-pending-badge"]')
    expect(badge.text()).toContain('Pending changes')
    await badge.trigger('click')
    await flushPromises()
    // Dialog content is portaled to document.body — look there for the
    // mocked draftDiff response's "no changes" empty state.
    expect(document.body.innerHTML).toMatch(/No changes|Loading diff/)
  })

  it('during initial load (rawLive=null), dirtyCount=0 so no pending button renders', async () => {
    // dirtyCount short-circuits to 0 when rawLive OR draftText is null
    // (apps/web/src/stores/config.ts:172-176). Header should render the
    // muted "No changes" badge instead of a clickable pending button.
    const store = useConfigStore()
    store.rawLive = null
    store.draftText = 'mode: global\n'
    const wrapper = track(mountHeader())
    await flushPromises()
    expect(wrapper.find('[data-testid="header-pending-badge"]').exists()).toBe(false)
    expect(wrapper.html()).toContain('No changes')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun x vitest run apps/web/tests/header.spec.ts`
Expected: FAIL — `[data-testid="header-pending-badge"]` not present; old `header.changes_count` wiring still active.

- [ ] **Step 4: Update Header.vue**

In `apps/web/src/components/layout/Header.vue`:

1. Add a new import at the top (after the existing `HealthBadge` import):

```ts
import PendingChangesDialog from './PendingChangesDialog.vue'
```

2. Inside `<script setup>`, add dialog state (no extra computed needed — `canApply` already implies `rawLive/draftText` are both non-null thanks to the store's `dirtyCount` definition):

```ts
const pendingOpen = ref(false)
```

3. Replace the existing badge block (around line 129-132 — the `<Badge v-if="canApply" …>` / `<Badge v-else …>`) with:

```vue
<button
  v-if="canApply"
  type="button"
  data-testid="header-pending-badge"
  :title="t('header.pending_tooltip')"
  class="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  @click="pendingOpen = true"
>
  <Badge variant="secondary">{{ t('header.pending_changes') }}</Badge>
</button>
<Badge v-else variant="muted">{{ t('header.no_changes') }}</Badge>
```

Wrapping `<Badge>` inside a `<button>` preserves the Badge component's styling (shadcn conventions) and avoids the "raw button + tailwind classes" divergence. No `v-else-if` branch is needed: `dirtyCount` returns `0` whenever `rawLive` or `draftText` is null, so `canApply` already guards against the load-race case — the muted "No changes" badge renders during initial load as the intended UX.

4. At the bottom of `<template>`, just before the closing `</div>` that wraps the canonicalized-banner, mount the dialog:

```vue
<PendingChangesDialog v-model:open="pendingOpen" />
```

5. Repo-wide sanity check — ensure no stale references to the removed key:

```bash
grep -rn "header\\.changes_count" apps/web/src apps/web/tests
```

Expected: no output. If anything surfaces, fix that call site BEFORE moving on.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun x vitest run apps/web/tests/header.spec.ts`
Expected: all pass.

Run full web suite to ensure no regressions:

Run: `bun x vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/Header.vue \
        apps/web/src/i18n/en.json \
        apps/web/src/i18n/ru.json \
        apps/web/tests/header.spec.ts
git commit -m "feat(ui): make pending-changes badge clickable

Replaces misleading '1 change' pluralised counter with a flag-based
'Pending changes' label. Clicking opens PendingChangesDialog.
Disabled during initial load when rawLive/draftText are still null."
```

---

## Task 8: Delete the placeholder `DiffViewer.vue` and orphan i18n keys

**Goal:** The old `apps/web/src/components/layout/DiffViewer.vue` was a placeholder for an earlier task and has zero call sites after this section lands. Remove it AND the orphan `diff.title` / `diff.placeholder` i18n keys it used.

**Files:**

- Delete: `apps/web/src/components/layout/DiffViewer.vue`
- Modify: `apps/web/src/i18n/en.json` (remove `"diff": { ... }` block)
- Modify: `apps/web/src/i18n/ru.json` (remove `"diff": { ... }` block)

**Acceptance Criteria:**

- [ ] Component file removed.
- [ ] `grep -rn 'DiffViewer' apps/web/src apps/web/tests` returns no matches.
- [ ] `grep -rn "t(['\"]diff\\.(title|placeholder)" apps/web/src` returns no matches.
- [ ] Both locale files no longer contain the top-level `"diff"` block.
- [ ] `bun x vitest run` still passes.

**Verify:** `bun x vitest run` → all pass.

**Steps:**

- [ ] **Step 1: Confirm zero call sites**

Run: `grep -rn 'DiffViewer' apps/web/src apps/web/tests`
Expected: no output (the component was never imported anywhere).

If there are matches, STOP and reclassify — the file isn't dead yet.

- [ ] **Step 2: Delete the component**

```bash
git rm apps/web/src/components/layout/DiffViewer.vue
```

- [ ] **Step 3: Remove orphan i18n keys**

In `apps/web/src/i18n/en.json`, find and delete the top-level block:

```jsonc
"diff": {
  "title": "Diff",
  "placeholder": "Monaco diff viewer arrives in a later task."
},
```

In `apps/web/src/i18n/ru.json`, delete the Russian counterpart:

```jsonc
"diff": {
  "title": "Diff",
  "placeholder": "Monaco-diff появится позже."
},
```

Verify no other component references these keys:

```bash
grep -rn "t(['\"]diff\\.\\(title\\|placeholder\\)" apps/web/src apps/web/tests
```

Expected: no output.

- [ ] **Step 4: Run the suite**

Run: `bun x vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/DiffViewer.vue \
        apps/web/src/i18n/en.json \
        apps/web/src/i18n/ru.json
git commit -m "chore(ui): remove unused DiffViewer placeholder + i18n keys"
```

---

## Section close-out

After all four tasks pass:

- [ ] Run full server test suite: `bun test apps/server`
- [ ] Run full web test suite: `bun x vitest run`
- [ ] Manual: open the UI with a dirty draft. Confirm the header badge says "Pending changes" (no number), opens the modal, the diff is rendered, and the reset button clears the draft back to live.
- [ ] Proceed to Section 1.
