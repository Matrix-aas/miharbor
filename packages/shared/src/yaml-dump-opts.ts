// Canonical serializer options used by every YAML write path in Miharbor.
//
// ONE source of truth for `doc.toString(DUMP_OPTS)`. If the server masks
// the live config with one set of options and the web draft re-serializer
// uses another, `/api/config/draft/diff` reports "structural" differences
// that are pure formatting noise — quotes appearing/disappearing on
// scalars that don't need them, `external-ui-url:` strings folding at
// arbitrary column widths, map-keys shuffling between round-trips.
//
// Values sourced from `apps/server/src/config/canonicalize.ts` (which in
// turn came from `docs/superpowers/poc-yaml/stability.ts` validated
// against the production config-server.yaml):
//   * lineWidth: 0 + minContentWidth: 0 — disable automatic folding so
//     long URLs under `geox-url`, `external-ui-url`, rule-provider `url`
//     stay on one line instead of wrapping at 80 chars.
//   * flowCollectionPadding: false — inline `{a: 1, b: 2}` stays tight.
//   * defaultStringType: 'PLAIN' + defaultKeyType: 'PLAIN' — emit
//     unquoted scalars where legal; only quote when the value contains
//     characters that MUST be quoted (flow indicators, leading !, etc).
//     Matches the convention mihomo's Go yaml writer produces.
//   * doubleQuotedMinMultiLineLength: 999999 — never break a
//     double-quoted string across multiple lines.

import type { ToStringOptions } from 'yaml'

/** Canonical yaml@2 serializer options. Used by both the server's
 *  canonicalize / masked-live / migrate paths and the web's draft
 *  mutator — diffs stay meaningful only while both sides share this. */
export const DUMP_OPTS = {
  lineWidth: 0,
  minContentWidth: 0,
  flowCollectionPadding: false,
  defaultStringType: 'PLAIN' as const,
  defaultKeyType: 'PLAIN' as const,
  doubleQuotedMinMultiLineLength: 999999,
} satisfies ToStringOptions
