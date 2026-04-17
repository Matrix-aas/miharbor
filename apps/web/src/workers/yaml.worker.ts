// monaco-yaml Vite worker wrapper.
//
// monaco-yaml ships `yaml.worker.js` as a plain bundle. In Vite, pointing
// `new Worker(new URL('monaco-yaml/yaml.worker', import.meta.url))` directly
// triggers the "Unexpected usage" error the upstream README documents; the
// workaround is a local worker entry that re-exports the upstream worker,
// which we then import with `?worker` from MonacoYamlEdit. That tells Vite
// to emit a proper ES-module worker bundle and hands us a Worker constructor.
//
// Upstream docs:
//   https://github.com/remcohaszing/monaco-yaml#why-doesnt-it-work-with-vite
import 'monaco-yaml/yaml.worker.js'
