// Flat config (ESLint 9). Uses typescript-eslint parser so TS-specific syntax
// (type annotations, interfaces, etc.) is understood. Each workspace invokes
// `eslint src --max-warnings 0` against its own tree.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.bun/**', '**/*.d.ts', '**/*.vue'],
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
)
