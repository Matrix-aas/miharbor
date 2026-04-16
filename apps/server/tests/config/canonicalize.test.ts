import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import { canonicalize } from '../../src/config/canonicalize.ts'

const GOLDEN_PATH = 'apps/server/tests/fixtures/config-golden.yaml'
const SNAPSHOT_PATH = 'apps/server/tests/fixtures/config-golden.canonical.yaml'

const GOLDEN = readFileSync(GOLDEN_PATH, 'utf8')

test('canonicalize is idempotent (parse→dump→parse→dump stable)', () => {
  const first = canonicalize(GOLDEN).text
  const second = canonicalize(first).text
  expect(second).toBe(first)
})

test('canonicalize preserves semantic content (AST equivalence)', () => {
  const original = parseDocument(GOLDEN).toJS()
  const canonical = parseDocument(canonicalize(GOLDEN).text).toJS()
  expect(canonical).toEqual(original)
})

test('canonicalize preserves critical runbook comment markers', () => {
  const out = canonicalize(GOLDEN).text
  const markers = [
    'DISABLED for first rollout',
    'MUST NOT be :53',
    'Prevent self-intercept',
    'runbook 13.3',
    'Runbook hard rule',
    'runbook 13.3 pt 1',
  ]
  for (const m of markers) {
    expect(out).toContain(m)
  }
})

test('canonicalize preserves snapshot against committed golden', () => {
  // Golden snapshot is stored in canonicalized form; refresh with UPDATE_GOLDEN=1.
  const actual = canonicalize(GOLDEN).text
  if (Bun.env.UPDATE_GOLDEN === '1' || !existsSync(SNAPSHOT_PATH)) {
    writeFileSync(SNAPSHOT_PATH, actual)
  }
  const expected = readFileSync(SNAPSHOT_PATH, 'utf8')
  expect(actual).toBe(expected)
})

test('canonicalize() returns a fresh Document that re-serializes identically', () => {
  const { doc, text } = canonicalize(GOLDEN)
  expect(
    doc.toString({
      lineWidth: 0,
      minContentWidth: 0,
      flowCollectionPadding: false,
      defaultStringType: 'PLAIN',
      defaultKeyType: 'PLAIN',
      doubleQuotedMinMultiLineLength: 999999,
    }),
  ).toBe(text)
})
