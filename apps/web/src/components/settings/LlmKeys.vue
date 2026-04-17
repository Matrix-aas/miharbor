<script setup lang="ts">
// Placeholder LLM-keys card. Disabled inputs + "coming in v1.0" badge
// so the operator sees the roadmap without exposing any wiring.

import { useI18n } from 'vue-i18n'
import { Sparkles, Lock } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const { t } = useI18n()
</script>

<template>
  <section class="space-y-4 rounded-md border border-border bg-card/30 p-5">
    <header class="flex items-center gap-2">
      <Sparkles class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-lg font-semibold">{{ t('settings.llm_title') }}</h2>
      <Badge variant="muted">v1.0</Badge>
    </header>
    <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock class="h-3 w-3" />
      {{ t('settings.llm_disabled_note') }}
    </p>
    <div class="space-y-3 opacity-60">
      <div>
        <label for="llm-key-anthropic" class="mb-1 block text-xs font-medium text-muted-foreground"
          >Anthropic</label
        >
        <Input
          id="llm-key-anthropic"
          disabled
          :placeholder="t('settings.llm_anthropic_placeholder')"
        />
      </div>
      <div>
        <label for="llm-key-openai" class="mb-1 block text-xs font-medium text-muted-foreground"
          >OpenAI</label
        >
        <Input id="llm-key-openai" disabled :placeholder="t('settings.llm_openai_placeholder')" />
      </div>
    </div>
  </section>
</template>
