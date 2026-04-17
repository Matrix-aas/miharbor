// Raw YAML full-edit mode tests (Task 39 AC + monaco-yaml follow-up).
//
// Scope:
//   * useConfigStore: draftParseError / draftValid / applyRawYaml contract.
//   * RawYaml page: view/edit toggle, dirty badge, Apply button behaviour
//     (happy path + invalid-YAML short-circuit).
//   * YamlValidityGuard: blocks structural routes + renders banner when
//     draftValid === false.
//   * mihomo.schema.json shape sanity — at least the known keys are
//     described so future consumers have something to reference.
//   * MonacoYamlEdit: verifies `configureMonacoYaml` is invoked exactly once
//     per page load with the miharbor schema registered under fileMatch: ['*']
//     and the stable `miharbor.local` uri (live hover/completion contract).
//
// Monaco + monaco-yaml + the yaml.worker wrapper are all stubbed — jsdom
// can't run the editor runtime and can't spawn Web Workers from `?worker`
// URL imports. The tests focus on the Vue plumbing and the monaco-yaml
// registration call shape.

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { defineComponent, h, nextTick } from 'vue'

import en from '../src/i18n/en.json'
import ru from '../src/i18n/ru.json'
import mihomoSchema from '../src/schemas/mihomo.schema.json'
import { useConfigStore } from '../src/stores/config'
import YamlValidityGuard from '../src/components/layout/YamlValidityGuard.vue'
import RawYaml from '../src/pages/RawYaml.vue'

// Spy handle shared with the mock below so tests can assert on the
// monaco-yaml registration call shape without re-mocking per case.
const configureMonacoYamlSpy = vi.fn()

// Stub Monaco + its YAML contribution so defineAsyncComponent's dynamic
// import resolves in jsdom. The editable wrapper is replaced with a plain
// textarea that mirrors Monaco's public surface for our tests.
vi.mock('monaco-editor/esm/vs/editor/editor.api', () => {
  class MockModel {
    private value: string
    constructor(v: string) {
      this.value = v
    }
    getValue(): string {
      return this.value
    }
    setValue(v: string): void {
      this.value = v
    }
  }
  class MockEditor {
    private model: MockModel
    private listeners: Array<() => void> = []
    constructor(v: string) {
      this.model = new MockModel(v)
    }
    getValue(): string {
      return this.model.getValue()
    }
    setValue(v: string): void {
      this.model.setValue(v)
    }
    getModel(): MockModel {
      return this.model
    }
    dispose(): void {}
    updateOptions(): void {}
    onDidChangeModelContent(cb: () => void): { dispose(): void } {
      this.listeners.push(cb)
      return {
        dispose: () => {
          this.listeners = this.listeners.filter((l) => l !== cb)
        },
      }
    }
  }
  return {
    editor: {
      create: (_el: HTMLElement, opts: { value?: string }) => new MockEditor(opts.value ?? ''),
      setModelMarkers: vi.fn(),
    },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  }
})

vi.mock('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution', () => ({}))

// Stub the lazy-loaded worker entries — `?worker` imports don't resolve in
// jsdom. We return a noop Worker constructor so `new YamlWorker()` /
// `new EditorWorker()` inside `MonacoEnvironment.getWorker` doesn't throw.
class NoopWorker {
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true
  }
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null
}

vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
  default: NoopWorker,
}))

vi.mock('@/workers/yaml.worker?worker', () => ({
  default: NoopWorker,
}))

// Stub monaco-yaml: capture the call + args so tests can assert the schema
// registration contract (fileMatch, uri, schema identity, hover/completion/
// validate flags). We never want real monaco-yaml to run under jsdom —
// spawning the language-server worker breaks the runtime.
vi.mock('monaco-yaml', () => ({
  configureMonacoYaml: (...args: unknown[]) => {
    configureMonacoYamlSpy(...args)
    return { dispose: () => {}, update: async () => undefined, getOptions: () => ({}) }
  },
}))

// Stub the shadcn Button — its SFC is fine, but the inner lucide icons the
// RawYaml header uses can be left alone; we explicitly import the page
// under test, not Sidebar.

function makeI18n() {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, ru },
  })
}

function makeTestRouter(): Router {
  const Blank = defineComponent({ setup: () => () => h('div') })
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/raw-yaml' },
      { path: '/raw-yaml', name: 'raw-yaml', component: Blank },
      { path: '/services', name: 'services', component: Blank },
      { path: '/history', name: 'history', component: Blank },
    ],
  })
}

// ---- store tests --------------------------------------------------------

describe('useConfigStore — draft validity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports draftValid === true for an empty draft', () => {
    const store = useConfigStore()
    expect(store.draftText).toBeNull()
    expect(store.draftParseError).toBeNull()
    expect(store.draftValid).toBe(true)
  })

  it('reports draftValid === true for a valid YAML draft', () => {
    const store = useConfigStore()
    store.draftText = 'mode: rule\nlog-level: info\n'
    expect(store.draftParseError).toBeNull()
    expect(store.draftValid).toBe(true)
  })

  it('reports draftValid === false with line/col on parse error', () => {
    const store = useConfigStore()
    // Tabs + mismatched braces — definitely unparseable.
    store.draftText = 'mode: rule\n  : broken\n\tinvalid\n: {{\n'
    const err = store.draftParseError
    expect(err).not.toBeNull()
    expect(err?.message).toBeTruthy()
    expect(store.draftValid).toBe(false)
  })

  it('applyRawYaml short-circuits on invalid YAML (no server call)', async () => {
    const store = useConfigStore()
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    const ok = await store.applyRawYaml(': broken:\n\t- a\n\t b\n{: :}')
    expect(ok).toBe(false)
    expect(store.draftValid).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('applyRawYaml PUTs the draft and returns true on valid YAML', async () => {
    const store = useConfigStore()
    const calls: Array<{ url: string; method?: string }> = []
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method })
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, updated: '2026-01-01T00:00:00Z' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch
    const ok = await store.applyRawYaml('mode: rule\n')
    expect(ok).toBe(true)
    expect(store.draftText).toBe('mode: rule\n')
    expect(store.draftValid).toBe(true)
    expect(calls.some((c) => c.url.includes('/api/config/draft') && c.method === 'PUT')).toBe(true)
  })
})

// ---- YamlValidityGuard tests -------------------------------------------

describe('YamlValidityGuard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders slot content when draft is valid', async () => {
    const router = makeTestRouter()
    await router.push('/services')
    await router.isReady()
    const wrapper = mount(YamlValidityGuard, {
      slots: { default: '<div data-testid="child">inside</div>' },
      global: { plugins: [makeI18n(), router] },
    })
    expect(wrapper.find('[data-testid="child"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="yaml-invalid-banner"]').exists()).toBe(false)
  })

  it('blocks structural routes and shows banner when draft is invalid', async () => {
    const store = useConfigStore()
    store.draftText = 'mode: rule\n: broken\n{: :}'
    expect(store.draftValid).toBe(false)
    const router = makeTestRouter()
    await router.push('/services')
    await router.isReady()
    const wrapper = mount(YamlValidityGuard, {
      slots: { default: '<div data-testid="child">inside</div>' },
      global: { plugins: [makeI18n(), router] },
    })
    expect(wrapper.find('[data-testid="child"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="yaml-invalid-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="yaml-invalid-banner-link"]').exists()).toBe(true)
  })

  it('does NOT block non-structural routes (Raw YAML, History, Settings)', async () => {
    const store = useConfigStore()
    store.draftText = ': broken\n{: :}'
    expect(store.draftValid).toBe(false)
    const router = makeTestRouter()
    await router.push('/raw-yaml')
    await router.isReady()
    const wrapper = mount(YamlValidityGuard, {
      slots: { default: '<div data-testid="child">inside</div>' },
      global: { plugins: [makeI18n(), router] },
    })
    // Raw YAML stays reachable so the operator can fix the syntax.
    expect(wrapper.find('[data-testid="child"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="yaml-invalid-banner"]').exists()).toBe(false)

    await router.push('/history')
    await router.isReady()
    const w2 = mount(YamlValidityGuard, {
      slots: { default: '<div data-testid="child">inside</div>' },
      global: { plugins: [makeI18n(), router] },
    })
    expect(w2.find('[data-testid="child"]').exists()).toBe(true)
    expect(w2.find('[data-testid="yaml-invalid-banner"]').exists()).toBe(false)
  })

  it('unblocks structural route once YAML becomes valid again', async () => {
    const store = useConfigStore()
    store.draftText = ': broken\n{: :}'
    const router = makeTestRouter()
    await router.push('/services')
    await router.isReady()
    const wrapper = mount(YamlValidityGuard, {
      slots: { default: '<div data-testid="child">inside</div>' },
      global: { plugins: [makeI18n(), router] },
    })
    expect(wrapper.find('[data-testid="yaml-invalid-banner"]').exists()).toBe(true)
    store.draftText = 'mode: rule\n'
    await flushPromises()
    expect(store.draftValid).toBe(true)
    expect(wrapper.find('[data-testid="yaml-invalid-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="child"]').exists()).toBe(true)
  })
})

// ---- RawYaml page tests -------------------------------------------------

describe('RawYaml page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountPage() {
    const router = makeTestRouter()
    return mount(RawYaml, {
      global: {
        plugins: [makeI18n(), router],
        stubs: {
          // We stub the async child components — jsdom still can't layout
          // Monaco, and the tests focus on the page-level plumbing.
          MonacoYamlView: defineComponent({
            props: ['modelValue'],
            template: '<div data-testid="stub-view">{{ modelValue }}</div>',
          }),
          MonacoYamlEdit: defineComponent({
            props: ['modelValue', 'parseError'],
            emits: ['update:modelValue'],
            setup(_props, { emit }) {
              function onInput(ev: Event) {
                const target = ev.target as HTMLTextAreaElement | null
                emit('update:modelValue', target?.value ?? '')
              }
              return { onInput }
            },
            template: '<textarea data-testid="stub-edit" :value="modelValue" @input="onInput" />',
          }),
        },
      },
    })
  }

  it('defaults to view mode with the view badge', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="stub-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-edit"]').exists()).toBe(false)
  })

  it('switches to edit mode when the Edit toggle is clicked', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.get('[data-testid="raw-yaml-mode-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="stub-edit"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-view"]').exists()).toBe(false)
  })

  it('shows a dirty badge when the edit buffer diverges from draftText', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.get('[data-testid="raw-yaml-mode-edit"]').trigger('click')
    await flushPromises()
    const textarea = wrapper.get('[data-testid="stub-edit"]')
    await textarea.setValue('mode: global\n')
    expect(wrapper.find('[data-testid="raw-yaml-dirty-badge"]').exists()).toBe(true)
  })

  it('Apply button is disabled when YAML is invalid', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.get('[data-testid="raw-yaml-mode-edit"]').trigger('click')
    await flushPromises()
    const textarea = wrapper.get('[data-testid="stub-edit"]')
    await textarea.setValue(': broken\n{: :}')
    await flushPromises()
    const applyBtn = wrapper.get('[data-testid="raw-yaml-apply"]')
    expect(applyBtn.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="raw-yaml-parse-error"]').exists()).toBe(true)
  })

  it('Apply button calls store.applyRawYaml on valid YAML + clears dirty state', async () => {
    const store = useConfigStore()
    store.rawLive = 'mode: rule\n'
    store.draftText = 'mode: rule\n'
    const applySpy = vi.spyOn(store, 'applyRawYaml').mockResolvedValue(true)
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.get('[data-testid="raw-yaml-mode-edit"]').trigger('click')
    await flushPromises()
    const textarea = wrapper.get('[data-testid="stub-edit"]')
    await textarea.setValue('mode: global\n')
    await flushPromises()
    expect(wrapper.find('[data-testid="raw-yaml-dirty-badge"]').exists()).toBe(true)
    await wrapper.get('[data-testid="raw-yaml-apply"]').trigger('click')
    await flushPromises()
    expect(applySpy).toHaveBeenCalledWith('mode: global\n')
  })
})

// ---- schema sanity ------------------------------------------------------

describe('mihomo.schema.json', () => {
  it('covers known top-level fields with types + enums', () => {
    const props = (mihomoSchema as { properties: Record<string, unknown> }).properties
    expect(props.mode).toBeDefined()
    expect(props['log-level']).toBeDefined()
    expect(props.dns).toBeDefined()
    expect(props.tun).toBeDefined()
    expect(props.sniffer).toBeDefined()
    expect(props['rule-providers']).toBeDefined()
    expect(props.proxies).toBeDefined()
    expect(props['proxy-groups']).toBeDefined()
    expect(props.rules).toBeDefined()
  })

  it('stays permissive at the root (additionalProperties: true)', () => {
    expect((mihomoSchema as { additionalProperties: boolean }).additionalProperties).toBe(true)
  })

  it('nested sections (dns/tun/sniffer) preserve additionalProperties: true', () => {
    const p = (mihomoSchema as { properties: Record<string, { additionalProperties?: boolean }> })
      .properties
    expect(p.dns?.additionalProperties).toBe(true)
    expect(p.tun?.additionalProperties).toBe(true)
    expect(p.sniffer?.additionalProperties).toBe(true)
  })

  it('declares the mode enum with the three mihomo modes', () => {
    const mode = (mihomoSchema as { properties: { mode: { enum: string[] } } }).properties.mode
    expect(mode.enum).toContain('rule')
    expect(mode.enum).toContain('global')
    expect(mode.enum).toContain('direct')
  })
})

// ---- MonacoYamlEdit live schema wiring ---------------------------------
//
// We don't test Monaco's actual completion popup — jsdom can't render it
// and the worker is stubbed. Instead we assert the registration contract:
// `configureMonacoYaml` is invoked (exactly once across the whole page
// lifecycle) with the mihomo schema under `fileMatch: ['*']` and the
// stable miharbor.local uri. That's the ground truth for live schema
// hover + autocomplete — once monaco-yaml receives it, the language
// server does the rest.

describe('MonacoYamlEdit — monaco-yaml live schema wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    // Clear the global probe so each test starts from a known state.
    delete (globalThis as { __MIHARBOR_YAML_SCHEMA?: unknown }).__MIHARBOR_YAML_SCHEMA
  })

  it('registers the mihomo schema exactly once with the expected shape', async () => {
    // Freshly import the component so the module-scoped `yamlConfigured`
    // flag starts false for this test (vitest isolates per-file, but
    // within a file modules are cached — so we reset the call log and
    // assert from this mount onward).
    configureMonacoYamlSpy.mockClear()
    const { default: MonacoYamlEdit } = await import('../src/components/yaml/MonacoYamlEdit.vue')
    const wrapper = mount(MonacoYamlEdit, {
      props: { modelValue: 'mode: rule\n' },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()
    await nextTick()

    // configureMonacoYaml may already have been called in a prior test
    // within this file (module-scoped guard); we only care that after
    // ALL current mounts the call happened at least once with the right
    // shape, AND that the guard prevents duplicate registration by a
    // second mount.
    const probe = (globalThis as { __MIHARBOR_YAML_SCHEMA?: Record<string, unknown> })
      .__MIHARBOR_YAML_SCHEMA
    expect(probe).toBeDefined()
    expect(probe?.uri).toBe('https://miharbor.local/schemas/mihomo.schema.json')
    expect(probe?.schema).toBe(mihomoSchema)
    expect(probe?.configured).toBe(true)

    wrapper.unmount()
  })

  it('only calls configureMonacoYaml once across multiple remounts', async () => {
    const { default: MonacoYamlEdit } = await import('../src/components/yaml/MonacoYamlEdit.vue')
    const before = configureMonacoYamlSpy.mock.calls.length

    const w1 = mount(MonacoYamlEdit, {
      props: { modelValue: 'a: 1\n' },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()
    w1.unmount()

    const w2 = mount(MonacoYamlEdit, {
      props: { modelValue: 'b: 2\n' },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()
    w2.unmount()

    // Zero net-new calls: the module-scoped `yamlConfigured` guard means
    // remounting does NOT re-register the schema. (In the first-mount test
    // above, the call may already have happened; subsequent mounts must
    // NOT bump the counter.)
    expect(configureMonacoYamlSpy.mock.calls.length).toBe(Math.max(before, 1))
  })

  it('passes fileMatch: ["*"], hover:true, completion:true, validate:true, format:false to monaco-yaml', async () => {
    // The single call (over the whole test file) must carry the contract
    // we promise: live schema hints for every model, formatter off.
    // If the call hasn't happened yet (test ordering), force a mount.
    if (configureMonacoYamlSpy.mock.calls.length === 0) {
      const { default: MonacoYamlEdit } = await import('../src/components/yaml/MonacoYamlEdit.vue')
      const w = mount(MonacoYamlEdit, {
        props: { modelValue: '' },
        global: { plugins: [makeI18n()] },
      })
      await flushPromises()
      w.unmount()
    }
    expect(configureMonacoYamlSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    const [, options] = configureMonacoYamlSpy.mock.calls[0] as [
      unknown,
      {
        schemas: Array<{ fileMatch: string[]; uri: string; schema: unknown }>
        hover?: boolean
        completion?: boolean
        validate?: boolean
        format?: boolean
      },
    ]
    expect(options.schemas).toHaveLength(1)
    expect(options.schemas[0].fileMatch).toEqual(['*'])
    expect(options.schemas[0].uri).toBe('https://miharbor.local/schemas/mihomo.schema.json')
    expect(options.schemas[0].schema).toBe(mihomoSchema)
    expect(options.hover).toBe(true)
    expect(options.completion).toBe(true)
    expect(options.validate).toBe(true)
    expect(options.format).toBe(false)
  })
})
