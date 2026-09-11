/**
 * JF-5B containment — the orchestration lock, the credential lock, and "no live calls in CI".
 *
 * ### What a scan proves that a behavioural test cannot
 *
 * A behavioural test shows a path was not taken on the inputs it tried. A scan shows the path is not
 * there to take. Both matter here, because the failures this lane must prevent — a business turn
 * reaching a provider before Jarvis, a workflow holding a credential, a CI job opening the live gate —
 * all look perfectly healthy when they happen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const repoPath = (rel: string): string => fileURLToPath(new URL(rel, REPO_ROOT));

const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

function walk(dir: string, extensions: readonly string[] = ['.ts']): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

/** Comments stripped, so a scan cannot match this file's own prose or a doc comment. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const OPERATOR_DIR = fileURLToPath(new URL('../', import.meta.url));
const OPERATOR_SOURCE = walk(OPERATOR_DIR).filter((file) => !file.includes(`${sep}tests${sep}`));

/** The Mastra application workflow, and the three-agent composition that uses it. */
const ORCHESTRATION_DIR = repoPath('apps/api/src/riya-customer-orchestration');

// ---------------------------------------------------------------------------
// §0A — the orchestration lock.
// ---------------------------------------------------------------------------

describe('JF-5B (0A) Mastra orchestrates; it never routes, holds or sends', () => {
  it('(2,3) no Mastra workflow imports a credential or constructs a provider client', () => {
    // Mastra is the orchestration engine INSIDE Jarvis. A workflow that could reach a provider would be
    // a second provider router with none of the gateway's policy, and a workflow holding a key would
    // put the credential one refactor away from an outbound call nobody reviewed.
    for (const file of walk(ORCHESTRATION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'ApiKey',
        'apiKey',
        'Authorization',
        'Bearer',
        'createFetch',
        'fetch(',
        'https://',
        ['process', '.env'].join(''),
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });

  it('(1,10) no orchestration file names a provider: selection lives in the gateway alone', () => {
    for (const file of walk(ORCHESTRATION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'groq',
        'Groq',
        'nara',
        'Nara',
        'PROVIDER_MODES',
        'ProviderMode',
        'GROQ_ONLY',
        'NARA_ONLY',
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });

  it('(5,6) no orchestration file has an external send surface', () => {
    for (const file of walk(ORCHESTRATION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'whatsapp',
        'WhatsApp',
        'webhook',
        'n8n',
        'graph.facebook',
        'sendMessage',
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });

  it('(8,9) the workflow is a ONE-step closure that adds no model call of its own', () => {
    // Reused from JF-4A rather than rebuilt per agent. The runner takes a supplied call and an opaque
    // marker; it never constructs a request, so it cannot add a second one.
    const runner = codeOnly(
      readFileSync(join(ORCHESTRATION_DIR, 'mastra-customer-turn-runner.ts'), 'utf8'),
    );
    // `invoke()` appears and MUST: it is the caller's closure, which is exactly why the workflow adds
    // no call of its own. What would be wrong is the runner building a request or repeating one.
    expect(runner).toContain('await invoke()');
    for (const forbidden of ['retry', 'retries', 'attempts', 'draftReply', 'modelReplyPort']) {
      expect({ forbidden, present: runner.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The operator itself: evaluation only, off the serving path.
// ---------------------------------------------------------------------------

describe('JF-5B the certification operator is off the serving path', () => {
  it('is imported ONLY by the named certification files, and by nothing that serves a turn', () => {
    // NARROWED, not relaxed (JF-5B-R1, ADR-0152).
    //
    // The first version of this lock said "nothing imports it", and that was the honest statement of
    // the rule while the package had no executable. It had one problem: the `bin` the manifest
    // declared did not exist, so the operator could not be RUN. JF-5B-R1 closed that by putting the
    // executable at the application's process boundary -- the only place in this repository allowed to
    // acquire a credential -- which means `apps/api` now imports this package.
    //
    // The property being protected was never "no importer". It was "nothing on the serving path". So
    // the lock names the exact files, by path, rather than permitting a directory: a new certification
    // module cannot appear without being added here, and no ingress, route, runtime factory, worker or
    // server startup can reach the operator by adding an import.
    const ALLOWED: readonly string[] = [
      // The sequence the process boundary runs. The bin itself is deliberately absent: it imports the
      // composition and the CLI and nothing else, which is what keeps it four lines long.
      'apps/api/src/cli/jf5b-certification-runner.ts',
      'apps/api/src/cli/run-jf5b-live-certification.ts',
      // The production wiring and the engine behind it.
      'apps/api/src/composition/jf5b-live-composition.ts',
      'apps/api/src/composition/jf5b-certification-context.ts',
      'apps/api/src/composition/jf5b-certification-runner-impl.ts',
      'apps/api/src/composition/jf5b-repository-facts.ts',
      // The two specs that drive all of the above with injected fakes and zero network.
      'apps/api/src/tests/jf5b-live-cli.test.ts',
      'apps/api/src/tests/jf5b-certification-runner.test.ts',
    ];
    const importers: string[] = [];
    for (const root of [repoPath('packages'), repoPath('apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'jarvis-v1-provider-certification-live') {
          continue;
        }
        for (const file of walk(join(root, entry, 'src'))) {
          // A real IMPORT, not a mention. Two containment specs elsewhere must NAME this package to
          // record it as an authorised addition and as a permitted dependant of the Groq smoke; a scan
          // that counted those would make every lock that documents this package an importer of it.
          const code = codeOnly(readFileSync(file, 'utf8'));
          if (code.includes(`from '@qf-jarvis/jarvis-v1-provider-certification-live`)) {
            importers.push(file.replace(/\\/gu, '/').split('/qf-jarvis-jf5b/').pop() ?? file);
          }
        }
      }
    }
    expect([...importers].sort()).toEqual([...ALLOWED].sort());
  });

  it('nothing that starts or serves the application reaches the operator', () => {
    // The other half of the same rule, stated as a property rather than as a list. A file that binds a
    // socket, builds the durable runtime or handles a request may not name this package, whatever the
    // allowlist above happens to say.
    const SERVING = ['/src/bin/', '/src/runtime/', '/src/private-riya-web-ingress/', '/src/server'];
    for (const file of walk(join(repoPath('apps'), 'api', 'src'))) {
      const normalised = file.replace(/\\/gu, '/');
      if (
        !codeOnly(readFileSync(file, 'utf8')).includes(
          `from '@qf-jarvis/jarvis-v1-provider-certification-live`,
        )
      ) {
        continue;
      }
      for (const area of SERVING) {
        // The certification bin is itself under `/src/bin/`, and it is the one file there that starts
        // nothing: it parses argv, composes the operator and exits. Named exactly so the rest of the
        // directory stays closed.
        const isCertificationBin = normalised.endsWith('/bin/run-jf5b-live-certification.ts');
        expect({
          file: normalised.split('/api/').pop(),
          area,
          reached: normalised.includes(area) && !isCertificationBin,
        }).toEqual({
          file: normalised.split('/api/').pop(),
          area,
          reached: false,
        });
      }
    }
  });

  it('implements no business authority and reaches no database', () => {
    for (const file of OPERATOR_SOURCE) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // QuickFurno is scanned as a DEPENDENCY rather than as a word: the preflight summary names it to
      // state that no QuickFurno record is ever sent, and a scan that banned the word would ban the
      // promise as well as the breach.
      for (const importSpecifier of ['quickfurno', 'onedecore', 'one-decore']) {
        expect({
          file: file.split(sep).pop(),
          importSpecifier,
          imported: code.toLowerCase().includes(`from '${importSpecifier}`),
        }).toEqual({ file: file.split(sep).pop(), importSpecifier, imported: false });
      }
      for (const forbidden of [
        'n8n',
        'Pool(',
        'createDatabasePool',
        'migration',
        'INSERT ',
        'UPDATE ',
        ['process', '.env'].join(''),
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });

  it('mints no evidence, no production approval and no active release', () => {
    for (const file of OPERATOR_SOURCE) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        ['create', 'ApprovalEvidence'].join(''),
        ['production', 'Approval'].join(''),
        ['ACTIVE_MODEL', '_RELEASE'].join(''),
        ['activate', 'Release'].join(''),
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });

  it('accepts a credential from no argument, environment or file', () => {
    for (const file of OPERATOR_SOURCE) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        ['process', '.env'].join(''),
        'readFileSync',
        'readFile(',
        '--api-key',
        '--token',
        '--secret',
        'dotenv',
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §31 — CI can never open the live gate.
// ---------------------------------------------------------------------------

describe('JF-5B (31) no test or CI path can open the live gate', () => {
  it('no workflow, script or spec passes the execute-live flag', () => {
    const roots = [
      repoPath('.github'),
      repoPath('packages'),
      repoPath('apps'),
      repoPath('scripts'),
    ];
    // COMPOSED, so this spec does not match itself while saying what it forbids.
    const flag = ['--execute', '-live'].join('');
    // The files ALLOWED to contain the string, each for a reason that is not "it runs a live call":
    //
    //   - `live-execution-gate.ts` DEFINES the constant, and the package manifest's description
    //     explains the gate to a reader. Neither invokes anything.
    //   - the JF-5B CLI must NAME the flag to refuse a run that omits it, and its bin's usage line
    //     must print it so an owner knows what to type. Naming a flag is how a gate says what it wants.
    //   - the CLI's spec passes it, deliberately, to prove the SECOND gate still stops the run: that
    //     spec injects a fake terminal, a fake transport and a fake runner, so the flag opens nothing.
    //     A lock that forbade the spec from passing it would forbid proving the gate works.
    //
    // Two gates, and this lock protects the first. The second -- a phrase typed at a real TTY -- is
    // unreachable from CI by construction: `ConfirmationReader.isInteractive()` is false there, and the
    // CLI stops before any credential. That is asserted in `jf5b-live-cli.test.ts`.
    const allowed = new Set(['live-execution-gate.ts', 'package.json']);
    const APP_ALLOWED: readonly string[] = [
      'apps/api/src/bin/run-jf5b-live-certification.ts',
      'apps/api/src/cli/run-jf5b-live-certification.ts',
      'apps/api/src/tests/jf5b-live-cli.test.ts',
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root, ['.ts', '.yml', '.yaml', '.mjs', '.json', '.sh', '.ps1'])) {
        const name = file.split(sep).pop() ?? '';
        const normalised = file.replace(/\\/gu, '/');
        if (name === 'jf5b-containment.test.ts') {
          continue;
        }
        if (!readFileSync(file, 'utf8').includes(flag)) {
          continue;
        }
        if (allowed.has(name) && file.includes('jarvis-v1-provider-certification-live')) {
          continue;
        }
        if (APP_ALLOWED.some((one) => normalised.endsWith(one))) {
          continue;
        }
        offenders.push(file.split(sep).slice(-2).join('/'));
      }
    }
    // No CI workflow, no script, no other package and no other spec carries it.
    expect(offenders).toEqual([]);

    // And no GitHub workflow carries it at all, allowlist or not.
    for (const file of walk(repoPath('.github'), ['.yml', '.yaml'])) {
      expect({
        file: file.split(sep).pop(),
        flagged: readFileSync(file, 'utf8').includes(flag),
      }).toEqual({ file: file.split(sep).pop(), flagged: false });
    }
  });

  it('no CI workflow names a provider host or a certification credential', () => {
    for (const file of walk(repoPath('.github'), ['.yml', '.yaml'])) {
      const text = readFileSync(file, 'utf8');
      for (const forbidden of [
        'router.bynara.id',
        'api.groq.com',
        'NARA_API_KEY',
        'GROQ_API_KEY',
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: text.includes(forbidden),
        }).toEqual({ file: file.split(sep).pop(), forbidden, present: false });
      }
    }
  });

  it('the operator performs no network call at import time', async () => {
    // The whole design in one assertion: importing the package runs the module bodies, and every one of
    // them is pure or takes an injected seam. If any held a top-level fetch, this would make it.
    const module = await import('../index.js');
    expect(typeof module.parseNaraModelDiscovery).toBe('function');
    expect(typeof module.checkArgvGate).toBe('function');
    // And the gate is closed by default: no flag means no run.
    expect(module.checkArgvGate([])).toBe('execute-live-flag-absent');
  });
});
