// /api/auth/* — status + password change. Used by the UI onboarding flow
// to detect `mustChangePassword` and to persist a new password. Both
// endpoints live inside the Basic-Auth guard — the PASSWORD CHANGE path
// still requires the operator to authenticate with the old password first.

import { Elysia, t } from 'elysia'
import type { AuthStore } from '../auth/password.ts'
import type { AuditLog } from '../observability/audit-log.ts'
import { getAuthUser } from '../auth/basic-auth.ts'

export interface AuthRoutesDeps {
  authStore: AuthStore
  audit: AuditLog
}

export function authRoutes(deps: AuthRoutesDeps) {
  return new Elysia({ prefix: '/api/auth' })
    .get('/status', ({ request }) => ({
      user: getAuthUser(request) ?? deps.authStore.getUser(),
      mustChangePassword: deps.authStore.mustChangePassword(),
    }))
    .post(
      '/password',
      async ({ body, request, set }) => {
        // Require the CURRENT password even when mustChangePassword=true —
        // this prevents a session-hijacker from upgrading the account.
        const oldOk = await deps.authStore.verifyPassword(body.oldPassword)
        if (!oldOk) {
          set.status = 401
          return { code: 'WRONG_OLD_PASSWORD' }
        }
        try {
          await deps.authStore.setPassword(body.newPassword)
        } catch (e) {
          set.status = 400
          return { code: 'BAD_PASSWORD', message: (e as Error).message }
        }
        await deps.audit.record({
          action: 'login',
          user: getAuthUser(request) ?? deps.authStore.getUser(),
          extra: { event: 'password-changed' },
        })
        return { ok: true }
      },
      {
        body: t.Object({
          oldPassword: t.String(),
          newPassword: t.String({ minLength: 8 }),
        }),
      },
    )
}
