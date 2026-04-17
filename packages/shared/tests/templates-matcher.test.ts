// Service template fuzzy matcher tests (Task 42).
//
// Covers:
//   * Catalogue shape: ≥ 50 entries, each entry has id/name/aliases/rules.
//   * Rules array invariants (≥ 2 rules per entry, type is valid rule type).
//   * Fuzzy matching: typo tolerance, case insensitivity, alias lookup.
//   * matchServices: empty query returns [], limit is respected.
//   * getServiceTemplateById happy + miss paths.

import { describe, expect, test } from 'bun:test'
import {
  getServiceTemplateById,
  matchServices,
  SERVICE_TEMPLATES,
  type ServiceTemplate,
} from '../src/linter/templates-matcher.ts'

const ALLOWED_RULE_TYPES = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'PROCESS-NAME',
])

// --- catalogue shape ------------------------------------------------------

describe('SERVICE_TEMPLATES catalogue', () => {
  test('has at least 50 entries', () => {
    expect(SERVICE_TEMPLATES.length).toBeGreaterThanOrEqual(50)
  })

  test('every entry has id/name/aliases/rules', () => {
    for (const s of SERVICE_TEMPLATES) {
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(Array.isArray(s.aliases)).toBe(true)
      expect(Array.isArray(s.rules)).toBe(true)
      expect(typeof s.category).toBe('string')
    }
  })

  test('every entry has at least 2 rules', () => {
    for (const s of SERVICE_TEMPLATES) {
      expect(s.rules.length).toBeGreaterThanOrEqual(2)
    }
  })

  test('every rule has a valid type + non-empty value', () => {
    for (const s of SERVICE_TEMPLATES) {
      for (const r of s.rules) {
        expect(ALLOWED_RULE_TYPES.has(r.type)).toBe(true)
        expect(typeof r.value).toBe('string')
        expect(r.value.length).toBeGreaterThan(0)
      }
    }
  })

  test('ids are unique', () => {
    const ids = new Set<string>()
    for (const s of SERVICE_TEMPLATES) {
      expect(ids.has(s.id)).toBe(false)
      ids.add(s.id)
    }
  })
})

// --- matchServices --------------------------------------------------------

describe('matchServices', () => {
  test('empty query returns []', () => {
    expect(matchServices('')).toEqual([])
    expect(matchServices('   ')).toEqual([])
  })

  test('exact match returns the service with a very good score', () => {
    const out = matchServices('Spotify')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.id).toBe('spotify')
    expect(out[0]!.score).toBeLessThanOrEqual(0.2)
  })

  test('is case-insensitive', () => {
    const lower = matchServices('spotify')
    const upper = matchServices('SPOTIFY')
    const mixed = matchServices('sPoTiFy')
    expect(lower[0]?.id).toBe('spotify')
    expect(upper[0]?.id).toBe('spotify')
    expect(mixed[0]?.id).toBe('spotify')
  })

  test('tolerates a single-letter typo ("yotube" → YouTube)', () => {
    const out = matchServices('yotube')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.id).toBe('youtube')
  })

  test('tolerates a transposed-letter typo ("gihub" → GitHub)', () => {
    const out = matchServices('gihub')
    expect(out.length).toBeGreaterThan(0)
    const ids = out.map((m) => m.id)
    expect(ids).toContain('github')
  })

  test('matches by alias ("ютуб" → YouTube)', () => {
    const out = matchServices('ютуб')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.id).toBe('youtube')
  })

  test('returns rules on match', () => {
    const out = matchServices('spotify')
    expect(out[0]!.rules.length).toBeGreaterThanOrEqual(2)
    const first = out[0]!.rules[0]!
    expect(first.type).toBe('DOMAIN-SUFFIX')
  })

  test('respects the limit parameter', () => {
    const out = matchServices('a', 3) // vague query — hits many fuzzy candidates
    expect(out.length).toBeLessThanOrEqual(3)
  })

  test('defaults to 5 results when limit is omitted', () => {
    const out = matchServices('a')
    expect(out.length).toBeLessThanOrEqual(5)
  })

  test('sorts by score ascending (best first)', () => {
    const out = matchServices('google')
    expect(out.length).toBeGreaterThan(0)
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.score).toBeGreaterThanOrEqual(out[i - 1]!.score)
    }
  })

  test('returns empty or weak set for completely unrelated query', () => {
    // Fuse with threshold 0.4 should reject gibberish outright.
    const out = matchServices('xqz!!!zzzzz')
    expect(out.length).toBe(0)
  })
})

// --- getServiceTemplateById ----------------------------------------------

describe('getServiceTemplateById', () => {
  test('finds an existing id', () => {
    const tpl: ServiceTemplate | undefined = getServiceTemplateById('youtube')
    expect(tpl).toBeDefined()
    expect(tpl!.name).toBe('YouTube')
  })

  test('returns undefined for unknown id', () => {
    expect(getServiceTemplateById('never-heard-of-it')).toBeUndefined()
  })
})
