// Universal mihomo invariants — things that are almost always wrong no matter
// what your router topology looks like. User-specific invariants (e.g.
// "dns.listen MUST be 127.0.0.1:1053 on our router") live in Stage 2's
// user-defined rules.
//
// The catalogue lives in ./../templates/invariants-universal.json so the UI
// can surface the same i18n keys and descriptions without reaching into TS.
// Each invariant has:
//   - id (stable for params.id)
//   - level / message_key (→ Issue.level / Issue.code)
//   - optional `path` (the YAML path under inspection, used by some checks)
//   - check.type selecting the evaluator
//
// Supported check types:
//   min_length_if_present — if value at `path` is a non-empty string, require
//                           length ≥ min.
//   not_equals            — value at `path` must not be any of `forbidden`.
//   conditional           — if value at `when` is truthy, value at
//                           `then_required` must be present + non-empty.
//   is_array_if_present   — if value at `path` is present (not undefined /
//                           null), it must be an array (plain JS array or a
//                           yaml@2 YAMLSeq). Scalars like "auto" fail.

import type { Document } from 'yaml'
import { isSeq } from 'yaml'
import type { Issue } from '../types/issue.ts'
import invariantsJson from '../templates/invariants-universal.json' with { type: 'json' }

type InvariantLevel = 'error' | 'warning' | 'info'

interface MinLengthCheck {
  type: 'min_length_if_present'
  min: number
}
interface NotEqualsCheck {
  type: 'not_equals'
  forbidden: string[]
}
interface ConditionalCheck {
  type: 'conditional'
  when: string[]
  then_required: string[]
}
interface IsArrayIfPresentCheck {
  type: 'is_array_if_present'
}
type InvariantCheck = MinLengthCheck | NotEqualsCheck | ConditionalCheck | IsArrayIfPresentCheck

interface InvariantDef {
  id: string
  level: InvariantLevel
  message_key: string
  path?: string[]
  check: InvariantCheck
}

interface InvariantsFile {
  invariants: InvariantDef[]
}

// Cast the imported JSON once so the rest of the file stays typed.
const INVARIANTS = invariantsJson as InvariantsFile

// Resolve any YAML node into the plain JS value we want to test. For scalars
// yaml@2 returns the scalar's `.value`; `getIn(path, true)` returns a Node
// reference we'd have to `.toJSON()` on — we use the simpler `getIn(path)`
// here which already returns the resolved primitive for scalars.
function readPath(doc: Document, path: string[]): unknown {
  return doc.getIn(path)
}

/** Check every universal invariant against `doc`. Returns one Issue per
 *  violation — zero issues ⇒ healthy (as far as these rules go). */
export function checkUniversalInvariants(doc: Document): Issue[] {
  const issues: Issue[] = []
  for (const inv of INVARIANTS.invariants) {
    const issue = runCheck(doc, inv)
    if (issue) issues.push(issue)
  }
  return issues
}

function runCheck(doc: Document, inv: InvariantDef): Issue | null {
  const check = inv.check
  if (check.type === 'min_length_if_present') {
    // `path` is required for path-based checks; the JSON catalogue enforces
    // this by convention. If it's missing, bail silently rather than crash.
    if (!inv.path) return null
    const val = readPath(doc, inv.path)
    if (typeof val === 'string' && val.length > 0 && val.length < check.min) {
      return {
        level: inv.level,
        code: inv.message_key,
        path: [...inv.path],
        params: { id: inv.id, min: check.min, actual: val.length },
      }
    }
    return null
  }
  if (check.type === 'not_equals') {
    if (!inv.path) return null
    const val = readPath(doc, inv.path)
    if (typeof val === 'string' && check.forbidden.includes(val)) {
      return {
        level: inv.level,
        code: inv.message_key,
        path: [...inv.path],
        params: { id: inv.id, value: val, forbidden: check.forbidden },
      }
    }
    return null
  }
  if (check.type === 'conditional') {
    const when = readPath(doc, check.when)
    // Only fire when the precondition is literally truthy. For booleans that
    // means `true` (or numeric `1` from some hand-written configs); for
    // strings we accept any non-empty string ("on", "1").
    const gateOn = when === true || when === 1 || (typeof when === 'string' && when.length > 0)
    if (!gateOn) return null
    const then = readPath(doc, check.then_required)
    if (then === undefined || then === null || then === '') {
      return {
        level: inv.level,
        code: inv.message_key,
        path: [...check.then_required],
        params: { id: inv.id, when_path: check.when, when_value: when },
      }
    }
    return null
  }
  if (check.type === 'is_array_if_present') {
    if (!inv.path) return null
    // `getIn` returns the resolved primitive for scalars or a YAMLSeq / plain
    // array for sequences. We accept either list shape; anything else — a
    // string like "auto", a map, a number — fails.
    const val = doc.getIn(inv.path)
    if (val === undefined || val === null) return null
    const isList = Array.isArray(val) || isSeq(val)
    if (!isList) {
      return {
        level: inv.level,
        code: inv.message_key,
        path: [...inv.path],
        params: { id: inv.id },
      }
    }
    return null
  }
  // Unknown check type — invariant catalogue is out of sync with code. Rather
  // than throw (which would kill the whole lint run), we swallow and return
  // null. When we add a new check type, this function gets a matching branch
  // and TypeScript's exhaustiveness guards us.
  return null
}
