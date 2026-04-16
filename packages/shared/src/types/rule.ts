// Rule — parsed form of mihomo's `rules:` array entries.
// Three shapes:
//   SimpleRule  — "DOMAIN-SUFFIX,example.com,MyGroup"
//   LogicalRule — "AND,((...)),Target"
//   MatchRule   — "MATCH,Target"

import { Type, type Static, type TSchema } from '@sinclair/typebox'

// I8: canonical list of rule-type strings, as const, exported so validators /
// parsers / UIs can iterate without drifting from the type union.
export const RULE_TYPES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-ASN',
  'SRC-IP-CIDR',
  'DST-PORT',
  'SRC-PORT',
  'PROCESS-NAME',
  'NETWORK',
  'RULE-SET',
  'AND',
  'OR',
  'NOT',
  'MATCH',
] as const

export type RuleType = (typeof RULE_TYPES)[number]

export const LOGICAL_OPS = ['AND', 'OR', 'NOT'] as const
export type LogicalOp = (typeof LOGICAL_OPS)[number]

// Types usable as a SimpleRule predicate — everything except logical
// combinators and the MATCH catch-all.
export type SimpleRuleType = Exclude<RuleType, LogicalOp | 'MATCH'>
export const SIMPLE_RULE_TYPES: readonly SimpleRuleType[] = RULE_TYPES.filter(
  (t): t is SimpleRuleType => t !== 'AND' && t !== 'OR' && t !== 'NOT' && t !== 'MATCH',
)

export interface SimpleRule {
  kind: 'simple'
  type: SimpleRuleType
  value: string
  target: string // proxy-group name or DIRECT/PROXY/REJECT
  modifiers?: string[] // ["no-resolve"]
}

export interface LogicalRule {
  kind: 'logical'
  op: LogicalOp
  children: Rule[]
  target: string
}

export interface MatchRule {
  kind: 'match'
  target: string
}

export type Rule = SimpleRule | LogicalRule | MatchRule

// --- TypeBox schemas (I7) -------------------------------------------------
// Runtime-validated counterparts to the TS types above. `RuleSchema` is a
// discriminated union on `kind` so `Value.Check` gives actionable error paths.

export const SimpleRuleTypeSchema = Type.Union(
  SIMPLE_RULE_TYPES.map((t) => Type.Literal(t)) as unknown as [TSchema, ...TSchema[]],
)

export const LogicalOpSchema = Type.Union([
  Type.Literal('AND'),
  Type.Literal('OR'),
  Type.Literal('NOT'),
])

export const SimpleRuleSchema = Type.Object({
  kind: Type.Literal('simple'),
  type: SimpleRuleTypeSchema,
  value: Type.String(),
  target: Type.String(),
  modifiers: Type.Optional(Type.Array(Type.String())),
})

// LogicalRule is self-referential (children: Rule[]). TypeBox `Recursive` gives
// us a schema that references itself through `This`.
export const RuleSchema = Type.Recursive(
  (This) =>
    Type.Union([
      SimpleRuleSchema,
      Type.Object({
        kind: Type.Literal('logical'),
        op: LogicalOpSchema,
        children: Type.Array(This),
        target: Type.String(),
      }),
      Type.Object({
        kind: Type.Literal('match'),
        target: Type.String(),
      }),
    ]),
  { $id: 'Rule' },
)

// Narrow schema exports for convenience.
export const LogicalRuleSchema = Type.Object({
  kind: Type.Literal('logical'),
  op: LogicalOpSchema,
  children: Type.Array(RuleSchema),
  target: Type.String(),
})

export const MatchRuleSchema = Type.Object({
  kind: Type.Literal('match'),
  target: Type.String(),
})

// Sanity-check: Static<typeof RuleSchema> should be structurally compatible
// with `Rule`. TS won't complain about recursive TypeBox here, but we deliberately
// don't re-alias to avoid clashing with the hand-written interfaces above.
export type RuleStatic = Static<typeof RuleSchema>
