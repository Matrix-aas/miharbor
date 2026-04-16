<script setup lang="ts">
// Read-only table of the server's env snapshot.
// Secrets are masked to `***` server-side; the `masked` flag is shown as
// a tiny "secret" badge so operators know "yes, it IS configured — I
// just can't see it in the UI".

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Settings2, Eye, EyeOff } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { endpoints, ApiError } from '@/api/client'
import type { EnvEntry } from '@/api/client'

const { t } = useI18n()

const entries = ref<Record<string, EnvEntry>>({})
const loading = ref(false)
const error = ref<string | null>(null)

const sortedKeys = computed(() => Object.keys(entries.value).sort())

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    entries.value = await endpoints.settings.env()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

function displayValue(entry: EnvEntry): string {
  if (entry.masked) return '***'
  if (entry.value === '' || entry.value === null || entry.value === undefined) {
    return t('settings.env_empty')
  }
  return String(entry.value)
}
</script>

<template>
  <section class="space-y-4 rounded-md border border-border bg-card/30 p-5">
    <header class="flex items-center gap-2">
      <Settings2 class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-lg font-semibold">{{ t('settings.env_title') }}</h2>
    </header>
    <p class="text-xs text-muted-foreground">{{ t('settings.env_subtitle') }}</p>

    <div
      v-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div v-if="loading && sortedKeys.length === 0" class="text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-border text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th class="py-2 pr-4 font-medium">{{ t('settings.env_key') }}</th>
            <th class="py-2 pr-4 font-medium">{{ t('settings.env_value') }}</th>
            <th class="py-2 font-medium">{{ t('settings.env_source') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="key in sortedKeys"
            :key="key"
            class="border-b border-border/40 last:border-b-0"
          >
            <td class="py-2 pr-4 align-top font-mono text-xs">{{ key }}</td>
            <td class="py-2 pr-4 align-top font-mono text-xs break-all">
              <span>{{ displayValue(entries[key]!) }}</span>
              <Badge v-if="entries[key]?.masked" variant="outline" class="ml-2">
                <EyeOff class="mr-1 h-2.5 w-2.5" />
                {{ t('settings.env_masked') }}
              </Badge>
            </td>
            <td class="py-2 align-top">
              <Badge :variant="entries[key]?.source === 'env' ? 'secondary' : 'muted'">
                <Eye v-if="entries[key]?.source === 'env'" class="mr-1 h-2.5 w-2.5" />
                {{
                  entries[key]?.source === 'env'
                    ? t('settings.env_source_env')
                    : t('settings.env_source_default')
                }}
              </Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
