/**
 * D2a — the import boundary is EXECUTED, not just configured (ADR-0138).
 *
 * `accepted-event-write-containment.test.ts` proves the ESLint configuration CONTAINS the rule. This
 * file proves the rule actually FIRES, by running the repository's real ESLint configuration over
 * real files at real package paths.
 *
 * That distinction is the whole point of D2a. A rule can be present and still be dead — shadowed by
 * a later flat-config block (flat config REPLACES `no-restricted-imports` rather than merging it),
 * scoped to a path that does not exist, or written with a `group` pattern that never matches the
 * specifier anyone would actually type. Reading the config cannot tell you which of those is true.
 * Running it can.
 *
 * The probes are written to disk because ESLint's type-aware configuration resolves a file through
 * the TypeScript project service; a purely hypothetical path is not linted the same way, and a test
 * that quietly checked nothing would be worse than no test. Every probe is removed in `finally`, and
 * again in `afterAll`.
 *
 * All probes are linted in ONE ESLint pass, in `beforeAll`. Type-aware linting is expensive, and one
 * pass per case made this suite slow enough to trip the default timeout under parallel load. Nothing
 * is asserted less strictly for it — the same cases are still proven, from a single run.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
const at = (relative: string): string => join(REPO_DIR, relative);

/** A distinctive name no real source file uses, so a stray probe is obvious and greppable. */
const PROBE = 'zz-d2a-lint-probe.ts';

/** The exact import an arbitrary package would write to reach the write capability. */
const SPECIFIER_IMPORT = `import { storeAuthenticatedEvent } from '@qf-jarvis/event-backbone/internal/event-write';
export const probe = storeAuthenticatedEvent;
`;

/** The deep relative form, in case someone tries to walk around the package specifier. */
const RELATIVE_IMPORT = `import { storeAuthenticatedEvent } from '../persistence/event-write.js';
export const probe = storeAuthenticatedEvent;
`;

/**
 * Every case this suite proves live.
 *
 * All probes stay inside THIS package's tree on purpose. Several other packages and apps run their
 * own recursive source scans, and a probe dropped into `apps/api/src` — even for the few hundred
 * milliseconds this suite holds it — races those scans and fails them. Keeping the blast radius
 * inside `event-backbone`, whose only scanner is the sibling containment test (which excludes these
 * filenames by name), keeps this suite honest without breaking unrelated packages.
 *
 * What that costs, stated plainly: these probes prove the rule FIRES for a non-permitted file and
 * that it catches both import forms. They do not themselves place a probe under `apps/**`. The
 * rule's SCOPE is asserted separately and statically, in the last test below.
 */
const CASES = [
  {
    key: 'projection-handlers',
    dir: 'packages/event-backbone/src/projections',
    code: SPECIFIER_IMPORT,
  },
  {
    key: 'persistence-neighbour',
    dir: 'packages/event-backbone/src/persistence',
    code: SPECIFIER_IMPORT,
  },
  {
    key: 'deep-relative',
    dir: 'packages/event-backbone/src/projections',
    code: RELATIVE_IMPORT,
  },
] as const;

/** The real committed bridge — the one file that may hold this capability. */
const GOVERNED_BRIDGE = 'packages/event-ingestion/src/ingest/persist-validated-event.ts';

const restrictedByKey = new Map<string, readonly string[]>();
const written: string[] = [];

async function removeProbes(): Promise<void> {
  for (const path of written.splice(0)) await rm(path, { force: true });
}

beforeAll(async () => {
  // `deep-relative` shares a directory with `projection-handlers`, so it gets its own filename;
  // probes are keyed by case rather than by path.
  const targets = CASES.map((c) => ({
    ...c,
    path: at(join(c.dir, c.key === 'deep-relative' ? `relative-${PROBE}` : PROBE)),
  }));

  try {
    for (const t of targets) {
      await mkdir(dirname(t.path), { recursive: true });
      await writeFile(t.path, t.code, 'utf8');
      written.push(t.path);
    }

    const eslint = new ESLint({ cwd: REPO_DIR });
    const results = await eslint.lintFiles([...targets.map((t) => t.path), at(GOVERNED_BRIDGE)]);

    const byPath = new Map(
      results.map((r) => [
        r.filePath,
        r.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message),
      ]),
    );
    for (const t of targets) restrictedByKey.set(t.key, byPath.get(t.path) ?? []);
    restrictedByKey.set('governed-bridge', byPath.get(at(GOVERNED_BRIDGE)) ?? []);
  } finally {
    await removeProbes();
  }
}, 120_000);

afterAll(removeProbes);

describe('D2a — an arbitrary package cannot import the accepted-event write capability', () => {
  it.each([
    ['a projection handler directory', 'projection-handlers'],
    ['the directory next door to the writer itself', 'persistence-neighbour'],
  ])('rejects the package specifier from %s', (_label, key) => {
    const messages = restrictedByKey.get(key) ?? [];

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('ADR-0138');
  });

  it('rejects the deep relative form too, so the specifier ban cannot be walked around', () => {
    expect((restrictedByKey.get('deep-relative') ?? []).length).toBeGreaterThan(0);
  });

  it('scopes the ban to every package AND every app, not just this one', async () => {
    // The live probes all sit inside event-backbone, for the blast-radius reason documented on
    // CASES. This is the other half of the proof: the rule's `files` globs must cover the whole
    // monorepo, or an arbitrary package could import the capability and never be told.
    const config = await readFile(at('eslint.config.mjs'), 'utf8');
    const block = config.slice(config.indexOf('ADR-0138'));

    expect(block).toContain("'packages/**/*.ts'");
    expect(block).toContain("'apps/**/*.ts'");
    // ...and exactly one production file is exempted from it.
    expect(block).toContain(GOVERNED_BRIDGE);
  });

  it('PERMITS the real governed bridge — this is a boundary, not a blanket ban', () => {
    // The actual committed file, which really does import the capability. If this ever fails, the
    // boundary has become a wall and ingestion itself cannot lint: D2a would have "hardened" the
    // write path by deleting it.
    expect(restrictedByKey.get('governed-bridge')).toStrictEqual([]);
  });
});
