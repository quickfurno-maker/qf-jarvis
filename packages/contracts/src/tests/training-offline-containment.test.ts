/**
 * Training-data containment: the production runtime never depends on the training lane (JF-1, ADR-0145).
 *
 * ### What this locks, and why it is worth locking
 *
 * The isolation asserted here is already true — every production runtime package resolves a workspace
 * dependency closure containing none of the training/data-generation packages, and none of them imports
 * one. Nothing is being fixed. What is missing is a REASON it stays true: the property currently holds
 * because nobody has needed a dataset inside the runtime yet, and "nobody has needed it yet" is not a
 * boundary. One `pnpm add` in the wrong package is the whole distance between a corpus that is training
 * data and a corpus that is live customer input.
 *
 * ### The rule, stated once
 *
 * **production runtime → no training/dataset-generation dependency.**
 * **offline evaluation → may consume approved datasets under existing governance.**
 *
 * The second half matters as much as the first. The generic evaluation foundation, the Riya quality
 * evaluator, the two benchmark packages, the candidate evaluation bridge and the live candidate
 * evidence operator are offline authorities whose whole job may one day be to read a governed corpus.
 * They are deliberately absent from the protected set, so this file constrains them in no way at all. A
 * containment test that made legitimate evaluation harder would be removed within a quarter, and a
 * removed test protects nothing.
 *
 * ### Why every package is named WITHOUT its scope
 *
 * Several packages in this repository run their own containment scan that flags any file containing
 * their exact `@qf-jarvis/…` specifier as an importer, and those scans read raw source on purpose —
 * a comment-stripping regex is not a lexer, and at an import firewall a false negative is the expensive
 * direction. The repository's stated convention is that a file which must NAME a package it does not
 * import words itself to avoid the exact specifier. This file is a package-graph analyzer, not an
 * importer, so it holds bare names and composes a specifier only where one is genuinely needed. That
 * keeps every other firewall intact rather than widening a dozen of them to admit this one.
 *
 * ### Why the classification is a list AND a pattern
 *
 * The repository has no package-classification manifest, so the sets below are declared. A declared list
 * is a liability on its own — it silently goes stale the moment a fourth training package is added and
 * nobody remembers this file. So the list is paired with a name-pattern guard: any workspace package
 * whose name looks like training or dataset work must appear in the offline set, and a new one fails
 * this suite until somebody classifies it. The list says what is known; the pattern says what may not be
 * forgotten.
 *
 * ### Two independent checks, because either alone is defeatable
 *
 * The dependency closure reads `package.json`. The import scan reads source. A dependency without an
 * import is dead weight and still refused; an import without a dependency would not resolve under pnpm
 * but would still be caught, because the day it starts resolving is the day the boundary is gone. The
 * suite also proves its own detector fires, against a synthetic graph — an always-passing containment
 * test is the failure mode this kind of file is most prone to.
 *
 * Nothing here reads a dataset, opens a socket, or executes any package it names.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** `packages/contracts/src/tests` → the repository root is four levels up. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The workspace scope, kept separate from every package name.
 *
 * The scope alone matches no package. A full specifier is only ever formed at run time, so this file
 * never contains the `<scope><package>` text another package's import scan looks for.
 */
const SCOPE = '@qf-jarvis/';

/**
 * The PRODUCTION RUNTIME set: packages that participate in serving a real customer turn.
 *
 * The owner-specified JF-1 set. It is not "every package" — a package that is not listed is simply not
 * constrained by this file, which is what keeps the offline evaluation lane free.
 */
const PRODUCTION_RUNTIME_PACKAGES: readonly string[] = Object.freeze([
  'api',
  'worker',
  'jarvis-runtime',
  'agent-runtime',
  'riya-agent',
  'riya-web-conversation-service',
  'model-gateway',
  'model-gateway-composition',
  'model-reply-adapter',
]);

/**
 * The OFFLINE-ONLY set: training corpora and the machinery that generates them.
 *
 * These hold and produce training data. They are not evaluation authorities and not runtime components,
 * and a production package reaching one is the condition this file exists to refuse.
 */
const OFFLINE_ONLY_PACKAGES: readonly string[] = Object.freeze([
  'riya-intelligence-dataset',
  'riya-ai-synthetic-generation',
  'riya-ai-synthetic-provider-adapters',
]);

/**
 * What a training/dataset package tends to be called.
 *
 * The staleness guard, not the classification itself. A package matching this must be classified above;
 * `evaluation`, `benchmark` and `candidate` are deliberately NOT here, because those name the offline
 * evaluation lane this file must leave alone.
 */
const TRAINING_NAME_PATTERN = /dataset|synthetic|training|corpus|human-gold/iu;

/** What an offline evaluation package tends to be called. Used only to prove they are UNconstrained. */
const EVALUATION_NAME_PATTERN = /evaluation|benchmark|candidate|quality/iu;

/**
 * Packages that can cause a real-world SIDE EFFECT, which a training package must never reach.
 *
 * The reverse direction. A corpus generator able to reach approval, execution intent, dispatch, the
 * event backbone, a Postgres store, the model gateway or an app is a data pipeline holding business
 * authority — the same defect read backwards.
 *
 * ### What is deliberately NOT in this list, and why
 *
 * The agent runtime and the Riya behaviour package are absent on purpose. The dataset packages DO reach
 * them, through the conversation-continuity contracts — and that is correct rather than tolerated. The
 * behaviour package exports no runtime, no router, no state machine and no port, and the agent runtime
 * supplies the closed vocabularies and turn constructors the corpus is validated against. A dataset that
 * reused neither would restate the phase vocabulary and the annotation rules in a second place, and the
 * copy would drift from the runtime it claims to describe — which is precisely the leakage ADR-0107's
 * firewall exists to prevent. Reaching a VOCABULARY is not holding AUTHORITY.
 *
 * The distinction is load-bearing, so it is also pinned positively below: the offline closure is
 * asserted to equal an exact set, and any widening of it fails this suite whether or not the new edge
 * happens to appear in this list.
 */
const SIDE_EFFECT_PACKAGES: readonly string[] = Object.freeze([
  'api',
  'worker',
  'jarvis-runtime',
  'approval-runtime',
  'approval-core-adapter',
  'execution-intent-runtime',
  'execution-dispatch-runtime',
  'execution-dispatch-composition',
  'core-decision-adapter',
  'core-riya-intake',
  'event-backbone',
  'event-ingestion',
  'model-gateway',
  'model-gateway-composition',
  'riya-web-conversation-service',
  'postgres-approval-queue',
  'postgres-conversation-state',
  'postgres-execution-replay-store',
  'postgres-riya-conversation-continuity-store',
  'postgres-riya-turn-coordinator',
]);

/**
 * Everything the training lane may reach today, pinned exactly.
 *
 * A blocklist only refuses what somebody thought of. This is the allowlist half: the union of every
 * workspace package reachable from the three offline packages. Adding any edge — to a store, a gateway,
 * an app, or something that does not exist yet — changes this set and fails the suite, so a widening is
 * a decision somebody makes rather than a thing that happens.
 */
const OFFLINE_PERMITTED_CLOSURE: readonly string[] = Object.freeze([
  'agent-runtime',
  'model-evaluation',
  'riya-agent',
  'riya-ai-synthetic-generation',
  'riya-conversation-continuity',
  'riya-conversation-evolution',
  'riya-intelligence-dataset',
  'riya-quality-evaluation',
]);

// ------------------------------------------------------------------------------------------------
// The workspace graph, read from package.json only, keyed by BARE package name.
// ------------------------------------------------------------------------------------------------

interface WorkspacePackage {
  readonly name: string;
  readonly directory: string;
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
}

/** Strip the workspace scope. A dependency outside it is not a workspace edge and is dropped. */
function bare(specifier: string): string | undefined {
  return specifier.startsWith(SCOPE) ? specifier.slice(SCOPE.length) : undefined;
}

function workspaceEdges(record: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  return Object.freeze(
    Object.keys(record ?? {})
      .map((one) => bare(one))
      .filter((one): one is string => one !== undefined),
  );
}

function readWorkspace(): ReadonlyMap<string, WorkspacePackage> {
  const found = new Map<string, WorkspacePackage>();
  for (const group of ['packages', 'apps']) {
    const groupDir = join(REPO_ROOT, group);
    for (const entry of readdirSync(groupDir)) {
      const directory = join(groupDir, entry);
      if (!statSync(directory).isDirectory()) continue;
      let raw: string;
      try {
        raw = readFileSync(join(directory, 'package.json'), 'utf8');
      } catch {
        continue;
      }
      const parsed = JSON.parse(raw) as {
        readonly name?: unknown;
        readonly dependencies?: Readonly<Record<string, unknown>>;
        readonly devDependencies?: Readonly<Record<string, unknown>>;
      };
      if (typeof parsed.name !== 'string') continue;
      const name = bare(parsed.name);
      if (name === undefined) continue;
      found.set(name, {
        name,
        directory,
        dependencies: workspaceEdges(parsed.dependencies),
        devDependencies: workspaceEdges(parsed.devDependencies),
      });
    }
  }
  return found;
}

const WORKSPACE = readWorkspace();

/**
 * Every workspace package reachable from `start`.
 *
 * `includeDev` follows `devDependencies` at EVERY node, not just the root. A test-only dependency is
 * still a dependency of the package that declares it, and the looser reading — "dev deps do not count" —
 * is exactly how a dataset ends up one `import` away from the runtime with the boundary still green.
 */
function workspaceClosure(
  start: string,
  graph: ReadonlyMap<string, WorkspacePackage>,
  includeDev: boolean,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const stack: string[] = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const node = graph.get(current);
    if (node === undefined) continue;
    const edges = includeDev
      ? [...node.dependencies, ...node.devDependencies]
      : [...node.dependencies];
    for (const edge of edges) {
      if (!graph.has(edge) || seen.has(edge)) continue;
      seen.add(edge);
      stack.push(edge);
    }
  }
  return seen;
}

/** Every non-test TypeScript source file under a package's `src`. */
function sourceFiles(directory: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `dist` is build output and `tests` is not production execution.
        if (entry === 'dist' || entry === 'node_modules' || entry === 'tests') continue;
        walk(full);
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  walk(join(directory, 'src'));
  return out;
}

describe('JF-1 training-offline containment (ADR-0145)', () => {
  it('every classified package name resolves to a real workspace package', () => {
    // A rename that silently emptied a set would leave this file passing while checking nothing.
    for (const name of [
      ...PRODUCTION_RUNTIME_PACKAGES,
      ...OFFLINE_ONLY_PACKAGES,
      ...SIDE_EFFECT_PACKAGES,
      ...OFFLINE_PERMITTED_CLOSURE,
    ]) {
      expect(WORKSPACE.has(name), `${name} is classified but not in the workspace`).toBe(true);
    }
    expect(WORKSPACE.size).toBeGreaterThanOrEqual(50);
  });

  it('every package whose name looks like training or dataset work is classified offline', () => {
    const unclassified = [...WORKSPACE.keys()]
      .filter((name) => TRAINING_NAME_PATTERN.test(name))
      .filter((name) => !OFFLINE_ONLY_PACKAGES.includes(name));
    expect(
      unclassified,
      'a new training/dataset package must be added to OFFLINE_ONLY_PACKAGES before it can land',
    ).toStrictEqual([]);
  });

  it('no production runtime package depends on a training package (dependencies)', () => {
    const violations: string[] = [];
    for (const name of PRODUCTION_RUNTIME_PACKAGES) {
      const closure = workspaceClosure(name, WORKSPACE, false);
      for (const offline of OFFLINE_ONLY_PACKAGES) {
        if (closure.has(offline)) violations.push(`${name} -> ${offline}`);
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('no production runtime package depends on a training package (including devDependencies)', () => {
    const violations: string[] = [];
    for (const name of PRODUCTION_RUNTIME_PACKAGES) {
      const closure = workspaceClosure(name, WORKSPACE, true);
      for (const offline of OFFLINE_ONLY_PACKAGES) {
        if (closure.has(offline)) violations.push(`${name} -> ${offline}`);
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('no production runtime source file imports a training package', () => {
    const violations: string[] = [];
    for (const name of PRODUCTION_RUNTIME_PACKAGES) {
      const pkg = WORKSPACE.get(name);
      if (pkg === undefined) continue;
      for (const file of sourceFiles(pkg.directory)) {
        const source = readFileSync(file, 'utf8');
        for (const offline of OFFLINE_ONLY_PACKAGES) {
          // The specifier is composed here, never written as a literal, for the reason at the top.
          if (source.includes(`${SCOPE}${offline}`)) {
            violations.push(`${file.slice(REPO_ROOT.length)} names ${offline}`);
          }
        }
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('no training package reaches anything that can cause a side effect', () => {
    const violations: string[] = [];
    for (const name of OFFLINE_ONLY_PACKAGES) {
      const closure = workspaceClosure(name, WORKSPACE, true);
      for (const authority of SIDE_EFFECT_PACKAGES) {
        if (closure.has(authority)) violations.push(`${name} -> ${authority}`);
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('the training lane reaches exactly the packages it is permitted to reach', () => {
    // The allowlist half. A blocklist refuses only what somebody anticipated; this fails on any new edge.
    const reached = new Set<string>();
    for (const name of OFFLINE_ONLY_PACKAGES) {
      for (const one of workspaceClosure(name, WORKSPACE, true)) reached.add(one);
    }
    expect([...reached].sort()).toStrictEqual([...OFFLINE_PERMITTED_CLOSURE].sort());
  });

  it('leaves the offline evaluation lane free to consume governed datasets', () => {
    // A positive control, derived from the workspace rather than a second hard-coded list: no package
    // that reads as evaluation work may sit in the protected set, so this file can never be the reason
    // an offline authority is unable to read a corpus.
    const evaluationLane = [...WORKSPACE.keys()].filter(
      (name) => EVALUATION_NAME_PATTERN.test(name) && !TRAINING_NAME_PATTERN.test(name),
    );
    expect(evaluationLane.length).toBeGreaterThanOrEqual(5);
    for (const name of evaluationLane) {
      expect(
        PRODUCTION_RUNTIME_PACKAGES.includes(name),
        `${name} is an offline evaluation authority and must not be constrained here`,
      ).toBe(false);
    }
  });

  it('detects a violation when one exists', () => {
    // The negative control. Without it, a bug that made every closure empty would leave the whole suite
    // green while proving nothing at all. Two hops, so the detector is proved TRANSITIVE, not direct.
    const node = (name: string, dependencies: readonly string[]): WorkspacePackage => ({
      name,
      directory: '',
      dependencies,
      devDependencies: [],
    });
    const synthetic = new Map<string, WorkspacePackage>([
      ['api', node('api', ['jarvis-runtime'])],
      ['jarvis-runtime', node('jarvis-runtime', ['riya-intelligence-dataset'])],
      ['riya-intelligence-dataset', node('riya-intelligence-dataset', [])],
    ]);
    expect(workspaceClosure('api', synthetic, false).has('riya-intelligence-dataset')).toBe(true);
    // And the real graph does not have that edge, which is the whole point.
    expect(workspaceClosure('api', WORKSPACE, true).has('riya-intelligence-dataset')).toBe(false);
  });

  it('the Human Gold corpus is present and stays outside the runtime', () => {
    // JF-1 preserves data. The corpus file is tracked; this asserts it is readable and that its owning
    // package is the offline one, not that its contents are anything in particular.
    const corpus = join(
      REPO_ROOT,
      'packages',
      'riya-intelligence-dataset',
      'data',
      'human-gold-v1',
      'wave-1',
      'batch-1.jsonl',
    );
    expect(statSync(corpus).isFile()).toBe(true);
    expect(OFFLINE_ONLY_PACKAGES).toContain('riya-intelligence-dataset');
  });
});
