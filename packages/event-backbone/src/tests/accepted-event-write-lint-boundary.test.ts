/**
 * D2a — the import boundary is EXECUTED, not just configured (ADR-0138).
 *
 * `accepted-event-write-containment.test.ts` proves the structural facts. This file proves the
 * ESLint boundary is real, in two complementary ways, because neither alone is enough:
 *
 *  1. **Resolved-rule assertions** via `ESLint#calculateConfigForFile`, which returns the rule value
 *     ESLint would actually apply to a path after flat-config resolution. This is not a grep of the
 *     config text: a block that is present but overridden resolves away, and this API shows that.
 *  2. **Live lint probes**: real source text, linted by the real configuration at a real path. The
 *     path is logical — no file is written — for the reason set out under "Why the probes are
 *     VIRTUAL" below.
 *
 * ### Why (1) exists at all — the defect it now guards
 *
 * Under flat config a later `no-restricted-imports` value **REPLACES** an earlier one; it does not
 * merge. D2a's first implementation appended a broad `packages/**` + `apps/**` block at the END of
 * the config, which silently DELETED three older boundaries for every overlapping file: the
 * contracts package's I/O ban, the event-ingestion verifier's purity ban, and the projection
 * reducers' purity and subject-reader bans. Every gate stayed green, because no committed source
 * violated the deleted rules — a green build proves nothing about a negative policy that has been
 * removed.
 *
 * So these tests assert the resolved rule for each scope **still contains its own patterns AND the
 * D2a patterns**. If a future change re-introduces the clobber, the resolved value loses patterns
 * and these fail.
 *
 * ### Why the probes are VIRTUAL
 *
 * An earlier version wrote each probe to disk at its real path and deleted it afterwards. That is a
 * repository-wide race, not a local one: a few dozen containment suites across other packages walk
 * every package's `src` tree recursively, and a probe that appears and vanishes between their
 * `readdir` and their `stat`/`readFile` makes them fail with ENOENT on a path they never asked
 * about. It was reproduced on Linux CI and on Windows, and it had nothing to do with the slice that
 * happened to trip it.
 *
 * So the probes are linted as TEXT at a logical path instead. `ESLint#lintText` resolves the flat
 * config by `filePath` exactly as `lintFiles` does, so every path-scoped block — the `packages/**`
 * baseline, the file-exact exceptions, the test-tree `ignores` — applies unchanged. The probe still
 * has to survive a real parse and a real lint; what it no longer does is exist on disk, so nothing
 * else in the repository can observe it. Physical probe files created by this suite: zero.
 *
 * `allowDefaultProject` is the one concession: a file that is not on disk is in no tsconfig, so the
 * type-aware project service is told to give these logical paths an inferred default project. It is
 * scoped to the probe filename in the probe directories and to nothing else.
 *
 * A fatal parse message would make every "this is PERMITTED" assertion pass for the wrong reason, so
 * `lintProbe` rejects on one rather than returning an empty message list.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
const at = (relative: string): string => join(REPO_DIR, relative);

/** A distinctive name no real source file uses, so a stray probe is obvious and greppable. */
const PROBE = 'zz-d2a-lint-probe.ts';

const eslint = new ESLint({ cwd: REPO_DIR });

/** The exact import an arbitrary package would write to reach the governed writer. */
const WRITE_CAPABILITY_IMPORT = `import { storeAuthenticatedEvent } from '@qf-jarvis/event-backbone/internal/event-write';
export const probe = storeAuthenticatedEvent;
`;

/** The deep relative form of the same, in case someone walks around the package specifier. */
const RELATIVE_CAPABILITY_IMPORT = `import { storeAuthenticatedEvent } from '../persistence/event-write.js';
export const probe = storeAuthenticatedEvent;
`;

/**
 * A second event-backbone production module importing the LOW-LEVEL writer directly. This compiles,
 * adds no second SQL INSERT, and adds no second `event-write` importer, so nothing else in the D2a
 * suite catches it.
 *
 * Two spellings are probed, and the SIBLING one is the important half. A module already sitting in
 * `persistence/` would naturally write `./event-store.js` — a specifier containing no
 * `persistence/` segment, which an earlier pattern list missed entirely. Probing only the
 * `../persistence/...` form would have been a probe written to match the rule rather than to match
 * what a developer would actually type.
 */
const LOW_LEVEL_WRITER_IMPORT_FROM_ELSEWHERE = `import { storeValidatedEvent } from '../persistence/event-store.js';
export const probe = storeValidatedEvent;
`;

const LOW_LEVEL_WRITER_IMPORT_SIBLING = `import { storeValidatedEvent } from './event-store.js';
export const probe = storeValidatedEvent;
`;

/** Read-side types from the SAME module must stay importable: write authority is restricted, reads are not. */
const READ_SIDE_TYPE_IMPORT = `import type { StoredEvent } from './event-store.js';
export type Probe = StoredEvent;
`;

const CASES = [
  { key: 'capability-from-projections', dir: 'src/projections', code: WRITE_CAPABILITY_IMPORT },
  { key: 'capability-from-persistence', dir: 'src/persistence', code: WRITE_CAPABILITY_IMPORT },
  { key: 'capability-deep-relative', dir: 'src/projections', code: RELATIVE_CAPABILITY_IMPORT },
  {
    key: 'low-level-writer',
    dir: 'src/projections',
    code: LOW_LEVEL_WRITER_IMPORT_FROM_ELSEWHERE,
  },
  {
    key: 'low-level-writer-sibling',
    dir: 'src/persistence',
    code: LOW_LEVEL_WRITER_IMPORT_SIBLING,
  },
  { key: 'read-side-types', dir: 'src/persistence', code: READ_SIDE_TYPE_IMPORT },
] as const;

/** The real committed bridge — the one production file that may hold the write capability. */
const GOVERNED_BRIDGE = 'packages/event-ingestion/src/ingest/persist-validated-event.ts';

/** The real committed module — the one production file that may hold the LOW-LEVEL writer. */
const EVENT_WRITE_MODULE = 'packages/event-backbone/src/persistence/event-write.ts';

const restrictedByKey = new Map<string, readonly string[]>();

/**
 * A second ESLint instance for the virtual probes, differing from `eslint` in ONE respect: the
 * project service is allowed to place these logical paths in an inferred default project, because a
 * path with no file behind it belongs to no tsconfig.
 *
 * Only `languageOptions` is overridden, so rule resolution — which is the entire subject of this
 * suite — is byte-for-byte the configuration a real file at that path would get. The override is
 * keyed to the probe filename, so it cannot reach any committed source even by accident, and the
 * `calculateConfigForFile` assertions all go through the untouched `eslint` instance.
 */
const probeEslint = new ESLint({
  cwd: REPO_DIR,
  overrideConfig: [
    {
      files: [`packages/event-backbone/src/**/*-${PROBE}`],
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: [
              ...new Set(CASES.map((c) => `packages/event-backbone/${c.dir}/*-${PROBE}`)),
            ],
          },
        },
      },
    },
  ],
});

/**
 * Lint `code` as if it were the file at `path`, without creating that file.
 *
 * A fatal message means the probe never reached the rule at all. Returning `[]` for that would turn
 * every "this import is PERMITTED" assertion into a test of nothing, so it throws instead.
 */
async function lintProbe(code: string, path: string): Promise<readonly string[]> {
  const [result] = await probeEslint.lintText(code, { filePath: path, warnIgnored: false });
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal === true);
  if (fatal.length > 0) {
    throw new Error(`probe ${path} did not lint: ${fatal.map((m) => m.message).join('; ')}`);
  }
  return messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

/** One entry of a resolved `no-restricted-imports` rule, with its `importNames` intact. */
interface ResolvedPattern {
  readonly group?: readonly string[];
  readonly importNames?: readonly string[];
}

/**
 * The rule OBJECTS ESLint would really apply to `path`.
 *
 * Flattening to group strings loses `importNames`, and `importNames` is what distinguishes "this
 * module is banned" from "this one exported NAME is banned" — the whole basis of the low-level
 * restriction, which must never break the barrel's read-side re-exports. So assertions about the
 * low-level ban go through this, not through the flattened view.
 */
async function resolvedPatterns(path: string): Promise<readonly ResolvedPattern[]> {
  const config: unknown = await eslint.calculateConfigForFile(at(path));
  const rule = (config as { rules?: Record<string, unknown> }).rules?.['no-restricted-imports'];
  return Array.isArray(rule)
    ? ((rule[1] as { patterns?: readonly ResolvedPattern[] } | undefined)?.patterns ?? [])
    : [];
}

/** Every `group` pattern in the rule ESLint would really apply to `path`, flattened. */
async function resolvedGroups(path: string): Promise<readonly string[]> {
  return (await resolvedPatterns(path)).flatMap((p) => p.group ?? []);
}

/** The resolved pattern that bans the low-level writer by NAME, if the scope carries one. */
async function lowLevelWriterPattern(path: string): Promise<ResolvedPattern | undefined> {
  return (await resolvedPatterns(path)).find((p) => p.importNames?.includes('storeValidatedEvent'));
}

beforeAll(async () => {
  const targets = CASES.map((c, i) => ({
    ...c,
    path: at(join('packages/event-backbone', c.dir, `${c.key}-${String(i)}-${PROBE}`)),
  }));

  for (const t of targets) restrictedByKey.set(t.key, await lintProbe(t.code, t.path));

  // The two REAL committed files are linted from disk, by the untouched instance. They are the half
  // of this suite that must be about actual repository content rather than about a logical path.
  const results = await eslint.lintFiles([at(GOVERNED_BRIDGE), at(EVENT_WRITE_MODULE)]);
  const byPath = new Map(
    results.map((r) => [
      r.filePath,
      r.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message),
    ]),
  );
  restrictedByKey.set('governed-bridge', byPath.get(at(GOVERNED_BRIDGE)) ?? []);
  restrictedByKey.set('event-write-module', byPath.get(at(EVENT_WRITE_MODULE)) ?? []);
}, 180_000);

describe('D2a did not clobber any pre-existing import boundary', () => {
  it('leaves the contracts package I/O ban in force, and adds D2a to it', async () => {
    const groups = await resolvedGroups('packages/contracts/src/hypothetical.ts');

    // The original policy, still resolved for this scope.
    expect(groups).toContain('node:*');
    expect(groups).toContain('child_process');
    // ...alongside D2a, not instead of it.
    expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
    expect(groups).toContain('**/persistence/event-store.js');
  });

  it('leaves the event-ingestion verifier purity ban in force, and adds D2a to it', async () => {
    const groups = await resolvedGroups('packages/event-ingestion/src/hypothetical.ts');

    expect(groups).toContain('node:fs');
    expect(groups).toContain('node:worker_threads');
    expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
  });

  it('leaves projection reducer I/O purity in force, and adds D2a to it', async () => {
    const groups = await resolvedGroups(
      'packages/event-backbone/src/projections/handlers/hypothetical.ts',
    );

    expect(groups).toContain('node:fs');
    expect(groups).toContain('node:crypto'); // reducers ban crypto too, unlike the verifier
    expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
  });

  it('leaves the ADR-0044 subject-reader boundary in force for metadata reducers', async () => {
    const metadata = await resolvedGroups(
      'packages/event-backbone/src/projections/handlers/hypothetical.ts',
    );
    const subjectActivity = await resolvedGroups(
      'packages/event-backbone/src/projections/handlers/subject-activity.ts',
    );

    // Banned for every reducer EXCEPT subject-activity, exactly as ADR-0044 requires...
    expect(metadata).toContain('**/projection-subject-reader.js');
    expect(subjectActivity).not.toContain('**/projection-subject-reader.js');
    // ...and both still carry reducer purity and D2a.
    for (const groups of [metadata, subjectActivity]) {
      expect(groups).toContain('node:fs');
      expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
    }
  });

  it('grants the bridge write authority WITHOUT stripping its purity rules', async () => {
    const groups = await resolvedGroups(GOVERNED_BRIDGE);

    // The exception omits ONE pattern, not the whole rule. Expressing it as an `ignores` entry on
    // the purity block would have removed everything, which is the trap this asserts against.
    expect(groups).toContain('node:fs');
    expect(groups).toContain('child_process');
    expect(groups).not.toContain('@qf-jarvis/event-backbone/internal/event-write');
  });

  it('does NOT hand the bridge the low-level writer as well — the two halves are disjoint', async () => {
    // The bridge is the most authority-sensitive production file in the repository, so it must not
    // also be the least restricted one. It builds a bound record and hands it to the governed
    // writer; it has no business calling `storeValidatedEvent` directly, and if it could, the
    // low-level ban would have had only the source scan protecting it exactly where it matters most.
    const pattern = await lowLevelWriterPattern(GOVERNED_BRIDGE);

    expect(pattern).toBeDefined();
    // Asserted on the rule OBJECT, because a flattened group list would hide the `importNames` that
    // makes this a name ban rather than a module ban.
    expect(pattern?.importNames).toStrictEqual(['storeValidatedEvent']);
    expect(pattern?.group).toContain('./event-store.js');
    expect(pattern?.group).toContain('**/event-store.js');
  });

  it('gives event-write.ts the complementary half, and only that half', async () => {
    // The mirror image: it may hold the low-level writer, and may not hold the governed one.
    const groups = await resolvedGroups(EVENT_WRITE_MODULE);
    const pattern = await lowLevelWriterPattern(EVENT_WRITE_MODULE);

    expect(pattern).toBeUndefined();
    expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
  });

  it('leaves neither file holding both authorities', async () => {
    // Stated once, as the property the two blocks exist to produce:
    //   event-write.ts             -> low-level YES, governed NO
    //   persist-validated-event.ts -> low-level NO,  governed YES
    const holdsLowLevel = async (path: string): Promise<boolean> =>
      (await lowLevelWriterPattern(path)) === undefined;
    const holdsGoverned = async (path: string): Promise<boolean> =>
      !(await resolvedGroups(path)).includes('@qf-jarvis/event-backbone/internal/event-write');

    expect(await holdsLowLevel(EVENT_WRITE_MODULE)).toBe(true);
    expect(await holdsGoverned(EVENT_WRITE_MODULE)).toBe(false);

    expect(await holdsLowLevel(GOVERNED_BRIDGE)).toBe(false);
    expect(await holdsGoverned(GOVERNED_BRIDGE)).toBe(true);
  });
});

describe('D2a — an arbitrary package cannot import the accepted-event write capability', () => {
  it.each([
    ['a projection directory', 'capability-from-projections'],
    ['the directory next door to the writer itself', 'capability-from-persistence'],
  ])('rejects the governed writer from %s', (_label, key) => {
    const messages = restrictedByKey.get(key) ?? [];

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('ADR-0138');
  });

  it('rejects the deep relative form too, so the specifier ban cannot be walked around', () => {
    expect((restrictedByKey.get('capability-deep-relative') ?? []).length).toBeGreaterThan(0);
  });

  it('scopes the ban to every package AND every app', async () => {
    // The live probes all carry event-backbone paths, because that is where the capability lives.
    // This is the other half: an arbitrary package and an arbitrary app must resolve the ban too, or
    // a package could import the capability and never be told.
    for (const path of [
      'packages/communication-request-runtime/src/hypothetical.ts',
      'apps/api/src/hypothetical.ts',
      'apps/worker/src/hypothetical.ts',
    ]) {
      const groups = await resolvedGroups(path);
      expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
      expect(groups).toContain('**/persistence/event-store.js');
    }
  });

  it('PERMITS the real governed bridge — this is a boundary, not a blanket ban', () => {
    // The actual committed file, which really does import the capability. If this ever fails, the
    // boundary has become a wall and ingestion itself cannot lint.
    expect(restrictedByKey.get('governed-bridge')).toStrictEqual([]);
  });
});

describe('D2a — the low-level writer has no same-package bypass either', () => {
  it.each([
    ["as '../persistence/event-store.js', from elsewhere in the package", 'low-level-writer'],
    ["as './event-store.js', the natural SIBLING form", 'low-level-writer-sibling'],
  ])('rejects importing storeValidatedEvent %s', (_label, key) => {
    // This is BLOCKER 2's scenario made executable: a second event-backbone production module
    // importing the low-level primitive. It compiles, adds no second SQL INSERT and no second
    // event-write importer, so nothing else in this suite would have caught it.
    const messages = restrictedByKey.get(key) ?? [];

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('ADR-0138');
  });

  it('PERMITS event-write.ts, the one module that may hold the low-level writer', () => {
    // The real committed file, which imports `storeValidatedEvent` from './event-store.js'. Its
    // exception is granted by a narrower block rather than an `ignores` entry, so it drops only the
    // low-level name restriction — if this ever fails, the capability module itself cannot lint.
    expect(restrictedByKey.get('event-write-module')).toStrictEqual([]);
  });

  it('keeps the governed cross-package writer pattern in force even for event-write.ts', async () => {
    // Its exception is narrow on purpose: it omits ONE pattern, not the whole rule.
    const groups = await resolvedGroups(EVENT_WRITE_MODULE);

    expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
    expect(groups).not.toContain('./event-store.js');
  });

  it('covers every practical spelling that can reach the writer module', async () => {
    const groups = await resolvedGroups('packages/event-backbone/src/persistence/hypothetical.ts');

    for (const spelling of [
      './event-store.js',
      './event-store',
      '**/event-store.js',
      '**/event-store',
      '**/persistence/event-store.js',
    ]) {
      expect(groups).toContain(spelling);
    }
  });

  it('still allows READ-side types from the same module', () => {
    // The ban is keyed by imported NAME, not by module path, because the package barrel legitimately
    // re-exports the outcome types and errors from `event-store.js`. Banning the path would have
    // broken the barrel and told us nothing about write authority.
    expect(restrictedByKey.get('read-side-types')).toStrictEqual([]);
  });
});
