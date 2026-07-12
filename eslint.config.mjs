// @ts-check
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat configuration.
 *
 * The rule set is deliberately small: it is typescript-eslint's maintained
 * strict + stylistic type-checked presets, plus a short, documented override
 * list. A large hand-rolled rule set is a maintenance burden that nobody
 * updates and that drifts out of agreement with the compiler.
 *
 * CI runs `eslint . --max-warnings=0`, so a warning fails the build exactly as
 * an error does. There is no "warning" severity in practice — a rule is either
 * worth enforcing or it is not enabled.
 *
 * See docs/engineering/quality-gates.md.
 */
export default tseslint.config(
  // Generated output, dependencies, and caches are never linted.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.cache/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,

  // TypeScript source — type-aware linting.
  //
  // `projectService: true` resolves each file against its own project's
  // tsconfig, which is what lets apps/api and apps/worker be linted (and
  // type-checked) independently of one another.
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused imports and variables are errors. A leading underscore is the
      // explicit, greppable way to say "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // `verbatimModuleSyntax` requires type-only imports to be written as such.
      // This rule makes the fix automatic rather than a compiler error.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // Module configuration files and the clean script. These are plain ESM and
  // are not part of a TypeScript project, so they are linted without type
  // information.
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // The contracts package claims to have no side effects: it opens no socket,
  // reads no environment variable, touches no filesystem, and logs nothing.
  //
  // A claim that nothing enforces is a comment. These rules are the enforcement —
  // a contract library that logs is a contract library that leaks, and the values
  // it would be logging are exactly the ones it just refused to accept.
  {
    files: ['packages/contracts/src/**/*.ts'],
    ignores: ['packages/contracts/src/tests/**'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'The contracts package reads no environment.' },
        { name: 'fetch', message: 'The contracts package performs no network activity.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'net', 'http', 'https', 'child_process'],
              message:
                'The contracts package is pure data and validation. It performs no I/O of any kind.',
            },
          ],
        },
      ],
    },
  },

  // Must remain last: turns off every rule that would fight Prettier.
  // Formatting is Prettier's job; ESLint's job is correctness.
  eslintConfigPrettier,
);
