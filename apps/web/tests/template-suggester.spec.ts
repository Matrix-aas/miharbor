// TemplateSuggester + AddServiceDialog integration tests (Task 42 AC).
//
// Scope:
//   * TemplateSuggester renders nothing for short / empty queries.
//   * TemplateSuggester surfaces top-5 matches with aria-labels for a
//     real-world query like "spotify".
//   * Clicking a pill emits the match with its rules array.
//   * AddServiceDialog integrates the suggester — typing a name shows
//     matches; picking one primes rules that ride along with the
//     create event.

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import type { ServiceMatch } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import TemplateSuggester from '../src/components/services/TemplateSuggester.vue'
import AddServiceDialog from '../src/components/services/AddServiceDialog.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

describe('TemplateSuggester', () => {
  it('renders nothing for empty query', () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: '' },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('ul').exists()).toBe(false)
  })

  it('renders nothing for single-character query', () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: 's' },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('ul').exists()).toBe(false)
  })

  it('renders matches for "spotify"', () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: 'spotify' },
      global: { plugins: [makeI18n()] },
    })
    const pills = wrapper.findAll('button[data-service-id]')
    expect(pills.length).toBeGreaterThan(0)
    const firstPill = pills[0]!
    expect(firstPill.attributes('data-service-id')).toBe('spotify')
    expect(firstPill.text()).toContain('Spotify')
  })

  it('attaches an aria-label describing the template + rule count', () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: 'youtube' },
      global: { plugins: [makeI18n()] },
    })
    const first = wrapper.find('button[data-service-id="youtube"]')
    const aria = first.attributes('aria-label') ?? ''
    expect(aria).toContain('YouTube')
    // Number of rules for YouTube in the catalogue is 6 (currently).
    expect(aria).toMatch(/\d+ rules/)
  })

  it('respects the limit prop', () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: 'a', limit: 2 },
      global: { plugins: [makeI18n()] },
    })
    const pills = wrapper.findAll('button[data-service-id]')
    expect(pills.length).toBeLessThanOrEqual(2)
  })

  it('emits select with the full match on pill click', async () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: 'spotify' },
      global: { plugins: [makeI18n()] },
    })
    const pill = wrapper.find('button[data-service-id="spotify"]')
    await pill.trigger('click')
    const emitted = wrapper.emitted('select') as unknown as ServiceMatch[][] | undefined
    expect(emitted).toBeTruthy()
    const match = emitted?.[0]?.[0]
    expect(match?.id).toBe('spotify')
    expect(match?.rules.length).toBeGreaterThanOrEqual(2)
    expect(match?.rules[0]?.type).toBe('DOMAIN-SUFFIX')
  })

  it('exposes list role with localized aria-label', () => {
    const wrapper = mount(TemplateSuggester, {
      props: { query: 'github' },
      global: { plugins: [makeI18n()] },
    })
    const list = wrapper.find('ul[role="list"]')
    expect(list.exists()).toBe(true)
    expect(list.attributes('aria-label')).toBe('Service template suggestions')
  })
})

describe('AddServiceDialog integration with TemplateSuggester', () => {
  // Radix DialogPortal teleports the DialogContent into document.body, so we
  // use `attachTo: document.body` + `document.querySelector` instead of the
  // wrapper's scoped queries. We skip any assertions that depend on CSS
  // animations (jsdom doesn't run them).

  it('renders the name input + template suggester wiring', async () => {
    const wrapper = mount(AddServiceDialog, {
      props: { open: true, existingNames: [] },
      attachTo: document.body,
      global: { plugins: [makeI18n()] },
    })
    await nextTick()
    // Radix renders the content in a portal; check it's in the DOM.
    const input = document.querySelector<HTMLInputElement>('input[data-testid="add-service-name"]')
    expect(input).toBeTruthy()
    wrapper.unmount()
    // Tidy up the portaled content jsdom might leave behind.
    document.body.innerHTML = ''
  })

  it('emits create with the template rules after the user picks a template', async () => {
    const wrapper = mount(AddServiceDialog, {
      props: { open: true, existingNames: [] },
      attachTo: document.body,
      global: { plugins: [makeI18n()] },
    })
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('input[data-testid="add-service-name"]')
    expect(input).toBeTruthy()
    input!.value = 'spotify'
    input!.dispatchEvent(new Event('input'))
    await nextTick()
    const pill = document.querySelector<HTMLButtonElement>('button[data-service-id="spotify"]')
    expect(pill).toBeTruthy()
    pill!.click()
    await nextTick()
    // After pick: name auto-fills to "Spotify".
    expect(input!.value).toBe('Spotify')
    const note = document.querySelector('[data-testid="template-picked-note"]')
    expect(note).toBeTruthy()

    // Submit via the form's submit event so the emit fires.
    const form = document.querySelector('form') as HTMLFormElement | null
    expect(form).toBeTruthy()
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    const emitted = wrapper.emitted('create') as
      | Array<
          [
            {
              name: string
              direction: string
              rules: Array<{ type: string; value: string }>
            },
          ]
        >
      | undefined
    expect(emitted).toBeTruthy()
    const payload = emitted?.[0]?.[0]
    expect(payload?.name).toBe('Spotify')
    expect(payload?.rules.length).toBeGreaterThanOrEqual(2)
    expect(payload?.rules[0]?.type).toBe('DOMAIN-SUFFIX')
    wrapper.unmount()
    document.body.innerHTML = ''
  })
})
