// User-defined invariants (Task 41).
//
// The operator maintains a YAML file at
// `${MIHARBOR_DATA_DIR}/invariants.yaml` listing custom rules their config
// should satisfy. The linter compiles the list into the same `Issue[]`
// shape the universal invariants produce and merges them at aggregation
// time (aggregator.ts).
//
// Schema (see examples/invariants/*.yaml):
//
//   invariants:
//     - id: "router-wg-proxy-excluded"
//       name: "WG proxy IP must be in tun.route-exclude-address"
//       level: "error"           # error | warning | info (default: warning)
//       active: true             # disabled invariants are skipped entirely
//       description: "…"         # surfaced to the UI
//       rule:
//         kind: "path-must-contain-all"
//         path: "tun.route-exclude-address"
//         values: ["91.132.58.113/32"]
//
// Supported rule kinds (MVP):
//   path-must-equal         — scalar value at `path` must == `value`.
//   path-must-not-equal     — scalar value at `path` must NOT be one of `values`.
//   path-must-be-in         — scalar value at `path` must be one of `values`.
//   path-must-contain-all   — array at `path` must contain every value in `values`.
//
// Custom JS predicates are deliberately out of scope (injection risk).

import type { Document } from 'yaml'
import { isSeq } from 'yaml'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Issue } from '../types/issue.ts'

// ---- schema (TypeBox so we can validate unknown input cheaply) ----

const InvariantLevel = Type.Union([
  Type.Literal('error'),
  Type.Literal('warning'),
  Type.Literal('info'),
])

const RulePathMustEqual = Type.Object({
  kind: Type.Literal('path-must-equal'),
  path: Type.String({ minLength: 1 }),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
})
const RulePathMustNotEqual = Type.Object({
  kind: Type.Literal('path-must-not-equal'),
  path: Type.String({ minLength: 1 }),
  values: Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { minItems: 1 }),
})
const RulePathMustBeIn = Type.Object({
  kind: Type.Literal('path-must-be-in'),
  path: Type.String({ minLength: 1 }),
  values: Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { minItems: 1 }),
})
const RulePathMustContainAll = Type.Object({
  kind: Type.Literal('path-must-contain-all'),
  path: Type.String({ minLength: 1 }),
  values: Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { minItems: 1 }),
})

export const UserInvariantRuleSchema = Type.Union([
  RulePathMustEqual,
  RulePathMustNotEqual,
  RulePathMustBeIn,
  RulePathMustContainAll,
])

export const UserInvariantSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  level: Type.Optional(InvariantLevel),
  active: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  rule: UserInvariantRuleSchema,
})

export const UserInvariantsFileSchema = Type.Object({
  invariants: Type.Array(UserInvariantSchema),
})

export type UserInvariant = Static<typeof UserInvariantSchema>
export type UserInvariantRule = Static<typeof UserInvariantRuleSchema>
export type UserInvariantsFile = Static<typeof UserInvariantsFileSchema>

/** Parse-and-validate result. `invariants` is always present; `errors` holds
 *  per-entry validation failures so the UI can explain why a row was dropped. */
export interface ParseResult {
  invariants: UserInvariant[]
  errors: Array<{ index: number; message: string }>
}

/** Resolve a dotted path like "tun.route-exclude-address" to a YAML node.
 *  We split on '.' only — keys with literal dots are not supported (rare in
 *  mihomo config; operators who really need them can fall back to a Raw YAML
 *  edit). */
function splitPath(p: string): string[] {
  return p.split('.').filter((s) => s.length > 0)
}

/** Parse a list of raw objects (as returned by `yaml.parse`) into validated
 *  UserInvariants. Bad entries are reported in `errors` — the good ones are
 *  kept so one typo doesn't nuke every rule. */
export function parseUserInvariants(raw: unknown): ParseResult {
  const result: ParseResult = { invariants: [], errors: [] }
  if (raw === null || raw === undefined) return result
  if (typeof raw !== 'object') {
    result.errors.push({ index: -1, message: 'root must be a mapping with `invariants:` key' })
    return result
  }
  const root = raw as { invariants?: unknown }
  if (root.invariants === undefined) return result
  if (!Array.isArray(root.invariants)) {
    result.errors.push({ index: -1, message: '`invariants` must be a list' })
    return result
  }
  root.invariants.forEach((entry: unknown, index: number) => {
    if (!Value.Check(UserInvariantSchema, entry)) {
      const firstErr = [...Value.Errors(UserInvariantSchema, entry)][0]
      result.errors.push({
        index,
        message: firstErr ? `${firstErr.path || '(root)'}: ${firstErr.message}` : 'invalid entry',
      })
      return
    }
    result.invariants.push(entry as UserInvariant)
  })
  // Duplicate-id guard — we keep the first, report the rest.
  const seen = new Set<string>()
  const deduped: UserInvariant[] = []
  result.invariants.forEach((inv, index) => {
    if (seen.has(inv.id)) {
      result.errors.push({ index, message: `duplicate id: ${inv.id}` })
      return
    }
    seen.add(inv.id)
    deduped.push(inv)
  })
  result.invariants = deduped
  return result
}

/** Read the value at a dotted YAML path. Scalars come back as primitives;
 *  sequences/maps come back as YAMLSeq / YAMLMap nodes. Missing paths return
 *  `undefined`. */
function readAt(doc: Document, path: string): unknown {
  const segs = splitPath(path)
  if (segs.length === 0) return undefined
  return doc.getIn(segs)
}

/** Normalise a yaml@2 sequence / plain array into `unknown[]` for shallow
 *  equality checks. Returns null when the node isn't list-shaped. */
function asList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (isSeq(v)) {
    // YAMLSeq#toJSON unwraps scalar values; for our "contains X" check that's
    // exactly what we want (string-to-string compare).
    const seq = v as { toJSON: () => unknown }
    const js = seq.toJSON() as unknown
    return Array.isArray(js) ? js : null
  }
  return null
}

function makeIssue(inv: UserInvariant, path: string[], reason: string): Issue {
  return {
    level: inv.level ?? 'warning',
    code: `USER_INVARIANT_${inv.id}`,
    path: [...path],
    params: {
      id: inv.id,
      name: inv.name,
      description: inv.description ?? '',
      reason,
      rule_kind: inv.rule.kind,
    },
    suggestion: {
      key: 'suggestion_user_invariant',
      params: {
        id: inv.id,
        name: inv.name,
        description: inv.description ?? '',
      },
    },
  }
}

/** Evaluate a single invariant against the document. Returns one Issue if
 *  violated, null otherwise. Disabled (active: false) invariants return null
 *  before we touch the document. */
export function evaluateUserInvariant(doc: Document, inv: UserInvariant): Issue | null {
  if (inv.active === false) return null
  const rule = inv.rule
  const pathSegs = splitPath(rule.path)
  const val = readAt(doc, rule.path)

  if (rule.kind === 'path-must-equal') {
    // `undefined` (absent key) fails by default — the operator asserted a
    // specific value must be present. Exception: `rule.value === null` is
    // treated as "key must be null OR absent", which lets operators write
    // "port: null" to mean "explicit HTTP listener forbidden" without
    // requiring the config to spell `port: null` verbatim.
    const actual = coerceScalar(val)
    if (rule.value === null && (actual === null || actual === undefined)) return null
    if (actual === rule.value) return null
    return makeIssue(
      inv,
      pathSegs,
      `expected ${JSON.stringify(rule.value)}, got ${JSON.stringify(actual)}`,
    )
  }

  if (rule.kind === 'path-must-not-equal') {
    const actual = coerceScalar(val)
    if (actual === undefined) return null // absent ⇒ not equal to any forbidden value
    if (!rule.values.includes(actual as string | number | boolean)) return null
    return makeIssue(inv, pathSegs, `forbidden value: ${JSON.stringify(actual)}`)
  }

  if (rule.kind === 'path-must-be-in') {
    const actual = coerceScalar(val)
    if (actual === undefined) {
      return makeIssue(inv, pathSegs, `missing key; expected one of ${JSON.stringify(rule.values)}`)
    }
    if (rule.values.includes(actual as string | number | boolean)) return null
    return makeIssue(
      inv,
      pathSegs,
      `expected one of ${JSON.stringify(rule.values)}, got ${JSON.stringify(actual)}`,
    )
  }

  if (rule.kind === 'path-must-contain-all') {
    const list = asList(val)
    if (list === null) {
      return makeIssue(inv, pathSegs, 'value is not a list (or path is absent)')
    }
    const missing: unknown[] = []
    for (const expected of rule.values) {
      if (!list.includes(expected)) missing.push(expected)
    }
    if (missing.length === 0) return null
    return makeIssue(inv, pathSegs, `missing entries: ${JSON.stringify(missing)}`)
  }

  // Exhaustiveness — unknown kind shouldn't reach here because TypeBox
  // validated the input. If it does, fail safe by emitting an info-level
  // diagnostic rather than throwing.
  return makeIssue(inv, pathSegs, `unknown rule kind`)
}

/** Run every active user invariant against the document. Inactive invariants
 *  are skipped entirely. */
export function checkUserInvariants(doc: Document, invariants: UserInvariant[]): Issue[] {
  const out: Issue[] = []
  for (const inv of invariants) {
    const issue = evaluateUserInvariant(doc, inv)
    if (issue) out.push(issue)
  }
  return out
}

/** Narrow a possibly-node YAML value to a primitive we can compare.
 *  yaml@2 `getIn(path)` already unwraps scalars; we additionally map YAML
 *  `null` / `undefined` both to undefined so tests stay intuitive. */
function coerceScalar(v: unknown): string | number | boolean | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return v as string | number | boolean
  }
  // Sequences / maps / yaml@2 node wrappers all fall here — not a scalar, so
  // report undefined. The rule will then fail with its own reason (e.g.
  // "expected X, got undefined").
  return undefined
}
