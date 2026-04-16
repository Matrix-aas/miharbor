// Append-only JSONL audit log for deploy-critical events.
// Stored at `$MIHARBOR_DATA_DIR/audit.log` with mode 0600.

import { appendFile, mkdir, chmod, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type AuditAction =
  | 'deploy'
  | 'rollback'
  | 'auto-rollback'
  | 'canonicalization'
  | 'login'
  | 'logout'

export interface AuditRecord {
  action: AuditAction
  user?: string
  user_ip?: string
  user_agent?: string
  snapshot_id?: string
  diff_summary?: { added: number; removed: number }
  extra?: Record<string, unknown>
}

export interface AuditLog {
  record: (rec: AuditRecord) => Promise<void>
}

export function createAuditLog(opts: { dir: string }): AuditLog {
  const path = join(opts.dir, 'audit.log')
  return {
    async record(rec: AuditRecord): Promise<void> {
      await mkdir(opts.dir, { recursive: true })
      const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n'
      // appendFile's `mode` option only applies on initial create; if file exists
      // with different perms we force-chmod after first write.
      await appendFile(path, line, { mode: 0o600 })
      try {
        const s = await stat(path)
        if ((s.mode & 0o777) !== 0o600) {
          await chmod(path, 0o600)
        }
      } catch {
        // ignore stat failures — best-effort hardening
      }
    },
  }
}
