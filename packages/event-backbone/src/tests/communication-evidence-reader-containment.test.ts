/**
 * D4 — least-privilege containment for the trusted communication evidence reader (ADR-0140).
 *
 * The reader has **zero** production consumers in this slice, and that is the invariant this file
 * defends — not an accident of nobody having needed it yet. D5 must move it from 0 to exactly 1, in
 * its own reviewed PR, when it builds the communication-state projection handler.
 *
 * Two independent layers, exactly as D2a established, because they fail differently: an
 * `eslint-disable` comment silences a lint rule but cannot silence a source scan.
 *
 * The resolved-rule assertions also re-check every boundary D2a and ADR-0044 own. Under flat config a
 * later `no-restricted-imports` value REPLACES an earlier one, so a new slice that appended its rule
 * carelessly would silently delete older ones while every gate stayed green — which is exactly what
 * happened during D2a and must not happen again here.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
const at = (relative: string): string => join(REPO_DIR, relative);

/** `git ls-files` is the source of truth for what is production source, not the filesystem. */
const execFile = promisify(execFileCallback);

const READER = 'packages/event-backbone/src/projections/communication-evidence-reader.ts';

/** The ONE production file D5 (ADR-0142) authorized to consume the reader. */
const D5_HANDLER = 'packages/event-backbone/src/projections/handlers/communication-state.ts';
const PROBE = 'zz-d4-lint-probe.ts';

const eslint = new ESLint({ cwd: REPO_DIR });

/** What an arbitrary file would write to reach the reader. */
const READER_IMPORT = `import { readTrustedCommunicationEvidenceAtPosition } from '../projections/communication-evidence-reader.js';
export const probe = readTrustedCommunicationEvidenceAtPosition;
`;

/** The sibling spelling, from inside `projections/` itself. */
const READER_IMPORT_SIBLING = `import { readTrustedCommunicationEvidenceAtPosition } from './communication-evidence-reader.js';
export const probe = readTrustedCommunicationEvidenceAtPosition;
`;

const CASES = [
  { key: 'from-persistence', dir: 'src/persistence', code: READER_IMPORT },
  { key: 'from-projections-sibling', dir: 'src/projections', code: READER_IMPORT_SIBLING },
  { key: 'from-a-handler', dir: 'src/projections/handlers', code: READER_IMPORT },
] as const;

const restrictedByKey = new Map<string, readonly string[]>();

/**
 * The probes are VIRTUAL — linted as text at a logical path, never written to disk.
 *
 * Writing them was a repository-wide race rather than a local inconvenience: a few dozen containment
 * suites in other packages walk every package's `src` tree recursively, and a probe that appears and
 * vanishes between their `readdir` and their `stat`/`readFile` fails them with ENOENT on a path they
 * never asked about. Reproduced on Linux CI and on Windows.
 *
 * `ESLint#lintText` resolves the flat config from `filePath` exactly as `lintFiles` does, so every
 * path-scoped block still applies and the probe still has to survive a real parse and a real lint.
 * What it no longer does is exist, so nothing else in the repository can observe it.
 *
 * This second instance differs from `eslint` in ONE respect — `allowDefaultProject`, because a path
 * with no file behind it belongs to no tsconfig and the type-aware project service would otherwise
 * refuse to parse it. Only `languageOptions` is overridden, so rule resolution is untouched, and the
 * override is keyed to the probe filename so it cannot reach committed source.
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
 * A fatal message means the probe never reached the rule, which would turn every "this import is
 * PERMITTED" assertion into a test of nothing. So it throws rather than returning no messages.
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

interface ResolvedPattern {
  readonly group?: readonly string[];
  readonly importNames?: readonly string[];
}

async function resolvedPatterns(path: string): Promise<readonly ResolvedPattern[]> {
  const config: unknown = await eslint.calculateConfigForFile(at(path));
  const rule = (config as { rules?: Record<string, unknown> }).rules?.['no-restricted-imports'];
  return Array.isArray(rule)
    ? ((rule[1] as { patterns?: readonly ResolvedPattern[] } | undefined)?.patterns ?? [])
    : [];
}

async function resolvedGroups(path: string): Promise<readonly string[]> {
  return (await resolvedPatterns(path)).flatMap((p) => p.group ?? []);
}

async function lowLevelWriterPattern(path: string): Promise<ResolvedPattern | undefined> {
  return (await resolvedPatterns(path)).find((p) => p.importNames?.includes('storeValidatedEvent'));
}

/**
 * The production-source corpus, derived from GIT-TRACKED files.
 *
 * The earlier version walked the filesystem and skipped anything whose NAME matched the transient
 * lint-probe convention. That fixed the ENOENT race — the probes were physical then, so a path could
 * vanish between `readdir` and `readFile` — but it fixed it with a filename rule, which is a bypass
 * waiting to be used: commit a real production file called `something-1-zz-d4-lint-probe.ts`, add an
 * `eslint-disable`, and it would have escaped BOTH the lint rule and this supposedly independent scan.
 *
 * The probes are virtual now and nothing transient appears in the tree at all, but the discriminator
 * stays trackedness rather than reverting to filenames, because the bypass above does not depend on
 * how the probes are written. An untracked file is never listed by `git ls-files` whatever it is
 * called; a committed one always is. Nothing is skipped by name.
 */
async function trackedProductionPaths(repoDir: string = REPO_DIR): Promise<readonly string[]> {
  const { stdout } = await execFile('git', ['ls-files', '--', 'packages', 'apps'], {
    cwd: repoDir,
    maxBuffer: 32 * 1024 * 1024,
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.ts'))
    .map((line) => join(repoDir, line))
    .filter((path) => !path.includes(`${sep}tests${sep}`) && !path.includes('.test.'));
}

let corpus: Promise<ReadonlyMap<string, string>> | undefined;

/**
 * Tracked production sources, read once.
 *
 * No blanket try/catch: a TRACKED file that cannot be read is a real problem and must still fail the
 * suite. Only untracked files are absent from the list, and a transient probe is untracked by
 * construction — which is precisely why trackedness, not the filename, is the discriminator.
 */
async function productionFiles(): Promise<ReadonlyMap<string, string>> {
  corpus ??= (async () => {
    const paths = await trackedProductionPaths();
    const entries = await Promise.all(
      paths.map(async (path) => [path, await readFile(path, 'utf8')] as const),
    );
    return new Map(entries);
  })();
  return corpus;
}

const relative = (absolute: string): string => absolute.slice(REPO_DIR.length).replace(/\\/g, '/');

/** The module's basename, without extension — what every reference form has in common. */
const READER_BASENAME = 'communication-evidence-reader';

/**
 * Does this source REFERENCE the reader module in any form a bundler would resolve?
 *
 * Keyed on the module SPECIFIER inside quotes rather than on `from '...'`, because the earlier
 * `from`-shaped regex missed a side-effect import, a dynamic `import()`, a `require()` and any
 * double-quoted specifier. Comments are stripped first so prose naming the file is not a reference.
 */
function referencesReader(code: string): boolean {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  return new RegExp(`['"\`][^'"\`]*${READER_BASENAME}(?:\\.js)?['"\`]`).test(withoutComments);
}

beforeAll(async () => {
  const targets = CASES.map((c, i) => ({
    ...c,
    path: at(join('packages/event-backbone', c.dir, `${c.key}-${String(i)}-${PROBE}`)),
  }));

  for (const t of targets) restrictedByKey.set(t.key, await lintProbe(t.code, t.path));

  // The two REAL committed files are linted from disk, by the untouched instance: this half of the
  // suite has to be about actual repository content, not about a logical path.
  const results = await eslint.lintFiles([at(READER), at(D5_HANDLER)]);
  const byPath = new Map(
    results.map((r) => [
      r.filePath,
      r.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message),
    ]),
  );
  restrictedByKey.set('reader-itself', byPath.get(at(READER)) ?? []);
  restrictedByKey.set('d5-handler', byPath.get(at(D5_HANDLER)) ?? []);
}, 180_000);

describe('D4 — the reader is not part of any public surface', () => {
  it('is absent from the event-backbone root barrel', () => {
    expect(barrel).not.toHaveProperty('readTrustedCommunicationEvidenceAtPosition');
  });

  it('leaves the package-root runtime surface at 38 — D4 adds nothing to it', () => {
    // D4 is a purpose-bounded internal capability. If it ever appears here, the boundary is gone.
    expect(Object.keys(barrel)).toHaveLength(38);
  });

  it('adds no package export subpath', async () => {
    const manifest = JSON.parse(
      await readFile(at('packages/event-backbone/package.json'), 'utf8'),
    ) as { readonly exports: Record<string, unknown> };

    // Unchanged from D2a: the root plus exactly three narrow internal subpaths. D5 may add one when
    // it has a consumer; D4 deliberately does not, because there is nothing to consume it yet.
    expect(Object.keys(manifest.exports).sort()).toStrictEqual([
      '.',
      './internal/event-write',
      './internal/projection-inspection-cli',
      './internal/projection-worker-cli',
    ]);
    expect(JSON.stringify(manifest.exports)).not.toContain('communication-evidence-reader');
  });

  it('declares the contracts dependency it actually uses, and no direct zod', async () => {
    const manifest = JSON.parse(
      await readFile(at('packages/event-backbone/package.json'), 'utf8'),
    ) as { readonly dependencies: Record<string, string> };

    expect(manifest.dependencies['@qf-jarvis/contracts']).toBe('workspace:*');
    // The canonical schemas come from contracts; the payload wrapper is checked with a plain-object
    // key check. Adding zod here would have meant a second place that can define what is valid.
    expect(manifest.dependencies).not.toHaveProperty('zod');
  });
});

describe('D4 — no production code may import the reader', () => {
  it.each([
    ['another directory in the package', 'from-persistence'],
    ['the projections directory itself, as a sibling', 'from-projections-sibling'],
    ['an ARBITRARY projection handler — only the D5 one is permitted', 'from-a-handler'],
  ])('rejects importing the reader from %s', (_label, key) => {
    const messages = restrictedByKey.get(key) ?? [];

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('ADR-0140');
  });

  it('does not ban the reader module from being itself', () => {
    expect(restrictedByKey.get('reader-itself')).toStrictEqual([]);
  });

  it('PERMITS the real D5 handler — the exception is file-exact, not directory-wide', () => {
    // The committed handler, which really does import the reader. A sibling handler in the same
    // directory is still refused (the `from-a-handler` case above), so the permission is one file.
    expect(restrictedByKey.get('d5-handler')).toStrictEqual([]);
  });

  it('grants the D5 handler the reader WITHOUT stripping its other boundaries', async () => {
    // The exception omits ONE pattern, not the whole rule. A read consumer earns no write authority,
    // and it stays subject-blind and I/O-pure like every other reducer.
    const groups = await resolvedGroups(D5_HANDLER);

    expect(groups).not.toContain('**/communication-evidence-reader.js');
    expect(groups).toContain('node:fs');
    expect(groups).toContain('**/projection-subject-reader.js');
    expect(groups).toContain('@qf-jarvis/event-backbone/internal/event-write');
    expect(
      (await resolvedPatterns(D5_HANDLER)).some((p) =>
        p.importNames?.includes('storeValidatedEvent'),
      ),
    ).toBe(true);
  });

  it('scopes the ban across every package and app', async () => {
    for (const path of [
      'packages/communication-request-runtime/src/hypothetical.ts',
      'apps/api/src/hypothetical.ts',
      'apps/worker/src/hypothetical.ts',
    ]) {
      expect(await resolvedGroups(path)).toContain('**/communication-evidence-reader.js');
    }
  });

  it('has EXACTLY ONE production reference to the reader, and it is the D5 handler', async () => {
    // The independent second layer: a source scan cannot be silenced by an eslint-disable comment.
    //
    // D4 shipped this at ZERO. D5 (ADR-0142) moved it to exactly ONE, deliberately. `toStrictEqual`
    // on the full list is what makes this bite in both directions: zero fails (the handler vanished
    // or stopped using the governed route), and two or more fails (a second consumer appeared).
    const files = await productionFiles();

    const referrers: string[] = [];
    for (const [file, code] of files) {
      if (file.endsWith(READER_BASENAME + '.ts')) continue; // the module itself
      if (referencesReader(code)) referrers.push(relative(file));
    }

    expect(referrers).toStrictEqual([D5_HANDLER]);
  });

  it('fails if the D5 handler stops being the importer, or a second one appears', () => {
    // Non-vacuity for the assertion above: the list is compared exactly, so neither an empty set nor
    // an extra entry can pass. Stated as a property rather than trusted from the shape of the code.
    const exactlyOne = [D5_HANDLER];

    expect(exactlyOne).toHaveLength(1);
    expect([]).not.toStrictEqual(exactlyOne);
    expect([
      D5_HANDLER,
      'packages/event-backbone/src/projections/handlers/other.ts',
    ]).not.toStrictEqual(exactlyOne);
  });

  it.each([
    ['a static named import', READER_IMPORT],
    ['the sibling static import', READER_IMPORT_SIBLING],
    [
      'an export-from re-export',
      "export { readTrustedCommunicationEvidenceAtPosition } from './communication-evidence-reader.js';",
    ],
    ['a side-effect import', "import './communication-evidence-reader.js';"],
    ['a dynamic import', "const m = await import('./communication-evidence-reader.js');"],
    [
      'a double-quoted import',
      'import { x } from "../projections/communication-evidence-reader.js";',
    ],
    ['a require call', "const m = require('./communication-evidence-reader.js');"],
    [
      'an eslint-disabled static import',
      "/* eslint-disable no-restricted-imports */\nimport { x } from './communication-evidence-reader.js';",
    ],
  ])('the zero-reference scan catches %s', (_label, source) => {
    // The earlier scan keyed on `from '...'`, so a side-effect import, a dynamic import and a
    // double-quoted specifier all slipped past it — which meant the "independent second layer" was
    // not actually independent for those forms. It now matches the MODULE SPECIFIER itself.
    expect(referencesReader(`\n${source}\n`)).toBe(true);
  });

  it('stays quiet on prose that merely names the module', () => {
    // A scan that fired on a doc comment would be quietly loosened by the first person it annoyed.
    expect(
      referencesReader('\n// see communication-evidence-reader.js for the D4 boundary\n'),
    ).toBe(false);
    expect(referencesReader('\n * The reader lives in communication-evidence-reader.ts.\n')).toBe(
      false,
    );
  });

  it('is honest about which forms LINT covers, versus only the scan', async () => {
    // `no-restricted-imports` governs static import/export specifiers. Dynamic `import()` is a call
    // expression, so it is NOT covered by that rule here — the structural scan is what closes it,
    // together with the eslint-disabled case. Claiming two independent layers for every syntax would
    // be an overclaim, so this asserts the split rather than papering over it.
    const groups = await resolvedGroups('packages/event-backbone/src/projections/hypothetical.ts');

    expect(groups).toContain('**/communication-evidence-reader.js');
    // ...and the scan independently catches the dynamic form the lint rule does not.
    expect(referencesReader("const m = await import('./communication-evidence-reader.js');")).toBe(
      true,
    );
  });

  it('adds no generic payload reader anywhere in the package', async () => {
    // The categorical ban: D4 earns access for ONE purpose. A generic reader would hand every future
    // projection the whole event log.
    const files = await productionFiles();
    const forbidden = [
      'readPayloadAtPosition',
      'readEventPayloadById',
      'readCanonicalEventById',
      'readAnyEventAtPosition',
    ];

    for (const [file, code] of files) {
      for (const name of forbidden) {
        expect(code, `${relative(file)} must not define ${name}`).not.toContain(`function ${name}`);
      }
    }
  });
});

describe('D4 preserved every boundary it inherited', () => {
  it('keeps the two D2a write exceptions disjoint, and adds the D4 ban to both', async () => {
    const writeModule = 'packages/event-backbone/src/persistence/event-write.ts';
    const bridge = 'packages/event-ingestion/src/ingest/persist-validated-event.ts';

    // event-write.ts: low-level YES, governed NO — unchanged by D4.
    expect(await lowLevelWriterPattern(writeModule)).toBeUndefined();
    expect(await resolvedGroups(writeModule)).toContain(
      '@qf-jarvis/event-backbone/internal/event-write',
    );

    // the bridge: low-level NO, governed YES — unchanged by D4.
    expect(await lowLevelWriterPattern(bridge)).toBeDefined();
    expect(await resolvedGroups(bridge)).not.toContain(
      '@qf-jarvis/event-backbone/internal/event-write',
    );

    // ...and neither write path gains any evidence-READ privilege from D4.
    for (const path of [writeModule, bridge]) {
      expect(await resolvedGroups(path)).toContain('**/communication-evidence-reader.js');
    }
  });

  it('keeps contracts package purity', async () => {
    const groups = await resolvedGroups('packages/contracts/src/hypothetical.ts');

    expect(groups).toContain('node:*');
    expect(groups).toContain('child_process');
  });

  it('keeps event-ingestion verifier purity', async () => {
    const groups = await resolvedGroups('packages/event-ingestion/src/hypothetical.ts');

    expect(groups).toContain('node:fs');
    expect(groups).toContain('node:worker_threads');
  });

  it('keeps projection reducer I/O purity', async () => {
    const groups = await resolvedGroups(
      'packages/event-backbone/src/projections/handlers/hypothetical.ts',
    );

    expect(groups).toContain('node:fs');
    expect(groups).toContain('node:crypto');
  });

  it('keeps the ADR-0044 subject-reader boundary exactly where it was', async () => {
    const metadata = await resolvedGroups(
      'packages/event-backbone/src/projections/handlers/hypothetical.ts',
    );
    const subjectActivity = await resolvedGroups(
      'packages/event-backbone/src/projections/handlers/subject-activity.ts',
    );

    expect(metadata).toContain('**/projection-subject-reader.js');
    expect(subjectActivity).not.toContain('**/projection-subject-reader.js');
    // The permitted subject reducer still gains no D4 read privilege.
    expect(subjectActivity).toContain('**/communication-evidence-reader.js');
  });
});

describe('the corpus is defined by TRACKEDNESS, not by filename', () => {
  // The first cure for the ENOENT race skipped anything whose NAME looked like a transient probe.
  // That would have let a committed file called `x-1-zz-d4-lint-probe.ts` with an `eslint-disable`
  // escape BOTH the lint rule and this supposedly independent scan. These pin the replacement.

  it('excludes untracked transient probes, and scans tracked ones with the same name', async () => {
    // Demonstrated on a THROWAWAY repository, not on this one. The claim needs files that are present
    // on disk, and materialising one inside this repository - even for the moment an assertion takes
    // - is precisely the ENOENT race the probes above were made virtual to remove.
    //
    // Both directions are exercised, which the in-repo version could not do: the untracked probe must
    // be absent, and a COMMITTED file carrying the very same probe-shaped name must be present. That
    // second half is the bypass a filename rule would have opened, checked as behaviour rather than
    // inferred from what .gitignore happens to say.
    const scratch = await mkdtemp(join(tmpdir(), 'qfj-d4-corpus-'));

    try {
      const dir = 'packages/event-backbone/src/projections';
      const ordinary = `${dir}/communication-evidence-reader.ts`;
      const trackedProbeShaped = `${dir}/committed-0-${PROBE}`;
      const untrackedProbe = `${dir}/from-a-handler-1-${PROBE}`;

      await mkdir(join(scratch, dir), { recursive: true });
      for (const path of [ordinary, trackedProbeShaped, untrackedProbe]) {
        await writeFile(join(scratch, path), READER_IMPORT, 'utf8');
      }

      await execFile('git', ['init', '--quiet'], { cwd: scratch });
      // `--force`, so the answer is about this repository's index rather than about whatever global
      // ignore file the machine running the suite happens to have.
      await execFile('git', ['add', '--force', '--', ordinary, trackedProbeShaped], {
        cwd: scratch,
      });

      const paths = await trackedProductionPaths(scratch);

      // On disk, and importing the reader - yet absent from the corpus, because untracked.
      expect(paths).not.toContain(join(scratch, untrackedProbe));
      // And a committed file is scanned whatever it is called.
      expect(paths).toContain(join(scratch, trackedProbeShaped));
      expect(paths).toContain(join(scratch, ordinary));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('scans a TRACKED file whatever it is called, probe-shaped names included', async () => {
    // The bypass the filename rule would have opened. `git ls-files` reports what is committed, so a
    // probe-shaped commit is listed like anything else — verified by asking git directly about a
    // hypothetical path rather than by trusting a naming rule.
    const { stdout } = await execFile(
      'git',
      [
        'check-ignore',
        '--no-index',
        '-v',
        '--',
        'packages/event-backbone/src/x-1-zz-d4-lint-probe.ts',
      ],
      { cwd: REPO_DIR },
    ).catch((error: unknown) => {
      // exit 1 means "not ignored", which is the answer this asserts.
      if ((error as { code?: number }).code === 1) return { stdout: '' };
      throw error;
    });

    // Nothing in .gitignore hides a probe-shaped path, so committing one WOULD track it — and a
    // tracked file is always scanned.
    expect(stdout).toBe('');
    expect(await trackedProductionPaths()).toContain(at(READER));
  });

  it('lists ordinary production source and excludes test trees', async () => {
    const paths = (await trackedProductionPaths()).map(relative);

    expect(paths).toContain(
      'packages/event-backbone/src/projections/communication-evidence-reader.ts',
    );
    expect(paths).toContain(
      'packages/contracts/src/communications/communication-state-record-v2.ts',
    );
    expect(paths.some((p) => p.includes('/tests/') || p.includes('.test.'))).toBe(false);
  });

  it('would catch a tracked eslint-disabled reader import', () => {
    // The scan reads source text, so a suppression comment cannot hide the reference from it.
    const disabled = [
      '/* eslint-disable no-restricted-imports */',
      "import { readTrustedCommunicationEvidenceAtPosition } from './communication-evidence-reader.js';",
    ].join('\n');

    expect(referencesReader(disabled)).toBe(true);
  });
});
