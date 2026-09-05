import js from '@eslint/js'
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
)

export default eslintConfig
