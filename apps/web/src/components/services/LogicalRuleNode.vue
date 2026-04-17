<script setup lang="ts">
// LogicalRuleNode — the recursive building block of the logical-rule tree.
//
// Each instance renders either:
//   * a LogicalRule (AND/OR/NOT) — a bordered group with operator badge, a
//     list of children (recursively rendered by `<LogicalRuleNode>`), a
//     remove button for this node, and "add child" actions (condition /
//     AND / OR / NOT).
//   * a SimpleRule — a compact row with TYPE selector + value input + up /
//     down / remove controls.
//
// State ownership: we do NOT mutate the `rule` prop. Instead we emit
// `update:rule` with the new Rule whenever the subtree changes — v-model
// pattern. The top-level LogicalRuleTreeBody owns the reactive tree and
// re-assigns its `.value` as edits bubble up. This keeps `vue/no-mutating-props`
// happy and keeps the recursive contract trivial.
//
// Structural events:
//   * `remove`              — parent should splice this node out.
//   * `move: 'up' | 'down'` — parent reorders among siblings.
//
// Depth is passed as a prop so we can paint nesting and gate the "add group"
// buttons at the runbook's hard limit of 5.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2, ArrowUp, ArrowDown, Plus } from 'lucide-vue-next'
import {
  type LogicalOp,
  type LogicalRule,
  type Rule,
  type SimpleRule,
  type SimpleRuleType,
  SIMPLE_RULE_TYPES,
} from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { validateRuleValue } from '@/lib/rule-validation'
// Self-import (Vue supports this for recursive SFCs — the import resolves to
// the compiled module after the parent file finishes evaluating).
import LogicalRuleNode from './LogicalRuleNode.vue'

interface Props {
  rule: Rule
  depth: number
  /** Max nesting depth, counted from the top-level LogicalRule at depth 0. */
  maxDepth: number
  /** Can this node be moved/removed? Top-level root of the tree always stays. */
  canRemove: boolean
  /** Position info for aria-labels + up/down availability. */
  siblingIndex: number
  siblingCount: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:rule': [rule: Rule]
  remove: []
  move: [direction: 'up' | 'down']
}>()

const { t } = useI18n()

const isLogical = computed(() => props.rule.kind === 'logical')
const isSimple = computed(() => props.rule.kind === 'simple')
const atMaxDepth = computed(() => props.depth >= props.maxDepth)

// --- SimpleRule branch -----------------------------------------------------

const simpleValidation = computed(() => {
  if (props.rule.kind !== 'simple') return { ok: true as const }
  return validateRuleValue(props.rule.type, props.rule.value)
})

const simpleValidationMessageKey = computed(() => {
  const v = simpleValidation.value
  return v.ok ? '' : v.messageKey
})

const simpleTypeModel = computed<SimpleRuleType | ''>(() =>
  props.rule.kind === 'simple' ? props.rule.type : '',
)
const simpleValueModel = computed<string>(() =>
  props.rule.kind === 'simple' ? props.rule.value : '',
)

function onSimpleTypeChange(e: Event): void {
  if (props.rule.kind !== 'simple') return
  const next = (e.target as HTMLSelectElement).value as SimpleRuleType
  const updated: SimpleRule = { ...props.rule, type: next }
  emit('update:rule', updated)
}

function onSimpleValueInput(next: string | number): void {
  if (props.rule.kind !== 'simple') return
  const updated: SimpleRule = { ...props.rule, value: String(next) }
  emit('update:rule', updated)
}

// --- LogicalRule branch ----------------------------------------------------

function opBadgeVariant(op: LogicalOp): 'default' | 'secondary' | 'destructive' {
  if (op === 'AND') return 'default'
  if (op === 'OR') return 'secondary'
  return 'destructive' // NOT
}

function emitChildrenUpdate(children: Rule[]): void {
  if (props.rule.kind !== 'logical') return
  const updated: LogicalRule = { ...props.rule, children }
  emit('update:rule', updated)
}

function addChild(kind: 'condition' | 'AND' | 'OR' | 'NOT'): void {
  if (props.rule.kind !== 'logical') return
  // Respect NOT unary constraint: only allow one child.
  if (props.rule.op === 'NOT' && props.rule.children.length >= 1) return
  if (kind === 'condition') {
    const next: Rule[] = [
      ...props.rule.children,
      { kind: 'simple', type: 'DOMAIN-SUFFIX', value: '', target: '' },
    ]
    emitChildrenUpdate(next)
    return
  }
  // Block deeper logical groups at depth limit.
  if (atMaxDepth.value) return
  const op: LogicalOp = kind
  const seed: Rule[] = [{ kind: 'simple', type: 'DOMAIN-SUFFIX', value: '', target: '' }]
  const newNode: LogicalRule = { kind: 'logical', op, children: seed, target: '' }
  emitChildrenUpdate([...props.rule.children, newNode])
}

function removeChild(childIdx: number): void {
  if (props.rule.kind !== 'logical') return
  const next = props.rule.children.slice()
  next.splice(childIdx, 1)
  emitChildrenUpdate(next)
}

function moveChild(childIdx: number, direction: 'up' | 'down'): void {
  if (props.rule.kind !== 'logical') return
  const delta = direction === 'up' ? -1 : 1
  const target = childIdx + delta
  if (target < 0 || target >= props.rule.children.length) return
  const next = props.rule.children.slice()
  const moved = next.splice(childIdx, 1)[0]
  if (moved !== undefined) next.splice(target, 0, moved)
  emitChildrenUpdate(next)
}

function onChildUpdate(childIdx: number, child: Rule): void {
  if (props.rule.kind !== 'logical') return
  const next = props.rule.children.slice()
  next[childIdx] = child
  emitChildrenUpdate(next)
}

const canMoveUp = computed(() => props.canRemove && props.siblingIndex > 0)
const canMoveDown = computed(() => props.canRemove && props.siblingIndex < props.siblingCount - 1)

/** aria-label copy for group nodes — includes op + child count. */
const groupAria = computed(() => {
  if (props.rule.kind !== 'logical') return ''
  return t(
    'rules.tree.group_label',
    { op: props.rule.op, count: props.rule.children.length },
    props.rule.children.length,
  )
})

// NOT groups: exactly one child. We surface a visible warning when that
// invariant is violated so the operator doesn't save a broken rule. Empty
// AND/OR is also flagged — mihomo would accept the string but the semantics
// are meaningless.
const groupProblem = computed<string | null>(() => {
  if (props.rule.kind !== 'logical') return null
  const c = props.rule.children.length
  if (props.rule.op === 'NOT') {
    if (c === 0) return t('rules.tree.empty_not_child')
    if (c > 1) return t('rules.tree.too_many_not_children')
  } else if (c === 0) {
    return t('rules.tree.empty_group')
  }
  return null
})
</script>

<template>
  <!-- Logical group branch -->
  <div
    v-if="isLogical && rule.kind === 'logical'"
    class="rounded-md border border-border/60 bg-card/40 p-3"
    role="group"
    :aria-label="groupAria"
    data-testid="logical-rule-node"
  >
    <div class="flex items-center gap-2">
      <Badge :variant="opBadgeVariant(rule.op)" class="shrink-0 font-mono text-[11px]">
        {{ rule.op }}
      </Badge>
      <span class="text-xs text-muted-foreground">
        {{
          t(
            'rules.tree.group_label',
            { op: rule.op, count: rule.children.length },
            rule.children.length,
          )
        }}
      </span>
      <div class="ml-auto flex items-center gap-1">
        <Button
          v-if="canMoveUp"
          type="button"
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :aria-label="t('rules.tree.move_up')"
          @click="emit('move', 'up')"
        >
          <ArrowUp class="h-3.5 w-3.5" />
        </Button>
        <Button
          v-if="canMoveDown"
          type="button"
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :aria-label="t('rules.tree.move_down')"
          @click="emit('move', 'down')"
        >
          <ArrowDown class="h-3.5 w-3.5" />
        </Button>
        <Button
          v-if="canRemove"
          type="button"
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-destructive"
          :aria-label="t('rules.tree.remove_node')"
          @click="emit('remove')"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <p
      v-if="groupProblem"
      class="mt-1 text-xs text-destructive"
      role="alert"
      data-testid="group-problem"
    >
      {{ groupProblem }}
    </p>

    <div class="mt-2 space-y-2 pl-3">
      <p v-if="rule.children.length === 0" class="text-xs text-muted-foreground">
        {{ t('rules.tree.no_children') }}
      </p>
      <LogicalRuleNode
        v-for="(child, idx) in rule.children"
        :key="idx"
        :rule="child"
        :depth="depth + 1"
        :max-depth="maxDepth"
        :can-remove="true"
        :sibling-index="idx"
        :sibling-count="rule.children.length"
        @update:rule="(next: Rule) => onChildUpdate(idx, next)"
        @remove="removeChild(idx)"
        @move="(d) => moveChild(idx, d)"
      />
    </div>

    <!-- Add-child actions -->
    <div class="mt-3 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="rule.op === 'NOT' && rule.children.length >= 1"
        :aria-label="t('rules.tree.add_condition')"
        @click="addChild('condition')"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('rules.tree.add_condition') }}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="atMaxDepth || (rule.op === 'NOT' && rule.children.length >= 1)"
        :title="atMaxDepth ? t('rules.tree.max_depth') : ''"
        :aria-label="t('rules.tree.add_and')"
        @click="addChild('AND')"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('rules.tree.add_and') }}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="atMaxDepth || (rule.op === 'NOT' && rule.children.length >= 1)"
        :title="atMaxDepth ? t('rules.tree.max_depth') : ''"
        :aria-label="t('rules.tree.add_or')"
        @click="addChild('OR')"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('rules.tree.add_or') }}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="atMaxDepth || (rule.op === 'NOT' && rule.children.length >= 1)"
        :title="atMaxDepth ? t('rules.tree.max_depth') : ''"
        :aria-label="t('rules.tree.add_not')"
        @click="addChild('NOT')"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ t('rules.tree.add_not') }}
      </Button>
    </div>
    <p v-if="atMaxDepth" class="mt-2 text-xs text-muted-foreground" data-testid="max-depth-notice">
      {{ t('rules.tree.max_depth') }}
    </p>
  </div>

  <!-- Simple predicate branch -->
  <div
    v-else-if="isSimple && rule.kind === 'simple'"
    class="flex flex-wrap items-start gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-2"
    data-testid="simple-rule-node"
  >
    <select
      :value="simpleTypeModel"
      class="h-9 w-[160px] rounded-md border border-input bg-background px-2 text-sm"
      :aria-label="t('rules.type_label')"
      @change="onSimpleTypeChange"
    >
      <option v-for="rt in SIMPLE_RULE_TYPES" :key="rt" :value="rt">{{ rt }}</option>
    </select>
    <div class="min-w-0 flex-1">
      <Input
        :model-value="simpleValueModel"
        class="h-9 font-mono"
        :placeholder="rule.type"
        :aria-label="t('rules.value_label')"
        @update:model-value="(v: string | number) => onSimpleValueInput(v)"
      />
      <p
        v-if="!simpleValidation.ok && rule.value.length > 0"
        class="mt-1 text-xs text-destructive"
        data-testid="simple-rule-error"
      >
        {{ t(simpleValidationMessageKey) }}
      </p>
    </div>
    <div class="flex items-center gap-1">
      <Button
        v-if="canMoveUp"
        type="button"
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :aria-label="t('rules.tree.move_up')"
        @click="emit('move', 'up')"
      >
        <ArrowUp class="h-3.5 w-3.5" />
      </Button>
      <Button
        v-if="canMoveDown"
        type="button"
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :aria-label="t('rules.tree.move_down')"
        @click="emit('move', 'down')"
      >
        <ArrowDown class="h-3.5 w-3.5" />
      </Button>
      <Button
        v-if="canRemove"
        type="button"
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-destructive"
        :aria-label="t('rules.tree.remove_node')"
        @click="emit('remove')"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>
</template>
