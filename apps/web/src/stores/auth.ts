// Authentication state. Thin wrapper over /api/auth/status — Basic-Auth
// credentials are supplied by the browser's session cache (set once the user
// dismissed the Basic-Auth prompt).

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { endpoints } from '@/api/client'
import { ApiError } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<string | null>(null)
  const mustChangePassword = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const status = await endpoints.auth.status()
      user.value = status.user
      mustChangePassword.value = status.mustChangePassword
    } catch (e) {
      user.value = null
      error.value = e instanceof ApiError ? e.message : (e as Error).message
    } finally {
      loading.value = false
    }
  }

  return { user, mustChangePassword, loading, error, refresh }
})
