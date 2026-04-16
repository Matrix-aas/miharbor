// Minimal vue-router setup. Every sidebar entry has a route, even if the
// target component is a placeholder — the Sidebar uses `<RouterLink>` for
// keyboard/middle-click friendliness. Real implementations land in later
// tasks (Services=21, Proxies=22, Raw YAML=23, History=24, Settings=25).

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import Services from '@/pages/Services.vue'
import Placeholder from '@/pages/Placeholder.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/services' },
  { path: '/services', name: 'services', component: Services },
  {
    path: '/proxies',
    name: 'proxies',
    component: Placeholder,
    props: { pageKey: 'pages.proxies' },
  },
  {
    path: '/providers',
    name: 'providers',
    component: Placeholder,
    props: { pageKey: 'pages.providers' },
  },
  { path: '/dns', name: 'dns', component: Placeholder, props: { pageKey: 'pages.dns' } },
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
    component: Placeholder,
    props: { pageKey: 'pages.raw_yaml' },
  },
  {
    path: '/history',
    name: 'history',
    component: Placeholder,
    props: { pageKey: 'pages.history' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: Placeholder,
    props: { pageKey: 'pages.settings' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/services' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
