// Issue formatter — helper to render issue messages and suggestions using i18n.
// When an Issue has a suggestion field, this function combines the main message
// with the suggestion text for full context.

import type { Issue } from 'miharbor-shared'

/**
 * Format an issue message with optional suggestion.
 * Returns an object with the main message and optional suggestion text.
 * The i18n integration is done in the component layer where useI18n() is available.
 */
export function formatIssue(issue: Issue): {
  messageKey: string
  messageParams?: Record<string, unknown>
  suggestionKey?: string
  suggestionParams?: Record<string, unknown>
} {
  return {
    messageKey: issue.code,
    messageParams: issue.params,
    ...(issue.suggestion && {
      suggestionKey: issue.suggestion.key,
      suggestionParams: issue.suggestion.params,
    }),
  }
}

/**
 * Check if an issue has a suggestion.
 */
export function hasIssueSuggestion(issue: Issue): boolean {
  return !!issue.suggestion
}
