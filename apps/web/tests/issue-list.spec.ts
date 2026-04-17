// IssueList component tests (Task 51 AC).
//
// Scope:
//   * Renders translated message + suggestion when suggestion is present.
//   * Renders only the message when the issue has no suggestion.
//   * Picks the right severity icon class for error / warning / info.
//   * aria-label on each row names the severity + translated message so
//     screen readers can navigate issues without visual cues.
//   * Missing i18n keys fall back to the raw issue code (defensive — a
//     new linter code shipping without translations should still render).

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { Issue } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import IssueList from '../src/components/linter/IssueList.vue'

function makeI18n(locale: 'en' | 'ru' = 'en') {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale,
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('IssueList', () => {
  it('renders message and suggestion for an issue that has both', () => {
    const issues: Issue[] = [
      {
        level: 'error',
        code: 'LINTER_DANGLING_GROUP_REFERENCE',
        path: ['rules', 2],
        params: { target: 'Ghost' },
        suggestion: {
          key: 'suggestion_dangling_group_reference',
          params: { target: 'Ghost' },
        },
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })

    const text = wrapper.text()
    expect(text).toContain("Rule targets proxy-group 'Ghost' which is not defined.")
    // Suggestion body, taken verbatim from the en.json flat suggestion key.
    expect(text).toContain("The target proxy-group 'Ghost' does not exist.")
    // 💡 prefix is rendered.
    const suggestionNode = wrapper.find('[data-testid="issue-suggestion"]')
    expect(suggestionNode.exists()).toBe(true)
    expect(suggestionNode.text()).toContain('💡')
  })

  it('renders only the message when the issue has no suggestion', () => {
    const issues: Issue[] = [
      {
        level: 'warning',
        code: 'LINTER_DUPLICATE_RULE',
        path: ['rules', 5],
        params: { duplicate_of_index: 3 },
        // No suggestion field on purpose.
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('Duplicate of rule #3.')
    expect(wrapper.find('[data-testid="issue-suggestion"]').exists()).toBe(false)
  })

  it('mixes an issue with suggestion and one without', () => {
    const issues: Issue[] = [
      {
        level: 'error',
        code: 'LINTER_UNREACHABLE_RULE',
        path: ['rules', 10],
        params: { covered_by_index: 4, reason: 'match_above' },
        suggestion: {
          key: 'suggestion_unreachable_rule_after_match',
          params: { covered_by_index: 4 },
        },
      },
      {
        level: 'warning',
        code: 'LINTER_DUPLICATE_RULE',
        path: ['rules', 11],
        params: { duplicate_of_index: 2 },
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    const items = wrapper.findAll('li[data-severity]')
    expect(items.length).toBe(2)
    // First item: has suggestion.
    expect(items[0]!.attributes('data-severity')).toBe('error')
    expect(items[0]!.find('[data-testid="issue-suggestion"]').exists()).toBe(true)
    // Second item: no suggestion.
    expect(items[1]!.attributes('data-severity')).toBe('warning')
    expect(items[1]!.find('[data-testid="issue-suggestion"]').exists()).toBe(false)
  })

  it('picks severity-specific icon colour', () => {
    const issues: Issue[] = [
      { level: 'error', code: 'LINTER_DUPLICATE_RULE', path: ['rules', 0] },
      { level: 'warning', code: 'LINTER_DUPLICATE_RULE', path: ['rules', 1] },
      { level: 'info', code: 'LINTER_DUPLICATE_RULE', path: ['rules', 2] },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    const items = wrapper.findAll('li[data-severity]')
    // The colour is applied on the leading `<span>` wrapping the icon.
    const spans = items.map((li) => li.find('span'))
    expect(spans[0]!.classes()).toContain('text-destructive')
    expect(spans[1]!.classes()).toContain('text-amber-500')
    expect(spans[2]!.classes()).toContain('text-sky-500')
  })

  it('emits aria-label containing severity and translated message', () => {
    const issues: Issue[] = [
      {
        level: 'error',
        code: 'LINTER_DANGLING_GROUP_REFERENCE',
        path: ['rules', 0],
        params: { target: 'MissingGroup' },
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    const item = wrapper.find('li[data-severity="error"]')
    const aria = item.attributes('aria-label') ?? ''
    expect(aria).toContain('Error')
    expect(aria).toContain('MissingGroup')
  })

  it('falls back to raw code when translation is missing', () => {
    const issues: Issue[] = [
      {
        level: 'warning',
        code: 'LINTER_SOMETHING_BRAND_NEW',
        path: ['rules', 0],
        params: {},
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('LINTER_SOMETHING_BRAND_NEW')
  })

  it('renders the localized empty state when issues is empty', () => {
    const wrapper = mount(IssueList, {
      props: { issues: [] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="issue-list-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No issues.')
  })

  it('uses the LINTER_UNREACHABLE_RULE match_above variant when reason is set', () => {
    const issues: Issue[] = [
      {
        level: 'error',
        code: 'LINTER_UNREACHABLE_RULE',
        path: ['rules', 0],
        params: { covered_by_index: 7, reason: 'match_above' },
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('MATCH rule at #7 above catches all traffic')
  })

  it('translates USER_INVARIANT_<id> codes via the shared USER_INVARIANT key', () => {
    const issues: Issue[] = [
      {
        level: 'warning',
        code: 'USER_INVARIANT_NO_DANGEROUS_WILDCARDS',
        path: ['rules'],
        params: {
          id: 'NO_DANGEROUS_WILDCARDS',
          name: 'No wildcard catch-alls',
          description: '',
          reason: 'matched DOMAIN-SUFFIX,.',
          rule_kind: 'matches',
        },
      },
    ]
    const wrapper = mount(IssueList, {
      props: { issues },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('No wildcard catch-alls')
  })
})
