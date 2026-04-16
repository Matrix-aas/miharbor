import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { writeFileSync, unlinkSync } from 'node:fs'

test('guard-secrets blocks WireGuard private-key', async () => {
  const f = '/tmp/mh-test-secret.yaml'
  writeFileSync(f, 'private-key: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n')
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks pre-shared-key', async () => {
  const f = '/tmp/mh-test-psk.yaml'
  writeFileSync(f, 'pre-shared-key: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n')
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks hex secret of 32+ chars', async () => {
  const f = '/tmp/mh-test-hexsecret.yaml'
  writeFileSync(f, 'secret: "abcdef0123456789abcdef0123456789ff"\n')
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets allows normal file', async () => {
  const f = '/tmp/mh-test-ok.yaml'
  writeFileSync(f, 'mode: rule\nlog-level: info\n')
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).toBe(0)
})
