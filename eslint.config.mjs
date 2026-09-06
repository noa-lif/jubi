import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const eslintConfig = tseslint.config(
  {
    ignores: ['client/**', 'server/**', 'generated/**', '.next/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // Server-side code and build scripts run in Node, so `process`, `Buffer`
    // and `console` are legitimate globals there.
    files: [
      'scripts/**/*.mjs',
      'lib/**/*.ts',
      'app/api/**/*.ts',
      'tests/**/*.ts',
      'tests/**/*.tsx',
      '*.mts',
      '*.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)

export default eslintConfig
