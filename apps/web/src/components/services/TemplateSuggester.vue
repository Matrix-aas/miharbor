<script setup lang="ts">
// TemplateSuggester — fuzzy-match the user's in-progress service name against
// the curated catalogue (Task 42) and surface the top-N templates as pills.
//
// Rendered inline inside AddServiceDialog, below the name input. When the
// user clicks a pill we emit `select` with the full ServiceMatch (id + name
// + rules) so the dialog can pre-fill the new service's rule list and close.
//
// No debounce at this level — matchServices() is CPU-bound over ~80 entries
// with Fuse's BitAP implementation, consistently <1ms per call.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { matchServices, type ServiceMatch } from 'miharbor-shared'

interface Props {
  query: string
  /** Max number of suggestions to show. Default 5. */
  limit?: number
}
const props = withDefaults(defineProps<Props>(), { limit: 5 })

const emit = defineEmits<{
  select: [match: ServiceMatch]
}>()

const { t } = useI18n()

const matches = computed<ServiceMatch[]>(() => {
  const q = props.query.trim()
  if (q.length < 2) return []
  return matchServices(q, props.limit)
})

function onPick(match: ServiceMatch): void {
  emit('select', match)
}
</script>

<template>
  <div v-if="matches.length > 0" class="mt-2">
    <p class="mb-1 text-xs font-medium text-muted-foreground">
      {{ t('services.templates.suggestions_label') }}
    </p>
    <ul class="flex flex-wrap gap-1.5" role="list" :aria-label="t('services.templates.list_aria')">
      <li v-for="m in matches" :key="m.id" class="inline-flex">
        <button
          type="button"
          class="group inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs hover:border-primary hover:bg-accent focus:outline-none focus:ring-1 focus:ring-primary"
          :aria-label="
            t('services.templates.use_template_aria', { name: m.name, rules: m.rules.length })
          "
          :data-service-id="m.id"
          @click="onPick(m)"
        >
          <span class="font-medium">{{ m.name }}</span>
          <span class="text-muted-foreground">
            {{ t('services.templates.rule_count', { count: m.rules.length }, m.rules.length) }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
