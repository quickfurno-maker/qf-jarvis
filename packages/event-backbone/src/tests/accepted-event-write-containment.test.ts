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
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import * as eventWrite from '../persistence/event-write.js';
import * as eventStore from '../persistence/event-store.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const REPO_DIR = fileURLToPath(REPO_ROOT);

/** `git ls-files` is the source of truth for what counts as production source. */
const execFile = promisify(execFileCallback);

/**
 * Production sources come from GIT, not from a filesystem walk.
 *
 * Sibling boundary suites write short-lived lint probes into real package directories and delete
 * them, so a walk can list a path that is gone by the time it is read, and a name-based skip would
 * open a bypass: commit a file called `x-1-zz-d4-lint-probe.ts` with an `eslint-disable` and it would
 * escape both the lint rule and this supposedly independent scan.
 *
 * **Trackedness is the honest discriminator.** A transient probe is never committed, so `git ls-files`
 * never lists it; a committed file is scanned whatever it is called, and nothing is skipped by name.
 */
async function scanProductionSources(): Promise<readonly string[]> {
  const { stdout } = await execFile('git', ['ls-files', '--', 'packages', 'apps'], {
    cwd: REPO_DIR,
    maxBuffer: 32 * 1024 * 1024,
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.ts'))
    .map((line) => join(REPO_DIR, line))
    .filter((path) => !path.includes(`${sep}tests${sep}`) && !path.includes('.test.'));
}

/** Source with block and line comments removed, so prose about a symbol is not read as a use of it. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** How many times `pattern` occurs in `code`. Occurrences, never files — see the mint scan below. */
function countMatches(code: string, pattern: RegExp): number {
  return (code.match(pattern) ?? []).length;
}

/** Every reference to the mint MEMBER, in any shape: a call, an alias, a re-export, a property read. */
const MINT_MEMBER_REFERENCE = /\bfromVerifiedIngestion\b/g;

/** The one intended shape: a direct call on the class. */
const MINT_DIRECT_CALL = /\bAuthenticatedEventWrite\s*\.\s*fromVerifiedIngestion\s*\(/g;

/** Every invocation of the low-level writer. */
const LOW_LEVEL_INVOCATION = /\bstoreValidatedEvent\s*\(/g;

/** An absolute path as a repo-relative, forward-slashed one, so assertions read the same everywhere. */
function relative(absolute: string): string {
  return absolute.slice(REPO_DIR.length).replace(/\\/g, '/');
}

/**
 * The production file list and their contents, read ONCE per suite.
 *
 * Five assertions below need the same corpus. Re-walking the monorepo and re-reading every file for
 * each of them was pure duplicated I/O, and enough of it to trip the default 5s timeout when vitest
 * runs this suite alongside the rest of the repository. Caching changes no assertion; it just stops
 * the suite failing for a reason that has nothing to do with containment.
 */
let productionCorpus: Promise<ReadonlyMap<string, string>> | undefined;

async function productionFiles(): Promise<ReadonlyMap<string, string>> {
  productionCorpus ??= (async () => {
    const paths = await scanProductionSources();
    const entries = await Promise.all(
      paths.map(async (path) => [path, await readFile(path, 'utf8')] as const),
    );
    return new Map(entries);
  })();
  return productionCorpus;
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

describe('D2a — the capability is a NOMINAL wrapper, not independent authentication evidence', () => {
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

  it('rejects structural substitution at the type level', () => {
    // What this proves, precisely: NOMINAL-TYPE SUBSTITUTION PROTECTION. The capability carries a
    // #private field, so no object literal — and no caller-selected boolean or string tag — can
    // stand in for it. @ts-expect-error FAILS THE BUILD if any line here starts compiling, so this
    // is a live assertion rather than a comment.
    //
    // What it does NOT prove: that a value of this type came from signature verification. The mint
    // is a public static factory taking a plain record, so any code permitted to import the module
    // could mint from a hand-built one. That is why the security boundary is the TESTED ONE-FILE
    // import/call containment below plus the bridge's evidence binding — not this class alone.
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

describe('D2a — the three-layer production containment chain', () => {
  /**
   * These scans read SOURCE TEXT, deliberately. A lint rule can be suppressed with an
   * `eslint-disable` comment; a text scan cannot be, so the two layers fail independently. Between
   * them they pin the whole chain:
   *
   *   1. the SQL INSERT           -> event-store.ts only          (asserted below)
   *   2. `storeValidatedEvent`    -> event-write.ts only          (this block)
   *   3. the governed writer      -> persist-validated-event.ts   (this block)
   *   4. the mint call site       -> persist-validated-event.ts   (this block)
   *
   * Break any single link and a canonical event row becomes creatable outside signed ingestion.
   */

  it('has exactly ONE production caller of the low-level storeValidatedEvent', async () => {
    const files = await productionFiles();
    const definition = join('persistence', 'event-store.ts');

    const referencing: string[] = [];
    for (const [file, code] of files) {
      if (file.endsWith(definition)) continue; // the implementation itself
      // Strip comments first: several files legitimately DISCUSS the primitive in prose, and a scan
      // that confused a doc comment for a call would either cry wolf or be quietly loosened later.
      if (/\bstoreValidatedEvent\b/.test(stripComments(code))) referencing.push(file);
    }

    expect(referencing.map(relative)).toStrictEqual([
      'packages/event-backbone/src/persistence/event-write.ts',
    ]);
  });

  it('makes exactly ONE production invocation of the low-level writer', async () => {
    // The file-level assertion above says only that one file mentions it. This says the file calls
    // it once, so "one production caller" is literally true rather than approximately true.
    const code = stripComments(
      await readFile(
        join(REPO_DIR, 'packages/event-backbone/src/persistence/event-write.ts'),
        'utf8',
      ),
    );

    expect(countMatches(code, LOW_LEVEL_INVOCATION)).toBe(1);
  });

  it('has exactly ONE production importer of the governed write capability', async () => {
    const files = await productionFiles();
    // Real import/re-export statements only. Several files legitimately NAME the subpath in a doc
    // comment (this boundary is worth documenting where it is enforced); naming it is not importing
    // it, and a scan that conflated the two would be theatre.
    const importsCapability =
      /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+'(?:@qf-jarvis\/event-backbone\/internal\/event-write|[^']*persistence\/event-write\.js)'/;

    const importers: string[] = [];
    for (const [file, code] of files) {
      if (importsCapability.test(code)) importers.push(file);
    }

    expect(importers.map(relative)).toStrictEqual([
      'packages/event-ingestion/src/ingest/persist-validated-event.ts',
    ]);
  });

  it('has exactly ONE production reference to the mint, and it is the intended direct call', async () => {
    // COUNTS OCCURRENCES, NOT FILES. A file-level check would pass with two mint calls inside the
    // permitted file, and a second mint there is exactly the dangerous case: it could build a record
    // by some other route while still satisfying "one file". The mint is a public factory over a
    // plain record, so "how many places may call it" IS the boundary (ADR-0138).
    //
    // It also counts the MEMBER NAME rather than the call shape, so an alias
    // (`const mint = AuthenticatedEventWrite.fromVerifiedIngestion`) cannot slip past a
    // call-shaped regex.
    const files = await productionFiles();
    const definition = join('persistence', 'event-write.ts');

    let memberReferences = 0;
    let directCalls = 0;
    const holders: string[] = [];

    for (const [file, raw] of files) {
      if (file.endsWith(definition)) continue; // the class declares the member; that is not a use
      const code = stripComments(raw);
      const refs = countMatches(code, MINT_MEMBER_REFERENCE);
      if (refs === 0) continue;
      memberReferences += refs;
      directCalls += countMatches(code, MINT_DIRECT_CALL);
      holders.push(file);
    }

    expect(holders.map(relative)).toStrictEqual([
      'packages/event-ingestion/src/ingest/persist-validated-event.ts',
    ]);
    // Exactly one reference, and that one reference is the direct call — so there is no alias, no
    // re-export and no second mint anywhere in production.
    expect(memberReferences).toBe(1);
    expect(directCalls).toBe(1);
  });
});

describe('D2a — the containment scans are not vacuous', () => {
  // A scan that can never fail is decoration. These prove the detectors actually fire on the exact
  // bypass shapes, and stay quiet on prose — checked as pure functions of source text, so no probe
  // file is written and no other suite can race them.
  //
  // This matters because the two enforcement layers fail INDEPENDENTLY: an `eslint-disable` comment
  // suppresses the lint rule but cannot suppress a text scan. That was verified by planting a real
  // second module which imported the primitive under `eslint-disable no-restricted-imports`: lint
  // passed clean with zero errors, and the scan above caught it by name.
  //
  // The fixtures are joined from lines rather than written as template literals, because embedding
  // comment delimiters inside a template that a comment-stripping function then processes is
  // needlessly confusing for whoever edits this next.
  const OPEN = '/' + '*';
  const CLOSE = '*' + '/';
  const BYPASS = [
    OPEN + ' eslint-disable no-restricted-imports ' + CLOSE,
    "import { storeValidatedEvent } from './event-store.js';",
    'export const sneaky = storeValidatedEvent;',
  ].join('\n');
  const PROSE = [
    OPEN +
      '* Persistence goes through storeValidatedEvent, which this module never calls. ' +
      CLOSE,
    'export const nothing = 1;',
  ].join('\n');

  it('detects a second low-level writer reference, even under eslint-disable', () => {
    expect(/\bstoreValidatedEvent\b/.test(stripComments(BYPASS))).toBe(true);
  });

  it('does not mistake a doc comment about the writer for a use of it', () => {
    expect(/\bstoreValidatedEvent\b/.test(stripComments(PROSE))).toBe(false);
  });

  it('detects a SECOND mint call in the SAME file — the file-counting weakness', () => {
    // The gap this replaced: counting files would report 1 here and pass. Counting occurrences
    // reports 2 and fails, which is the whole point of the change.
    const twoMints = [
      'const a = AuthenticatedEventWrite.fromVerifiedIngestion(record);',
      'const b = AuthenticatedEventWrite.fromVerifiedIngestion(other);',
    ].join('\n');

    expect(countMatches(twoMints, MINT_MEMBER_REFERENCE)).toBe(2);
    expect(countMatches(twoMints, MINT_DIRECT_CALL)).toBe(2);
  });

  it('detects an ALIASED mint, which a call-shaped regex alone would miss', () => {
    const aliased = [
      'const mint = AuthenticatedEventWrite.fromVerifiedIngestion;',
      'const w = mint(record);',
    ].join('\n');

    // The call-shaped pattern sees nothing...
    expect(countMatches(aliased, MINT_DIRECT_CALL)).toBe(0);
    // ...so the member-name count is what catches it, and the two assertions together
    // (`memberReferences === 1` AND `directCalls === 1`) make this shape fail.
    expect(countMatches(aliased, MINT_MEMBER_REFERENCE)).toBe(1);
  });

  it('detects a second low-level invocation', () => {
    const twice = 'storeValidatedEvent(pool, a);\nstoreValidatedEvent(pool, b);';
    expect(countMatches(twice, LOW_LEVEL_INVOCATION)).toBe(2);
  });
});

describe('D2a — exactly one production path writes qf_jarvis.event', () => {
  it('finds no second INSERT in repository production source', async () => {
    const files = await productionFiles();
    expect(files.size).toBeGreaterThan(100); // the scan actually ran

    const inserters = [...files.keys()].filter((file) => file.endsWith('event-store.ts'));
    const others: string[] = [];
    for (const [file, code] of files) {
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

  // NOTE: the "exactly one production importer" assertion lives in the three-layer chain block
  // above, where it sits beside the low-level-writer and mint scans it belongs with. A weaker
  // duplicate used to live here too (length + `toContain` rather than exact list equality); it was
  // removed because it re-scanned every production file for no extra coverage, and the doubled I/O
  // made this suite time out under parallel load.
});
