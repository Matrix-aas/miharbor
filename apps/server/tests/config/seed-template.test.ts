// Invariants for the onboarding seed template:
//  * After substituting the secret placeholder the YAML is already in
//    canonical form (canonicalize(text).text === text).
//  * `runSharedLinters(parseDocument(text))` returns an empty issue list.
//  * `renderSeed` refuses templates that no longer contain the placeholder.
//
// If this test fails, the onboarding endpoint will produce a config that
// the deploy pipeline's lint step rejects — i.e. fresh installs would be
// broken. It's a guardrail against innocent edits to seed-template.yaml.

import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { runSharedLinters } from 'miharbor-shared'
import { canonicalize } from '../../src/config/canonicalize.ts'
import { generateSecret, loadSeedTemplate, renderSeed } from '../../src/routes/onboarding.ts'

test('seed template + generated secret → canonical YAML', async () => {
  const template = await loadSeedTemplate()
  const yaml = renderSeed(template, generateSecret())
  const { text } = canonicalize(yaml)
  expect(text).toBe(yaml)
})

test('seed template + generated secret → zero linter issues', async () => {
  const template = await loadSeedTemplate()
  const yaml = renderSeed(template, generateSecret())
  const issues = runSharedLinters(parseDocument(yaml))
  expect(issues).toEqual([])
})

test('generateSecret returns 64 hex chars', () => {
  const s = generateSecret()
  expect(s).toMatch(/^[0-9a-f]{64}$/)
  // Two successive calls must differ.
  expect(s).not.toBe(generateSecret())
})

test('renderSeed throws on templates without the placeholder', () => {
  expect(() => renderSeed('mode: rule\n', 'abc')).toThrow(/placeholder/)
})
