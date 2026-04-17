// Auto-placement linter (Linter 5 / Task 43).
//
// Classifies rules into 5 categories based on content:
//   1. ads       — REJECT target or ad-blocking patterns
//   2. private   — RFC1918 ranges, localhost, local domain suffixes
//   3. ru        — Russian domains (.ru/.by/.рф), GEOIP,RU, GEOSITE,category-ru
//   4. services  — named service rules (GEOSITE,youtube, DOMAIN-SUFFIX,spotify.com)
//   5. match     — the catch-all MATCH rule (always last)
//
// suggestPlacement() finds the first index where the newRule's category begins
// and suggests placing it after the last rule in that same block (if it exists),
// otherwise at the start of the category. If the category doesn't exist, it
// falls back to the end (before MATCH if MATCH exists).
//
// Exported reasons are keyed by i18n for UI display:
//   * 'placement_reason_ads'
//   * 'placement_reason_private'
//   * 'placement_reason_ru'
//   * 'placement_reason_services'
//   * 'placement_reason_match'
//   * 'placement_reason_empty'

import type { Rule } from '../types/rule.ts'

export type RuleCategory = 'ads' | 'private' | 'ru' | 'services' | 'match'

export interface PlacementSuggestion {
  index: number
  category: RuleCategory
  reason: string // i18n key, e.g. 'placement_reason_ads'
}

// --- Classifiers ---

/** Check if a rule's value contains ad-blocking indicators. */
function isAdBlockValue(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    lower.includes('adguard') ||
    lower.includes('adblock') ||
    lower.includes('ads') ||
    lower.includes('tracker') ||
    lower.includes('malware')
  )
}

/** Check if a rule's target is REJECT. */
function isRejectTarget(target: string): boolean {
  return target === 'REJECT'
}

/** Check if a string matches Russian domain patterns. */
function isRussianDomain(value: string): boolean {
  const lower = value.toLowerCase()
  // Domain suffix / keyword / regex suffixes: .ru, .by, .рф
  return /\.(ru|by|рф)$/.test(lower)
}

/** Check if value is a private RFC1918 CIDR or localhost. */
function isPrivateIP(value: string): boolean {
  // Avoid regex; just check prefixes for common patterns.
  const lower = value.toLowerCase()
  return (
    lower.startsWith('10.') ||
    lower.startsWith('172.16.') ||
    lower.startsWith('192.168.') ||
    lower.startsWith('127.') ||
    lower === 'localhost' ||
    value.startsWith('::1') || // IPv6 loopback
    value.startsWith('fc00:') || // IPv6 ULA
    value.startsWith('fe80::') // IPv6 link-local
  )
}

/** Check if value is a private domain suffix (lan, local, home, internal, localhost). */
function isPrivateDomainSuffix(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    lower === 'localhost' ||
    lower === 'lan' ||
    lower === 'local' ||
    lower === 'home' ||
    lower === 'internal' ||
    lower.endsWith('.lan') ||
    lower.endsWith('.local') ||
    lower.endsWith('.home') ||
    lower.endsWith('.internal')
  )
}

/** Check if value is a GEOSITE category-ru or GEOIP,RU pattern. */
function isRussianGeo(type: string, value: string): boolean {
  const lower = value.toLowerCase()
  // GEOSITE,category-ru
  if (type === 'GEOSITE' && lower === 'category-ru') return true
  // GEOIP,RU (Russia country code)
  if (type === 'GEOIP' && lower === 'ru') return true
  return false
}

/** Check if a value looks like a GEOSITE category (not category-ru). */
function isGeoSiteCategory(type: string, value: string): boolean {
  return type === 'GEOSITE' && value.toLowerCase().startsWith('category-')
}

/** Check if a value looks like a named service domain. */
function isServiceDomain(type: string, value: string): boolean {
  const lower = value.toLowerCase()
  // Common service domains: spotify.com, youtube.com, netflix.com, etc.
  // Also includes shorthand: GEOSITE,youtube → service
  // DOMAIN-SUFFIX,example.com where example is a known service → service
  // heuristic: if type is DOMAIN-SUFFIX/DOMAIN and value has a dot and is not private,
  // and not a Russian domain, it's likely a service.
  if (type === 'GEOSITE' && !isGeoSiteCategory(type, value)) return false // GEOSITE categories go to services
  if (
    (type === 'DOMAIN' || type === 'DOMAIN-SUFFIX' || type === 'DOMAIN-KEYWORD') &&
    lower.includes('.')
  ) {
    return !isPrivateDomainSuffix(lower) && !isRussianDomain(lower)
  }
  return false
}

/**
 * Classify a rule into one of 5 categories.
 *
 * Order of checks matters — we check in priority:
 *   1. ads
 *   2. private
 *   3. ru
 *   4. services (including GEOSITE categories)
 *   5. match (only for actual MATCH rules)
 *
 * Fallback to services for anything else that looks rule-ish.
 */
export function classifyRule(rule: Rule): RuleCategory {
  // MATCH rules always map to 'match' category.
  if (rule.kind === 'match') return 'match'

  // Logical rules (AND/OR/NOT) are treated as services (grouped with others).
  if (rule.kind === 'logical') return 'services'

  // SimpleRule — check type and value.
  const { type, value, target } = rule

  // 1. Ads block
  if (isRejectTarget(target) || isAdBlockValue(value)) return 'ads'

  // 2. Private block (IP ranges + private domains)
  if (type === 'IP-CIDR' || type === 'IP-CIDR6' || type === 'SRC-IP-CIDR') {
    if (isPrivateIP(value)) return 'private'
  }
  if (
    type === 'DOMAIN-SUFFIX' ||
    type === 'DOMAIN-KEYWORD' ||
    type === 'DOMAIN-REGEX' ||
    type === 'DOMAIN'
  ) {
    if (isPrivateDomainSuffix(value)) return 'private'
  }

  // 3. RU block (Russian domains + geo rules)
  if (isRussianGeo(type, value)) return 'ru'
  if (
    type === 'DOMAIN-SUFFIX' ||
    type === 'DOMAIN-KEYWORD' ||
    type === 'DOMAIN-REGEX' ||
    type === 'DOMAIN'
  ) {
    if (isRussianDomain(value)) return 'ru'
  }

  // 4. Services block (everything else that's a matching rule)
  // Includes: named services, GEOSITE categories, GEOIP (non-RU), process rules, etc.
  if (isServiceDomain(type, value) || isGeoSiteCategory(type, value)) return 'services'
  if (type === 'GEOIP') return 'services'
  if (type === 'SRC-GEOIP') return 'services'
  if (type === 'IP-ASN') return 'services'
  if (
    type === 'PROCESS-NAME' ||
    type === 'PROCESS-NAME-REGEX' ||
    type === 'PROCESS-PATH' ||
    type === 'PROCESS-PATH-REGEX'
  ) {
    return 'services'
  }
  if (type === 'IN-PORT' || type === 'DST-PORT' || type === 'SRC-PORT') return 'services'
  if (
    type === 'IN-TYPE' ||
    type === 'IN-USER' ||
    type === 'NETWORK' ||
    type === 'DSCP' ||
    type === 'UID'
  ) {
    return 'services'
  }
  if (type === 'RULE-SET' || type === 'SUB-RULE') return 'services'

  // 5. Fallback: treat unknown types as services.
  return 'services'
}

/**
 * Find the suggested index for inserting a new rule based on its category.
 *
 * Strategy:
 *   - Find the range [startIdx, endIdx) of the new rule's category in existingRules.
 *   - If the range exists, return endIdx (i.e., after the last rule in that category).
 *   - If the range doesn't exist, find where the category "should" go in the ordered
 *     sequence [ads, private, ru, services, match] and return the index of the
 *     first rule in the next category, or the end of the list if no next category exists.
 *   - Special case: if adding a MATCH rule to an empty list, return 0. If the list
 *     already has a MATCH rule, return its index (replace it, or append before it).
 *
 * Returns an object with:
 *   - index: the suggested position
 *   - category: the classified category of the new rule
 *   - reason: i18n key describing why (e.g., 'placement_reason_ads')
 */
export function suggestPlacement(newRule: Rule, existingRules: Rule[] = []): PlacementSuggestion {
  const newCategory = classifyRule(newRule)

  if (existingRules.length === 0) {
    return {
      index: 0,
      category: newCategory,
      reason: 'placement_reason_empty',
    }
  }

  // Category priority: ads < private < ru < services < match
  const categoryOrder: RuleCategory[] = ['ads', 'private', 'ru', 'services', 'match']
  const newCategoryPriority = categoryOrder.indexOf(newCategory)

  // Find the range of rules with the same category as newRule.
  let sameCategory: { start: number; end: number } | null = null
  for (let i = 0; i < existingRules.length; i++) {
    const rule = existingRules[i]
    if (!rule) continue
    const cat = classifyRule(rule)
    if (cat === newCategory) {
      if (!sameCategory) sameCategory = { start: i, end: i + 1 }
      else sameCategory.end = i + 1
    }
  }

  // If the new rule's category already exists, place after the last rule of that category.
  if (sameCategory) {
    return {
      index: sameCategory.end,
      category: newCategory,
      reason: `placement_reason_${newCategory}`,
    }
  }

  // The category doesn't exist yet. Find where it should go by looking at the
  // first rule in each category that comes after newCategory in the priority order.
  for (let i = newCategoryPriority + 1; i < categoryOrder.length; i++) {
    const targetCategory = categoryOrder[i]
    for (let j = 0; j < existingRules.length; j++) {
      const rule = existingRules[j]
      if (!rule) continue
      if (classifyRule(rule) === targetCategory) {
        return {
          index: j,
          category: newCategory,
          reason: `placement_reason_${newCategory}`,
        }
      }
    }
  }

  // No later category found; append to the end.
  return {
    index: existingRules.length,
    category: newCategory,
    reason: `placement_reason_${newCategory}`,
  }
}
