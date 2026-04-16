import { expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import { readFileSync } from 'node:fs'
import { canonicalize, serialize } from '../../src/config/canonicalize.ts'
import {
  deleteAt,
  getRuleRaw,
  insertRule,
  removeRule,
  replaceRule,
  setScalar,
} from '../../src/config/mutator.ts'
import { parseRulesFromDoc } from 'miharbor-shared'

const GOLDEN = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')

test('setScalar updates a scalar path', () => {
  const { doc } = canonicalize('mode: rule\nlog-level: info\n')
  setScalar({ doc }, ['log-level'], 'debug')
  expect(doc.get('log-level')).toBe('debug')
  expect(serialize(doc)).toContain('log-level: debug')
})

test('deleteAt removes a path', () => {
  const { doc } = canonicalize('mode: rule\nlog-level: info\n')
  deleteAt({ doc }, ['log-level'])
  expect(doc.get('log-level')).toBeUndefined()
})

test('insertRule appends when index is -1', () => {
  const { doc } = canonicalize(GOLDEN)
  const before = parseRulesFromDoc(doc).length
  insertRule(
    { doc },
    { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'notion.so', target: 'Notion' },
    -1,
  )
  const after = parseRulesFromDoc(doc).length
  expect(after).toBe(before + 1)
  expect(getRuleRaw({ doc }, after - 1)).toBe('DOMAIN-SUFFIX,notion.so,Notion')
})

test('insertRule inserts at a specific index', () => {
  const { doc } = canonicalize(GOLDEN)
  insertRule(
    { doc },
    { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'inserted.test', target: 'other' },
    0,
  )
  expect(getRuleRaw({ doc }, 0)).toBe('DOMAIN-SUFFIX,inserted.test,other')
})

test('replaceRule swaps the rule at a given index', () => {
  const { doc } = canonicalize(GOLDEN)
  replaceRule({ doc }, 0, {
    kind: 'simple',
    type: 'DOMAIN',
    value: 'replaced.test',
    target: 'other',
  })
  expect(getRuleRaw({ doc }, 0)).toBe('DOMAIN,replaced.test,other')
})

test('removeRule shrinks the list', () => {
  const { doc } = canonicalize(GOLDEN)
  const before = parseRulesFromDoc(doc).length
  removeRule({ doc }, 0)
  const after = parseRulesFromDoc(doc).length
  expect(after).toBe(before - 1)
})

test('insertRule on a doc without a rules: array creates it', () => {
  const doc = parseDocument('mode: rule\n')
  insertRule({ doc }, { kind: 'match', target: 'DIRECT' })
  expect(doc.getIn(['rules', 0])).toBe('MATCH,DIRECT')
})

test('insertRule rejects negative indices other than -1', () => {
  const { doc } = canonicalize(GOLDEN)
  expect(() => insertRule({ doc }, { kind: 'match', target: 'DIRECT' }, -5)).toThrow(
    /negative index/i,
  )
})

test('deleteAt is a no-op when the path is entirely missing', () => {
  const { doc } = canonicalize('mode: rule\n')
  // `does.not.exist` walks through a scalar → no collection to delete from.
  // Contract: silent success.
  expect(() => deleteAt({ doc }, ['does', 'not', 'exist'])).not.toThrow()
  expect(doc.get('mode')).toBe('rule') // unrelated data intact
})

test('removeRule throws when rules: is missing (API consistency with replaceRule)', () => {
  const doc = parseDocument('mode: rule\n')
  expect(() => removeRule({ doc }, 0)).toThrow(/rules array missing/i)
})

test('removeRule throws on out-of-bounds index', () => {
  const { doc } = canonicalize(GOLDEN)
  // One past the end.
  const count = parseRulesFromDoc(doc).length
  expect(() => removeRule({ doc }, count)).toThrow(/out of bounds/i)
})

test('replaceRule throws when rules: is missing (unified message)', () => {
  const doc = parseDocument('mode: rule\n')
  expect(() =>
    replaceRule({ doc }, 0, {
      kind: 'simple',
      type: 'DOMAIN',
      value: 'x.com',
      target: 'G',
    }),
  ).toThrow(/rules array missing/i)
})
