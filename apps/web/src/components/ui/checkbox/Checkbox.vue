<script setup lang="ts">
defineProps<{
  checked?: boolean
  id?: string
}>()

defineEmits<{
  'update:checked': [checked: boolean]
}>()
</script>

<template>
  <input
    type="checkbox"
    :id="id"
    :checked="checked"
    class="peer h-4 w-4 cursor-pointer rounded border border-input bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    @change="$emit('update:checked', ($event.target as HTMLInputElement).checked)"
  />
</template>
