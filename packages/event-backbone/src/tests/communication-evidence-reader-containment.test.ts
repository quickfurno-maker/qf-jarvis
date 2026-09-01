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
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
const at = (relative: string): string => join(REPO_DIR, relative);

const READER = 'packages/event-backbone/src/projections/communication-evidence-reader.ts';
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
const written: string[] = [];

async function removeProbes(): Promise<void> {
  for (const path of written.splice(0)) await rmQuietly(path);
}

async function rmQuietly(path: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(path, { force: true });
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
 * A TRANSIENT lint probe written by a sibling boundary suite, not repository source.
 *
 * `accepted-event-write-lint-boundary.test.ts` and this file's own lint suite each write short-lived
 * `.ts` files into real package directories to prove their ESLint rules actually fire, then delete
 * them. Under full parallel load one of those files can exist when this scan lists a directory and be
 * gone by the time the scan reads it — which surfaced as `ENOENT ... zz-d2a-lint-probe.ts` and made
 * this suite flaky.
 *
 * The classifier is deliberately NARROW: it matches only the exact generated convention
 * `<case>-<index>-zz-<slice>-lint-probe.ts`. A production file merely containing the word "probe" is
 * still scanned, because ignoring those would quietly shrink the corpus this containment rests on.
 */
const TRANSIENT_LINT_PROBE = /(?:^|[\\/])[a-z0-9-]+-\d+-zz-d\d[a-z]*-lint-probe\.ts$/i;

export function isTransientLintProbe(path: string): boolean {
  return TRANSIENT_LINT_PROBE.test(path);
}

/** Every `.ts` file under a directory, recursively, excluding transient lint probes. */
async function collect(dir: string): Promise<readonly string[]> {
  const found: string[] = [];
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    // Skip a transient probe BEFORE stat(): the race is that the file vanishes between listing and
    // touching it, so the fix has to land before the first filesystem call that can throw.
    if (isTransientLintProbe(full)) continue;
    let info;
    try {
      info = await stat(full);
    } catch {
      // It disappeared between readdir and stat. Only a probe can legitimately do that; anything
      // else is a real condition the next line must not hide, so re-check and rethrow.
      if (isTransientLintProbe(full)) continue;
      throw new Error(`A repository source file vanished during the scan: ${full}`);
    }
    if (info.isDirectory()) found.push(...(await collect(full)));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

let corpus: Promise<ReadonlyMap<string, string>> | undefined;

/** Production sources, read once. Tests are excluded — they are not production consumers. */
async function productionFiles(): Promise<ReadonlyMap<string, string>> {
  corpus ??= (async () => {
    const paths: string[] = [];
    for (const root of ['packages', 'apps']) paths.push(...(await collect(join(REPO_DIR, root))));
    const kept = paths.filter(
      (f) =>
        !f.includes(`${sep}tests${sep}`) &&
        !f.includes('.test.') &&
        !f.endsWith(PROBE) &&
        !isTransientLintProbe(f),
    );
    const entries = await Promise.all(
      kept.map(async (path) => {
        // No blanket try/catch here on purpose. A missing production source file is a real problem and
        // must still fail the suite; only the narrow probe convention above is filtered out.
        return [path, await readFile(path, 'utf8')] as const;
      }),
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
  const { mkdir, writeFile } = await import('node:fs/promises');
  const targets = CASES.map((c, i) => ({
    ...c,
    path: at(join('packages/event-backbone', c.dir, `${c.key}-${String(i)}-${PROBE}`)),
  }));

  try {
    for (const t of targets) {
      await mkdir(join(t.path, '..'), { recursive: true });
      await writeFile(t.path, t.code, 'utf8');
      written.push(t.path);
    }

    const results = await eslint.lintFiles([...targets.map((t) => t.path), at(READER)]);
    const byPath = new Map(
      results.map((r) => [
        r.filePath,
        r.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message),
      ]),
    );
    for (const t of targets) restrictedByKey.set(t.key, byPath.get(t.path) ?? []);
    restrictedByKey.set('reader-itself', byPath.get(at(READER)) ?? []);
  } finally {
    await removeProbes();
  }
}, 180_000);

afterAll(removeProbes);

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
    ['a projection handler — D5 must open this deliberately', 'from-a-handler'],
  ])('rejects importing the reader from %s', (_label, key) => {
    const messages = restrictedByKey.get(key) ?? [];

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('ADR-0140');
  });

  it('does not ban the reader module from being itself', () => {
    expect(restrictedByKey.get('reader-itself')).toStrictEqual([]);
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

  it('has exactly ZERO production references to the reader, in ANY module form', async () => {
    // The independent second layer: a source scan cannot be silenced by an eslint-disable comment.
    // D5 changes this number to exactly 1, deliberately, in its own PR.
    const files = await productionFiles();

    const referrers: string[] = [];
    for (const [file, code] of files) {
      if (file.endsWith(READER_BASENAME + '.ts')) continue; // the module itself
      if (referencesReader(code)) referrers.push(relative(file));
    }

    expect(referrers).toStrictEqual([]);
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

describe('the transient-probe classifier is narrow', () => {
  // The race this fixes is real but the cure is easy to over-apply: ignoring anything containing
  // "probe" would silently shrink the corpus the zero-consumer guarantee rests on. So the classifier
  // matches only the exact generated convention, and these pin both halves of that.
  it.each([
    [
      'a D2a probe',
      'packages/event-backbone/src/persistence/capability-from-persistence-1-zz-d2a-lint-probe.ts',
    ],
    ['a D4 probe', 'packages/event-backbone/src/projections/from-a-handler-2-zz-d4-lint-probe.ts'],
    [
      'a relative-form probe',
      'packages/event-backbone/src/projections/deep-relative-0-zz-d2a-lint-probe.ts',
    ],
  ])('excludes %s', (_label, path) => {
    expect(isTransientLintProbe(path.replace(/\//g, sep))).toBe(true);
  });

  it.each([
    [
      'ordinary production source',
      'packages/event-backbone/src/projections/communication-evidence-reader.ts',
    ],
    [
      'a production file that merely says probe',
      'packages/event-backbone/src/persistence/probe.ts',
    ],
    ['a production file named like a probe but not generated', 'apps/api/src/lint-probe.ts'],
    ['a probe-ish name without the index segment', 'packages/x/src/zz-d2a-lint-probe.ts'],
  ])('still scans %s', (_label, path) => {
    expect(isTransientLintProbe(path.replace(/\//g, sep))).toBe(false);
  });
});
