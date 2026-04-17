// Service-template fuzzy matcher (Linter 4 / Task 42).
//
// Given a free-form query (what the user types into the new-service dialog's
// "name" field), suggest the top-N service templates by fuzzy-matching over
// the template's `name` + `aliases`. The UI renders each match as a "use this
// template" pill so the user can pre-fill the new service with a curated set
// of DOMAIN-SUFFIX / GEOSITE rules.
//
// Design notes:
//   * Fuse.js (~10 KB gz) handles typo tolerance out of the box. We pin a
//     tight threshold (0.4) so "yotube" → YouTube passes but "xyz123" does
//     not.
//   * Scores are 0-1 where 0 = perfect. We echo Fuse's score as-is so the UI
//     can gray out weaker matches.
//   * No side effects — the matcher is a pure function over the static
//     services.json catalogue.

import Fuse from 'fuse.js'
import servicesJson from '../templates/services.json' with { type: 'json' }

export interface ServiceTemplateRule {
  type: string
  value: string
}

export interface ServiceTemplate {
  id: string
  name: string
  aliases: string[]
  category: string
  rules: ServiceTemplateRule[]
}

export interface ServiceMatch {
  id: string
  name: string
  category: string
  /** Fuse score — 0 means perfect, 1 means completely unrelated. */
  score: number
  rules: ServiceTemplateRule[]
}

interface ServicesFile {
  services: ServiceTemplate[]
}

const data = servicesJson as ServicesFile

// Full, readonly catalogue (exported for tests + the UI dropdown's "browse
// all" fallback).
export const SERVICE_TEMPLATES: readonly ServiceTemplate[] = Object.freeze(data.services.slice())

// Fuse instance is built lazily on first call so tests that just import the
// catalogue don't pay the build cost.
let fuseInstance: Fuse<ServiceTemplate> | null = null

function getFuse(): Fuse<ServiceTemplate> {
  if (fuseInstance) return fuseInstance
  fuseInstance = new Fuse<ServiceTemplate>(data.services, {
    includeScore: true,
    // Lower = tighter. 0.4 lets single-letter typos pass ("yotube" ≈
    // "youtube") while rejecting unrelated garbage.
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'name', weight: 1 },
      { name: 'aliases', weight: 0.8 },
    ],
  })
  return fuseInstance
}

/**
 * Fuzzy-match user query against the service templates catalogue.
 *
 * @param query  Free-form text (the user's in-progress service name).
 * @param limit  Max number of matches to return (default 5).
 * @returns      Top-N matches, best score first. Empty array for empty query.
 */
export function matchServices(query: string, limit = 5): ServiceMatch[] {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const results = getFuse().search(trimmed, { limit: Math.max(1, limit) })
  return results.map((r) => ({
    id: r.item.id,
    name: r.item.name,
    category: r.item.category,
    score: r.score ?? 1,
    rules: r.item.rules,
  }))
}

/** Look up a template by stable id (used by the UI on explicit click). */
export function getServiceTemplateById(id: string): ServiceTemplate | undefined {
  return data.services.find((s) => s.id === id)
}
