import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat ESLint config for the QF Jarvis workspace.
 *
 * We use typescript-eslint's syntactic ("recommended") ruleset rather than the
 * type-checked one. It needs no per-file tsconfig resolution, so it stays fast
 * and predictable across every workspace package, and `pnpm typecheck` already
 * provides full type-aware verification as its own quality gate.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // The architecture forbids `any`; make it a hard error, not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
    },
  },
  {
    // Config files and build scripts run in Node without the app's constraints.
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    rules: {
      'no-console': 'off',
    },
  },
);
