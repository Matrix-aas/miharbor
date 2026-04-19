// Rule-provider name resolution for /api/catalog/rule-providers.
// Reads the live mihomo config via the injected Transport, parses the
// top-level `rule-providers:` map, and returns the declared provider
// names. Never throws — read / parse failures degrade to an empty list
// so the catalog endpoint keeps serving (UI falls back to free-form
// input in the RULE-SET combobox, same as geo-offline behaviour).

import { parseDocument } from 'yaml'
import type { Transport } from '../transport/transport.ts'

export interface RuleProvidersResult {
  /** Stable, sorted list of names declared under `rule-providers:`. */
  names: string[]
  /** Human-readable error surfaced to the UI (offline badge). `null` on success. */
  error: string | null
}

export async function resolveRuleProviders(transport: Transport): Promise<RuleProvidersResult> {
  let content = ''
  try {
    const read = await transport.readConfig()
    content = read.content
  } catch (e) {
    return { names: [], error: e instanceof Error ? e.message : String(e) }
  }

  try {
    const doc = parseDocument(content)
    if (doc.errors.length > 0) {
      return { names: [], error: doc.errors[0]!.message }
    }
    const node = doc.get('rule-providers')
    if (node === undefined || node === null) return { names: [], error: null }
    // yaml's `toJSON()` on a Map returns a plain object — good enough for
    // name extraction; we don't care about provider metadata here.
    const asJson = (node as { toJSON?: () => unknown }).toJSON?.() ?? node
    if (typeof asJson !== 'object' || asJson === null || Array.isArray(asJson)) {
      return { names: [], error: null }
    }
    const names = Object.keys(asJson as Record<string, unknown>)
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .sort((a, b) => a.localeCompare(b))
    return { names, error: null }
  } catch (e) {
    return { names: [], error: e instanceof Error ? e.message : String(e) }
  }
}
