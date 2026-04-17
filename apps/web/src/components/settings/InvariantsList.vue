<script setup lang="ts">
// User invariants card — Task 41.
//
// Lists the operator's custom lint rules (loaded from /api/invariants) and
// lets them add / edit / toggle-active / delete. PUT sends the full list
// back to the server on each save so the server persists atomically.
//
// The GuardrailPlate on the active toggle appears when the operator flips
// any invariant to inactive — it's the runbook-standard "disabling a safety
// check kills the safety" advisory.

import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldCheck, Plus, Pencil, Trash2, Loader2, Save, ShieldAlert } from 'lucide-vue-next'
import type { UserInvariant } from 'miharbor-shared'
import { Button } from '@/components/ui/button'
import GuardrailPlate from '@/components/ui/GuardrailPlate.vue'
import InvariantEditForm from '@/components/settings/InvariantEditForm.vue'
import { endpoints, ApiError } from '@/api/client'

const { t } = useI18n()

const invariants = ref<UserInvariant[]>([])
const loadError = ref<string | null>(null)
const parseErrorsCount = ref(0)
const saveStatus = ref<'idle' | 'saving' | 'ok' | 'error'>('idle')
const saveErrorMsg = ref<string | null>(null)
const editingIdx = ref<number | null>(null)
const creating = ref(false)

const hasAnyInactive = computed(() => invariants.value.some((i) => i.active === false))

async function load(): Promise<void> {
  loadError.value = null
  try {
    const res = await endpoints.invariants.list()
    invariants.value = res.invariants
    parseErrorsCount.value = res.errors?.length ?? 0
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(load)

async function persist(list: UserInvariant[]): Promise<boolean> {
  saveStatus.value = 'saving'
  saveErrorMsg.value = null
  try {
    const res = await endpoints.invariants.put(list)
    invariants.value = res.invariants
    saveStatus.value = 'ok'
    return true
  } catch (e) {
    saveStatus.value = 'error'
    if (e instanceof ApiError) {
      saveErrorMsg.value = e.body?.errors?.[0]?.message ?? e.message
    } else {
      saveErrorMsg.value = (e as Error).message
    }
    return false
  }
}

function startCreate(): void {
  creating.value = true
  editingIdx.value = null
}

function startEdit(index: number): void {
  editingIdx.value = index
  creating.value = false
}

function cancelEdit(): void {
  editingIdx.value = null
  creating.value = false
}

async function saveEntry(entry: UserInvariant): Promise<void> {
  const list = invariants.value.slice()
  if (creating.value) {
    list.push(entry)
  } else if (editingIdx.value !== null) {
    list[editingIdx.value] = entry
  }
  const ok = await persist(list)
  if (ok) {
    creating.value = false
    editingIdx.value = null
  }
}

async function deleteEntry(index: number): Promise<void> {
  const list = invariants.value.slice()
  list.splice(index, 1)
  await persist(list)
}

async function toggleActive(index: number): Promise<void> {
  const list = invariants.value.slice()
  const current = list[index]
  if (!current) return
  // Default is active=true; we write an explicit boolean so the YAML file
  // stays self-describing.
  const nextActive = !(current.active !== false)
  list[index] = { ...current, active: nextActive }
  await persist(list)
}

const existingIds = computed(() =>
  invariants.value
    .map((i, idx) => ({ id: i.id, idx }))
    .filter((x) => x.idx !== editingIdx.value)
    .map((x) => x.id),
)
</script>

<template>
  <section
    class="space-y-4 rounded-md border border-border bg-card/30 p-5"
    data-testid="invariants-card"
  >
    <header class="flex items-center gap-2">
      <ShieldCheck class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-lg font-semibold">{{ t('settings.invariants_title') }}</h2>
    </header>
    <p class="text-xs text-muted-foreground">
      {{ t('settings.invariants_subtitle', { path: 'invariants.yaml' }) }}
    </p>

    <p v-if="loadError" class="flex items-center gap-1.5 text-xs text-destructive">
      <ShieldAlert class="h-4 w-4" />
      {{ t('settings.invariants_load_failed', { error: loadError }) }}
    </p>

    <p v-if="parseErrorsCount > 0" class="text-xs text-amber-500">
      {{ t('settings.invariants_parse_errors', parseErrorsCount) }}
    </p>

    <GuardrailPlate
      v-if="hasAnyInactive"
      :message="t('settings.invariants_active_guardrail')"
      data-testid="invariants-active-guardrail"
    />

    <ul
      v-if="invariants.length > 0"
      class="space-y-2"
      :aria-label="t('settings.invariants_title')"
      data-testid="invariants-list"
    >
      <li
        v-for="(inv, idx) in invariants"
        :key="inv.id"
        class="flex items-start justify-between gap-3 rounded border border-border bg-background px-3 py-2"
        :data-testid="`invariant-${inv.id}`"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <code class="text-xs text-muted-foreground">{{ inv.id }}</code>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
              :class="{
                'bg-destructive/20 text-destructive': (inv.level ?? 'warning') === 'error',
                'bg-amber-500/20 text-amber-600 dark:text-amber-400':
                  (inv.level ?? 'warning') === 'warning',
                'bg-muted text-muted-foreground': (inv.level ?? 'warning') === 'info',
              }"
            >
              {{ inv.level ?? 'warning' }}
            </span>
          </div>
          <p class="truncate text-sm font-medium">{{ inv.name }}</p>
          <p v-if="inv.description" class="mt-0.5 text-xs text-muted-foreground">
            {{ inv.description }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <label class="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              :checked="inv.active !== false"
              :aria-label="t('settings.invariants_active_label')"
              :data-testid="`invariant-active-${inv.id}`"
              @change="toggleActive(idx)"
            />
            {{ t('settings.invariants_active_label') }}
          </label>
          <Button
            variant="ghost"
            size="icon"
            :aria-label="t('settings.invariants_edit_aria', { id: inv.id })"
            :data-testid="`invariant-edit-${inv.id}`"
            @click="startEdit(idx)"
          >
            <Pencil class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            :aria-label="t('settings.invariants_delete_aria', { id: inv.id })"
            :data-testid="`invariant-delete-${inv.id}`"
            @click="deleteEntry(idx)"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
      </li>
    </ul>
    <p v-else class="text-xs text-muted-foreground" data-testid="invariants-empty">
      {{ t('settings.invariants_empty') }}
    </p>

    <div class="flex items-center gap-3">
      <Button
        v-if="!creating && editingIdx === null"
        variant="outline"
        data-testid="invariants-add"
        @click="startCreate"
      >
        <Plus class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.invariants_add') }}
      </Button>
      <p
        v-if="saveStatus === 'saving'"
        class="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        {{ t('common.loading') }}
      </p>
      <p
        v-else-if="saveStatus === 'ok'"
        class="flex items-center gap-1.5 text-xs text-emerald-500"
        data-testid="invariants-saved"
      >
        <Save class="h-3.5 w-3.5" />
        {{ t('settings.invariants_saved') }}
      </p>
      <p
        v-else-if="saveStatus === 'error'"
        class="flex items-center gap-1.5 text-xs text-destructive"
        data-testid="invariants-save-error"
      >
        <ShieldAlert class="h-3.5 w-3.5" />
        {{ t('settings.invariants_save_failed', { error: saveErrorMsg ?? '' }) }}
      </p>
    </div>

    <InvariantEditForm
      v-if="creating"
      :existing-ids="existingIds"
      data-testid="invariants-form-create"
      @save="saveEntry"
      @cancel="cancelEdit"
    />
    <InvariantEditForm
      v-else-if="editingIdx !== null"
      :invariant="invariants[editingIdx]"
      :existing-ids="existingIds"
      data-testid="invariants-form-edit"
      @save="saveEntry"
      @cancel="cancelEdit"
    />
  </section>
</template>
