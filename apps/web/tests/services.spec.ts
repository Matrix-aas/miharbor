// Services-screen component tests (Task 21 AC).
//
// Scope (intentionally thin — smoke + critical logic only):
//   * ServiceList renders a row per service + filter chips work.
//   * RuleEditor validates DOMAIN-SUFFIX and forbids empty values.
//   * RuleRow shows "complex rule" badge for logical rules with a disabled
//     edit button.
//   * Config store helpers exposed as unit-testable functions.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { Service, SimpleRule, Rule } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import ServiceList from '../src/components/services/ServiceList.vue'
import RuleEditor from '../src/components/services/RuleEditor.vue'
import RuleRow from '../src/components/services/RuleRow.vue'
import { validateRuleValue } from '../src/lib/rule-validation'
import {
  createService,
  deleteServiceWithRules,
  insertRule,
  parseDraft,
  serializeDraft,
  setGroupDirection,
} from '../src/lib/yaml-mutator'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

function makeService(partial: Partial<Service> & { name: string }): Service {
  return {
    name: partial.name,
    group: partial.group ?? { name: partial.name, type: 'select', proxies: ['PROXY', 'DIRECT'] },
    rules: partial.rules ?? [],
    direction: partial.direction ?? 'VPN',
    issues: partial.issues ?? [],
  }
}

describe('ServiceList', () => {
  it('renders every service exactly once', () => {
    const services = [
      makeService({ name: 'Streaming', direction: 'VPN' }),
      makeService({ name: 'Banking', direction: 'DIRECT' }),
      makeService({ name: 'Ads', direction: 'REJECT' }),
    ]
    const wrapper = mount(ServiceList, {
      props: { services, selected: null },
      global: { plugins: [makeI18n()] },
    })
    const rows = wrapper.findAll('button[type="button"]')
    // 4 filter chips + 1 "Add service" button + 3 rows.
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(wrapper.text()).toContain('Streaming')
    expect(wrapper.text()).toContain('Banking')
    expect(wrapper.text()).toContain('Ads')
  })

  it('filters to DIRECT only when filter clicked', async () => {
    const services = [
      makeService({ name: 'Streaming', direction: 'VPN' }),
      makeService({ name: 'Banking', direction: 'DIRECT' }),
      makeService({ name: 'Ads', direction: 'REJECT' }),
    ]
    const wrapper = mount(ServiceList, {
      props: { services, selected: null },
      global: { plugins: [makeI18n()] },
    })
    // Click the DIRECT chip. The filters are rendered as <Button> at the top,
    // we pick by visible label text.
    const directBtn = wrapper.findAll('button').find((b) => b.text() === 'DIRECT')
    expect(directBtn).toBeTruthy()
    await directBtn!.trigger('click')
    expect(wrapper.text()).toContain('Banking')
    expect(wrapper.text()).not.toContain('Streaming')
    expect(wrapper.text()).not.toContain('Ads')
  })
})

describe('RuleEditor', () => {
  it('rejects empty DOMAIN-SUFFIX values', () => {
    const r = validateRuleValue('DOMAIN-SUFFIX', '')
    expect(r.ok).toBe(false)
  })
  it('accepts valid DOMAIN-SUFFIX values', () => {
    const r = validateRuleValue('DOMAIN-SUFFIX', 'example.com')
    expect(r.ok).toBe(true)
  })
  it('rejects invalid domain strings', () => {
    const r = validateRuleValue('DOMAIN-SUFFIX', 'not a domain!')
    expect(r.ok).toBe(false)
  })
  it('disables save button until value validates', async () => {
    const wrapper = mount(RuleEditor, {
      props: { target: 'Streaming' },
      global: { plugins: [makeI18n()] },
    })
    const submit = wrapper.find('button[type="submit"]')
    // Default type DOMAIN-SUFFIX + empty value -> save disabled.
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    const input = wrapper.find('input')
    await input.setValue('example.com')
    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits save with the assembled rule', async () => {
    const wrapper = mount(RuleEditor, {
      props: { target: 'Streaming' },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('input').setValue('example.com')
    await wrapper.find('form').trigger('submit.prevent')
    const emitted = wrapper.emitted('save') as unknown as SimpleRule[][] | undefined
    expect(emitted).toBeTruthy()
    const rule = emitted?.[0]?.[0]
    expect(rule?.kind).toBe('simple')
    expect(rule?.type).toBe('DOMAIN-SUFFIX')
    expect(rule?.value).toBe('example.com')
    expect(rule?.target).toBe('Streaming')
  })
})

describe('RuleRow', () => {
  it('shows complex-rule badge + enabled edit that emits on click', async () => {
    // Task 40 — the logical-rule pencil is no longer disabled. Clicking it
    // opens the tree-editor modal via the parent (ServiceDetail).
    const logical: Rule = {
      kind: 'logical',
      op: 'AND',
      children: [
        { kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'example.com', target: '' },
        {
          kind: 'logical',
          op: 'NOT',
          children: [{ kind: 'simple', type: 'DOMAIN-SUFFIX', value: 'ru', target: '' }],
          target: '',
        },
      ],
      target: 'Streaming',
    }
    const wrapper = mount(RuleRow, {
      props: { rule: logical, index: 0 },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.text()).toContain('Complex rule')
    const editButtons = wrapper
      .findAll('button')
      .filter((b) => b.attributes('aria-label') === 'Edit rule')
    expect(editButtons.length).toBe(1)
    expect((editButtons[0]!.element as HTMLButtonElement).disabled).toBe(false)
    await editButtons[0]!.trigger('click')
    expect(wrapper.emitted('edit')).toBeTruthy()
  })
})

describe('yaml-mutator (used by config store)', () => {
  const base = `proxy-groups:
  - name: Streaming
    type: select
    proxies:
      - PROXY
      - DIRECT
rules:
  - DOMAIN-SUFFIX,netflix.com,Streaming
  - MATCH,DIRECT
`

  it('insertRule appends a rule', () => {
    const doc = parseDraft(base)
    const rule: SimpleRule = {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'hulu.com',
      target: 'Streaming',
    }
    // Insert at position 1 (before MATCH).
    insertRule(doc, rule, 1)
    const out = serializeDraft(doc)
    expect(out).toContain('DOMAIN-SUFFIX,hulu.com,Streaming')
  })

  it('setGroupDirection flips a select group', () => {
    const doc = parseDraft(base)
    setGroupDirection(doc, 'Streaming', 'DIRECT')
    const out = serializeDraft(doc)
    // The new first proxy should be DIRECT.
    expect(out).toMatch(/proxies:\s*\n\s*-\s*DIRECT/)
  })

  it('createService appends a new group and deleteServiceWithRules removes it + referencing rules', () => {
    const doc = parseDraft(base)
    createService(doc, { name: 'Ads', direction: 'REJECT' })
    insertRule(doc, {
      kind: 'simple',
      type: 'DOMAIN-SUFFIX',
      value: 'doubleclick.net',
      target: 'Ads',
    })
    const removed = deleteServiceWithRules(doc, 'Ads')
    expect(removed).toBeGreaterThanOrEqual(1)
    const out = serializeDraft(doc)
    expect(out).not.toContain('Ads')
    expect(out).not.toContain('doubleclick.net')
  })
})
