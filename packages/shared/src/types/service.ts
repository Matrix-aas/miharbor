// Service — virtual Miharbor construct pairing a mihomo proxy-group with the
// rules that route into it. 1:1 with proxy-groups; deduced, not stored.

import type { Rule } from './rule.ts'
import type { Issue } from './issue.ts'

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
