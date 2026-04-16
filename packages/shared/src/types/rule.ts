// Rule — parsed form of mihomo's `rules:` array entries.
// Three shapes:
//   SimpleRule  — "DOMAIN-SUFFIX,example.com,MyGroup"
//   LogicalRule — "AND,((...)),Target"
//   MatchRule   — "MATCH,Target"

export type RuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'DOMAIN-REGEX'
  | 'GEOSITE'
  | 'GEOIP'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'IP-ASN'
  | 'SRC-IP-CIDR'
  | 'DST-PORT'
  | 'SRC-PORT'
  | 'PROCESS-NAME'
  | 'NETWORK'
  | 'RULE-SET'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'MATCH'

export interface SimpleRule {
  kind: 'simple'
  type: Exclude<RuleType, 'AND' | 'OR' | 'NOT' | 'MATCH'>
  value: string
  target: string // proxy-group name or DIRECT/PROXY/REJECT
  modifiers?: string[] // ["no-resolve"]
}

export interface LogicalRule {
  kind: 'logical'
  op: 'AND' | 'OR' | 'NOT'
  children: Rule[]
  target: string
}

export interface MatchRule {
  kind: 'match'
  target: string
}

export type Rule = SimpleRule | LogicalRule | MatchRule
