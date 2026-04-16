// vue-i18n setup. Two locales for MVP: en (default) and ru. The active locale
// is decided by, in priority order:
//   1. `?lang=ru` query parameter (for deep-linked screenshots/support)
//   2. `localStorage.miharbor_lang`
//   3. `navigator.language` prefix match (en-*, ru-*)
// Fallback is 'en'. When the user changes the language in the header we
// persist it to localStorage so subsequent loads remember it.

import { createI18n } from 'vue-i18n'
import en from './en.json'
import ru from './ru.json'

export type AppLocale = 'en' | 'ru'

const SUPPORTED: AppLocale[] = ['en', 'ru']
const STORAGE_KEY = 'miharbor_lang'

function detectLocale(): AppLocale {
  // SSR / test-runner guard. `navigator` is unavailable under vue-tsc or vitest.
  if (typeof window === 'undefined') return 'en'

  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('lang')
  if (fromQuery && (SUPPORTED as string[]).includes(fromQuery)) {
    return fromQuery as AppLocale
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && (SUPPORTED as string[]).includes(stored)) {
      return stored as AppLocale
    }
  } catch {
    // private mode / sandbox may throw on localStorage access
  }

  const nav = window.navigator?.language?.toLowerCase() ?? 'en'
  const short = nav.split('-')[0]
  if (short === 'ru') return 'ru'
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, ru },
})

export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // ignore persistence failures
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

export function currentLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}
