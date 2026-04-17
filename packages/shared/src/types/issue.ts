// Issue — the uniform error/warning object produced by linters, YAML
// validation, and any layer that wants to surface a problem to the UI.
// `code` is an i18n key so messages can be translated client-side.

import { Type, type Static } from '@sinclair/typebox'

export const IssueLevel = Type.Union([
  Type.Literal('error'),
  Type.Literal('warning'),
  Type.Literal('info'),
])

export const IssueSchema = Type.Object({
  level: IssueLevel,
  code: Type.String(), // i18n key, e.g. "LINTER_UNREACHABLE_RULE"
  path: Type.Array(Type.Union([Type.String(), Type.Number()])), // YAML path
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  autofix: Type.Optional(
    Type.Object({
      label: Type.String(),
      patch: Type.Unknown(),
    }),
  ),
})

export type Issue = Static<typeof IssueSchema>
