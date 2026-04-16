// App bootstrap: Pinia + vue-router + vue-i18n + Tailwind global CSS. The
// `.dark` class on <html> ships dark-first (Task 25 adds the toggle).

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n, currentLocale } from './i18n'
import './assets/tailwind.css'

// Dark-first: shadcn tokens flip from the `.dark` class on <html>. Later
// Task 25 introduces a Settings-driven light-mode switch.
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark')
  document.documentElement.lang = currentLocale()
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.mount('#app')
