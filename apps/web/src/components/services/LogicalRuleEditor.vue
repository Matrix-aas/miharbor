<script setup lang="ts">
// LogicalRuleEditor — modal-hosted tree editor for mihomo's AND / OR / NOT
// rules. Stage 1 surfaced complex rules as read-only with an "edit in Raw
// YAML" hint; this component delivers the tree UI that replaces it.
//
// Flow:
//   * Parent supplies `initial: LogicalRule` (or undefined to open in
//     creation mode — we seed with a blank `AND` group containing one empty
//     DOMAIN-SUFFIX condition).
//   * Parent also supplies `target` — the resolved proxy-group name for the
//     rule. The operator can override it via the "Target" input at the top
//     of the dialog (rare, but some flows — renaming a rule's group —
//     require it).
//   * We deep-clone the initial tree so keystrokes on the draft don't
//     ripple back into the store's parsed rule list.
//   * `save` emits the edited `LogicalRule` (with target populated). The
//     parent routes it through `configStore.replaceRuleAt(index, rule)`.
//
// Layout split: this shell wraps `LogicalRuleTreeBody` in a modal Dialog.
// The inner component is exported separately so unit tests can mount it
// without the Radix portal (which teleports outside the @vue/test-utils
// wrapper and breaks DOM-query assertions).
//
// Acceptance criterion #2 of Task 40 allows "either DnD OR up/down buttons,
// pick the simpler one if DnD adds a heavy dep" — we ship up/down to avoid a
// runtime dep on vuedraggable/sortablejs.

import type { LogicalRule } from 'miharbor-shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import LogicalRuleTreeBody from './LogicalRuleTreeBody.vue'
import { useI18n } from 'vue-i18n'

interface Props {
  open: boolean
  /** Pre-existing tree for edit mode; undefined for "create from scratch". */
  initial?: LogicalRule
  /** Default proxy-group name (inherited from the service the rule belongs to). */
  target: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [v: boolean]
  save: [rule: LogicalRule]
}>()

const { t } = useI18n()

function onSave(rule: LogicalRule): void {
  emit('save', rule)
  emit('update:open', false)
}

function onCancel(): void {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('rules.tree.title') }}</DialogTitle>
        <DialogDescription>{{ t('rules.tree.description') }}</DialogDescription>
      </DialogHeader>

      <LogicalRuleTreeBody
        v-if="props.open"
        :initial="props.initial"
        :target="props.target"
        @save="onSave"
        @cancel="onCancel"
      />
    </DialogContent>
  </Dialog>
</template>
