<script setup lang="ts">
// Raw YAML viewer — Task 23.
//
// Shows the current draft (configStore.draftText) in a Monaco editor,
// read-only for MVP. The editor loads lazily via defineAsyncComponent so
// the main bundle stays small. "Edit mode" lands in stage-2 (Task 39).
//
// Copy-to-clipboard uses `navigator.clipboard.writeText`. We keep a fallback
// message for browsers where the clipboard API is disabled (insecure
// context); the button text momentarily flips to "Copied!" / "Failed".

import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Check } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfigStore } from '@/stores/config'

const MonacoYamlView = defineAsyncComponent(() => import('@/components/yaml/MonacoYamlView.vue'))

const { t } = useI18n()
const config = useConfigStore()

const yamlText = computed(() => config.draftText ?? config.rawLive ?? '')

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(yamlText.value)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  setTimeout(() => {
    copyState.value = 'idle'
  }, 1500)
}

onMounted(() => {
  // Guard — if the user reloads directly onto /raw-yaml without passing
  // through another page first, loadAll() may not have run yet.
  if (!config.draftText && !config.rawLive) {
    void config.loadAll()
  }
})
</script>

<template>
  <section class="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
    <header class="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6">
      <h1 class="text-xl font-semibold tracking-tight">{{ t('pages.raw_yaml.title') }}</h1>
      <Badge variant="muted">{{ t('raw_yaml.read_only') }}</Badge>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="!yamlText" @click="copyToClipboard">
          <Copy v-if="copyState === 'idle'" class="mr-1.5 h-3.5 w-3.5" />
          <Check v-else-if="copyState === 'copied'" class="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
          <Copy v-else class="mr-1.5 h-3.5 w-3.5 text-destructive" />
          <span v-if="copyState === 'copied'">{{ t('raw_yaml.copied') }}</span>
          <span v-else-if="copyState === 'failed'">{{ t('raw_yaml.copy_failed') }}</span>
          <span v-else>{{ t('raw_yaml.copy') }}</span>
        </Button>
      </div>
    </header>

    <p v-if="!yamlText" class="px-4 py-6 text-sm text-muted-foreground md:px-6">
      {{ t('common.loading') }}
    </p>

    <div v-else class="flex-1 min-h-0">
      <MonacoYamlView :model-value="yamlText" read-only language="yaml" />
    </div>
  </section>
</template>
