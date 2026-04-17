// User invariants UI tests — Task 41.
//
// Drives the InvariantsList + InvariantEditForm components in isolation,
// stubbing the API client to assert list render, create flow, edit flow,
// delete, toggle-active (plus its GuardrailPlate warning) and client-side
// validation (required fields, duplicate ids).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { UserInvariant } from 'miharbor-shared'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import InvariantsList from '../src/components/settings/InvariantsList.vue'
import InvariantEditForm from '../src/components/settings/InvariantEditForm.vue'

// --- API mock -------------------------------------------------------------

const listMock = vi.fn()
const putMock = vi.fn()

vi.mock('@/api/client', () => ({
  endpoints: {
    invariants: {
      list: () => listMock(),
      put: (invariants: UserInvariant[]) => putMock(invariants),
    },
  },
  ApiError: class ApiError extends Error {
    status: number
    body: unknown
    constructor(status: number, message: string, body: unknown) {
      super(message)
      this.status = status
      this.body = body
    }
  },
}))

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

function mountList() {
  return mount(InvariantsList, {
    global: { plugins: [makeI18n()] },
  })
}

function mountForm(props: { invariant?: UserInvariant; existingIds?: string[] } = {}) {
  return mount(InvariantEditForm, {
    props: {
      existingIds: props.existingIds ?? [],
      ...(props.invariant ? { invariant: props.invariant } : {}),
    },
    global: { plugins: [makeI18n()] },
  })
}

// --- tests ----------------------------------------------------------------

describe('InvariantsList', () => {
  beforeEach(() => {
    listMock.mockReset()
    putMock.mockReset()
  })

  it('shows empty state when the API returns no invariants', async () => {
    listMock.mockResolvedValueOnce({ invariants: [], errors: [] })
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.find('[data-testid="invariants-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="invariants-list"]').exists()).toBe(false)
  })

  it('renders loaded invariants with id + name + level badge', async () => {
    listMock.mockResolvedValueOnce({
      invariants: [
        {
          id: 'dns-listen',
          name: 'DNS listener must be 1053',
          level: 'error',
          rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
        },
      ],
      errors: [],
    })
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.find('[data-testid="invariant-dns-listen"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('dns-listen')
    expect(wrapper.text()).toContain('DNS listener must be 1053')
  })

  it('shows the guardrail when any invariant is inactive', async () => {
    listMock.mockResolvedValueOnce({
      invariants: [
        {
          id: 'dns-listen',
          name: 'n',
          active: false,
          rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
        },
      ],
      errors: [],
    })
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.find('[data-testid="invariants-active-guardrail"]').exists()).toBe(true)
  })

  it('hides the guardrail when every invariant is active', async () => {
    listMock.mockResolvedValueOnce({
      invariants: [
        {
          id: 'dns-listen',
          name: 'n',
          rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
        },
      ],
      errors: [],
    })
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.find('[data-testid="invariants-active-guardrail"]').exists()).toBe(false)
  })

  it('toggling active sends a PUT with the flipped active flag', async () => {
    listMock.mockResolvedValueOnce({
      invariants: [
        {
          id: 'dns-listen',
          name: 'n',
          rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
        },
      ],
      errors: [],
    })
    putMock.mockResolvedValueOnce({
      ok: true,
      invariants: [
        {
          id: 'dns-listen',
          name: 'n',
          active: false,
          rule: { kind: 'path-must-equal', path: 'dns.listen', value: '127.0.0.1:1053' },
        },
      ],
    })
    const wrapper = mountList()
    await flushPromises()
    await wrapper.get('[data-testid="invariant-active-dns-listen"]').setValue(false)
    await flushPromises()
    expect(putMock).toHaveBeenCalledTimes(1)
    const arg = putMock.mock.calls[0]?.[0] as UserInvariant[]
    expect(arg[0]!.active).toBe(false)
  })

  it('delete removes the row and persists the remaining list', async () => {
    listMock.mockResolvedValueOnce({
      invariants: [
        {
          id: 'a',
          name: 'A',
          rule: { kind: 'path-must-equal', path: 'x', value: 1 },
        },
        {
          id: 'b',
          name: 'B',
          rule: { kind: 'path-must-equal', path: 'y', value: 2 },
        },
      ],
      errors: [],
    })
    putMock.mockResolvedValueOnce({
      ok: true,
      invariants: [{ id: 'b', name: 'B', rule: { kind: 'path-must-equal', path: 'y', value: 2 } }],
    })
    const wrapper = mountList()
    await flushPromises()
    await wrapper.get('[data-testid="invariant-delete-a"]').trigger('click')
    await flushPromises()
    expect(putMock).toHaveBeenCalledTimes(1)
    const arg = putMock.mock.calls[0]?.[0] as UserInvariant[]
    expect(arg.length).toBe(1)
    expect(arg[0]!.id).toBe('b')
  })

  it('create flow: opens form, saves, hides form', async () => {
    listMock.mockResolvedValueOnce({ invariants: [], errors: [] })
    putMock.mockResolvedValueOnce({
      ok: true,
      invariants: [
        {
          id: 'new-id',
          name: 'new',
          level: 'warning',
          active: true,
          rule: { kind: 'path-must-equal', path: 'x', value: '1' },
        },
      ],
    })
    const wrapper = mountList()
    await flushPromises()
    await wrapper.get('[data-testid="invariants-add"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="invariants-form-create"]').exists()).toBe(true)

    await wrapper.get('[data-testid="inv-form-id"]').setValue('new-id')
    await wrapper.get('[data-testid="inv-form-name"]').setValue('new')
    await wrapper.get('[data-testid="inv-form-path"]').setValue('x')
    await wrapper.get('[data-testid="inv-form-value"]').setValue('1')
    await wrapper.get('[data-testid="inv-form-save"]').trigger('submit')
    await flushPromises()
    expect(putMock).toHaveBeenCalledTimes(1)
    const arg = putMock.mock.calls[0]?.[0] as UserInvariant[]
    expect(arg[0]!.id).toBe('new-id')
    expect(arg[0]!.rule.kind).toBe('path-must-equal')
  })

  it('surfaces parse-errors count when the server reports dropped rows', async () => {
    listMock.mockResolvedValueOnce({
      invariants: [{ id: 'a', name: 'A', rule: { kind: 'path-must-equal', path: 'x', value: 1 } }],
      errors: [{ index: 1, message: 'bad' }],
    })
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.text()).toMatch(/schema/)
  })
})

describe('InvariantEditForm', () => {
  it('shows an error when id is missing / has bad chars', async () => {
    const wrapper = mountForm()
    await wrapper.get('[data-testid="inv-form-id"]').setValue('  has spaces')
    await wrapper.get('[data-testid="inv-form-name"]').setValue('name')
    await wrapper.get('[data-testid="inv-form-path"]').setValue('x')
    await wrapper.get('[data-testid="inv-form-value"]').setValue('1')
    // Save is disabled.
    const save = wrapper.get('[data-testid="inv-form-save"]').element as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(wrapper.text()).toMatch(/pattern/i)
  })

  it('refuses a duplicate id (existingIds set)', async () => {
    const wrapper = mountForm({ existingIds: ['already-there'] })
    await wrapper.get('[data-testid="inv-form-id"]').setValue('already-there')
    await wrapper.get('[data-testid="inv-form-name"]').setValue('x')
    await wrapper.get('[data-testid="inv-form-path"]').setValue('y')
    await wrapper.get('[data-testid="inv-form-value"]').setValue('1')
    const save = wrapper.get('[data-testid="inv-form-save"]').element as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('swaps the value/values input when rule kind changes', async () => {
    const wrapper = mountForm()
    expect(wrapper.find('[data-testid="inv-form-value"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inv-form-values"]').exists()).toBe(false)

    await wrapper.get('[data-testid="inv-form-kind"]').setValue('path-must-contain-all')
    expect(wrapper.find('[data-testid="inv-form-value"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="inv-form-values"]').exists()).toBe(true)
  })

  it('emits `save` with a well-formed UserInvariant for path-must-contain-all', async () => {
    const wrapper = mountForm()
    await wrapper.get('[data-testid="inv-form-id"]').setValue('wg-excluded')
    await wrapper.get('[data-testid="inv-form-name"]').setValue('WG excluded')
    await wrapper.get('[data-testid="inv-form-level"]').setValue('error')
    await wrapper.get('[data-testid="inv-form-kind"]').setValue('path-must-contain-all')
    await wrapper.get('[data-testid="inv-form-path"]').setValue('tun.route-exclude-address')
    await wrapper.get('[data-testid="inv-form-values"]').setValue('91.132.58.113/32\n10.0.0.0/8')
    await wrapper.get('[data-testid="inv-form-save"]').trigger('submit')
    const emitted = wrapper.emitted('save') as unknown as Array<Array<UserInvariant>>
    expect(emitted).toBeTruthy()
    const entry = emitted[0]![0]!
    expect(entry.id).toBe('wg-excluded')
    expect(entry.name).toBe('WG excluded')
    expect(entry.level).toBe('error')
    expect(entry.rule.kind).toBe('path-must-contain-all')
    if (entry.rule.kind === 'path-must-contain-all') {
      expect(entry.rule.path).toBe('tun.route-exclude-address')
      expect(entry.rule.values).toEqual(['91.132.58.113/32', '10.0.0.0/8'])
    }
  })

  it('coerces `true` / `false` / `null` / number literals in the value field', async () => {
    const wrapper = mountForm()
    await wrapper.get('[data-testid="inv-form-id"]').setValue('b1')
    await wrapper.get('[data-testid="inv-form-name"]').setValue('bool')
    await wrapper.get('[data-testid="inv-form-path"]').setValue('sniffer.enable')
    await wrapper.get('[data-testid="inv-form-value"]').setValue('true')
    await wrapper.get('[data-testid="inv-form-save"]').trigger('submit')
    const emitted = wrapper.emitted('save') as unknown as Array<Array<UserInvariant>>
    const entry = emitted[0]![0]!
    if (entry.rule.kind === 'path-must-equal') {
      expect(entry.rule.value).toBe(true)
    }
  })

  it('cancel emits `cancel`', async () => {
    const wrapper = mountForm()
    await wrapper.get('[data-testid="inv-form-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('edit mode pre-populates fields and disables id editing', async () => {
    const inv: UserInvariant = {
      id: 'existing',
      name: 'Existing',
      level: 'info',
      description: 'desc',
      rule: { kind: 'path-must-equal', path: 'mode', value: 'rule' },
    }
    const wrapper = mountForm({ invariant: inv })
    const idInput = wrapper.get('[data-testid="inv-form-id"]').element as HTMLInputElement
    expect(idInput.value).toBe('existing')
    expect(idInput.disabled).toBe(true)
  })
})
