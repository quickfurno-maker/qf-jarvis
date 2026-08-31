// @ts-check
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The filesystem/network/process/crypto imports a projection reducer must never reach for (ADR-0022 §4,
 * QFJ-P03.08). Shared so the subject-reader-boundary block can re-state it without drift when it
 * additionally restricts the subject reader for the metadata reducers.
 */
/**
 * D2a (ADR-0138): the accepted-event WRITE AUTHORITY patterns.
 *
 * Two layers, both banned for ordinary production code:
 *   - the governed cross-package writer (`internal/event-write`), and
 *   - the low-level primitive `storeValidatedEvent` itself, wherever it is imported from. Banning
 *     only the first left a same-package bypass: another `event-backbone` module could import
 *     `storeValidatedEvent` from `persistence/event-store.js`, hand-build a record and write a row
 *     while adding no second SQL INSERT and no second `event-write` importer.
 *
 * The second entry is keyed by `importNames`, NOT by module path, because the barrel legitimately
 * re-exports the READ-side outcome types and errors from that same module. Write authority is
 * restricted; read types are not.
 *
 * MUST be re-stated by every narrower block that defines its own `no-restricted-imports`: under
 * flat config a later value REPLACES an earlier one rather than merging with it. That is the same
 * hazard the subject-reader block below already documents, and composing through this constant is
 * how D2a avoids silently deleting an older boundary.
 */
const GOVERNED_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN = {
  group: [
    '@qf-jarvis/event-backbone/internal/event-write',
    '**/persistence/event-write.js',
    '**/persistence/event-write',
  ],
  message:
    'Accepted-event write authority is governed (D2a, ADR-0138). Only the event-ingestion bridge (persist-validated-event.ts) may import it, and only through the verify -> prepare -> persist path. A canonical event row must never be creatable outside signed ingestion.',
};

/**
 * The LOW-LEVEL writer, banned by NAME rather than by module path.
 *
 * The name matters because the package barrel legitimately re-exports the READ-side outcome types
 * and errors from this same module: a path ban would break the barrel and still say nothing about
 * write authority.
 *
 * The path list matters because an import specifier is matched as a STRING. `**\/persistence/...`
 * alone missed the most natural bypass of all — a module already sitting in `persistence/` writes
 * `./event-store.js`, which contains no `persistence/` segment. The bare `./` and `**` forms below
 * close that, so every practical spelling that can reach this module is covered rather than only the
 * spellings a probe happened to use.
 */
const LOW_LEVEL_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN = {
  group: [
    './event-store.js',
    './event-store',
    '**/event-store.js',
    '**/event-store',
    '**/persistence/event-store.js',
    '**/persistence/event-store',
  ],
  importNames: ['storeValidatedEvent'],
  message:
    'The low-level accepted-event writer is governed (D2a, ADR-0138). Only event-write.ts may call storeValidatedEvent, and only behind the AuthenticatedEventWrite capability. Importing it elsewhere would bypass the governed path without adding a second SQL INSERT. Read-side outcome types from this module remain unrestricted.',
};

/**
 * D4 (ADR-0140): the purpose-specific trusted communication evidence reader.
 *
 * It has **zero** production consumers in this slice, and that is the invariant — not an accident of
 * nobody having needed it yet. A generic "read the payload at a position" capability shared across
 * projections is exactly what D4 exists NOT to be, so the reader is banned repository-wide until D5
 * builds the actual communication-state handler and opens ONE exact-file exception in its own
 * reviewed PR. Nothing here pre-authorizes that consumer.
 */
const COMMUNICATION_EVIDENCE_READER_FORBIDDEN_IMPORT_PATTERN = {
  group: [
    './communication-evidence-reader.js',
    './communication-evidence-reader',
    '**/communication-evidence-reader.js',
    '**/communication-evidence-reader',
  ],
  message:
    'The trusted communication evidence reader is purpose-bounded (D4, ADR-0140). It has no production consumer in this slice; D5 must open one exact-file exception when it builds the communication-state projection handler. It is not a generic event-payload reader.',
};

const ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS = [
  GOVERNED_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN,
  LOW_LEVEL_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN,
  COMMUNICATION_EVIDENCE_READER_FORBIDDEN_IMPORT_PATTERN,
];

const REDUCER_FORBIDDEN_IO_IMPORTS = [
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
];

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
      '**/.next/**',
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
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx'],
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

  // Jarvis OS — the browser surface (JOS-01A, docs/architecture/jarvis-os.md).
  //
  // Two things differ from every other project here, and both are consequences of it being
  // the first thing that renders rather than reasons: it contains JSX, and it runs in a
  // browser as well as during a server render. So the parser is told about JSX and the
  // globals are widened to include the DOM — the STRICTNESS is unchanged, because a
  // dashboard that shows an operator whether a system is live deserves the same rule set as
  // the runtime behind it.
  {
    files: ['apps/jarvis-os/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Jarvis OS holds no authority and must never acquire one by accident. `console` in a
      // surface that renders approval state is also a leak of exactly the content the
      // backend's error contracts are careful never to quote.
      'no-console': 'error',
      'no-alert': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Jarvis OS performs no network access (JOS-01A).' },
        { name: 'localStorage', message: 'Jarvis OS stores nothing (JOS-01A).' },
        { name: 'sessionStorage', message: 'Jarvis OS stores nothing (JOS-01A).' },
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
  // D2a (ADR-0138): the BASELINE accepted-event write-authority ban, applied repository-wide.
  //
  // It sits HERE, before every specialised block, on purpose. Under flat config a later
  // `no-restricted-imports` REPLACES an earlier one, so a broad block placed last would silently
  // delete the contracts, event-ingestion and reducer boundaries defined below — a security slice
  // weakening three older ones. Placed first, a later block that needs to override for its own
  // scope may do so, and every such block re-states these patterns by spreading
  // ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS. The single production exception (the governed
  // ingestion bridge) is granted by its own block further down, which keeps that file's
  // event-ingestion purity rules in force while omitting only these write patterns.
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    ignores: [
      // In-package tests of the capability itself, and the D2a containment tests that prove this
      // very boundary, must be able to reach it. The claim D2a makes is about PRODUCTION
      // application code across packages, not about the tests that police it.
      'packages/event-backbone/src/tests/**/*.ts',
      'packages/event-ingestion/src/tests/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS] },
      ],
    },
  },

  // D2a (ADR-0138): the ONE production exception to the LOW-LEVEL writer ban.
  //
  // `event-write.ts` is the module that wraps `storeValidatedEvent` in the governed capability, so it
  // must import it — as `./event-store.js`, the sibling form the baseline block above deliberately
  // covers. The exception is granted as a narrower block rather than an `ignores` entry so it drops
  // ONLY the low-level name restriction: the governed cross-package writer pattern stays in force
  // here too, and no unrelated rule is stripped from this file.
  //
  // The permission is FILE-EXACT. A neighbour in `persistence/` inherits the full ban.
  {
    files: ['packages/event-backbone/src/persistence/event-write.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            GOVERNED_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN,
            // Its exception is for the low-level writer alone. It gains no read-side privilege.
            COMMUNICATION_EVIDENCE_READER_FORBIDDEN_IMPORT_PATTERN,
          ],
        },
      ],
    },
  },

  // D4 (ADR-0140): the evidence reader module is not banned from being itself.
  //
  // Every other production file in the repository inherits the ban above, including the projection
  // handlers — D4 deliberately ships with no consumer. This block exists only so the module can hold
  // its own imports; it keeps the full D2a write bans, because a READ capability earns no write
  // authority.
  {
    files: ['packages/event-backbone/src/projections/communication-evidence-reader.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            GOVERNED_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN,
            LOW_LEVEL_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN,
          ],
        },
      ],
    },
  },

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
            // Re-stated because this value REPLACES the baseline D2a block above (flat config).
            ...ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS,
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
            // Re-stated because this value REPLACES the baseline D2a block above (flat config).
            ...ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS,
          ],
        },
      ],
    },
  },

  // D2a (ADR-0138): the ONE production exception to the GOVERNED CROSS-PACKAGE writer ban.
  //
  // The ingestion bridge is the single file that may import the governed write capability. The
  // exception is granted by a NARROWER block rather than an `ignores` entry, because `ignores` would
  // have excluded the bridge from the purity block above and quietly stripped its event-ingestion
  // I/O rules along with the write ban.
  //
  // It omits EXACTLY ONE pattern. The bridge keeps its purity rules AND keeps the LOW-LEVEL
  // `storeValidatedEvent` ban, because it has no business calling the primitive directly: its job is
  // to build a bound record and hand it to the governed writer. Granting it both authorities would
  // have made the most authority-sensitive file in the repository the least restricted one, and
  // would have left the low-level writer with only the source scan protecting it there.
  //
  // The result is disjoint least privilege, each file holding exactly one half of the chain:
  //   event-write.ts             -> low-level writer YES, governed writer NO
  //   persist-validated-event.ts -> low-level writer NO,  governed writer YES
  //
  // The permission is FILE-EXACT. A neighbour in the same directory inherits the full ban.
  {
    files: ['packages/event-ingestion/src/ingest/persist-validated-event.ts'],
    rules: {
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
            // Retained: the bridge may hold the governed writer, never the low-level primitive.
            LOW_LEVEL_EVENT_WRITER_FORBIDDEN_IMPORT_PATTERN,
            // Retained: the bridge is a WRITE path. It gains no evidence-read privilege from D4.
            COMMUNICATION_EVIDENCE_READER_FORBIDDEN_IMPORT_PATTERN,
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
              group: [...REDUCER_FORBIDDEN_IO_IMPORTS],
              message:
                'A projection reducer is a pure function of the event log. It performs no filesystem, network, process, or crypto I/O; it only writes its read-model table through the borrowed client.',
            },
            // Re-stated because this value REPLACES the baseline D2a block above (flat config).
            ...ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS,
          ],
        },
      ],
    },
  },

  // Subject visibility is least-privilege by MODULE BOUNDARY (QFJ-P03.09, ADR-0044). The opaque subject
  // is resolved only by `projection-subject-reader`, and ONLY the `subject-activity` reducer may import
  // it — the metadata reducers (event-type-activity, daily-event-acceptance, and any future one) stay
  // subject-blind in code, even though the shared projection DB role technically holds the column grant.
  //
  // This block covers the reducer files EXCEPT subject-activity, so its `no-restricted-imports` REPLACES
  // (flat-config semantics) the purity block's for those files — it therefore re-states the shared I/O
  // ban and adds the subject-reader ban.
  {
    files: ['packages/event-backbone/src/projections/handlers/**/*.ts'],
    ignores: ['packages/event-backbone/src/projections/handlers/subject-activity.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...REDUCER_FORBIDDEN_IO_IMPORTS],
              message:
                'A projection reducer is a pure function of the event log. It performs no filesystem, network, process, or crypto I/O; it only writes its read-model table through the borrowed client.',
            },
            {
              group: ['**/projection-subject-reader.js', '**/projection-subject-reader'],
              message:
                'Only the subject-activity reducer may resolve the opaque subject (QFJ-P03.09, ADR-0044). Other projections remain subject-blind.',
            },
            // Re-stated because this value REPLACES the baseline D2a block above (flat config).
            ...ACCEPTED_EVENT_WRITE_FORBIDDEN_IMPORT_PATTERNS,
          ],
        },
      ],
    },
  },

  // Must remain last: turns off every rule that would fight Prettier.
  // Formatting is Prettier's job; ESLint's job is correctness.
  eslintConfigPrettier,
);
