// Service — virtual Miharbor construct pairing a mihomo proxy-group with the
// rules that route into it. 1:1 with proxy-groups; deduced, not stored.

import { Type } from '@sinclair/typebox'
import type { Rule } from './rule.ts'
import type { Issue } from './issue.ts'
import { RuleSchema } from './rule.ts'
import { IssueSchema } from './issue.ts'

export type ProxyGroupType = 'select' | 'url-test' | 'fallback' | 'load-balance' | 'relay'

export interface ProxyGroup {
  name: string
  type: ProxyGroupType
  proxies: string[] // names of other proxies/groups/DIRECT/REJECT
  url?: string
  interval?: number
  hidden?: boolean
}

export interface Service {
  name: string // == group.name
  group: ProxyGroup
  rules: { index: number; rule: Rule }[] // index in the global rules array
  direction: 'VPN' | 'DIRECT' | 'REJECT' | 'MIXED' // deduced from current selection
  issues: Issue[]
}

// --- TypeBox schemas (I7) -------------------------------------------------

export const ProxyGroupTypeSchema = Type.Union([
  Type.Literal('select'),
  Type.Literal('url-test'),
  Type.Literal('fallback'),
  Type.Literal('load-balance'),
  Type.Literal('relay'),
])

export const ProxyGroupSchema = Type.Object({
  name: Type.String(),
  type: ProxyGroupTypeSchema,
  proxies: Type.Array(Type.String()),
  url: Type.Optional(Type.String()),
  interval: Type.Optional(Type.Number()),
  hidden: Type.Optional(Type.Boolean()),
})

export const ServiceDirectionSchema = Type.Union([
  Type.Literal('VPN'),
  Type.Literal('DIRECT'),
  Type.Literal('REJECT'),
  Type.Literal('MIXED'),
])

export const ServiceSchema = Type.Object({
  name: Type.String(),
  group: ProxyGroupSchema,
  rules: Type.Array(
    Type.Object({
      index: Type.Integer({ minimum: 0 }),
      rule: RuleSchema,
    }),
  ),
  direction: ServiceDirectionSchema,
  issues: Type.Array(IssueSchema),
})
