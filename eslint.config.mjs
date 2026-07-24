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

  // The event-ingestion signature verifier claims to be pure and synchronous: it
  // reads no clock, no environment, no filesystem, and no network. `now` is injected
  // and the keys are injected. These rules are the enforcement of that claim — a
  // verifier that reached for Date.now() or process.env would quietly break the tested
  // property that an event's validity depends only on the injected inputs. node:crypto
  // is the one permitted node builtin; the I/O modules are forbidden.
  {
    files: ['packages/event-ingestion/src/**/*.ts'],
    ignores: ['packages/event-ingestion/src/tests/**'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'The signature verifier reads no environment. Configuration is passed in.',
        },
        {
          name: 'fetch',
          message: 'The signature verifier performs no network activity.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'The verifier reads no clock. The current time is injected as `now`.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:fs',
                'node:fs/*',
                'node:net',
                'node:http',
                'node:https',
                'node:child_process',
                'node:dns',
                'node:tls',
                'node:dgram',
                'node:process',
                'node:worker_threads',
                'fs',
                'net',
                'http',
                'https',
                'child_process',
              ],
              message:
                'Stage 3.2 signature verification is a pure, synchronous leaf. It performs no filesystem, network, or process I/O. Only node:crypto is permitted.',
            },
          ],
        },
      ],
    },
  },

  // Projection REDUCERS claim to be pure functions of the event log: a handler reads no clock, no
  // randomness, no environment, and performs no filesystem/network I/O. That purity is what makes a
  // read model rebuildable to an identical result (ADR-0022 §4, QFJ-P03.08/ADR-0043). A reducer that
  // reached for Date.now(), Math.random(), or process.env would silently break rebuild determinism —
  // usually months later, in an incident, rather than in the pull request.
  //
  // These rules are the mechanical enforcement ADR-0022 §4 promised and that the QFJ-P03.08 readiness
  // audit found MISSING. They are scoped narrowly to the reducer implementation files in
  // `projections/handlers` — NOT the runner, worker, stores, or reader, which legitimately perform I/O
  // and own the clock/lock/transaction. Timestamps in a read model must come from the EVENT
  // (`ProjectionEvent.acceptedAt`), never from the wall clock.
  {
    files: ['packages/event-backbone/src/projections/handlers/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message:
            'A projection reducer reads no environment. Its inputs are the borrowed client and the event.',
        },
        {
          name: 'fetch',
          message: 'A projection reducer performs no network activity.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'A projection reducer reads no clock. A read-model timestamp comes from the event (ProjectionEvent.acceptedAt), never from now().',
        },
        {
          object: 'Math',
          property: 'random',
          message:
            'A projection reducer is deterministic. Randomness would make live and rebuild disagree.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message:
            'A projection reducer reads no clock. `new Date()` with no argument is the wall clock; derive time from the event instead.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:fs',
                'node:fs/*',
                'node:net',
                'node:http',
                'node:https',
                'node:child_process',
                'node:dns',
                'node:tls',
                'node:dgram',
                'node:process',
                'node:worker_threads',
                'node:crypto',
                'fs',
                'net',
                'http',
                'https',
                'child_process',
              ],
              message:
                'A projection reducer is a pure function of the event log. It performs no filesystem, network, process, or crypto I/O; it only writes its read-model table through the borrowed client.',
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
