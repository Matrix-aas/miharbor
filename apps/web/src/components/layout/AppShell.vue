<script setup lang="ts">
// AppShell — the chrome that wraps every route. Responsibilities:
//   * own sidebar collapse state (desktop) + mobile overlay open/close
//   * toggle with Ctrl+B / Cmd+B (spec §4)
//   * render <Header>, <Sidebar>, the page (via <RouterView>), and the
//     <DeployStepper> dialog that activates from the Apply button.

import { onMounted, onUnmounted, ref } from 'vue'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import Header from './Header.vue'
import Sidebar from './Sidebar.vue'
import DeployStepper from './DeployStepper.vue'

const collapsed = ref(false)
const mobileOpen = ref(false)

const bp = useBreakpoints(breakpointsTailwind)
const isDesktop = bp.greaterOrEqual('md')

function toggleSidebar(): void {
  if (isDesktop.value) {
    collapsed.value = !collapsed.value
  } else {
    mobileOpen.value = !mobileOpen.value
  }
}

function closeMobile(): void {
  mobileOpen.value = false
}

function onKey(e: KeyboardEvent): void {
  // Ctrl+B / Cmd+B toggles the sidebar, matching the spec note.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleSidebar()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex min-h-screen bg-background text-foreground">
    <Sidebar :collapsed="collapsed" :mobile-open="mobileOpen" @navigate="closeMobile" />

    <!-- Mobile backdrop -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/50 md:hidden"
      aria-hidden="true"
      @click="closeMobile"
    ></div>

    <div class="flex min-w-0 flex-1 flex-col">
      <Header
        :collapsed="collapsed"
        @toggle-sidebar="toggleSidebar"
        @toggle-mobile="mobileOpen = !mobileOpen"
      />

      <main class="flex-1 overflow-auto p-4 md:p-6">
        <RouterView />
      </main>
    </div>

    <!-- Shared dialogs / toasts region -->
    <DeployStepper />
  </div>
</template>
