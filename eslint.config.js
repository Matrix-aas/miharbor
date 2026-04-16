// Flat config (ESLint 9). Minimal config — just enough to satisfy `--max-warnings 0`
// in each workspace. Each workspace invokes eslint on its own `src/` directory.
export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.bun/**', '**/*.d.ts', '**/*.vue'],
  },
  {
    files: ['**/*.{js,cjs,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'off', // TS compiler handles this via noUnusedLocals/Parameters
      'no-undef': 'off', // TS handles undefined symbols
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]
