/**
 * D2a — accepted-event write-path and provenance containment (ADR-0138).
 *
 * These tests are the enforcement of the D2a claim. They are deliberately STRUCTURAL: they read the
 * built barrel, the package manifest, the ESLint configuration and the repository's own production
 * source, because a comment saying "do not call this" is not containment. If someone re-exports the
 * writer, adds a second production INSERT, or widens the lint boundary, one of these fails.
 *
 * The claim being enforced is narrow and stated exactly in ADR-0138:
 *
 *   Within the qf-jarvis application trust model, a canonical event row reached through the governed
 *   event ingestion/persistence path cannot be established by another repository production import
 *   or runtime SQL writer without violating tested containment.
 *
 * It is NOT a claim that the database cryptographically proves every row was signed. Whatever the
 * database grants permit, an out-of-repository actor can still write the table; D2a hardens the
 * repository/application path, not the DBA.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import * as eventWrite from '../persistence/event-write.js';
import * as eventStore from '../persistence/event-store.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const REPO_DIR = fileURLToPath(REPO_ROOT);

/** Kept in step with `accepted-event-write-lint-boundary.test.ts`. See `productionSources`. */
const LINT_PROBE_FILENAME = 'zz-d2a-lint-probe.ts';

/** Every `.ts` file under a directory, recursively. */
async function collectTypeScriptFiles(dir: string): Promise<readonly string[]> {
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
    const info = await stat(full);
    if (info.isDirectory()) {
      found.push(...(await collectTypeScriptFiles(full)));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** Production source across the monorepo: packages + apps, excluding every test tree. */
async function productionSources(): Promise<readonly string[]> {
  const roots = ['packages', 'apps'].map((d) => join(REPO_DIR, d));
  const all: string[] = [];
  for (const root of roots) all.push(...(await collectTypeScriptFiles(root)));
  return all.filter(
    (f) =>
      !f.includes(`${sep}tests${sep}`) &&
      !f.includes('.test.') &&
      // `accepted-event-write-lint-boundary.test.ts` writes short-lived probe files into real
      // package directories to prove the lint rule actually fires. Vitest may be running it in
      // parallel with this scan, so a probe can exist on disk for a few hundred milliseconds. It is
      // never committed — the sibling test removes it in `finally` and again in `afterAll`.
      !f.endsWith(LINT_PROBE_FILENAME) &&
      !f.endsWith(`relative-${LINT_PROBE_FILENAME}`),
  );
}

describe('D2a — the accepted-event writer is not on the package root', () => {
  it('does NOT export storeValidatedEvent from the barrel', () => {
    // The pre-D2a bypass: any package could import this and store a hand-built record.
    expect(barrel).not.toHaveProperty('storeValidatedEvent');
  });

  it('does NOT export the governed writer or its capability from the barrel either', () => {
    // Moving the writer behind a subpath is pointless if the barrel re-exports the subpath.
    expect(barrel).not.toHaveProperty('storeAuthenticatedEvent');
    expect(barrel).not.toHaveProperty('AuthenticatedEventWrite');
  });

  it('keeps the primitive INTERNAL rather than pretending it does not exist', () => {
    // The honest half, matching how recordEventConflict is treated: it is real and reachable
    // inside the package — it is just not reachable from the package root.
    expect(eventStore).toHaveProperty('storeValidatedEvent');
    expect(eventStore.storeValidatedEvent).toBeTypeOf('function');
  });

  it('still exports the read-side outcome surface, which is not write authority', () => {
    // D2a separates read types from write authority. Callers that must handle an outcome or an
    // error keep everything they had.
    expect(barrel).toHaveProperty('ConflictingEventDigestError');
    expect(barrel).toHaveProperty('EventPersistenceConsistencyError');
  });
});

describe('D2a — the governed write capability cannot be forged', () => {
  it('exposes exactly one writer and one mint on the internal module', () => {
    expect(eventWrite.storeAuthenticatedEvent).toBeTypeOf('function');
    expect(eventWrite.AuthenticatedEventWrite).toBeTypeOf('function');
  });

  it('refuses `new` — the constructor is private', () => {
    // TypeScript rejects this at compile time; this proves the runtime shape too, so the guarantee
    // does not evaporate for a JavaScript caller or a cast.
    const Ctor = eventWrite.AuthenticatedEventWrite as unknown as new (r: unknown) => unknown;
    expect(() => new Ctor({})).toThrow();
  });

  it('rejects every structurally-faked capability at the type level', () => {
    // These are the exact forgeries ADR-0138 forbids. Each is a compile ERROR, which is the point:
    // the capability carries a #private field, so no object literal — and no caller-selected
    // boolean or string tag — can satisfy it. @ts-expect-error FAILS THE BUILD if the line ever
    // starts compiling, so this test is a live assertion, not a comment.
    const pool = {} as unknown as Parameters<typeof eventWrite.storeAuthenticatedEvent>[0];

    // @ts-expect-error a caller-constructed "verified" discriminator is not the capability
    void (() => eventWrite.storeAuthenticatedEvent(pool, { verified: true }));
    // @ts-expect-error nor is a "trusted" flag
    void (() => eventWrite.storeAuthenticatedEvent(pool, { trusted: true }));
    // @ts-expect-error nor is a source tag
    void (() => eventWrite.storeAuthenticatedEvent(pool, { source: 'ingestion' }));
    // @ts-expect-error nor is a bare persistence record — the pre-D2a forgery
    void (() => eventWrite.storeAuthenticatedEvent(pool, { record: {} }));
    // @ts-expect-error nor is a bare eventId; an id is a name, never provenance
    void (() => eventWrite.storeAuthenticatedEvent(pool, { eventId: 'any-id-a-caller-can-type' }));

    expect(eventWrite.storeAuthenticatedEvent).toBeTypeOf('function');
  });
});

describe('D2a — exactly one production path writes qf_jarvis.event', () => {
  it('finds no second INSERT in repository production source', async () => {
    const files = await productionSources();
    expect(files.length).toBeGreaterThan(100); // the scan actually ran

    const inserters = files.filter((file) => file.endsWith('event-store.ts'));
    const others: string[] = [];
    for (const file of files) {
      const code = await readFile(file, 'utf8');
      if (/insert\s+into\s+qf_jarvis\.event\b/i.test(code) && !file.endsWith('event-store.ts')) {
        others.push(file);
      }
    }

    // Exactly one canonical production writer, and it is the store primitive itself.
    expect(others).toStrictEqual([]);
    expect(inserters.length).toBe(1);
  });

  it('does not mistake migrations or DDL for a runtime bypass', async () => {
    // The table is legitimately NAMED by migration `0001` (DDL) and by projection READERS (SELECT /
    // JOIN). D2a contains runtime INSERTs, not every mention, so this test states that distinction
    // rather than letting a future reader assume the scan above is stricter than it is.
    const ddl = await readFile(
      new URL('../persistence/migrations/0001_event_log.sql', import.meta.url),
      'utf8',
    );
    expect(ddl).toContain('qf_jarvis.event');
    expect(/insert\s+into\s+qf_jarvis\.event\b/i.test(ddl)).toBe(false);
  });

  it('leaves the projection read path untouched — it joins, it never inserts', async () => {
    for (const reader of ['projection-event-reader.ts', 'projection-subject-reader.ts']) {
      const code = await readFile(new URL(`../projections/${reader}`, import.meta.url), 'utf8');
      expect(code).toContain('JOIN qf_jarvis.event');
      expect(/insert\s+into\s+qf_jarvis\.event\b/i.test(code)).toBe(false);
    }
  });
});

describe('D2a — the import boundary is configured, not merely documented', () => {
  it('restricts the write subpath to the one governed ingestion bridge', async () => {
    const config = await readFile(new URL('eslint.config.mjs', REPO_ROOT), 'utf8');

    // The specifier is banned...
    expect(config).toContain('@qf-jarvis/event-backbone/internal/event-write');
    // ...and the relative form too, so an in-repo deep import cannot walk around the specifier.
    expect(config).toContain('**/persistence/event-write.js');
    // ...for everyone except exactly one production file.
    expect(config).toContain('packages/event-ingestion/src/ingest/persist-validated-event.ts');
    expect(config).toContain('ADR-0138');
  });

  it('publishes the capability through a narrow internal subpath, not a wildcard', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { readonly exports: Record<string, unknown> };

    const subpath = JSON.stringify(manifest.exports['./internal/event-write']);
    expect(subpath).toContain('./dist/persistence/event-write.js');
    expect(subpath).toContain('./dist/persistence/event-write.d.ts');
    // It must resolve to the one narrow module — never the barrel, never the migration runner,
    // and never a directory a deep import could walk.
    expect(subpath).not.toContain('index.js');
    expect(subpath).not.toContain('migration-runner');
    expect(subpath).not.toContain('*');
  });

  it('has exactly one production importer of the write capability', async () => {
    const files = await productionSources();
    // Real import/re-export statements only. Several files legitimately NAME the subpath in a
    // doc comment (this boundary is worth documenting where it is enforced); naming it is not
    // importing it, and a scan that conflated the two would be theatre.
    const importsCapability =
      /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+'(?:@qf-jarvis\/event-backbone\/internal\/event-write|[^']*persistence\/event-write\.js)'/;

    const importers: string[] = [];
    for (const file of files) {
      const code = await readFile(file, 'utf8');
      if (importsCapability.test(code)) importers.push(file);
    }

    // Exactly the governed bridge. The capability module does not import itself.
    expect(importers.length).toBe(1);
    expect(importers[0]?.replace(/\\/g, '/')).toContain(
      'packages/event-ingestion/src/ingest/persist-validated-event.ts',
    );
  });
});
