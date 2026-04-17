<script setup lang="ts">
// LogicalRuleTreeBody — the actual tree form without a Dialog shell.
//
// Owns the draft Rule (deep-cloned from `initial`), renders the recursive
// `LogicalRuleNode` tree, and performs cross-tree validation before emitting
// `save`. Extracted from LogicalRuleEditor so component tests can mount the
// form directly without fighting the Radix DialogPortal (portals escape the
// @vue/test-utils wrapper DOM).

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { cloneRule, type LogicalRule, type Rule, type SimpleRule } from 'miharbor-shared'
import { validateRuleValue } from '@/lib/rule-validation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import LogicalRuleNode from './LogicalRuleNode.vue'

interface Props {
  initial?: LogicalRule
  target: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ save: [rule: LogicalRule]; cancel: [] }>()

const { t } = useI18n()

const MAX_DEPTH = 5

function seed(): LogicalRule {
  return {
    kind: 'logical',
    op: 'AND',
    children: [
      {
        kind: 'simple',
        type: 'DOMAIN-SUFFIX',
        value: '',
        target: '',
      },
    ],
    target: props.target,
  }
}

const draft = ref<LogicalRule>(
  props.initial && props.initial.kind === 'logical' ? cloneRule(props.initial) : seed(),
)

watch(
  () => [props.initial, props.target] as const,
  ([next, tgt]) => {
    if (next && next.kind === 'logical') {
      const cloned = cloneRule(next)
      if (!cloned.target) cloned.target = tgt
      draft.value = cloned
    } else {
      const s = seed()
      s.target = tgt
      draft.value = s
    }
  },
  { immediate: false },
)

type TreeProblem =
  | { kind: 'target_empty' }
  | { kind: 'empty_group' }
  | { kind: 'not_children' }
  | { kind: 'simple_invalid' }

function walk(rule: Rule, depth: number, problems: TreeProblem[]): void {
  if (rule.kind === 'simple') {
    const v = validateRuleValue(rule.type, rule.value)
    if (!v.ok) problems.push({ kind: 'simple_invalid' })
    return
  }
  if (rule.kind === 'match') return
  if (rule.op === 'NOT') {
    if (rule.children.length !== 1) problems.push({ kind: 'not_children' })
  } else if (rule.children.length === 0) {
    problems.push({ kind: 'empty_group' })
  }
  for (const c of rule.children) walk(c, depth + 1, problems)
}

const problems = computed<TreeProblem[]>(() => {
  const p: TreeProblem[] = []
  if (!draft.value.target || draft.value.target.trim().length === 0) {
    p.push({ kind: 'target_empty' })
  }
  walk(draft.value, 0, p)
  return p
})

const canSave = computed(() => problems.value.length === 0)

function onSave(): void {
  if (!canSave.value) return
  const normalised = cloneRule(draft.value)
  const strip = (r: Rule, isRoot: boolean): void => {
    if (r.kind === 'logical') {
      r.target = isRoot ? normalised.target : ''
      for (const c of r.children) strip(c, false)
    } else if (r.kind === 'simple') {
      ;(r as SimpleRule).target = ''
    }
  }
  strip(normalised, true)
  emit('save', normalised)
}

// Receives the new tree from the root LogicalRuleNode. The root of our tree
// is always a LogicalRule (MATCH / SimpleRule are edited elsewhere), but
// users editing a broken logical rule could in theory send us a different
// kind — we reject those silently to keep the draft shape stable.
function onRootUpdate(next: Rule): void {
  if (next.kind !== 'logical') return
  draft.value = next
}
</script>

<template>
  <form class="space-y-4" data-testid="logical-rule-editor" @submit.prevent="onSave">
    <div>
      <label class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('rules.tree.target_label') }}
      </label>
      <Input
        v-model="draft.target"
        class="h-9"
        :placeholder="t('rules.tree.target_label')"
        data-testid="tree-target-input"
      />
    </div>

    <div class="max-h-[56vh] overflow-y-auto pr-1" data-testid="tree-root">
      <LogicalRuleNode
        :rule="draft"
        :depth="0"
        :max-depth="MAX_DEPTH"
        :can-remove="false"
        :sibling-index="0"
        :sibling-count="1"
        @update:rule="onRootUpdate"
      />
    </div>

    <p v-if="!canSave" class="text-xs text-destructive" role="alert" data-testid="tree-invalid">
      {{ t('rules.tree.invalid_tree') }}
    </p>

    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" type="button" @click="emit('cancel')">
        {{ t('rules.cancel') }}
      </Button>
      <Button type="submit" size="sm" :disabled="!canSave" data-testid="tree-save-btn">
        {{ t('rules.save') }}
      </Button>
    </div>
  </form>
</template>
