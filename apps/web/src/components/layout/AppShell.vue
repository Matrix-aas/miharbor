<script setup lang="ts">
// AppShell — the chrome that wraps every route. Responsibilities:
//   * own sidebar collapse state (desktop) + mobile overlay open/close
//   * toggle with Ctrl+B / Cmd+B (spec §4)
//   * render <Header>, <Sidebar>, the page (via <RouterView>), and the
//     <DeployStepper> dialog that activates from the Apply button.

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import Header from './Header.vue'
import Sidebar from './Sidebar.vue'
import DeployStepper from './DeployStepper.vue'
import YamlValidityGuard from './YamlValidityGuard.vue'

const { t } = useI18n()

const route = useRoute()
const hideShell = computed(() => route.meta.noShell === true)

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
  <RouterView v-if="hideShell" />
  <div v-else class="flex min-h-screen bg-background text-foreground">
    <!--
      Skip-to-main link. Visually hidden until it receives focus, then
      anchors to #main so keyboard users can bypass the sidebar on Tab.
      `sr-only focus:not-sr-only` is the Tailwind idiom for this pattern.
    -->
    <a
      href="#main"
      class="sr-only rounded-md border border-primary bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
    >
      {{ t('app.skip_to_main') }}
    </a>

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

      <main id="main" class="flex-1 overflow-auto p-4 md:p-6" tabindex="-1">
        <!-- YamlValidityGuard short-circuits structural routes (Services /
             Proxies / DNS / TUN / Sniffer / Profile / Providers) with an
             invalid-YAML banner when the draft fails to parse. Raw YAML,
             History, Settings remain reachable. -->
        <RouterView v-slot="{ Component }">
          <YamlValidityGuard>
            <component :is="Component" />
          </YamlValidityGuard>
        </RouterView>
      </main>
    </div>

    <!-- Shared dialogs / toasts region -->
    <DeployStepper />
  </div>
</template>
