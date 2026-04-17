<script lang="ts">
// Module-scoped state lives in a non-setup script block so it's truly shared
// across every instance of this component. Vue's `<script setup>` wraps its
// top-level bindings in the component's per-instance setup function — so a
// `let yamlConfigured = false` inside `<script setup>` would reset on each
// mount and defeat the "configure monaco-yaml exactly once per page load"
// invariant that follow-up to Task 39 promises. We export the getter + setter
// as named helpers so tests can assert / reset without spelunking the
// module's closure.
let yamlConfigured = false

export function __isYamlConfiguredForTests(): boolean {
  return yamlConfigured
}

export function __setYamlConfiguredForTests(v: boolean): void {
  yamlConfigured = v
}
</script>

<script setup lang="ts">
// MonacoYamlEdit — read-write Monaco wrapper used by Raw YAML edit mode
// (Task 39 + follow-up: live schema hover/autocomplete via monaco-yaml).
//
// Pipeline:
//   * Lazy dynamic import of `monaco-editor/esm/vs/editor/editor.api` plus the
//     yaml basic-languages tokenizer contribution keeps the Monaco runtime in
//     a separate chunk (verified by `scripts/check-bundle-size.ts`).
//   * monaco-yaml is imported in the same async chunk and `configureMonacoYaml`
//     is invoked ONCE per page load (module-scoped flag `yamlConfigured`). The
//     yaml language server ships as a Web Worker — Vite's `?worker` suffix
//     emits it as an ES-module worker so the ~300 KB worker payload doesn't
//     land in the main bundle either.
//   * Schema source: `@/schemas/mihomo.schema.json`. Registered against
//     `fileMatch: ['*']` so every model opened by this wrapper receives live
//     hover + completion hints. The schema URI is the same stable
//     `https://miharbor.local/schemas/mihomo.schema.json` used before — it
//     both identifies the schema to the language server and shows up as the
//     source in hover tooltips.
//   * Two-way sync with `v-model` (debounce lives in the parent store),
//     parse-error markers surfaced via `editor.setModelMarkers` for errors
//     the `yaml` library catches before the worker does, and a module-scoped
//     `__MIHARBOR_YAML_SCHEMA` probe is still set so integration tests and
//     devtools can confirm the schema is wired.
//
// Why `configureMonacoYaml` instead of a fresh call per mount?
//   monaco-yaml is documented as "only one configured instance at a time"
//   (see https://github.com/remcohaszing/monaco-yaml). Re-running the setup
//   on every component remount would churn the language-server worker; a
//   single configure + keep-alive is the supported path.

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import mihomoSchema from '@/schemas/mihomo.schema.json'

interface ParseErrorProp {
  message: string
  line?: number
  col?: number
}

interface Props {
  modelValue: string
  parseError?: ParseErrorProp | null
  /** Optional JSON Schema URL. Used as the `uri` we hand to monaco-yaml, so
   *  the language server also reports this URL as the schema source in its
   *  hover tooltips. */
  schemaUri?: string
  height?: string
}

const props = withDefaults(defineProps<Props>(), {
  parseError: null,
  schemaUri: 'https://miharbor.local/schemas/mihomo.schema.json',
  height: '100%',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'ready'): void
}>()

// Minimal structural types — same reason as MonacoYamlView: importing the
// real Monaco types eagerly would defeat the lazy-chunk strategy.
interface MonacoMarkerData {
  severity: number
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  source?: string
}
interface MonacoModel {
  setValue(v: string): void
  getValue(): string
  onDidChangeContent(cb: () => void): { dispose(): void }
}
interface MonacoEditorInstance {
  getValue(): string
  setValue(v: string): void
  getModel(): MonacoModel | null
  dispose(): void
  updateOptions(opts: Record<string, unknown>): void
  onDidChangeModelContent(cb: () => void): { dispose(): void }
}
interface MonacoNamespace {
  editor: {
    create(el: HTMLElement, opts: Record<string, unknown>): MonacoEditorInstance
    setModelMarkers(model: MonacoModel, owner: string, markers: MonacoMarkerData[]): void
  }
  MarkerSeverity: { Error: number; Warning: number; Info: number; Hint: number }
}

// `yamlConfigured` lives in the non-setup <script> block above — Vue's
// `<script setup>` would otherwise wrap it per-instance, losing the "once
// per page load" guarantee.

const container = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
let editor: MonacoEditorInstance | null = null
let monacoRef: MonacoNamespace | null = null
let contentDisposer: { dispose(): void } | null = null
// Swallow the echo when we programmatically `setValue` from a parent update.
let suppressNextChange = false

async function init(): Promise<void> {
  if (!container.value) return
  try {
    // Web workers: we need BOTH Monaco's editorWorkerService (core worker)
    // AND monaco-yaml's yaml.worker. The `?worker` suffix is Vite's
    // directive to emit a worker entry; it matches monaco-yaml's documented
    // Vite workaround. Workers are imported eagerly here (inside the async
    // init) so they land inside the MonacoYamlEdit chunk, not the initial
    // bundle.
    const envTarget = globalThis as unknown as {
      MonacoEnvironment?: { getWorker?: (moduleId: string, label: string) => Worker }
    }
    const [{ default: EditorWorker }, { default: YamlWorker }] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('@/workers/yaml.worker?worker'),
    ])
    envTarget.MonacoEnvironment = {
      getWorker: (_moduleId: string, label: string): Worker => {
        if (label === 'yaml') return new YamlWorker()
        return new EditorWorker()
      },
    }

    const monacoPromise = import('monaco-editor/esm/vs/editor/editor.api')
    const contribPromise = import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution')
    const yamlPluginPromise = import('monaco-yaml')
    const [monaco, , yamlPlugin] = await Promise.all([
      monacoPromise,
      contribPromise,
      yamlPluginPromise,
    ])
    monacoRef = monaco as unknown as MonacoNamespace
    if (!container.value) return

    // Configure monaco-yaml exactly once. Idempotent across remounts; a
    // future hot-reload should clear `yamlConfigured` if we ever want to
    // rebind the schema dynamically (not needed today — schema is static).
    if (!yamlConfigured) {
      yamlPlugin.configureMonacoYaml(
        monaco as Parameters<typeof yamlPlugin.configureMonacoYaml>[0],
        {
          schemas: [
            {
              fileMatch: ['*'],
              uri: props.schemaUri,
              schema: mihomoSchema as Parameters<typeof yamlPlugin.configureMonacoYaml>[1] extends {
                schemas?: Array<{ schema?: infer S }>
              }
                ? S
                : never,
            },
          ],
          hover: true,
          completion: true,
          validate: true,
          // Prettier formatting is useful in theory but would grab Cmd/Ctrl+Shift+I
          // globally and diff against a formatter we don't control — keep the
          // user's whitespace until the ecosystem settles on a consistent style.
          format: false,
        },
      )
      yamlConfigured = true
    }

    // Leave a discoverable probe for tests + devtools. Real schema loading
    // now goes through monaco-yaml (above), but the probe confirms the
    // wiring ran and exposes the raw schema + URI for inspection.
    ;(globalThis as unknown as { __MIHARBOR_YAML_SCHEMA?: unknown }).__MIHARBOR_YAML_SCHEMA = {
      uri: props.schemaUri,
      schema: mihomoSchema,
      configured: yamlConfigured,
    }

    editor = monacoRef.editor.create(container.value, {
      value: props.modelValue,
      language: 'yaml',
      readOnly: false,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      wordWrap: 'off',
      renderWhitespace: 'none',
      scrollbar: { useShadows: false },
      tabSize: 2,
    })

    contentDisposer = editor.onDidChangeModelContent(() => {
      if (!editor) return
      if (suppressNextChange) {
        suppressNextChange = false
        return
      }
      const next = editor.getValue()
      if (next !== props.modelValue) {
        emit('update:modelValue', next)
      }
    })

    applyMarkers(props.parseError)
    loading.value = false
    emit('ready')
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

function applyMarkers(err: ParseErrorProp | null | undefined): void {
  if (!editor || !monacoRef) return
  const model = editor.getModel()
  if (!model) return
  if (!err) {
    monacoRef.editor.setModelMarkers(model, 'miharbor-yaml', [])
    return
  }
  const line = Math.max(1, err.line ?? 1)
  const col = Math.max(1, err.col ?? 1)
  monacoRef.editor.setModelMarkers(model, 'miharbor-yaml', [
    {
      severity: monacoRef.MarkerSeverity.Error,
      message: err.message,
      startLineNumber: line,
      startColumn: col,
      // End the marker at end-of-line so the squiggle is visible without a
      // parsed `endLine/endCol` pair from the yaml library (it only emits
      // the start position).
      endLineNumber: line,
      endColumn: col + 1,
      source: 'yaml',
    },
  ])
}

onMounted(() => {
  void init()
})

watch(
  () => props.modelValue,
  (next) => {
    if (!editor) return
    if (editor.getValue() === next) return
    suppressNextChange = true
    // Preserve the cursor/selection by setting through the model — Monaco's
    // editor.setValue resets them, model.setValue doesn't.
    const model = editor.getModel()
    if (model) model.setValue(next)
    else editor.setValue(next)
  },
)

watch(
  () => props.parseError,
  (next) => applyMarkers(next ?? null),
  { deep: true },
)

onBeforeUnmount(() => {
  contentDisposer?.dispose()
  contentDisposer = null
  if (editor) {
    editor.dispose()
    editor = null
  }
  monacoRef = null
})
</script>

<template>
  <div class="relative h-full w-full" data-testid="monaco-yaml-edit">
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"
    >
      Loading editor…
    </div>
    <div
      v-if="loadError"
      class="absolute inset-0 flex items-center justify-center text-sm text-destructive"
    >
      Failed to load editor: {{ loadError }}
    </div>
    <div
      ref="container"
      class="h-full w-full"
      :style="{ height }"
      :aria-hidden="loading ? 'true' : 'false'"
    ></div>
  </div>
</template>
