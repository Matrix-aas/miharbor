<script setup lang="ts">
// MonacoYamlEdit — read-write Monaco wrapper used by Raw YAML edit mode
// (Task 39). Shares the lazy-load + no-worker strategy with MonacoYamlView
// but is a distinct component because the editable side needs:
//   * two-way sync with `v-model` (debounced `update:modelValue` emits)
//   * inline parse-error markers surfaced via `editor.setModelMarkers`
//   * an `isDirty` flag for the Apply button in RawYaml.vue
//   * a JSON Schema registered as an advisory reference — Stage 2 keeps
//     schema hints as a "nice-to-have" (see task notes: monaco-yaml isn't
//     currently installed, so we surface YAML parse errors from the
//     `yaml` library and stash the JSON Schema next to this file for a
//     future monaco-yaml drop-in).
//
// The parse-error marker pipeline:
//   1. user types → editor fires `onDidChangeModelContent`
//   2. we emit `update:modelValue`
//   3. a parent-watched `parseError` prop flows back in with {line, col,
//      message} — we translate it into `monaco.MarkerSeverity.Error` and
//      call `editor.setModelMarkers(model, 'miharbor-yaml', […])`.
// Passing the error diagnostic as a prop (rather than re-parsing inside
// the wrapper) keeps the store as the single source of truth.

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
  /** Optional JSON Schema URL. When monaco-yaml is available in the bundle,
   *  a future version can pipe this through the YAML language service for
   *  autocomplete/hover. The current read-write wrapper only uses it as a
   *  reference (the schema lives next to this file). */
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
    const monacoPromise = import('monaco-editor/esm/vs/editor/editor.api')
    const contribPromise = import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution')
    const [monaco] = await Promise.all([monacoPromise, contribPromise])
    monacoRef = monaco as unknown as MonacoNamespace
    if (!container.value) return

    // Stub worker — read-write basic-languages tokenizer runs on the main
    // thread; without this, Monaco throws when language-server modules try
    // to spawn a worker. Same pattern as MonacoYamlView.
    const envTarget = globalThis as unknown as { MonacoEnvironment?: unknown }
    envTarget.MonacoEnvironment = {
      getWorker: () => {
        const blobURL = URL.createObjectURL(
          new Blob(['self.onmessage = () => {};'], { type: 'application/javascript' }),
        )
        return new Worker(blobURL)
      },
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

    // Schema: stash a reference on the global so a future monaco-yaml drop-in
    // can grab it. We deliberately don't register it against `languages.yaml`
    // because that module isn't in the bundle; logging the intent keeps the
    // reference path discoverable for reviewers.
    ;(globalThis as unknown as { __MIHARBOR_YAML_SCHEMA?: unknown }).__MIHARBOR_YAML_SCHEMA = {
      uri: props.schemaUri,
      schema: mihomoSchema,
    }

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
