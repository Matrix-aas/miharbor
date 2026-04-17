// Client-side value validation per simple rule type. The backend linter
// still runs on deploy (canonical source of truth); this layer exists to
// give the RuleEditor immediate feedback as the user types.

import type { SimpleRuleType } from 'miharbor-shared'

export type ValidationResult = { ok: true } | { ok: false; messageKey: string }

const DOMAIN_RE =
  /^(?:[A-Za-z0-9*](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9*](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/
const CIDR_V4_RE = /^(?:\d{1,3}\.){3}\d{1,3}\/(?:\d|[12]\d|3[0-2])$/
const CIDR_V6_RE = /^[0-9a-fA-F:]+\/\d{1,3}$/
const PORT_RE = /^\d{1,5}(?:-\d{1,5})?$/

/** Return `{ ok: true }` if `value` is accepted, else an i18n key the
 *  editor can surface as an inline error. Unknown types pass through
 *  (parser allows pass-through too). */
export function validateRuleValue(type: SimpleRuleType, value: string): ValidationResult {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, messageKey: 'rules.validation.empty' }
  switch (type) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
    case 'DOMAIN-KEYWORD':
      // DOMAIN-KEYWORD accepts any substring; still reject whitespace.
      if (type === 'DOMAIN-KEYWORD') {
        return /\s/.test(trimmed)
          ? { ok: false, messageKey: 'rules.validation.keyword_whitespace' }
          : { ok: true }
      }
      return DOMAIN_RE.test(trimmed)
        ? { ok: true }
        : { ok: false, messageKey: 'rules.validation.domain' }
    case 'IP-CIDR':
      return CIDR_V4_RE.test(trimmed)
        ? { ok: true }
        : { ok: false, messageKey: 'rules.validation.cidr_v4' }
    case 'IP-CIDR6':
      return CIDR_V6_RE.test(trimmed)
        ? { ok: true }
        : { ok: false, messageKey: 'rules.validation.cidr_v6' }
    case 'SRC-IP-CIDR':
      return CIDR_V4_RE.test(trimmed) || CIDR_V6_RE.test(trimmed)
        ? { ok: true }
        : { ok: false, messageKey: 'rules.validation.cidr' }
    case 'DST-PORT':
    case 'SRC-PORT':
    case 'IN-PORT':
      return PORT_RE.test(trimmed)
        ? { ok: true }
        : { ok: false, messageKey: 'rules.validation.port' }
    // Unknown / free-form types (GEOSITE, GEOIP, PROCESS-NAME, RULE-SET, …).
    default:
      return { ok: true }
  }
}

/** Simple predicate — a valid base64-ish blob for WireGuard private/public keys. */
export function isValidWireGuardKey(s: string): boolean {
  const trimmed = s.trim()
  if (trimmed.length === 0) return false
  // 32-byte base64 keys are 44 chars long, `[A-Za-z0-9+/]+=*`.
  return /^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length >= 40
}
