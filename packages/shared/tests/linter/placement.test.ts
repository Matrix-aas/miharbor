import { expect, test } from 'bun:test'
import { classifyRule, suggestPlacement } from '../../src/linter/placement.ts'
import type { Rule } from '../../src/types/rule.ts'

// --- Classification tests ---

test('classifyRule: REJECT target → ads', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'example.com',
    target: 'REJECT',
  }
  expect(classifyRule(rule)).toBe('ads')
})

test('classifyRule: ad-blocking keyword in value → ads', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'adguard.pro',
    target: 'MyGroup',
  }
  expect(classifyRule(rule)).toBe('ads')
})

test('classifyRule: "adblock" in value → ads', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'adblock.org',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('ads')
})

test('classifyRule: RFC1918 IP-CIDR → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'IP-CIDR',
    value: '192.168.1.0/24',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: 10.0.0.0/8 IP-CIDR → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'IP-CIDR',
    value: '10.0.0.0/8',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: 172.16.0.0/12 IP-CIDR → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'IP-CIDR',
    value: '172.16.0.0/12',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: IPv6 loopback ::1 → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'IP-CIDR6',
    value: '::1/128',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: DOMAIN-SUFFIX,.lan → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'lan',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: DOMAIN-SUFFIX,.local → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'local',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: DOMAIN-SUFFIX,.home → private', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'home',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('private')
})

test('classifyRule: GEOSITE,category-ru → ru', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'GEOSITE',
    value: 'category-ru',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('ru')
})

test('classifyRule: GEOIP,RU (case-insensitive) → ru', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'GEOIP',
    value: 'RU',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('ru')
})

test('classifyRule: DOMAIN-SUFFIX,.ru → ru', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'yandex.ru',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('ru')
})

test('classifyRule: DOMAIN-SUFFIX,.by (Belarus) → ru', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'example.by',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('ru')
})

test('classifyRule: DOMAIN-SUFFIX with Cyrillic .рф → ru', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'example.рф',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('ru')
})

test('classifyRule: DOMAIN-SUFFIX,spotify.com (service domain) → services', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'spotify.com',
    target: 'MyVPN',
  }
  expect(classifyRule(rule)).toBe('services')
})

test('classifyRule: GEOSITE,youtube (non-ru category) → services', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'GEOSITE',
    value: 'youtube',
    target: 'MyVPN',
  }
  expect(classifyRule(rule)).toBe('services')
})

test('classifyRule: GEOSITE,category-cn → services', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'GEOSITE',
    value: 'category-cn',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('services')
})

test('classifyRule: GEOIP,CN → services', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'GEOIP',
    value: 'CN',
    target: 'MyVPN',
  }
  expect(classifyRule(rule)).toBe('services')
})

test('classifyRule: MATCH,DIRECT → match', () => {
  const rule: Rule = {
    kind: 'match',
    target: 'DIRECT',
  }
  expect(classifyRule(rule)).toBe('match')
})

test('classifyRule: PROCESS-NAME → services', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'PROCESS-NAME',
    value: 'telegram',
    target: 'MyVPN',
  }
  expect(classifyRule(rule)).toBe('services')
})

test('classifyRule: DST-PORT → services', () => {
  const rule: Rule = {
    kind: 'simple',
    type: 'DST-PORT',
    value: '443',
    target: 'MyVPN',
  }
  expect(classifyRule(rule)).toBe('services')
})

test('classifyRule: logical AND rule → services', () => {
  const rule: Rule = {
    kind: 'logical',
    op: 'AND',
    children: [
      {
        kind: 'simple',
        type: 'DOMAIN-SUFFIX',
        value: 'example.com',
        target: 'DIRECT',
      },
    ],
    target: 'MyGroup',
  }
  expect(classifyRule(rule)).toBe('services')
})

// --- Placement tests ---

test('suggestPlacement: empty list → index 0', () => {
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'example.com',
    target: 'MyVPN',
  }
  const result = suggestPlacement(newRule, [])
  expect(result.index).toBe(0)
  expect(result.category).toBe('services')
  expect(result.reason).toBe('placement_reason_empty')
})

test('suggestPlacement: adding ad-block DOMAIN-SUFFIX to empty list → index 0, reason ads', () => {
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'adguard.pro',
    target: 'REJECT',
  }
  const result = suggestPlacement(newRule, [])
  expect(result.index).toBe(0)
  expect(result.category).toBe('ads')
  expect(result.reason).toBe('placement_reason_empty')
})

test('suggestPlacement: add service after existing service block', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'netflix.com',
      target: 'MyVPN',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'youtube.com',
    target: 'MyVPN',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.index).toBe(2) // after the last service
  expect(result.category).toBe('services')
  expect(result.reason).toBe('placement_reason_services')
})

test('suggestPlacement: add ad-block before services', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'ads.com',
    target: 'REJECT',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.index).toBe(0) // before the service
  expect(result.category).toBe('ads')
  expect(result.reason).toBe('placement_reason_ads')
})

test('suggestPlacement: add private rule before ru', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'yandex.ru',
      target: 'DIRECT',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'lan',
    target: 'DIRECT',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.index).toBe(0) // private comes before ru
  expect(result.category).toBe('private')
  expect(result.reason).toBe('placement_reason_private')
})

test('suggestPlacement: add ru rule before services', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'yandex.ru',
    target: 'DIRECT',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.index).toBe(0) // ru comes before services
  expect(result.category).toBe('ru')
  expect(result.reason).toBe('placement_reason_ru')
})

test('suggestPlacement: add MATCH rule always at the end', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
    {
      kind: 'match',
      target: 'DIRECT',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'youtube.com',
    target: 'MyVPN',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.index).toBe(1) // before the MATCH rule
  expect(result.category).toBe('services')
})

test('suggestPlacement: comprehensive category ordering', () => {
  // Full rule set with all 5 categories
  const existing: Rule[] = [
    // ads
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'ads.com',
      target: 'REJECT',
    },
    // private
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'lan',
      target: 'DIRECT',
    },
    // ru
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'yandex.ru',
      target: 'DIRECT',
    },
    // services
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
    // match
    {
      kind: 'match',
      target: 'DIRECT',
    },
  ]

  // Add another ad-block rule → should go after first ads rule
  const adRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'tracker.com',
    target: 'REJECT',
  }
  expect(suggestPlacement(adRule, existing).index).toBe(1) // after ads, before private

  // Add another ru rule → should go after ru, before services
  const ruRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'vk.ru',
    target: 'DIRECT',
  }
  expect(suggestPlacement(ruRule, existing).index).toBe(3) // after yandex.ru, before spotify

  // Add another service → should go after services, before match
  const svcRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'youtube.com',
    target: 'MyVPN',
  }
  expect(suggestPlacement(svcRule, existing).index).toBe(4) // after spotify, before match
})

test('suggestPlacement: add new category between existing categories', () => {
  // Only ads and services, no private/ru in between
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'ads.com',
      target: 'REJECT',
    },
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
  ]

  // Add a private rule → should go between ads and services
  const privateRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'lan',
    target: 'DIRECT',
  }
  const result = suggestPlacement(privateRule, existing)
  expect(result.index).toBe(1) // between ads and services
  expect(result.category).toBe('private')
})

test('suggestPlacement: multiple ads rules grouped together', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'ads1.com',
      target: 'REJECT',
    },
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'ads2.com',
      target: 'REJECT',
    },
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'ads3.com',
      target: 'REJECT',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'ads4.com',
    target: 'REJECT',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.index).toBe(3) // after all existing ads rules
  expect(result.category).toBe('ads')
})

test('suggestPlacement: match rule is recognized as end of list', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
    {
      kind: 'match',
      target: 'DIRECT',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'youtube.com',
    target: 'MyVPN',
  }
  const result = suggestPlacement(newRule, existing)
  // Should place before the MATCH rule
  expect(result.index).toBe(1)
  expect(existing[result.index]!.kind).toBe('match')
})

test('suggestPlacement: case-insensitive domain matching', () => {
  const existing: Rule[] = []
  // YaNeX.Ru (mixed case)
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'YaNeX.RU',
    target: 'DIRECT',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.category).toBe('ru')
})

test('suggestPlacement: .local domain recognized as private', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'DOMAIN-SUFFIX',
    value: 'router.local',
    target: 'DIRECT',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.category).toBe('private')
  expect(result.index).toBe(0) // before services
})

test('suggestPlacement: public IP-CIDR goes to services', () => {
  const existing: Rule[] = [
    {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'spotify.com',
      target: 'MyVPN',
    },
  ]
  const newRule: Rule = {
    kind: 'simple',
    type: 'IP-CIDR',
    value: '8.8.8.0/24',
    target: 'MyVPN',
  }
  const result = suggestPlacement(newRule, existing)
  expect(result.category).toBe('services')
  expect(result.index).toBe(1) // after existing services
})
