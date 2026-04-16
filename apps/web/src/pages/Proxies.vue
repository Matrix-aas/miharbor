<script setup lang="ts">
// Proxies page — list of proxy nodes + WireGuard add/edit form.
//
// The form renders in a modal-ish right panel when the user clicks
// "Add WireGuard" or the pencil next to an existing WireGuard node.
// Non-WireGuard transports can only be deleted from the UI in MVP.

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore } from '@/stores/config'
import ProxyList from '@/components/proxies/ProxyList.vue'
import WireGuardForm from '@/components/proxies/WireGuardForm.vue'
import ImportConfDialog from '@/components/proxies/ImportConfDialog.vue'
import ConfirmDialog from '@/components/services/ConfirmDialog.vue'
import type { WireGuardNode } from 'miharbor-shared'

const { t } = useI18n()
const config = useConfigStore()

const showForm = ref(false)
const editingName = ref<string | null>(null)
const showImport = ref(false)
const deleteTarget = ref<string | null>(null)

onMounted(() => {
  void config.loadAll()
})

const initialForForm = computed<WireGuardNode | undefined>(() => {
  if (!editingName.value) return undefined
  const match = config.proxies.find((p) => p.name === editingName.value)
  if (!match || match.type !== 'wireguard') return undefined
  return match as WireGuardNode
})

function openAdd(): void {
  editingName.value = null
  showForm.value = true
}

function openEdit(name: string): void {
  const match = config.proxies.find((p) => p.name === name)
  if (!match || match.type !== 'wireguard') return
  editingName.value = name
  showForm.value = true
}

async function onSubmit(node: WireGuardNode): Promise<void> {
  try {
    await config.upsertProxyNodeDraft(node)
    showForm.value = false
    editingName.value = null
  } catch (e) {
    console.error('upsertProxyNode failed', e)
  }
}

function askDelete(name: string): void {
  deleteTarget.value = name
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  try {
    await config.removeProxyNodeDraft(deleteTarget.value)
  } catch (e) {
    console.error('removeProxyNode failed', e)
  } finally {
    deleteTarget.value = null
  }
}

function cancelForm(): void {
  showForm.value = false
  editingName.value = null
}
</script>

<template>
  <section class="space-y-4">
    <header class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('proxies.heading') }}</h1>
    </header>

    <ProxyList
      :proxies="config.proxies"
      @add="openAdd"
      @import="showImport = true"
      @edit="openEdit"
      @delete="askDelete"
    />

    <section
      v-if="showForm"
      class="rounded-md border border-border bg-card/30 p-4"
      data-testid="wireguard-form-panel"
    >
      <header class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ t('proxies.wireguard.title') }}</h2>
      </header>
      <WireGuardForm
        :initial="initialForForm"
        :existing-names="config.existingProxyNodeNames"
        @submit="onSubmit"
        @cancel="cancelForm"
      />
    </section>

    <ImportConfDialog v-model:open="showImport" />

    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="deleteTarget ? t('proxies.delete_confirm_title', { name: deleteTarget }) : ''"
      :body="t('proxies.delete_confirm_body')"
      :confirm-label="t('common.delete')"
      @update:open="
        (v: boolean) => {
          if (!v) deleteTarget = null
        }
      "
      @confirm="confirmDelete"
    />
  </section>
</template>
