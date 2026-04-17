import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuditLog } from '../../src/observability/audit-log.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mh-audit-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('audit-log writes append-only JSONL', async () => {
  const audit = createAuditLog({ dir })
  await audit.record({ action: 'deploy', user: 'admin', snapshot_id: 'snap-1' })
  await audit.record({ action: 'rollback', user: 'admin', snapshot_id: 'snap-0' })
  const lines = readFileSync(join(dir, 'audit.log'), 'utf8').trim().split('\n')
  expect(lines.length).toBe(2)
  expect(JSON.parse(lines[0]!).action).toBe('deploy')
  expect(JSON.parse(lines[1]!).action).toBe('rollback')
})

test('audit-log records include ts', async () => {
  const audit = createAuditLog({ dir })
  await audit.record({ action: 'login', user: 'admin' })
  const line = readFileSync(join(dir, 'audit.log'), 'utf8').trim()
  const parsed = JSON.parse(line)
  expect(typeof parsed.ts).toBe('string')
  expect(parsed.action).toBe('login')
  expect(parsed.user).toBe('admin')
})

test('audit-log file mode is 0600', async () => {
  const audit = createAuditLog({ dir })
  await audit.record({ action: 'deploy' })
  const stat = statSync(join(dir, 'audit.log'))
  // Compare lower 9 bits (permission bits) — should be 0600
  expect(stat.mode & 0o777).toBe(0o600)
})

test('audit-log creates directory if missing', async () => {
  const nested = join(dir, 'nested', 'dir')
  const audit = createAuditLog({ dir: nested })
  await audit.record({ action: 'canonicalization' })
  const line = readFileSync(join(nested, 'audit.log'), 'utf8').trim()
  expect(JSON.parse(line).action).toBe('canonicalization')
})
