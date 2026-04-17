// Aggregator — runs every shared linter against a Document and returns a
// flat Issue[] in deterministic order. The order matters for snapshot-style
// tests and for the UI which tends to show issues grouped by section; we go
// unreachable → invariants → duplicates, which happens to be "rule-list
// problems first, then root-level problems, then reference problems".
//
// Malformed rules surface as an Issue themselves (LINTER_RULE_PARSE_ERROR)
// and the aggregator skips rule-based linters for unparseable inputs rather
// than throwing. The universal-invariants linter is doc-level and runs
// regardless of whether rules parsed.

import type { Document } from 'yaml'
import type { Issue } from '../types/issue.ts'
import { detectUnreachable } from './unreachable.ts'
import { checkUniversalInvariants } from './invariants-universal.ts'
import { checkUserInvariants, type UserInvariant } from './invariants-user.ts'
import { detectDuplicates } from './duplicates.ts'
import { parseRulesFromDoc } from '../parser/rule-parser.ts'
import type { Rule } from '../types/rule.ts'

export interface SharedLinterOptions {
  /** User-defined invariants merged with universal ones. Inactive entries
   *  are skipped by the engine. Defaults to an empty list — server boot
   *  passes the loaded invariants.yaml here. */
  userInvariants?: UserInvariant[]
}

export function runSharedLinters(doc: Document, opts: SharedLinterOptions = {}): Issue[] {
  const issues: Issue[] = []

  // Parse rules once up front. A malformed rule aborts `parseRulesFromDoc`
  // with an Error — we catch and surface it as a single Issue so the rest of
  // the linters still run against what we can read.
  let rules: { index: number; rule: Rule }[] = []
  let rulesParsed = true
  try {
    rules = parseRulesFromDoc(doc)
  } catch (err) {
    rulesParsed = false
    issues.push({
      level: 'error',
      code: 'LINTER_RULE_PARSE_ERROR',
      path: ['rules'],
      params: { message: err instanceof Error ? err.message : String(err) },
      suggestion: {
        key: 'suggestion_rule_parse_error',
        params: { message: err instanceof Error ? err.message : String(err) },
      },
    })
  }

  if (rulesParsed) {
    issues.push(...detectUnreachable(rules))
  }
  issues.push(...checkUniversalInvariants(doc))
  if (opts.userInvariants && opts.userInvariants.length > 0) {
    issues.push(...checkUserInvariants(doc, opts.userInvariants))
  }
  if (rulesParsed) {
    issues.push(...detectDuplicates(doc, rules))
  }

  return issues
}
