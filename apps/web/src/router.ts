// Minimal vue-router setup. Every sidebar entry has a route, even if the
// target component is a placeholder — the Sidebar uses `<RouterLink>` for
// keyboard/middle-click friendliness. Real implementations land in later
// tasks (Services=21, Proxies=22, Raw YAML=23, History=24, Settings=25).

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import Services from '@/pages/Services.vue'
import Proxies from '@/pages/Proxies.vue'
import Placeholder from '@/pages/Placeholder.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/services' },
  { path: '/services', name: 'services', component: Services },
  { path: '/services/:name', name: 'service-detail', component: Services, props: true },
  { path: '/proxies', name: 'proxies', component: Proxies },
  {
    path: '/providers',
    name: 'providers',
    component: Placeholder,
    props: { pageKey: 'pages.providers' },
  },
  {
    path: '/dns',
    name: 'dns',
    // Lazy-loaded — Dns.vue pulls the whole DNS subcomponent tree + forms
    // only when the operator actually navigates here.
    component: () => import('@/pages/Dns.vue'),
  },
  { path: '/tun', name: 'tun', component: Placeholder, props: { pageKey: 'pages.tun' } },
  {
    path: '/sniffer',
    name: 'sniffer',
    component: Placeholder,
    props: { pageKey: 'pages.sniffer' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: Placeholder,
    props: { pageKey: 'pages.profile' },
  },
  {
    path: '/raw-yaml',
    name: 'raw-yaml',
    // Lazy-loaded — pulls Monaco into a separate chunk only when the user
    // navigates here. Also used by History's diff drawer.
    component: () => import('@/pages/RawYaml.vue'),
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/pages/History.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/Settings.vue'),
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    // No AppShell wrapper in the onboarding flow — the page renders its own
    // welcome layout.
    component: () => import('@/pages/Onboarding.vue'),
    meta: { noShell: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/services' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// ----- Onboarding guard ---------------------------------------------------
// One-shot check at first navigation: if the server reports
// `needsOnboarding: true` we redirect to /onboarding; otherwise we let the
// requested route through. The check runs once per page-load; after the
// operator completes onboarding, subsequent loads see needsOnboarding:false
// and the guard is a no-op.

type OnboardingProbe = { needsOnboarding: boolean }

let probe: Promise<OnboardingProbe> | null = null

function runProbe(): Promise<OnboardingProbe> {
  if (probe) return probe
  probe = fetch('/api/onboarding/status', { credentials: 'include' })
    .then((r) => (r.ok ? (r.json() as Promise<OnboardingProbe>) : { needsOnboarding: false }))
    .catch(() => ({ needsOnboarding: false }))
  return probe
}

router.beforeEach(async (to) => {
  if (to.name === 'onboarding') return true
  let result: OnboardingProbe
  try {
    result = await runProbe()
  } catch {
    return true
  }
  if (result.needsOnboarding) {
    return { name: 'onboarding' }
  }
  return true
})
