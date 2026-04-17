<script setup lang="ts">
// IssueList — renders the linter-produced Issue[] as a human-readable list.
//
// Each item shows:
//   * Severity icon (error/warning/info) with themed color.
//   * Translated message. Lookup path is `linter.issues.<CODE>.message`
//     (with per-reason specialization for LINTER_UNREACHABLE_RULE). When a
//     translation is missing we fall back to the raw code so nothing silently
//     disappears — it's better to show `LINTER_FOO_BAR` than blank space.
//   * Optional translated suggestion (from `issue.suggestion`), rendered on
//     its own muted-text row with a 💡 prefix.
//
// The component is purely presentational — it does not fetch, mutate, or
// re-order issues. Callers typically wrap it in `v-if="issues.length"` so
// they get a clean layout without the "no issues" placeholder, but we still
// render a localized empty state when a caller passes an empty list.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, AlertTriangle, Info } from 'lucide-vue-next'
import type { Issue } from 'miharbor-shared'
import { formatIssue } from '@/lib/issue-formatter'

interface Props {
  issues: Issue[]
}
const props = defineProps<Props>()

const { t, te } = useI18n()

interface RenderedIssue {
  key: string
  level: Issue['level']
  message: string
  suggestion: string | null
  ariaLabel: string
}

/**
 * Resolve the i18n key for an issue's main message.
 * For `LINTER_UNREACHABLE_RULE` the linter emits two variants in `params.reason`
 * (`match_above` / `shadowed`); we specialize to `message_match_above` /
 * `message_shadowed` when present, falling back to plain `message`.
 */
function messageKeyFor(issue: Issue): string {
  const base = `linter.issues.${issue.code}`
  if (issue.code === 'LINTER_UNREACHABLE_RULE') {
    const reason = (issue.params?.reason as string | undefined) ?? ''
    if (reason === 'match_above' && te(`${base}.message_match_above`))
      return `${base}.message_match_above`
    if (reason === 'shadowed' && te(`${base}.message_shadowed`)) return `${base}.message_shadowed`
  }
  // User invariants share one message template — codes are USER_INVARIANT_<id>.
  if (issue.code.startsWith('USER_INVARIANT_') && !te(`${base}.message`)) {
    return 'linter.issues.USER_INVARIANT.message'
  }
  return `${base}.message`
}

function translateMessage(issue: Issue): string {
  const key = messageKeyFor(issue)
  if (te(key)) return t(key, (issue.params ?? {}) as Record<string, unknown>)
  // Fallback: show the raw code so missing translations are visible.
  return issue.code
}

function translateSuggestion(issue: Issue): string | null {
  const f = formatIssue(issue)
  if (!f.suggestionKey) return null
  if (te(f.suggestionKey)) {
    return t(f.suggestionKey, (f.suggestionParams ?? {}) as Record<string, unknown>)
  }
  // Fallback: show the raw suggestion key so nothing silently disappears.
  return f.suggestionKey
}

function severityLabel(level: Issue['level']): string {
  if (level === 'error') return t('issues.severity_error')
  if (level === 'warning') return t('issues.severity_warning')
  return t('issues.severity_info')
}

const rendered = computed<RenderedIssue[]>(() =>
  props.issues.map((issue, idx) => {
    const message = translateMessage(issue)
    const suggestion = translateSuggestion(issue)
    return {
      key: `${idx}-${issue.code}-${issue.path.join('.')}`,
      level: issue.level,
      message,
      suggestion,
      ariaLabel: t('issues.aria_item', { severity: severityLabel(issue.level), message }),
    }
  }),
)

const severityClass = (level: Issue['level']): string => {
  if (level === 'error') return 'text-destructive'
  if (level === 'warning') return 'text-amber-500'
  return 'text-sky-500'
}
</script>

<template>
  <div class="space-y-2" data-testid="issue-list">
    <p
      v-if="rendered.length === 0"
      class="text-sm text-muted-foreground"
      data-testid="issue-list-empty"
    >
      {{ t('issues.empty') }}
    </p>
    <ul v-else class="space-y-2">
      <li
        v-for="item in rendered"
        :key="item.key"
        class="flex items-start gap-2 rounded-md border border-border bg-card/50 px-3 py-2"
        :data-severity="item.level"
        :aria-label="item.ariaLabel"
      >
        <span class="mt-0.5 shrink-0" :class="severityClass(item.level)" aria-hidden="true">
          <AlertCircle v-if="item.level === 'error'" class="h-4 w-4" />
          <AlertTriangle v-else-if="item.level === 'warning'" class="h-4 w-4" />
          <Info v-else class="h-4 w-4" />
        </span>
        <div class="min-w-0 flex-1 text-sm">
          <p class="text-foreground" data-testid="issue-message">{{ item.message }}</p>
          <p
            v-if="item.suggestion"
            class="mt-1 text-xs text-muted-foreground"
            data-testid="issue-suggestion"
          >
            <span aria-hidden="true">💡 </span>
            <span class="sr-only">{{ t('issues.suggestion_prefix') }}: </span>
            {{ item.suggestion }}
          </p>
        </div>
      </li>
    </ul>
  </div>
</template>
