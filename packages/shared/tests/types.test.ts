import { expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { IssueSchema, type Issue } from '../src/types/issue.ts'
import {
  RuleSchema,
  RULE_TYPES,
  SIMPLE_RULE_TYPES,
  type Rule,
  type SimpleRule,
  type LogicalRule,
  type MatchRule,
} from '../src/types/rule.ts'
import { ServiceSchema, type Service } from '../src/types/service.ts'
import { ProxyNodeSchema, type ProxyNode } from '../src/types/proxy-node.ts'
import {
  isAnyMiharborSentinel,
  isMiharborViewSentinel,
  isVaultSentinel,
  META_SECRET_SENTINEL,
  VAULT_SENTINEL_PREFIX,
  WIREGUARD_PRE_SHARED_KEY_SENTINEL,
  WIREGUARD_PRIVATE_KEY_SENTINEL,
} from '../src/types/sentinels.ts'

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
  expect(typeof mod.RuleSchema).toBeDefined()
  expect(typeof mod.ServiceSchema).toBeDefined()
  expect(typeof mod.ProxyNodeSchema).toBeDefined()
  expect(Array.isArray(mod.RULE_TYPES)).toBe(true)
})

// --- I8: RULE_TYPES as const --------------------------------------------

test('RULE_TYPES is a frozen/const list covering all rule types (I8)', () => {
  expect(RULE_TYPES).toContain('DOMAIN-SUFFIX')
  expect(RULE_TYPES).toContain('MATCH')
  expect(RULE_TYPES).toContain('AND')
  expect(RULE_TYPES).toContain('OR')
  expect(RULE_TYPES).toContain('NOT')
  // Mihomo 1.19+ types — kept in sync with rule.ts.
  expect(RULE_TYPES).toContain('IN-PORT')
  expect(RULE_TYPES).toContain('PROCESS-PATH')
  expect(RULE_TYPES).toContain('SUB-RULE')
  expect(RULE_TYPES).toContain('DSCP')
  expect(RULE_TYPES.length).toBe(29)
})

test('SIMPLE_RULE_TYPES excludes logical ops and MATCH (I8)', () => {
  expect(SIMPLE_RULE_TYPES).not.toContain('AND')
  expect(SIMPLE_RULE_TYPES).not.toContain('OR')
  expect(SIMPLE_RULE_TYPES).not.toContain('NOT')
  expect(SIMPLE_RULE_TYPES).not.toContain('MATCH')
  expect(SIMPLE_RULE_TYPES).toContain('DOMAIN-SUFFIX')
  expect(SIMPLE_RULE_TYPES).toContain('GEOIP')
})

// --- I7: RuleSchema ------------------------------------------------------

test('RuleSchema accepts a valid SimpleRule (I7)', () => {
  const rule: SimpleRule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'example.com',
    target: 'MyGroup',
    modifiers: ['no-resolve'],
  }
  expect(Value.Check(RuleSchema, rule)).toBe(true)
})

test('RuleSchema accepts a valid MatchRule (I7)', () => {
  const rule: MatchRule = { kind: 'match', target: 'PROXY' }
  expect(Value.Check(RuleSchema, rule)).toBe(true)
})

test('RuleSchema accepts a valid LogicalRule with nested simple children (I7)', () => {
  const rule: LogicalRule = {
    kind: 'logical',
    op: 'AND',
    target: 'PROXY',
    children: [
      { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'example.com', target: 'PROXY' },
      { kind: 'simple', type: 'DST-PORT', value: '443', target: 'PROXY' },
    ],
  }
  expect(Value.Check(RuleSchema, rule)).toBe(true)
})

test('RuleSchema accepts deeply nested logical rules (I7)', () => {
  const rule: LogicalRule = {
    kind: 'logical',
    op: 'OR',
    target: 'PROXY',
    children: [
      {
        kind: 'logical',
        op: 'AND',
        target: 'PROXY',
        children: [
          { kind: 'simple', type: 'GEOIP', value: 'CN', target: 'PROXY' },
          { kind: 'simple', type: 'DOMAIN', value: 'a.com', target: 'PROXY' },
        ],
      },
      { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'b.com', target: 'PROXY' },
    ],
  }
  expect(Value.Check(RuleSchema, rule)).toBe(true)
})

test('RuleSchema rejects empty object (I7)', () => {
  expect(Value.Check(RuleSchema, {})).toBe(false)
})

test('RuleSchema rejects simple rule with AND in type field (I7)', () => {
  expect(
    Value.Check(RuleSchema, {
      kind: 'simple',
      type: 'AND',
      value: 'x',
      target: 'PROXY',
    }),
  ).toBe(false)
})

test('RuleSchema rejects simple rule with unknown type (I7)', () => {
  expect(
    Value.Check(RuleSchema, {
      kind: 'simple',
      type: 'DOMAIN-BOGUS',
      value: 'x',
      target: 'PROXY',
    }),
  ).toBe(false)
})

test('RuleSchema rejects logical rule with bad op (I7)', () => {
  expect(
    Value.Check(RuleSchema, {
      kind: 'logical',
      op: 'XOR',
      target: 'PROXY',
      children: [],
    }),
  ).toBe(false)
})

// --- I7: ServiceSchema ---------------------------------------------------

test('ServiceSchema accepts a valid service (I7)', () => {
  const service: Service = {
    name: 'International',
    group: {
      name: 'International',
      type: 'select',
      proxies: ['wg-nl', 'DIRECT'],
    },
    rules: [
      {
        index: 0,
        rule: {
          kind: 'simple',
          type: 'DOMAIN-SUFFIX',
          value: 'google.com',
          target: 'International',
        },
      },
    ],
    direction: 'VPN',
    issues: [],
  }
  expect(Value.Check(ServiceSchema, service)).toBe(true)
})

test('ServiceSchema accepts a service with issues (I7)', () => {
  const service: Service = {
    name: 'X',
    group: { name: 'X', type: 'fallback', proxies: ['a'] },
    rules: [],
    direction: 'MIXED',
    issues: [{ level: 'warning', code: 'LINTER_FOO', path: ['proxy-groups', 0] }],
  }
  expect(Value.Check(ServiceSchema, service)).toBe(true)
})

test('ServiceSchema rejects empty object (I7)', () => {
  expect(Value.Check(ServiceSchema, {})).toBe(false)
})

test('ServiceSchema rejects bad direction (I7)', () => {
  expect(
    Value.Check(ServiceSchema, {
      name: 'X',
      group: { name: 'X', type: 'select', proxies: [] },
      rules: [],
      direction: 'SIDEWAYS',
      issues: [],
    }),
  ).toBe(false)
})

// --- I7: ProxyNodeSchema -------------------------------------------------

test('ProxyNodeSchema accepts a valid WireGuard node (I7)', () => {
  const node: ProxyNode = {
    name: 'wg-nl',
    type: 'wireguard',
    server: 'vpn.example.com',
    port: 51820,
    udp: true,
    'private-key': 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=',
    'public-key': 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy=',
    ip: '10.200.200.2/32',
    dns: ['1.1.1.1'],
    'allowed-ips': ['0.0.0.0/0'],
    'persistent-keepalive': 25,
    'amnezia-wg-option': { Jc: 4, Jmin: 50, Jmax: 1000 },
  }
  expect(Value.Check(ProxyNodeSchema, node)).toBe(true)
})

test('ProxyNodeSchema accepts a generic shadowsocks node with extra keys (I7)', () => {
  const node: ProxyNode = {
    name: 'ss-jp',
    type: 'ss',
    server: 'jp.example.com',
    port: 8388,
    udp: true,
    cipher: 'aes-256-gcm',
    password: 'secret',
  }
  expect(Value.Check(ProxyNodeSchema, node)).toBe(true)
})

test('ProxyNodeSchema rejects empty object (I7)', () => {
  expect(Value.Check(ProxyNodeSchema, {})).toBe(false)
})

test('ProxyNodeSchema rejects WireGuard node missing private-key (I7)', () => {
  expect(
    Value.Check(ProxyNodeSchema, {
      name: 'wg',
      type: 'wireguard',
      server: 'x',
      port: 51820,
      'public-key': 'y',
      ip: '10.200.200.2/32',
    }),
  ).toBe(false)
})

test('ProxyNodeSchema rejects unknown node type (I7)', () => {
  expect(
    Value.Check(ProxyNodeSchema, {
      name: 'bogus',
      type: 'quic-thing',
      server: 'x',
      port: 1234,
    }),
  ).toBe(false)
})

test('ProxyNodeSchema rejects out-of-range port (I7)', () => {
  expect(
    Value.Check(ProxyNodeSchema, {
      name: 'x',
      type: 'http',
      server: 'x',
      port: 99999,
    }),
  ).toBe(false)
})

// Rule — unused locals silencer for Rule union type (forces TS to keep the type imported).
test('Rule union type is importable (I7/I8)', () => {
  const r: Rule = { kind: 'match', target: 'PROXY' }
  expect(r.kind).toBe('match')
})

// --- sentinels (v0.2.6) --------------------------------------------------

test('isVaultSentinel accepts per-value vault-prefixed strings', () => {
  expect(isVaultSentinel('$MIHARBOR_VAULT:09e0bb8a-acf0-4953-a75f-0e9fd2146a0d')).toBe(true)
  expect(isVaultSentinel(`${VAULT_SENTINEL_PREFIX}abc`)).toBe(true)
})

test('isVaultSentinel rejects non-prefixed or non-string values', () => {
  expect(isVaultSentinel('not-a-sentinel')).toBe(false)
  expect(isVaultSentinel('MIHARBOR_VAULT:abc')).toBe(false) // missing leading $
  expect(isVaultSentinel('')).toBe(false)
  expect(isVaultSentinel(undefined)).toBe(false)
  expect(isVaultSentinel(null)).toBe(false)
  expect(isVaultSentinel(42)).toBe(false)
})

test('isMiharborViewSentinel and isVaultSentinel are disjoint', () => {
  // Fixed view-scope sentinels don't start with the vault prefix, so the
  // two predicates never overlap. Forms combine them via isAnyMiharborSentinel.
  expect(isVaultSentinel(META_SECRET_SENTINEL)).toBe(false)
  expect(isVaultSentinel(WIREGUARD_PRIVATE_KEY_SENTINEL)).toBe(false)
  expect(isVaultSentinel(WIREGUARD_PRE_SHARED_KEY_SENTINEL)).toBe(false)
  expect(isMiharborViewSentinel('$MIHARBOR_VAULT:abc')).toBe(false)
})

test('isAnyMiharborSentinel covers both fixed and per-value sentinels', () => {
  expect(isAnyMiharborSentinel(META_SECRET_SENTINEL)).toBe(true)
  expect(isAnyMiharborSentinel(WIREGUARD_PRIVATE_KEY_SENTINEL)).toBe(true)
  expect(isAnyMiharborSentinel(WIREGUARD_PRE_SHARED_KEY_SENTINEL)).toBe(true)
  expect(isAnyMiharborSentinel('$MIHARBOR_VAULT:abc')).toBe(true)
  expect(isAnyMiharborSentinel('something else')).toBe(false)
})
