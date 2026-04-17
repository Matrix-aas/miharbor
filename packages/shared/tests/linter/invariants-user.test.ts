// User invariants engine — Task 41.
//
// Covers:
//  * Schema validation: required fields, pattern, level/rule kind unions.
//  * parseUserInvariants drops bad entries but keeps good ones, collects
//    errors, deduplicates ids.
//  * Each rule kind evaluates correctly against a sample YAML doc.
//  * Inactive invariants produce no issues regardless of doc.
//  * Aggregator wires user invariants into the final Issue list.

import { describe, expect, test } from 'bun:test'
import { parseDocument } from 'yaml'
import {
  checkUserInvariants,
  evaluateUserInvariant,
  parseUserInvariants,
  runSharedLinters,
  type UserInvariant,
} from '../../src/linter/index.ts'

// --- schema parsing -------------------------------------------------------

describe('parseUserInvariants', () => {
  test('accepts a minimal valid entry', () => {
    const raw = {
      invariants: [
        {
          id: 'dns-listen',
          name: 'DNS listen',
          rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
        },
      ],
    }
    const res = parseUserInvariants(raw)
    expect(res.errors).toEqual([])
    expect(res.invariants.length).toBe(1)
    expect(res.invariants[0]!.id).toBe('dns-listen')
  })

  test('rejects entries missing `id` / `name` / `rule`', () => {
    const raw = {
      invariants: [{ name: 'no id', rule: { kind: 'path-must-equal', path: 'x', value: 1 } }],
    }
    const res = parseUserInvariants(raw)
    expect(res.invariants.length).toBe(0)
    expect(res.errors.length).toBe(1)
  })

  test('rejects invalid id pattern (leading hyphen)', () => {
    const raw = {
      invariants: [
        { id: '-bad', name: 'nope', rule: { kind: 'path-must-equal', path: 'x', value: 1 } },
      ],
    }
    const res = parseUserInvariants(raw)
    expect(res.invariants.length).toBe(0)
    expect(res.errors.length).toBe(1)
  })

  test('drops duplicate ids (keeps first)', () => {
    const raw = {
      invariants: [
        { id: 'same', name: 'one', rule: { kind: 'path-must-equal', path: 'x', value: 1 } },
        { id: 'same', name: 'two', rule: { kind: 'path-must-equal', path: 'y', value: 2 } },
      ],
    }
    const res = parseUserInvariants(raw)
    expect(res.invariants.length).toBe(1)
    expect(res.invariants[0]!.name).toBe('one')
    expect(res.errors.length).toBe(1)
    expect(res.errors[0]!.message).toMatch(/duplicate/i)
  })

  test('rejects unknown rule kinds', () => {
    const raw = {
      invariants: [
        {
          id: 'bad-kind',
          name: 'nope',
          rule: { kind: 'path-must-evaluate-js', path: 'x' },
        },
      ],
    }
    const res = parseUserInvariants(raw)
    expect(res.invariants.length).toBe(0)
  })

  test('path-must-contain-all requires a non-empty values array', () => {
    const raw = {
      invariants: [
        {
          id: 'empty-values',
          name: 'no values',
          rule: { kind: 'path-must-contain-all', path: 'x', values: [] },
        },
      ],
    }
    const res = parseUserInvariants(raw)
    expect(res.invariants.length).toBe(0)
    expect(res.errors.length).toBe(1)
  })

  test('accepts a missing `invariants` key (file has comments only)', () => {
    const res = parseUserInvariants({})
    expect(res.invariants).toEqual([])
    expect(res.errors).toEqual([])
  })

  test('rejects root that is not an object', () => {
    const res = parseUserInvariants([])
    expect(res.invariants).toEqual([])
    // Array is an object in JS, but `invariants` key is absent ⇒ returns empty,
    // matching the "missing invariants" branch. Passing a primitive scalar
    // instead triggers the `root must be a mapping` error.
    const res2 = parseUserInvariants('hello')
    expect(res2.errors.length).toBe(1)
  })
})

// --- rule kinds -----------------------------------------------------------

function makeDoc(yaml: string) {
  return parseDocument(yaml)
}

describe('evaluateUserInvariant', () => {
  test('path-must-equal: violates when scalar differs', () => {
    const doc = makeDoc('dns:\n  listen: 0.0.0.0:53\n')
    const inv: UserInvariant = {
      id: 'dns-listen',
      name: 'DNS listener must be localhost:1053',
      rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
    }
    const issue = evaluateUserInvariant(doc, inv)
    expect(issue).not.toBeNull()
    expect(issue!.code).toBe('USER_INVARIANT_dns-listen')
    expect(issue!.level).toBe('warning') // default level
    expect(issue!.path).toEqual(['dns', 'listen'])
  })

  test('path-must-equal: passes when scalar matches', () => {
    const doc = makeDoc('dns:\n  listen: 127.0.0.1:1053\n')
    const inv: UserInvariant = {
      id: 'dns-listen',
      name: 'n',
      rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
    }
    expect(evaluateUserInvariant(doc, inv)).toBeNull()
  })

  test('path-must-equal: absent key fails (missing value != expected)', () => {
    const doc = makeDoc('mode: rule\n')
    const inv: UserInvariant = {
      id: 'dns-listen',
      name: 'n',
      rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
    }
    expect(evaluateUserInvariant(doc, inv)).not.toBeNull()
  })

  test('path-must-equal: value=null treats "absent" and "null" both as passing', () => {
    // Supports examples/invariants/no-http-proxies.yaml — operator writes
    // `value: null` to mean "this listener must not be set".
    const absent = makeDoc('mode: rule\n')
    const explicitNull = makeDoc('port: ~\n')
    const present = makeDoc('port: 7890\n')
    const inv: UserInvariant = {
      id: 'no-port',
      name: 'n',
      rule: { kind: 'path-must-equal', path: 'port', value: null },
    }
    expect(evaluateUserInvariant(absent, inv)).toBeNull()
    expect(evaluateUserInvariant(explicitNull, inv)).toBeNull()
    expect(evaluateUserInvariant(present, inv)).not.toBeNull()
  })

  test('path-must-not-equal: violates on any forbidden match', () => {
    const doc = makeDoc('dns:\n  listen: "0.0.0.0:53"\n')
    const inv: UserInvariant = {
      id: 'no-wildcard-dns',
      name: 'n',
      level: 'error',
      rule: { kind: 'path-must-not-equal', path: 'dns.listen', values: ['0.0.0.0:53', ':53'] },
    }
    const issue = evaluateUserInvariant(doc, inv)
    expect(issue).not.toBeNull()
    expect(issue!.level).toBe('error')
  })

  test('path-must-not-equal: absent key passes (value is undefined, not forbidden)', () => {
    const doc = makeDoc('mode: rule\n')
    const inv: UserInvariant = {
      id: 'no-wildcard-dns',
      name: 'n',
      rule: { kind: 'path-must-not-equal', path: 'dns.listen', values: ['0.0.0.0:53'] },
    }
    expect(evaluateUserInvariant(doc, inv)).toBeNull()
  })

  test('path-must-be-in: violates when scalar is outside the allowlist', () => {
    const doc = makeDoc('mode: direct\n')
    const inv: UserInvariant = {
      id: 'rule-mode-only',
      name: 'n',
      rule: { kind: 'path-must-be-in', path: 'mode', values: ['rule'] },
    }
    expect(evaluateUserInvariant(doc, inv)).not.toBeNull()
  })

  test('path-must-be-in: passes when scalar is in allowlist', () => {
    const doc = makeDoc('mode: rule\n')
    const inv: UserInvariant = {
      id: 'rule-mode-only',
      name: 'n',
      rule: { kind: 'path-must-be-in', path: 'mode', values: ['rule', 'global'] },
    }
    expect(evaluateUserInvariant(doc, inv)).toBeNull()
  })

  test('path-must-contain-all: violates when list misses a required entry', () => {
    const doc = makeDoc('tun:\n  route-exclude-address:\n    - 10.0.0.0/8\n')
    const inv: UserInvariant = {
      id: 'proxy-ip-excluded',
      name: 'n',
      rule: {
        kind: 'path-must-contain-all',
        path: 'tun.route-exclude-address',
        values: ['91.132.58.113/32'],
      },
    }
    const issue = evaluateUserInvariant(doc, inv)
    expect(issue).not.toBeNull()
    expect((issue!.params as { reason: string }).reason).toMatch(/91\.132\.58\.113/)
  })

  test('path-must-contain-all: passes when every required entry is present', () => {
    const doc = makeDoc(
      'tun:\n  route-exclude-address:\n    - 91.132.58.113/32\n    - 10.0.0.0/8\n',
    )
    const inv: UserInvariant = {
      id: 'proxy-ip-excluded',
      name: 'n',
      rule: {
        kind: 'path-must-contain-all',
        path: 'tun.route-exclude-address',
        values: ['91.132.58.113/32'],
      },
    }
    expect(evaluateUserInvariant(doc, inv)).toBeNull()
  })

  test('path-must-contain-all: fails gracefully when value is not a list', () => {
    const doc = makeDoc('tun:\n  route-exclude-address: "10.0.0.0/8"\n')
    const inv: UserInvariant = {
      id: 'proxy-ip-excluded',
      name: 'n',
      rule: {
        kind: 'path-must-contain-all',
        path: 'tun.route-exclude-address',
        values: ['91.132.58.113/32'],
      },
    }
    const issue = evaluateUserInvariant(doc, inv)
    expect(issue).not.toBeNull()
    expect((issue!.params as { reason: string }).reason).toMatch(/list/i)
  })

  test('inactive invariants produce no issue regardless of doc', () => {
    const doc = makeDoc('dns:\n  listen: "0.0.0.0:53"\n')
    const inv: UserInvariant = {
      id: 'dns-listen',
      name: 'n',
      active: false,
      rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
    }
    expect(evaluateUserInvariant(doc, inv)).toBeNull()
  })
})

// --- checkUserInvariants (batch) ------------------------------------------

test('checkUserInvariants runs every active entry and concatenates issues', () => {
  const doc = makeDoc('dns:\n  listen: 0.0.0.0:53\nmode: direct\n')
  const invariants: UserInvariant[] = [
    {
      id: 'dns-listen',
      name: 'n',
      rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
    },
    {
      id: 'rule-mode',
      name: 'n',
      rule: { kind: 'path-must-be-in', path: 'mode', values: ['rule'] },
    },
    {
      // Inactive should not contribute.
      id: 'disabled',
      name: 'n',
      active: false,
      rule: { kind: 'path-must-equal', path: 'mode', value: 'direct' },
    },
  ]
  const issues = checkUserInvariants(doc, invariants)
  expect(issues.length).toBe(2)
  const codes = issues.map((i) => i.code)
  expect(codes).toContain('USER_INVARIANT_dns-listen')
  expect(codes).toContain('USER_INVARIANT_rule-mode')
  expect(codes).not.toContain('USER_INVARIANT_disabled')
})

// --- aggregator integration -----------------------------------------------

test('runSharedLinters merges user invariants with universal + other linters', () => {
  const doc = makeDoc(
    [
      'dns: { listen: 0.0.0.0:53 }', // universal: INVARIANT_DNS_LISTEN_ZERO53
      'mode: direct',
      'proxies: []',
      'proxy-groups: []',
      'rules:',
      '  - MATCH,DIRECT',
    ].join('\n'),
  )
  const userInvariants: UserInvariant[] = [
    {
      id: 'rule-mode',
      name: 'n',
      level: 'error',
      rule: { kind: 'path-must-be-in', path: 'mode', values: ['rule'] },
    },
  ]
  const issues = runSharedLinters(doc, { userInvariants })
  const codes = issues.map((i) => i.code)
  expect(codes).toContain('INVARIANT_DNS_LISTEN_ZERO53')
  expect(codes).toContain('USER_INVARIANT_rule-mode')
})

test('runSharedLinters without userInvariants option still emits universal issues', () => {
  const doc = makeDoc('dns: { listen: 0.0.0.0:53 }\nproxies: []\nproxy-groups: []\nrules: []\n')
  const issues = runSharedLinters(doc)
  expect(issues.some((i) => i.code === 'INVARIANT_DNS_LISTEN_ZERO53')).toBe(true)
})
