<script setup lang="ts">
// RuleRow — renders a single rule in the ServiceDetail rule list.
//
// Three shapes:
//   simple  — editable inline (emits `edit` when the pencil icon clicks).
//   match   — read-only badge, not editable.
//   logical — badge "complex rule" with a tree preview. The pencil opens
//             the modal tree editor (LogicalRuleEditor — Task 40). Stage 1
//             had this button disabled with a "edit in Raw YAML" hint; the
//             tree editor now unlocks visual editing.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, Trash2 } from 'lucide-vue-next'
import type { Rule } from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Props {
  rule: Rule
  index: number
}
const props = defineProps<Props>()
const emit = defineEmits<{ edit: [index: number]; delete: [index: number] }>()

const { t } = useI18n()

const isSimple = computed(() => props.rule.kind === 'simple')
const isLogical = computed(() => props.rule.kind === 'logical')
const isMatch = computed(() => props.rule.kind === 'match')

/** Compact human-readable preview of a logical rule. Mirrors the mihomo
 *  serialisation but without the implicit target (which we display separately). */
function previewLogical(rule: Rule): string {
  if (rule.kind === 'simple') {
    const mods = rule.modifiers && rule.modifiers.length > 0 ? ` [${rule.modifiers.join(',')}]` : ''
    return `${rule.type}:${rule.value}${mods}`
  }
  if (rule.kind === 'match') return 'MATCH'
  const kids = rule.children.map(previewLogical).join(', ')
  return `${rule.op}(${kids})`
}
</script>

<template>
  <div class="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2">
    <template v-if="isSimple">
      <Badge variant="outline" class="shrink-0 font-mono text-[11px]">
        {{ rule.kind === 'simple' ? rule.type : '' }}
      </Badge>
      <span class="min-w-0 flex-1 truncate font-mono text-sm">
        {{ rule.kind === 'simple' ? rule.value : '' }}
      </span>
      <template v-if="rule.kind === 'simple' && rule.modifiers && rule.modifiers.length > 0">
        <Badge
          v-for="mod in rule.modifiers"
          :key="mod"
          variant="muted"
          class="shrink-0 text-[10px]"
        >
          {{ mod }}
        </Badge>
      </template>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :aria-label="t('rules.edit')"
        @click="emit('edit', index)"
      >
        <Pencil class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-destructive"
        :aria-label="t('rules.delete')"
        @click="emit('delete', index)"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    </template>

    <template v-else-if="isMatch">
      <Badge variant="muted" class="shrink-0 text-[11px]">
        {{ t('rules.complex.match') }}
      </Badge>
      <span class="flex-1 text-xs text-muted-foreground">→ {{ rule.target }}</span>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-destructive"
        :aria-label="t('rules.delete')"
        @click="emit('delete', index)"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    </template>

    <template v-else-if="isLogical">
      <Badge variant="secondary" class="shrink-0" :title="t('rules.complex.tooltip')">
        {{ t('rules.complex.badge') }}
      </Badge>
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {{ previewLogical(rule) }}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :title="t('rules.complex.tooltip')"
        :aria-label="t('rules.edit')"
        data-testid="logical-edit-btn"
        @click="emit('edit', index)"
      >
        <Pencil class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-destructive"
        :aria-label="t('rules.delete')"
        @click="emit('delete', index)"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    </template>
  </div>
</template>
