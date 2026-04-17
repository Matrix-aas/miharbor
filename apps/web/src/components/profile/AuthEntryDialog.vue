<script setup lang="ts">
// AuthEntryDialog — add or edit a single `authentication:` row. Passwords are
// ONLY ever collected through this dialog; they're never surfaced back after
// save (the list view shows usernames only — see Profile.vue invariants).
//
// `mode: 'add'` — empty form, both fields required.
// `mode: 'edit'` — username pre-filled (read-only by default — renaming a
// user would lose the association and is surprising; the operator should
// delete + re-add). Password field is empty and any submitted value REPLACES
// the stored password.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import GuardrailPlate from '@/components/ui/GuardrailPlate.vue'

interface Props {
  open: boolean
  /** 'add' for new entries, 'edit' for editing an existing user's password. */
  mode: 'add' | 'edit'
  /** Username shown when editing (locked) or pre-filled when adding. */
  initialUser?: string
  /** Existing usernames — used for duplicate-check in add mode. */
  existingUsers: string[]
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [v: boolean]
  save: [input: { user: string; password: string }]
}>()

const { t } = useI18n()

const user = ref('')
const password = ref('')

watch(
  () => props.open,
  (v) => {
    if (v) {
      user.value = props.initialUser ?? ''
      password.value = ''
    } else {
      // Clear the password when the dialog closes so it doesn't linger in
      // memory any longer than needed.
      password.value = ''
    }
  },
  { immediate: true },
)

const isDuplicate = computed(() => {
  if (props.mode !== 'add') return false
  return props.existingUsers.includes(user.value.trim())
})

const canSave = computed(() => {
  if (user.value.trim().length === 0) return false
  if (password.value.length === 0) return false
  if (isDuplicate.value) return false
  // username cannot contain ':' (it's the delimiter in "user:pass").
  if (user.value.includes(':')) return false
  return true
})

function onSubmit(): void {
  if (!canSave.value) return
  emit('save', { user: user.value.trim(), password: password.value })
  password.value = ''
  emit('update:open', false)
}

function onClose(): void {
  password.value = ''
  emit('update:open', false)
}
</script>

<template>
  <Dialog
    :open="props.open"
    @update:open="(v: boolean) => (v ? emit('update:open', true) : onClose())"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === 'add'
              ? t('pages.profile.auth.dialog_add_title')
              : t('pages.profile.auth.dialog_edit_title')
          }}
        </DialogTitle>
        <DialogDescription>
          {{ t('pages.profile.auth.dialog_description') }}
        </DialogDescription>
      </DialogHeader>

      <GuardrailPlate
        :message="t('pages.profile.auth.dialog_guardrail')"
        data-testid="auth-dialog-guardrail"
      />

      <form class="space-y-3" @submit.prevent="onSubmit">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted-foreground" for="auth-user">
            {{ t('pages.profile.auth.user_label') }}
          </label>
          <Input
            id="auth-user"
            v-model="user"
            :placeholder="t('pages.profile.auth.user_placeholder')"
            class="h-9"
            :disabled="mode === 'edit'"
            :aria-label="t('pages.profile.auth.user_label')"
            data-testid="auth-user-input"
            autocomplete="off"
          />
          <p v-if="user.includes(':')" class="mt-1 text-xs text-destructive">
            {{ t('pages.profile.auth.user_colon_invalid') }}
          </p>
          <p v-else-if="isDuplicate" class="mt-1 text-xs text-destructive">
            {{ t('pages.profile.auth.user_taken') }}
          </p>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-muted-foreground" for="auth-password">
            {{ t('pages.profile.auth.password_label') }}
          </label>
          <Input
            id="auth-password"
            v-model="password"
            type="password"
            :placeholder="t('pages.profile.auth.password_placeholder')"
            class="h-9"
            :aria-label="t('pages.profile.auth.password_label')"
            data-testid="auth-password-input"
            autocomplete="new-password"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" type="button" @click="onClose">
            {{ t('common.cancel') }}
          </Button>
          <Button type="submit" size="sm" :disabled="!canSave" data-testid="auth-save">
            {{ t('common.save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
