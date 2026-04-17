// Flat config (ESLint 9). Uses typescript-eslint parser for *.ts files and
// vue-eslint-parser (with typescript-eslint as inner parser) for *.vue files,
// so both <script lang="ts"> blocks and <template> blocks are understood.
//
// Each workspace invokes `eslint <pattern> --max-warnings 0` against its own
// tree; apps/web uses "src/**/*.{ts,vue}" so the config below must lint both.
//
// Accessibility (Task 50): eslint-plugin-vuejs-accessibility is registered
// at WARN level (not error) per MVP scope. To keep the strict `--max-warnings 0`
// main lint green while still tracking a11y, the a11y rule group activates
// only when MIHARBOR_A11Y=1 is set in the environment (the `lint:a11y`
// script in apps/web/package.json). Promote rules to error one-by-one
// post-v0.2.0 after cleaning warnings.
import tseslint from 'typescript-eslint'
import vuePlugin from 'eslint-plugin-vue'
import vueA11y from 'eslint-plugin-vuejs-accessibility'
import vueParser from 'vue-eslint-parser'

const a11yEnabled = process.env.MIHARBOR_A11Y === '1'
const a11ySeverity = a11yEnabled ? 'warn' : 'off'

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
    plugins: {
      'vuejs-accessibility': vueA11y,
    },
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
      // ── Accessibility (Task 50): warn-level baseline ─────────────────
      // Manually enumerated (rather than ...vueA11y.configs['flat/recommended'])
      // so we control severity precisely. Rules activate only under
      // MIHARBOR_A11Y=1 (see `lint:a11y` script) — outside that, they are
      // 'off' so the strict `--max-warnings 0` main lint stays green.
      'vuejs-accessibility/alt-text': a11ySeverity,
      'vuejs-accessibility/anchor-has-content': a11ySeverity,
      'vuejs-accessibility/aria-props': a11ySeverity,
      'vuejs-accessibility/aria-role': a11ySeverity,
      'vuejs-accessibility/aria-unsupported-elements': a11ySeverity,
      'vuejs-accessibility/click-events-have-key-events': a11ySeverity,
      'vuejs-accessibility/form-control-has-label': a11ySeverity,
      'vuejs-accessibility/heading-has-content': a11ySeverity,
      'vuejs-accessibility/iframe-has-title': a11ySeverity,
      'vuejs-accessibility/interactive-supports-focus': a11ySeverity,
      'vuejs-accessibility/label-has-for': a11yEnabled
        ? [
            'warn',
            // Either `for` attribute OR a wrapped control counts. shadcn-style
            // labels often wrap, so don't mandate explicit for=.
            { required: { some: ['nesting', 'id'] } },
          ]
        : 'off',
      'vuejs-accessibility/mouse-events-have-key-events': a11ySeverity,
      'vuejs-accessibility/no-access-key': a11ySeverity,
      'vuejs-accessibility/no-autofocus': a11ySeverity,
      'vuejs-accessibility/no-distracting-elements': a11ySeverity,
      'vuejs-accessibility/no-onchange': a11ySeverity,
      'vuejs-accessibility/no-redundant-roles': a11ySeverity,
      'vuejs-accessibility/no-static-element-interactions': a11ySeverity,
      'vuejs-accessibility/role-has-required-aria-props': a11ySeverity,
      'vuejs-accessibility/tabindex-no-positive': a11ySeverity,
      // media-has-caption is off — no <video>/<audio> in the app.
      'vuejs-accessibility/media-has-caption': 'off',
    },
  },
)
