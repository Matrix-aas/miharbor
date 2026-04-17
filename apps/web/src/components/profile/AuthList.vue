<script setup lang="ts">
// AuthList — renders mihomo's `authentication:` entries as
// [{ user, hasPassword }] rows. Usernames are visible; passwords are NEVER
// shown (security invariant: after a password is written to YAML the UI must
// not echo it back). Add / edit flows go through AuthEntryDialog.
//
// Semantics:
//   * `modelValue` is the raw `string[]` of "user:pass" entries (the YAML
//     shape). Parent owns it; we emit `update:modelValue` on every change.
//   * Internally we parse each entry to surface the user + hasPassword
//     indicator. The raw entries stay the source of truth so edits are
//     non-destructive on fields we don't expose.

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-vue-next'
import { parseAuthEntry, serialiseAuthEntry } from 'miharbor-shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import AuthEntryDialog from './AuthEntryDialog.vue'

interface Props {
  modelValue: string[]
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()

const { t } = useI18n()

interface Row {
  user: string
  hasPassword: boolean
}

const rows = computed<Row[]>(() =>
  props.modelValue.map((e) => {
    const { user, hasPassword } = parseAuthEntry(e)
    return { user, hasPassword }
  }),
)

const existingUsers = computed<string[]>(() => rows.value.map((r) => r.user))

const dialogOpen = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const dialogInitialUser = ref<string | undefined>(undefined)
const editingIndex = ref<number | null>(null)

function openAdd(): void {
  dialogMode.value = 'add'
  dialogInitialUser.value = undefined
  editingIndex.value = null
  dialogOpen.value = true
}

function openEdit(index: number): void {
  const r = rows.value[index]
  if (!r) return
  dialogMode.value = 'edit'
  dialogInitialUser.value = r.user
  editingIndex.value = index
  dialogOpen.value = true
}

function onSave(input: { user: string; password: string }): void {
  const next = [...props.modelValue]
  const entry = serialiseAuthEntry(input.user, input.password)
  if (dialogMode.value === 'add') {
    next.push(entry)
  } else if (editingIndex.value !== null) {
    next[editingIndex.value] = entry
  }
  emit('update:modelValue', next)
}

function removeAt(index: number): void {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="space-y-2" role="group" :aria-label="t('pages.profile.auth.list_aria')">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="flex items-center gap-2"
      data-testid="auth-row"
    >
      <div class="flex-1 min-w-0 truncate font-mono text-sm" data-testid="auth-user-cell">
        {{ row.user || '—' }}
      </div>
      <Badge
        v-if="row.hasPassword"
        variant="secondary"
        class="shrink-0"
        data-testid="auth-password-badge"
      >
        {{ t('pages.profile.auth.has_password') }}
      </Badge>
      <span
        v-else
        class="inline-flex shrink-0 items-center gap-1 text-xs text-amber-500"
        data-testid="auth-no-password"
      >
        <AlertTriangle class="h-3 w-3" aria-hidden="true" />
        {{ t('pages.profile.auth.no_password') }}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('pages.profile.auth.edit_aria', { user: row.user })"
        data-testid="auth-edit"
        @click="openEdit(index)"
      >
        <Pencil class="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('pages.profile.auth.remove_aria', { user: row.user })"
        data-testid="auth-remove"
        @click="removeAt(index)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
    <p v-if="rows.length === 0" class="text-xs text-muted-foreground">
      {{ t('pages.profile.auth.empty') }}
    </p>
    <Button type="button" variant="outline" size="sm" data-testid="auth-add" @click="openAdd">
      <Plus class="h-4 w-4" />
      {{ t('pages.profile.auth.add') }}
    </Button>

    <AuthEntryDialog
      :open="dialogOpen"
      :mode="dialogMode"
      :initial-user="dialogInitialUser"
      :existing-users="dialogMode === 'add' ? existingUsers : []"
      @update:open="(v: boolean) => (dialogOpen = v)"
      @save="onSave"
    />
  </div>
</template>
