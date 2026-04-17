import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadConfig } from '../../src/config/loader.ts'

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'miharbor-loader-'))
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

test('loadConfig returns doc, text, originalHash and wasCanonicalized', async () => {
  const raw = 'mode: rule\nlog-level: info\n'
  const path = tmpFile('c.yaml', raw)
  const loaded = await loadConfig(path)
  expect(loaded.doc.get('mode')).toBe('rule')
  expect(typeof loaded.text).toBe('string')
  expect(loaded.originalHash).toBe(createHash('sha256').update(raw).digest('hex'))
  // raw content is already canonical form for this trivial file
  expect(loaded.wasCanonicalized).toBe(false)
})

test('loadConfig flags wasCanonicalized for noisy flow-mapping input', async () => {
  // Column-aligned flow mapping — canonicalize will strip the padding.
  const raw = [
    'proxy-groups:',
    "  - {name: 'A',     type: select, proxies: ['X', DIRECT]}",
    "  - {name: 'B',     type: select, proxies: ['Y', DIRECT]}",
    '',
  ].join('\n')
  const path = tmpFile('c.yaml', raw)
  const loaded = await loadConfig(path)
  expect(loaded.wasCanonicalized).toBe(true)
  expect(loaded.text).not.toBe(raw)
})

test('loadConfig on the golden fixture yields wasCanonicalized=true (production-style padding)', async () => {
  const loaded = await loadConfig('apps/server/tests/fixtures/config-golden.yaml')
  expect(loaded.wasCanonicalized).toBe(true)
  expect(loaded.doc.get('mode')).toBe('rule')
})

test('loadConfig on the already-canonical snapshot is a no-op', async () => {
  const loaded = await loadConfig('apps/server/tests/fixtures/config-golden.canonical.yaml')
  expect(loaded.wasCanonicalized).toBe(false)
})
