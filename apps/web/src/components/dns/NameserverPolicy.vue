<script setup lang="ts">
// NameserverPolicy — sortable table for `dns.nameserver-policy`.
//
// Each row represents a single `domain → nameservers` mapping. The YAML
// shape is a *map* (Record<domain, string | string[]>), not a list, so the
// visual ordering is Miharbor's own convention; we serialize by iterating
// rows in display order, which preserves the user's chosen order on save
// (yaml.Document.createNode keeps insertion order for maps).
//
// Reorder via keyboard/mouse up/down buttons (MVP). DnD can come in Task 50.

import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface PolicyRow {
  domain: string
  nameservers: string // comma-separated for display; split on save
}

interface Props {
  modelValue: Record<string, string | string[]> | undefined
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string | string[]>]
}>()

const { t } = useI18n()

function fromRecord(rec: Record<string, string | string[]> | undefined): PolicyRow[] {
  if (!rec) return []
  return Object.entries(rec).map(([domain, value]) => ({
    domain,
    nameservers: Array.isArray(value) ? value.join(', ') : value,
  }))
}

const rows = ref<PolicyRow[]>(fromRecord(props.modelValue))

// Resync when the parent's value changes structurally.
watch(
  () => props.modelValue,
  (next) => {
    const rebuilt = fromRecord(next)
    // Shallow equality check — avoid clobbering mid-edit.
    const same =
      rebuilt.length === rows.value.length &&
      rebuilt.every((r, i) => {
        const current = rows.value[i]
        return r.domain === current?.domain && r.nameservers === current?.nameservers
      })
    if (!same) rows.value = rebuilt
  },
  { deep: true },
)

function commit(): void {
  const out: Record<string, string | string[]> = {}
  for (const row of rows.value) {
    const domain = row.domain.trim()
    if (!domain) continue // skip blank domain rows — they're placeholders
    const parts = row.nameservers
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (parts.length === 0) continue
    out[domain] = parts.length === 1 ? (parts[0] as string) : parts
  }
  emit('update:modelValue', out)
}

function updateRow(index: number, field: keyof PolicyRow, value: string): void {
  const row = rows.value[index]
  if (!row) return
  row[field] = value
  commit()
}

function addRow(): void {
  rows.value.push({ domain: '', nameservers: '' })
  // Don't commit yet — empty rows are filtered out.
}

function removeRow(index: number): void {
  rows.value.splice(index, 1)
  commit()
}

function moveUp(index: number): void {
  if (index <= 0) return
  const row = rows.value[index]
  const prev = rows.value[index - 1]
  if (!row || !prev) return
  rows.value.splice(index - 1, 2, row, prev)
  commit()
}

function moveDown(index: number): void {
  if (index >= rows.value.length - 1) return
  const row = rows.value[index]
  const next = rows.value[index + 1]
  if (!row || !next) return
  rows.value.splice(index, 2, next, row)
  commit()
}
</script>

<template>
  <div class="space-y-3" data-testid="nameserver-policy">
    <p class="text-xs text-muted-foreground">
      {{ t('pages.dns.nameserver_policy.description') }}
    </p>

    <div v-if="rows.length === 0" class="text-sm text-muted-foreground">
      {{ t('pages.dns.nameserver_policy.empty') }}
    </div>

    <table v-else class="w-full border-collapse text-sm">
      <thead class="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th class="w-10"></th>
          <th class="pb-2 pr-2 font-medium">{{ t('pages.dns.nameserver_policy.domain') }}</th>
          <th class="pb-2 pr-2 font-medium">
            {{ t('pages.dns.nameserver_policy.nameservers') }}
          </th>
          <th class="w-10"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="index"
          class="border-t border-border"
          data-testid="policy-row"
        >
          <td class="py-2 pr-2">
            <div class="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :disabled="index === 0"
                :aria-label="t('pages.dns.nameserver_policy.move_up')"
                data-testid="policy-up"
                @click="moveUp(index)"
              >
                <ArrowUp class="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :disabled="index === rows.length - 1"
                :aria-label="t('pages.dns.nameserver_policy.move_down')"
                data-testid="policy-down"
                @click="moveDown(index)"
              >
                <ArrowDown class="h-3 w-3" />
              </Button>
            </div>
          </td>
          <td class="py-2 pr-2 align-top">
            <Input
              :model-value="row.domain"
              :placeholder="t('pages.dns.placeholders.domain_pattern')"
              class="h-9"
              @update:model-value="(v: string | number) => updateRow(index, 'domain', String(v))"
            />
          </td>
          <td class="py-2 pr-2 align-top">
            <Input
              :model-value="row.nameservers"
              :placeholder="t('pages.dns.placeholders.nameserver')"
              class="h-9"
              @update:model-value="
                (v: string | number) => updateRow(index, 'nameservers', String(v))
              "
            />
          </td>
          <td class="py-2 align-top">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :aria-label="t('pages.dns.nameserver_policy.remove')"
              data-testid="policy-remove"
              @click="removeRow(index)"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </td>
        </tr>
      </tbody>
    </table>

    <Button type="button" variant="outline" size="sm" data-testid="policy-add" @click="addRow">
      <Plus class="h-4 w-4" />
      {{ t('pages.dns.nameserver_policy.add') }}
    </Button>
  </div>
</template>
