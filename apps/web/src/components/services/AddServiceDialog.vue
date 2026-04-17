<script setup lang="ts">
// AddServiceDialog — lightweight "create a proxy-group" wizard.
//
// The dialog emits the form result so the store can `createNewService(...)`
// and PUT the updated draft. As of Task 42 the dialog also surfaces a
// fuzzy-matched list of service templates (Spotify / YouTube / …) below the
// name field. Clicking a template fills the name + stages a pre-filled set
// of rules that the parent inserts right after group creation.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ServiceMatch, SimpleRule } from 'miharbor-shared'
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
import TemplateSuggester from '@/components/services/TemplateSuggester.vue'

interface Props {
  open: boolean
  /** Existing group names — used for unique-name validation. */
  existingNames: string[]
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [v: boolean]
  create: [
    input: {
      name: string
      direction: 'VPN' | 'DIRECT' | 'REJECT'
      /** Template rules to insert after the group is created. Empty if the
       *  user didn't pick a template. */
      rules: SimpleRule[]
    },
  ]
}>()

const { t } = useI18n()

const name = ref('')
const direction = ref<'VPN' | 'DIRECT' | 'REJECT'>('VPN')

/** When the user picks a template pill, we stash its rules here so they ride
 *  along with the final emit. A manual edit to the name clears the staged
 *  rules to keep the UX obvious — if the user retypes, they're off-script. */
const pendingRules = ref<SimpleRule[]>([])
const pickedTemplateId = ref<string | null>(null)

// Reset fields whenever the dialog reopens so stale drafts don't leak across
// invocations.
watch(
  () => props.open,
  (v) => {
    if (v) {
      name.value = ''
      direction.value = 'VPN'
      pendingRules.value = []
      pickedTemplateId.value = null
    }
  },
)

// Guard flag so `onTemplatePick` can write `name.value` without the watcher
// immediately clearing the staged rules.
let suppressNameWatch = false

watch(name, () => {
  // If the user keeps typing after picking a template, drop the staged rules.
  // Keeping them behind a name the user now owns would be a footgun.
  if (suppressNameWatch) {
    suppressNameWatch = false
    return
  }
  if (pickedTemplateId.value !== null) {
    pendingRules.value = []
    pickedTemplateId.value = null
  }
})

const NAME_RE = /^[A-Za-z0-9_\- .А-Яа-яЁё]+$/
const isTaken = computed(() => props.existingNames.includes(name.value.trim()))
const isValidName = computed(() => NAME_RE.test(name.value.trim()))
const canCreate = computed(
  () => name.value.trim().length > 0 && !isTaken.value && isValidName.value,
)

function onTemplatePick(match: ServiceMatch): void {
  suppressNameWatch = true
  name.value = match.name
  pickedTemplateId.value = match.id
  // Convert ServiceMatch rules into SimpleRule wire format. The target is
  // filled in at insert time by the store (`addRuleToService` overwrites it).
  pendingRules.value = match.rules.map<SimpleRule>((r) => ({
    kind: 'simple',
    type: r.type as SimpleRule['type'],
    value: r.value,
    target: match.name,
  }))
}

function onSubmit(): void {
  if (!canCreate.value) return
  emit('create', {
    name: name.value.trim(),
    direction: direction.value,
    rules: pendingRules.value.slice(),
  })
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('services.add_dialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('services.add_dialog.direction_label') }}</DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted-foreground">
            {{ t('services.add_dialog.name_label') }}
          </label>
          <Input
            v-model="name"
            :placeholder="t('services.add_dialog.name_placeholder')"
            class="h-9"
            data-testid="add-service-name"
          />
          <p v-if="name.length > 0 && !isValidName" class="mt-1 text-xs text-destructive">
            {{ t('services.add_dialog.name_invalid') }}
          </p>
          <p v-else-if="isTaken" class="mt-1 text-xs text-destructive">
            {{ t('services.add_dialog.name_taken') }}
          </p>

          <TemplateSuggester :query="name" @select="onTemplatePick" />

          <p
            v-if="pickedTemplateId && pendingRules.length > 0"
            class="mt-2 text-xs text-muted-foreground"
            data-testid="template-picked-note"
          >
            {{
              t(
                'services.templates.picked_note',
                { count: pendingRules.length },
                pendingRules.length,
              )
            }}
          </p>
        </div>

        <div>
          <p class="mb-1 block text-xs font-medium text-muted-foreground">
            {{ t('services.add_dialog.direction_label') }}
          </p>
          <div class="flex gap-2">
            <Button
              v-for="d in ['VPN', 'DIRECT', 'REJECT'] as const"
              :key="d"
              type="button"
              size="sm"
              :variant="direction === d ? 'default' : 'outline'"
              @click="direction = d"
            >
              {{ t('services.direction_' + d.toLowerCase()) }}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" type="button" @click="emit('update:open', false)">
            {{ t('common.cancel') }}
          </Button>
          <Button type="submit" size="sm" :disabled="!canCreate">
            {{ t('services.add_dialog.create') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
