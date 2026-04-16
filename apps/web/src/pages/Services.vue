<script setup lang="ts">
// Services page — orchestrates the master-detail Services screen.
//
// Data flow:
//   1. configStore.loadAll() pulls live config on mount (idempotent — cheap
//      to call even if the store is warm).
//   2. configStore.fetchLiveProxyState() calls mihomo /proxies once; the
//      detail view reads `liveProxyState[group.name]` to paint the direction
//      switcher. If mihomo is unreachable we fall back to the YAML default
//      with a "live state unknown" badge.
//   3. selection state lives in the URL hash so deep-linking works:
//      /services/myservice opens MyService on the right pane.

import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useConfigStore } from '@/stores/config'
import ServiceList from '@/components/services/ServiceList.vue'
import ServiceDetail from '@/components/services/ServiceDetail.vue'
import AddServiceDialog from '@/components/services/AddServiceDialog.vue'
import type { SimpleRule } from 'miharbor-shared'
import { ref } from 'vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const config = useConfigStore()

const selectedName = computed(() => (route.params.name as string | undefined) ?? null)

const selectedService = computed(() => {
  if (!selectedName.value) return null
  return config.services.find((s) => s.name === selectedName.value) ?? null
})

onMounted(() => {
  void config.loadAll().then(() => config.fetchLiveProxyState())
})

// Keep the URL in sync: if the user picks a service that no longer exists
// (after deletion) we redirect to the overview.
watch(selectedService, (svc) => {
  if (selectedName.value && !svc) {
    void router.replace({ name: 'services' })
  }
})

function onSelect(name: string): void {
  void router.push({ name: 'service-detail', params: { name } })
}

const addOpen = ref(false)

function openAdd(): void {
  addOpen.value = true
}

async function onCreate(input: {
  name: string
  direction: 'VPN' | 'DIRECT' | 'REJECT'
}): Promise<void> {
  try {
    await config.createNewService(input)
    void router.push({ name: 'service-detail', params: { name: input.name } })
  } catch (e) {
    console.error('createNewService failed', e)
  }
}

async function onChangeDirection(
  name: string,
  direction: 'VPN' | 'DIRECT' | 'REJECT',
): Promise<void> {
  try {
    await config.setServiceDirection(name, direction)
  } catch (e) {
    console.error('setServiceDirection failed', e)
  }
}

async function onAddRule(serviceName: string, rule: SimpleRule): Promise<void> {
  try {
    await config.addRuleToService(serviceName, rule)
  } catch (e) {
    console.error('addRuleToService failed', e)
  }
}

async function onReplaceRule(index: number, rule: SimpleRule): Promise<void> {
  try {
    await config.replaceRuleAt(index, rule)
  } catch (e) {
    console.error('replaceRuleAt failed', e)
  }
}

async function onRemoveRule(index: number): Promise<void> {
  try {
    await config.removeRuleAt(index)
  } catch (e) {
    console.error('removeRuleAt failed', e)
  }
}

async function onDeleteService(name: string): Promise<void> {
  try {
    await config.deleteServiceDraft(name)
    void router.replace({ name: 'services' })
  } catch (e) {
    console.error('deleteServiceDraft failed', e)
  }
}
</script>

<template>
  <section class="flex h-[calc(100vh-3.5rem)] min-h-0">
    <ServiceList
      :services="config.services"
      :selected="selectedName"
      @select="onSelect"
      @add-service="openAdd"
    />

    <div class="min-w-0 flex-1">
      <ServiceDetail
        v-if="selectedService"
        :key="selectedService.name"
        :service="selectedService"
        :live-state="config.liveProxyState"
        @change-direction="onChangeDirection"
        @add-rule="onAddRule"
        @replace-rule="onReplaceRule"
        @remove-rule="onRemoveRule"
        @delete-service="onDeleteService"
      />
      <div
        v-else
        class="flex h-full items-center justify-center px-6 text-sm text-muted-foreground"
      >
        {{ t('services.select_to_view') }}
      </div>
    </div>

    <AddServiceDialog
      v-model:open="addOpen"
      :existing-names="config.existingGroupNames"
      @create="onCreate"
    />
  </section>
</template>
