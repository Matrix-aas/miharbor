<script setup lang="ts">
// ServiceDetail — right pane of the master-detail Services screen.
//
// Responsibilities:
//   * Header with service name, live-direction chip, delete button.
//   * Direction switcher — VPN / DIRECT / REJECT. Reads live state from
//     `configStore.liveProxyState` when available; falls back to
//     `group.proxies[0]` with a "live state unknown" badge.
//   * Rules list (RuleRow) with inline RuleEditor for add/edit flows.
//   * Confirm dialog for "delete service" (counts related rules).

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Plus, Trash2 } from 'lucide-vue-next'
import type { Rule, Service, SimpleRule } from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import RuleRow from './RuleRow.vue'
import RuleEditor from './RuleEditor.vue'
import ConfirmDialog from './ConfirmDialog.vue'

interface Props {
  service: Service
  /** Map of groupName → runtime `now` reported by mihomo. Empty when mihomo
   *  is unreachable; the detail view renders a warning badge in that case. */
  liveState: Record<string, string>
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'change-direction': [name: string, direction: 'VPN' | 'DIRECT' | 'REJECT']
  'add-rule': [serviceName: string, rule: SimpleRule]
  'replace-rule': [index: number, rule: SimpleRule]
  'remove-rule': [index: number]
  'delete-service': [name: string]
}>()

const { t } = useI18n()

const editorOpenIndex = ref<number | null>(null)
const adderOpen = ref<boolean>(false)
const deleteOpen = ref<boolean>(false)

const effectiveDirection = computed<'VPN' | 'DIRECT' | 'REJECT' | 'MIXED'>(() => {
  const live = props.liveState[props.service.name]
  if (live === 'DIRECT') return 'DIRECT'
  if (live === 'REJECT') return 'REJECT'
  if (live) return 'VPN'
  return props.service.direction
})

const isLiveKnown = computed(() => Boolean(props.liveState[props.service.name]))
const isSelectType = computed(() => props.service.group.type === 'select')

function directionVariant(): 'default' | 'secondary' | 'destructive' | 'muted' {
  if (effectiveDirection.value === 'VPN') return 'default'
  if (effectiveDirection.value === 'DIRECT') return 'secondary'
  if (effectiveDirection.value === 'REJECT') return 'destructive'
  return 'muted'
}

function onDirection(d: 'VPN' | 'DIRECT' | 'REJECT'): void {
  emit('change-direction', props.service.name, d)
}

function startEdit(index: number): void {
  adderOpen.value = false
  editorOpenIndex.value = index
}

function cancelEdit(): void {
  editorOpenIndex.value = null
  adderOpen.value = false
}

function onSaveNew(rule: SimpleRule): void {
  emit('add-rule', props.service.name, rule)
  adderOpen.value = false
}

function onSaveEdit(rule: SimpleRule): void {
  if (editorOpenIndex.value === null) return
  // Find the global index of this rule from service.rules[i].index.
  const localIdx = props.service.rules.findIndex((r) => r.index === editorOpenIndex.value)
  if (localIdx < 0) {
    editorOpenIndex.value = null
    return
  }
  emit('replace-rule', editorOpenIndex.value, rule)
  editorOpenIndex.value = null
}

function initialForEdit(index: number | null): SimpleRule | undefined {
  if (index === null) return undefined
  const match = props.service.rules.find((r) => r.index === index)
  if (!match || match.rule.kind !== 'simple') return undefined
  return match.rule
}

function removeRule(index: number): void {
  emit('remove-rule', index)
}

function askDelete(): void {
  deleteOpen.value = true
}

function confirmDelete(): void {
  emit('delete-service', props.service.name)
}

const relatedCount = computed(() => props.service.rules.length)

function bodyForDelete(): string {
  const count = relatedCount.value
  if (count === 0) return t('services.delete_confirm_body_none')
  return t('services.delete_confirm_body', { count }, count)
}

const editorTargetIndex = computed<number | null>(() => editorOpenIndex.value)

// A helper used by the template for keying the list — consistent across
// edits so Vue doesn't remount RuleRow unnecessarily.
function ruleKey(pair: { index: number; rule: Rule }): string {
  return `${pair.index}`
}
</script>

<template>
  <section class="flex h-full w-full flex-col" data-testid="service-detail">
    <header class="flex items-center gap-3 border-b border-border px-4 py-3">
      <h2 class="truncate text-lg font-semibold">{{ service.name }}</h2>
      <Badge :variant="directionVariant()">{{ effectiveDirection }}</Badge>
      <Badge
        v-if="!isLiveKnown"
        variant="muted"
        class="text-[10px]"
        :title="t('services.live_state_unknown')"
      >
        <AlertTriangle class="mr-1 h-3 w-3" />
        {{ t('services.live_state_unknown') }}
      </Badge>
      <div class="ml-auto">
        <Button variant="destructive" size="sm" @click="askDelete">
          <Trash2 class="h-4 w-4" />
          {{ t('services.delete_service') }}
        </Button>
      </div>
    </header>

    <div class="border-b border-border px-4 py-3">
      <p class="mb-2 text-xs font-medium uppercase text-muted-foreground">
        {{ t('services.direction_label') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="d in ['VPN', 'DIRECT', 'REJECT'] as const"
          :key="d"
          size="sm"
          :variant="effectiveDirection === d ? 'default' : 'outline'"
          :disabled="!isSelectType"
          @click="onDirection(d)"
        >
          {{ t('services.direction_' + d.toLowerCase()) }}
        </Button>
      </div>
      <p v-if="!isSelectType" class="mt-2 text-xs text-muted-foreground">
        {{ t('services.direction_not_select') }}
      </p>
    </div>

    <div class="flex-1 space-y-2 overflow-y-auto p-4" data-testid="rules-list">
      <div v-if="service.rules.length === 0 && !adderOpen" class="text-sm text-muted-foreground">
        {{ t('services.no_rules') }}
      </div>

      <template v-for="pair in service.rules" :key="ruleKey(pair)">
        <RuleEditor
          v-if="editorTargetIndex === pair.index && pair.rule.kind === 'simple'"
          :target="service.name"
          :initial="initialForEdit(pair.index)"
          @save="onSaveEdit"
          @cancel="cancelEdit"
        />
        <RuleRow
          v-else
          :rule="pair.rule"
          :index="pair.index"
          @edit="startEdit"
          @delete="removeRule"
        />
      </template>

      <RuleEditor v-if="adderOpen" :target="service.name" @save="onSaveNew" @cancel="cancelEdit" />

      <Button
        v-if="!adderOpen"
        variant="outline"
        size="sm"
        class="w-full"
        data-testid="add-rule-btn"
        @click="
          adderOpen = true
          editorOpenIndex = null
        "
      >
        <Plus class="h-4 w-4" />
        {{ t('services.add_rule') }}
      </Button>
    </div>

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('services.delete_confirm_title', { name: service.name })"
      :body="bodyForDelete()"
      :confirm-label="t('common.delete')"
      @confirm="confirmDelete"
    />
  </section>
</template>
