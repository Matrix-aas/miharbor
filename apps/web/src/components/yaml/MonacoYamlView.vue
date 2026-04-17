<script setup lang="ts">
// Thin Monaco wrapper — YAML-highlighted, read-only by default, lazy-loaded.
//
// Design notes:
//  * Monaco is ~3MB raw / ~1MB gzipped. We dynamically `import()` only
//    `monaco-editor/esm/vs/editor/editor.api` (the thinnest entry that gives
//    us `editor.create` + the YAML grammar) so Vite emits it as a separate
//    chunk. The main app bundle stays at its pre-Monaco size.
//  * Web-workers: Monaco wants language-server workers. We avoid the whole
//    MonacoEnvironment dance by setting `renderLineHighlight: 'none'` and
//    using the lightweight API (no language server). Syntax highlight works
//    because YAML tokenization is built into Monaco's core (`basic-languages`).
//  * We expose `readOnly` as a prop so History can reuse this wrapper for the
//    "view snapshot" drawer later.

import { onMounted, onBeforeUnmount, ref, watch } from 'vue'

interface Props {
  modelValue: string
  /** Defaults to true — Stage-1 has no edit mode. Task 39 will flip this. */
  readOnly?: boolean
  /** Monaco language id. Defaults to 'yaml'. */
  language?: string
  /** Fill the parent container's height. */
  height?: string
}

const props = withDefaults(defineProps<Props>(), {
  readOnly: true,
  language: 'yaml',
  height: '100%',
})

defineEmits<{
  (e: 'ready'): void
}>()

// We use a structural interface for Monaco's editor — importing the real
// types eagerly would defeat the lazy-load. The surface we touch is small:
// getValue / setValue, getModel, dispose, updateOptions.
interface MinimalMonacoEditor {
  getValue(): string
  setValue(v: string): void
  getModel(): { setValue(v: string): void } | null
  dispose(): void
  updateOptions(opts: Record<string, unknown>): void
}

const container = ref<HTMLDivElement | null>(null)
let editorInstance: MinimalMonacoEditor | null = null
const loading = ref(true)
const loadError = ref<string | null>(null)

async function init(): Promise<void> {
  if (!container.value) return
  try {
    // Lazy dynamic import — creates a separate chunk.
    // We import the "contrib" basic-languages bundle so YAML tokenization is
    // registered. The `editor.api` entry is the thinnest: no language-server.
    const monacoPromise = import('monaco-editor/esm/vs/editor/editor.api')
    // Register basic-languages. Monaco's `contributions.js` auto-registers
    // all languages when imported, including YAML.
    const contribPromise = import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution')
    const [monaco] = await Promise.all([monacoPromise, contribPromise])
    if (!container.value) {
      return
    }
    // Disable web workers — we don't need them for read-only syntax highlight
    // and configuring them requires Vite `?worker` imports that we can skip
    // for the MVP read-only view. Setting the MonacoEnvironment makes the
    // editor fall back to the main thread.
    ;(globalThis as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
      getWorker: () => {
        // Return a no-op worker stub. Read-only view + builtin tokenizer
        // doesn't ask the workers for anything, but if Monaco does request
        // one we respond with an empty worker so it doesn't throw.
        const blobURL = URL.createObjectURL(
          new Blob(['self.onmessage = () => {};'], { type: 'application/javascript' }),
        )
        return new Worker(blobURL)
      },
    }
    editorInstance = monaco.editor.create(container.value, {
      value: props.modelValue,
      language: props.language,
      readOnly: props.readOnly,
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
    }) as unknown as MinimalMonacoEditor
    loading.value = false
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

onMounted(() => {
  void init()
})

// Reactively sync the model value — the Raw YAML page updates as draftText
// changes. If we ever flip to read-write mode, this watch will also need to
// reconcile user edits.
watch(
  () => props.modelValue,
  (newValue) => {
    if (!editorInstance) return
    if (editorInstance.getValue() === newValue) return
    // Preserve cursor/scroll position — Monaco's `setValue` resets both,
    // so we save → set → restore.
    const model = editorInstance.getModel()
    if (model) model.setValue(newValue)
    else editorInstance.setValue(newValue)
  },
)

watch(
  () => props.readOnly,
  (ro) => {
    if (!editorInstance) return
    editorInstance.updateOptions({ readOnly: ro })
  },
)

onBeforeUnmount(() => {
  if (editorInstance) {
    editorInstance.dispose()
    editorInstance = null
  }
})
</script>

<template>
  <div class="relative h-full w-full" data-testid="monaco-yaml-view">
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

<style scoped>
/* Monaco appends absolutely-positioned widgets; the parent must be
   positioned so they don't escape. */
</style>
