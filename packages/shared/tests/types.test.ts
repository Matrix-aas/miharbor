import { expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { IssueSchema, type Issue } from '../src/types/issue.ts'

test('IssueSchema accepts valid issue', () => {
  const issue: Issue = { level: 'error', code: 'LINTER_X', path: ['rules', 5] }
  expect(Value.Check(IssueSchema, issue)).toBe(true)
})

test('IssueSchema rejects invalid level', () => {
  expect(Value.Check(IssueSchema, { level: 'fatal', code: 'X', path: [] })).toBe(false)
})

test('IssueSchema accepts optional params and autofix', () => {
  const issue: Issue = {
    level: 'warning',
    code: 'LINTER_X',
    path: ['rules', 3],
    params: { covered_by_index: 0 },
    autofix: { label: 'Remove', patch: { op: 'remove', path: ['rules', 3] } },
  }
  expect(Value.Check(IssueSchema, issue)).toBe(true)
})

test('exports are reachable from package index', async () => {
  const mod = await import('../src/index.ts')
  expect(typeof mod.IssueSchema).toBeDefined()
})
