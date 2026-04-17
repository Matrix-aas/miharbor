import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { writeFileSync, unlinkSync } from 'node:fs'

// NOTE: all secret-looking strings below are constructed at runtime (string
// concat / template pieces split by `+`) so the guard-secrets hook itself
// doesn't flag THIS test file when it's staged. The guard is designed to
// operate on committed content, not test-case bodies.

const PK_KEY = 'private' + '-' + 'key'
const PSK_KEY = 'pre' + '-' + 'shared' + '-' + 'key'
const SK_ANT = 's' + 'k-ant-api03-abcdefghijklmnopqrst'
const SK_PROJ = 's' + 'k-proj-abcdefghijklmnopqrst'
const SECRET_WORD = 'Sec' + 'ret'
const HEX32 = 'abcdef0123456789abcdef0123456789ff'

test('guard-secrets blocks WireGuard private-key', async () => {
  const f = '/tmp/mh-test-secret.yaml'
  writeFileSync(f, `${PK_KEY}: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks pre-shared-key', async () => {
  const f = '/tmp/mh-test-psk.yaml'
  writeFileSync(f, `${PSK_KEY}: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks hex secret of 32+ chars', async () => {
  const f = '/tmp/mh-test-hexsecret.yaml'
  writeFileSync(f, `secret: "${HEX32}"\n`)
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

// C4: broadened patterns — these previously slipped through.

test('guard-secrets blocks indented YAML private-key (C4)', async () => {
  const f = '/tmp/mh-test-indent-pk.yaml'
  writeFileSync(f, `proxies:\n  - name: wg\n    ${PK_KEY}: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks indented YAML pre-shared-key (C4)', async () => {
  const f = '/tmp/mh-test-indent-psk.yaml'
  writeFileSync(f, `proxies:\n  - name: wg\n    ${PSK_KEY}: ABCDEFGHIJKLMNOPQRSTUV=\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks capital-case Secret (C4)', async () => {
  const f = '/tmp/mh-test-capital-secret.yaml'
  writeFileSync(f, `${SECRET_WORD}: "${HEX32}"\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks capital-case PRIVATE-KEY (C4)', async () => {
  const f = '/tmp/mh-test-capital-pk.yaml'
  writeFileSync(f, `${PK_KEY.toUpperCase()}: ABCDEFGHIJKLMNOPQRSTUVWXYZ=\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks .env-style ANTHROPIC_API_KEY (C4)', async () => {
  const f = '/tmp/mh-test-env-anthropic.env'
  writeFileSync(f, `ANTHROPIC_API_KEY=${SK_ANT}\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks .env-style OPENAI_API_KEY with quotes (C4)', async () => {
  const f = '/tmp/mh-test-env-openai.env'
  writeFileSync(f, `OPENAI_API_KEY="${SK_PROJ}"\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets blocks bare sk-ant- token in plain text (C4)', async () => {
  const f = '/tmp/mh-test-bare-anthropic.md'
  writeFileSync(f, `some docs ${SK_ANT} more\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).not.toBe(0)
})

test('guard-secrets skips files under tests/fixtures/ (Task 5)', async () => {
  // Placeholder-keyed fixtures live under tests/fixtures/ and are additionally
  // verified by scripts/verify-anon.sh. guard-secrets hook lets them through.
  const f = '/tmp/mh-test-fixture/tests/fixtures/config-golden.yaml'
  await $`mkdir -p ${f.replace(/\/[^/]+$/, '')}`.nothrow()
  writeFileSync(f, `${PK_KEY}: AAAAAAAAAAAAAAAAAAAAAAAAA=\nsecret: "${HEX32}"\n`)
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  await $`rmdir ${f.replace(/\/[^/]+$/, '')} ${f.replace(/\/[^/]+\/[^/]+$/, '')} ${f.replace(/\/[^/]+\/[^/]+\/[^/]+$/, '')}`.nothrow()
  expect(proc.exitCode).toBe(0)
})

test('guard-secrets allows clean mihomo config fragment (C4)', async () => {
  const f = '/tmp/mh-test-clean-mihomo.yaml'
  writeFileSync(
    f,
    [
      'mode: rule',
      'log-level: info',
      'proxies:',
      '  - name: wg-nl',
      '    type: wireguard',
      '    server: vpn.example.com',
      '    port: 51820',
      '    udp: true',
      'rules:',
      '  - DOMAIN-SUFFIX,example.com,DIRECT',
      '  - MATCH,PROXY',
      '',
    ].join('\n'),
  )
  const proc = await $`./scripts/guard-secrets.sh ${f}`.nothrow()
  unlinkSync(f)
  expect(proc.exitCode).toBe(0)
})
