// Flat config (ESLint 9). Uses typescript-eslint parser for *.ts files and
// vue-eslint-parser (with typescript-eslint as inner parser) for *.vue files,
// so both <script lang="ts"> blocks and <template> blocks are understood.
//
// Each workspace invokes `eslint <pattern> --max-warnings 0` against its own
// tree; apps/web uses "src/**/*.{ts,vue}" so the config below must lint both.
import tseslint from 'typescript-eslint'
import vuePlugin from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.bun/**', '**/*.d.ts'],
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // Vue SFCs. Keep the rule surface small — shadcn-style components often
  // use `class` / `as` props that trip over stricter defaults. We inherit
  // only the recommended ruleset and disable the ones that don't earn their
  // keep in an SFC-heavy codebase.
  ...vuePlugin.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // SFCs that re-export primitives often contain only the <script>/<template>
      // blocks — the single-root-element rule does not apply to Vue 3.
      'vue/no-multiple-template-root': 'off',
      // shadcn-style single-word components are fine (Button, Badge, Input).
      'vue/multi-word-component-names': 'off',
      // Attribute ordering pedantry — nice to have but noisy in this skeleton.
      'vue/attributes-order': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      // Optional props are expressed through TS types (`prop?: T`); no need
      // to force a runtime default as well.
      'vue/require-default-prop': 'off',
    },
  },
)
