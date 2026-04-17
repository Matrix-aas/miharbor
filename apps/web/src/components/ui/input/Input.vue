<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  modelValue?: string | number
  class?: string
  type?: string
  placeholder?: string
  disabled?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// Forward attrs (aria-*, id, name, autocomplete, etc.) onto the <input>.
// Crucial for a11y — callers pass `:aria-label`, `id`, or similar.
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()

// If no accessible name is supplied (neither explicit aria-label,
// aria-labelledby, an associated <label for>, nor a placeholder fallback),
// the input would be nameless for screen readers. We can't detect a label
// wrapping us from JS, so rely on `id` (paired with external <label for>)
// or aria-label / placeholder at minimum. This flag is consumed by the
// template to set a fallback `aria-label` from placeholder when no other
// name is given — pragmatic, not WCAG-perfect.
const derivedAriaLabel = computed<string | undefined>(() => {
  if (attrs['aria-label'] || attrs['aria-labelledby'] || attrs.id) return undefined
  return typeof props.placeholder === 'string' ? props.placeholder : undefined
})

const inputClass = computed(() =>
  cn(
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    props.class,
  ),
)
</script>

<template>
  <input
    v-bind="attrs"
    :aria-label="derivedAriaLabel ?? (attrs['aria-label'] as string | undefined)"
    :class="inputClass"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    :value="modelValue"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
