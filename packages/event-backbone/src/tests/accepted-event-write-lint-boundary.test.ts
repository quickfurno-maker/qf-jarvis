/**
 * D2a — the import boundary is EXECUTED, not just configured (ADR-0138).
 *
 * `accepted-event-write-containment.test.ts` proves the structural facts. This file proves the
 * ESLint boundary is real, in two complementary ways, because neither alone is enough:
 *
 *  1. **Resolved-rule assertions** via `ESLint#calculateConfigForFile`, which returns the rule value
 *     ESLint would actually apply to a path after flat-config resolution. This is not a grep of the
 *     config text: a block that is present but overridden resolves away, and this API shows that.
 *  2. **Live lint probes**: real files, written at real paths, linted by the real configuration.
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
 * Probe files stay inside THIS package's tree on purpose: other packages and apps run recursive
 * source scans, and a probe dropped into `apps/api/src` — even for the moment this suite holds it —
 * races those scans. Every probe is removed in `finally` and again in `afterAll`.
 *
 * All probes are linted in ONE ESLint pass. Type-aware linting is expensive, and a pass per case was
 * slow enough to trip the default timeout under parallel load. Nothing is asserted less strictly for
 * it.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
 * BLOCKER 2's scenario: a second event-backbone production module importing the LOW-LEVEL writer
 * directly. This compiles, adds no second SQL INSERT, and adds no second `event-write` importer —
 * so before the correction it slipped through every D2a check.
 */
const LOW_LEVEL_WRITER_IMPORT = `import { storeValidatedEvent } from '../persistence/event-store.js';
export const probe = storeValidatedEvent;
`;

/** Read-side types from the SAME module must stay importable: write authority is restricted, reads are not. */
const READ_SIDE_TYPE_IMPORT = `import type { StoredEvent } from '../persistence/event-store.js';
export type Probe = StoredEvent;
`;

const CASES = [
  { key: 'capability-from-projections', dir: 'src/projections', code: WRITE_CAPABILITY_IMPORT },
  { key: 'capability-from-persistence', dir: 'src/persistence', code: WRITE_CAPABILITY_IMPORT },
  { key: 'capability-deep-relative', dir: 'src/projections', code: RELATIVE_CAPABILITY_IMPORT },
  { key: 'low-level-writer', dir: 'src/projections', code: LOW_LEVEL_WRITER_IMPORT },
  { key: 'low-level-writer-beside-it', dir: 'src/persistence', code: LOW_LEVEL_WRITER_IMPORT },
  { key: 'read-side-types', dir: 'src/projections', code: READ_SIDE_TYPE_IMPORT },
] as const;

/** The real committed bridge — the one production file that may hold the write capability. */
const GOVERNED_BRIDGE = 'packages/event-ingestion/src/ingest/persist-validated-event.ts';

const restrictedByKey = new Map<string, readonly string[]>();
const written: string[] = [];

async function removeProbes(): Promise<void> {
  for (const path of written.splice(0)) await rm(path, { force: true });
}

/** Every `group` pattern in the rule ESLint would really apply to `path`, flattened. */
async function resolvedGroups(path: string): Promise<readonly string[]> {
  const config: unknown = await eslint.calculateConfigForFile(at(path));
  const rule = (config as { rules?: Record<string, unknown> }).rules?.['no-restricted-imports'];
  const patterns = Array.isArray(rule)
    ? ((rule[1] as { patterns?: readonly { group?: readonly string[] }[] } | undefined)?.patterns ??
      [])
    : [];
  return patterns.flatMap((p) => p.group ?? []);
}

beforeAll(async () => {
  const targets = CASES.map((c, i) => ({
    ...c,
    path: at(join('packages/event-backbone', c.dir, `${c.key}-${String(i)}-${PROBE}`)),
  }));

  try {
    for (const t of targets) {
      await mkdir(dirname(t.path), { recursive: true });
      await writeFile(t.path, t.code, 'utf8');
      written.push(t.path);
    }

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
}, 180_000);

afterAll(removeProbes);

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

    // The exception is narrow: it drops the D2a write patterns and nothing else. Expressing this as
    // an `ignores` entry on the purity block would have removed both, which is the trap this asserts
    // against.
    expect(groups).toContain('node:fs');
    expect(groups).toContain('child_process');
    expect(groups).not.toContain('@qf-jarvis/event-backbone/internal/event-write');
    expect(groups).not.toContain('**/persistence/event-store.js');
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
    // The live probes all sit inside event-backbone, for the blast-radius reason documented at the
    // top. This is the other half: an arbitrary package and an arbitrary app must resolve the ban
    // too, or a package could import the capability and never be told.
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
    ['from another directory in the package', 'low-level-writer'],
    ['from the writer’s own directory', 'low-level-writer-beside-it'],
  ])('rejects importing storeValidatedEvent %s', (_label, key) => {
    // This is BLOCKER 2's scenario made executable: a second event-backbone production module
    // importing the low-level primitive. It compiles, adds no second SQL INSERT and no second
    // event-write importer, so nothing else in this suite would have caught it.
    const messages = restrictedByKey.get(key) ?? [];

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('ADR-0138');
  });

  it('still allows READ-side types from the same module', () => {
    // The ban is keyed by imported NAME, not by module path, because the package barrel legitimately
    // re-exports the outcome types and errors from `event-store.js`. Banning the path would have
    // broken the barrel and told us nothing about write authority.
    expect(restrictedByKey.get('read-side-types')).toStrictEqual([]);
  });
});
