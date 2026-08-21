/**
 * QFJ-S2-D-B — containment for the credential process boundary (ADR-0064 §4, §7, §12).
 *
 * This is the slice that first makes `apps/api` capable of holding a real secret, so the envelope is
 * asserted rather than assumed: no environment read, `node:fs` confined to ONE designated adapter, no
 * network, no shell, no terminal, no logger, no timer, no raw-secret fixture — and every `packages/**`
 * API and dependency lock still exactly where S2-C-B left it.
 *
 * Scans read CODE, not documentation: these modules describe what they refuse to do, and a raw-text
 * scan would flag the description as the violation. Every test is offline — file reads and pure
 * functions only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));

function readRepo(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const normalise = (p: string): string => p.replace(/\\/g, '/');

/**
 * Every TypeScript file in apps/api EXCEPT this scanner.
 *
 * This spec necessarily names every string it forbids — `process` `.env`, the staging-smoke package,
 * the protected directory. Scanning itself would flag the prohibition as the violation, which is the
 * recurring false positive in this repository's containment suites. Excluding the scanner keeps the
 * check honest: it still covers all production source and the behavioural spec.
 */
const SCANNER = 'src/tests/credential-containment.test.ts';
const allFiles = (): string[] =>
  walk(join(APP_DIR, 'src')).filter((f) => !normalise(f).endsWith(`/${SCANNER}`));
/** Production source only — the specs are held to their own, narrower rules below. */
const productionFiles = (): string[] => allFiles().filter((f) => !normalise(f).includes('/tests/'));

/**
 * THE two files permitted to import `node:fs`, each with a single narrow job.
 *
 * S2-D-B allowed exactly one, for the CREDENTIAL. S2-E-B adds exactly one more, for the NON-SECRET run
 * configuration and evidence artifact (ADR-0065 §5). They are separate modules deliberately: the
 * credential reader enforces a 514-byte ceiling and POSIX mode bits, the JSON reader does not, and
 * merging them would let a non-secret path inherit secret-file handling or the reverse.
 */
const DESIGNATED_FS_ADAPTERS: readonly string[] = Object.freeze([
  'src/secrets/credential-file-reader.ts',
  'src/shadow/shadow-json-reader.ts',
]);
const isDesignatedAdapter = (f: string): boolean =>
  DESIGNATED_FS_ADAPTERS.some((a) => normalise(f).endsWith(`/${a}`));

/**
 * The files permitted to touch `process` at all, and the exact member each may touch.
 *
 * `process.env` is never in this table: no file in `apps/api` may read the environment (ADR-0064 §7,
 * ADR-0065 §12), asserted separately and unconditionally below.
 */
const PROCESS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // The credential reader asks the platform whether POSIX mode bits are meaningful. Nothing else.
  'src/secrets/credential-file-reader.ts': ['process.platform'],
  // The two bin entries are the ONLY modules that read argv or set an exit code.
  'src/bin/run-shadow-once.ts': ['process.exitCode', 'process.argv'],
  'src/bin/generate-shadow-evidence.ts': ['process.exitCode', 'process.argv'],
  // The default IO factories are the ONLY modules that touch a stream, and only for WRITING.
  'src/cli/run-shadow-once.ts': ['process.stdout'],
  'src/cli/generate-shadow-evidence.ts': ['process.stdout', 'process.stderr'],
});

/** THE one file permitted to arm a timer: the single hard run deadline (ADR-0065 §11). */
const DESIGNATED_TIMER_MODULE = 'src/shadow/create-controlled-shadow-runner.ts';

/**
 * THE one PRODUCTION file permitted to reach a database (QFJ-P08-B3, ADR-0078).
 *
 * QFJ-P08-B2 made a human takeover durable; nothing composed it, so on merged `main` the only
 * authoritative state a real runtime could receive was an in-process fake. This module is that seam.
 * It is named here, singular, so "apps/api can talk to PostgreSQL" stays a decision about one file
 * rather than a property the application quietly acquired.
 */
const DESIGNATED_DATABASE_MODULE = 'src/runtime/durable-jarvis-runtime.ts';
const isDesignatedDatabaseModule = (f: string): boolean =>
  normalise(f).endsWith(`/${DESIGNATED_DATABASE_MODULE}`);

/**
 * The one production file permitted to NAME the durable approval queue (QFJ-P08, ADR-0082).
 *
 * Deliberately a separate list from the one above, and deliberately a weaker permission. The
 * operator boundary never REACHES a database: the queue arrives already built, and this module
 * imports it as a TYPE, which the compiler erases. What it may do is say the word — and the scan
 * below still holds it to every rule the designated database module is held to, plus one more:
 * the import must be `import type`.
 */
const DESIGNATED_QUEUE_TYPE_MODULE = 'src/runtime/approval-operator-service.ts';
const isDesignatedQueueTypeModule = (f: string): boolean =>
  normalise(f).endsWith(`/${DESIGNATED_QUEUE_TYPE_MODULE}`);

/**
 * THE one file permitted to read the environment, and it is TEST-ONLY (QFJ-P08-B3, ADR-0078).
 *
 * The durable composition tests need a real PostgreSQL, which needs a connection string, which has
 * to come from somewhere. It is confined to a single harness that `tsconfig.build.json` excludes
 * from the emitting build, exactly as `@qf-jarvis/postgres-conversation-state` confines its own.
 *
 * PRODUCTION source still reads NOTHING — that rule is unchanged and asserted unconditionally below.
 */
const DESIGNATED_TEST_ENV_MODULE = 'src/tests/durable-database-harness.ts';

function allowlistFor(file: string): readonly string[] {
  const key = Object.keys(PROCESS_ALLOWLIST).find((k) => normalise(file).endsWith(`/${k}`));
  return key === undefined ? [] : (PROCESS_ALLOWLIST[key] ?? []);
}

/**
 * Strip documentation so a containment scan reads CODE.
 *
 * Block comments and whole-line `//` comments go; a trailing comment stays, so nothing on a code line
 * can hide behind one.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('(67) the process boundary reads no environment', () => {
  it('no PRODUCTION file in apps/api touches process.env', () => {
    for (const file of productionFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/process\s*\.\s*env/);
    }
  });

  it('exactly one TEST-ONLY module reads the environment, and only DATABASE_URL', () => {
    const readers = allFiles().filter((file) =>
      /process\s*\.\s*env/.test(readFileSync(file, 'utf8')),
    );
    expect(readers.map((f) => normalise(f).split('/apps/api/')[1] ?? '')).toEqual([
      DESIGNATED_TEST_ENV_MODULE,
    ]);

    // Exactly one read, of exactly one variable. Not a general environment reader.
    const harness = readFileSync(readers[0] ?? '', 'utf8');
    expect(harness.match(/process\s*\.\s*env\s*\[[^\]]*\]/g)).toEqual([
      "process.env['DATABASE_URL']",
    ]);
    expect(harness).not.toMatch(/process\s*\.\s*env\s*\./);

    // And it cannot reach dist: the emitting build excludes the whole test tree.
    expect(readFileSync(join(APP_DIR, 'tsconfig.build.json'), 'utf8')).toContain(
      '"exclude": ["src/tests/**"]',
    );
  });

  it('every `process` access is on the allowlist, and only in its designated file', () => {
    const seen = new Set<string>();
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const allowed = allowlistFor(file);
      for (const raw of code.match(/process\s*\.\s*[A-Za-z]+/g) ?? []) {
        const use = raw.replace(/\s/g, '');
        expect(allowed).toContain(use);
        seen.add(`${normalise(file).split('/src/')[1] ?? ''}:${use}`);
      }
    }
    // Every entry in the allowlist is actually used: a stale permission cannot linger unnoticed.
    const declared = Object.entries(PROCESS_ALLOWLIST).flatMap(([f, uses]) =>
      uses.map((u) => `${f.replace('src/', '')}:${u}`),
    );
    expect([...seen].sort()).toEqual([...declared].sort());
  });

  it('no file reads a stream — argv and exit codes are written, never stdin', () => {
    for (const file of allFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/process\s*\.\s*stdin/);
      expect(code).not.toMatch(/\bprompt\s*\(|setRawMode|createInterface/);
    }
  });
});

describe('(68) node:fs is confined to one designated adapter', () => {
  it('only the designated adapter imports a filesystem module', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      if (isDesignatedAdapter(file)) {
        expect(code).toMatch(/from 'node:fs\/promises'/);
        continue;
      }
      expect(code).not.toMatch(/from ['"]node:fs(\/promises)?['"]/);
    }
  });

  it('the designated adapters exist and are exactly the two declared files', () => {
    expect(productionFiles().filter(isDesignatedAdapter)).toHaveLength(
      DESIGNATED_FS_ADAPTERS.length,
    );
    expect(DESIGNATED_FS_ADAPTERS).toHaveLength(2);
  });

  it('neither adapter writes, deletes or changes a file', () => {
    for (const adapter of productionFiles().filter(isDesignatedAdapter)) {
      const code = codeOnly(readFileSync(adapter, 'utf8'));
      // Read-only by construction: `open` in the default 'r' mode, `lstat`, and nothing else.
      expect(code).toMatch(/import \{ open, lstat \} from 'node:fs\/promises'/);
      for (const mutation of [
        'writeFile',
        'appendFile',
        'unlink',
        'rm(',
        'rmdir',
        'mkdir',
        'rename',
        'chmod',
        'chown',
        'copyFile',
        'createWriteStream',
        'truncate',
      ]) {
        expect(code).not.toContain(mutation);
      }
    }
  });
});

describe('(69, 70) no network, shell, terminal, store, logger, timer or watcher', () => {
  const FORBIDDEN_MODULES =
    /from ['"]node:(net|http|https|dns|tls|dgram|child_process|readline|repl|worker_threads|cluster)['"]/;

  /**
   * The ONE production directory permitted to import `node:http`.
   *
   * ADR-0097's private Riya web ingress is a PROCESS boundary: speaking HTTP and verifying an
   * Ed25519 signature are exactly what it exists to do, and pushing either into a workspace package
   * would make a reusable library environment-dependent. The exception is narrow and stays narrow:
   * the ingress may name `node:http` and `node:crypto`; every other production file in this app may
   * not, and the ingress still may not `fetch`, `exec` or `spawn` -- all asserted below. It also
   * still starts nothing: `private-riya-web-ingress-containment.test.ts` proves no `listen`, no
   * `createServer` and no environment read anywhere in it.
   */
  const INGRESS_DIR = 'src/private-riya-web-ingress/';
  const isIngress = (file: string): boolean => normalise(file).includes(INGRESS_DIR);

  it('production source imports no network, shell or terminal module', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      if (isIngress(file)) {
        expect(code, file).not.toMatch(
          /from ['"]node:(net|https|dns|tls|dgram|child_process|readline|repl|worker_threads|cluster)['"]/,
        );
      } else {
        expect(code, file).not.toMatch(FORBIDDEN_MODULES);
      }
      // The one live HTTP call a SHADOW run makes is issued by the gateway's Groq transport inside
      // `packages/model-gateway`. `apps/api` supplies the credential and the composition; it never
      // opens a socket itself.
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/\bexec\w*\s*\(|\bspawn\w*\s*\(/);
    }
  });

  it('production source contains no clipboard, keychain, cloud-secret or Docker access', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'clipboard',
        'keychain',
        'keytar',
        'secretsmanager',
        'keyvault',
        'secretmanager',
        'dotenv',
        'vault',
        'dockerode',
        // Supabase is the DEPLOYMENT target and is never named in source, B3 included.
        'supabase',
        'groq-sdk',
        'openai',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
      // `postgres` is permitted in EXACTLY TWO modules and forbidden everywhere else: the one that
      // creates a pool (QFJ-P08-B3), and the operator boundary that names the durable queue as a
      // TYPE (QFJ-P08, ADR-0082). The test above proves the second holds no runtime reference.
      if (!isDesignatedDatabaseModule(file) && !isDesignatedQueueTypeModule(file)) {
        expect(code, file).not.toContain('postgres');
      }
    }
  });

  it('exactly two production modules name a database, and neither opens a connection of its own', () => {
    const touching = productionFiles().filter((file) => {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      return (
        code.includes('postgres') ||
        code.includes('event-backbone') ||
        code.includes('conversation-state')
      );
    });
    // An EXACT set, not a superset. QFJ-P08 (ADR-0082) adds the operator boundary, which names the
    // durable approval queue as a TYPE; the seam that actually creates a pool is still exactly one.
    expect(touching.map((f) => normalise(f).split('/apps/api/')[1] ?? '').sort()).toEqual(
      [DESIGNATED_DATABASE_MODULE, DESIGNATED_QUEUE_TYPE_MODULE].sort(),
    );

    // BOTH reach persistence only through public workspace APIs: no `pg` import, no raw pool, no
    // SQL, no migration, no connection string handling, and no HTTP surface.
    for (const file of touching) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const label = normalise(file).split('/apps/api/')[1] ?? '';
      expect(code, label).not.toMatch(/from ['"]pg['"]/);
      expect(code, label).not.toMatch(/\bnew\s+Pool\b/);
      expect(code, label).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/);
      expect(code, label).not.toMatch(/migrat/i);
      expect(code, label).not.toMatch(/connectionString/);
      expect(code, label).not.toMatch(/createServer|express|fastify/i);
    }

    // And the operator boundary names the queue as a TYPE ONLY -- erased at compile time, so it
    // holds no reference to the adapter at runtime and receives one already built.
    const operator = touching.find(isDesignatedQueueTypeModule) ?? '';
    const operatorCode = codeOnly(readFileSync(operator, 'utf8'));
    expect(operatorCode).toMatch(
      /import type \{[\s\S]*?\} from '@qf-jarvis\/postgres-approval-queue';/,
    );
    expect(operatorCode).not.toMatch(
      /^import \{[^}]*\} from '@qf-jarvis\/postgres-approval-queue'/m,
    );
    // It composes; it does not configure. Nothing here builds a pool or reads a database setting.
    expect(operatorCode).not.toMatch(/createDatabasePool|createDatabaseConfig|DATABASE_URL/);
  });

  it('production source creates no watcher or polling loop, and logs nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/setInterval|setImmediate/);
      expect(code).not.toMatch(/watchFile|fs\.watch|\bwatch\s*\(/);
      expect(code).not.toMatch(/console\s*\./);
      // No logging library is imported, and no error is serialised for output.
      expect(code).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
    }
  });

  it('exactly one module arms a timer, and it clears it', () => {
    const timerFiles = productionFiles().filter((file) =>
      codeOnly(readFileSync(file, 'utf8')).includes('setTimeout'),
    );
    expect(timerFiles.map((f) => normalise(f).split('/apps/api/')[1] ?? '')).toEqual([
      DESIGNATED_TIMER_MODULE,
    ]);
    const code = codeOnly(readFileSync(timerFiles[0] ?? '', 'utf8'));
    // One arm, one clear — the single hard deadline, released on every path.
    expect(code.match(/setTimeout/g)).toHaveLength(1);
    expect(code.match(/clearTimeout/g)).toHaveLength(1);
    // Not a repeating or rescheduling timer.
    expect(code).not.toMatch(/setInterval|refresh\s*\(\s*\)/);
  });
});

describe('the staging smoke stays out of the production boundary', () => {
  it('apps/api never imports groq-staging-smoke or the masked-TTY resolver', () => {
    for (const file of allFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain('@qf-jarvis/groq-staging-smoke');
      expect(text).not.toContain('createNodeMaskedSecretSource');
      expect(text).not.toContain('createMaskedTtyCredentialResolver');
    }
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // S2-E-B promotes the composition to a RUNTIME dependency: the controlled SHADOW runner is
    // production source that composes the real gateway (ADR-0065 §6). `zod` is the schema validator
    // already pinned by nine other workspace packages — no new third-party resolution (ADR-0065 §14).
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      // ADR-0097 adds exactly two, both genuinely used by the private ingress: the conversation
      // SERVICE it delegates to, and `agent-runtime` for the closed `RUNTIME_DATA_CLASSES`
      // vocabulary its classification-policy output is validated against. No web framework, and no
      // new third-party resolution.
      '@qf-jarvis/agent-runtime',
      // QFJ-P08 (ADR-0082): the authenticated operator boundary. `contracts` is a real runtime edge
      // -- the service validates an identifier and two instants with the governed schemas -- while
      // `approval-core-adapter` and `postgres-approval-queue` are named as TYPES ONLY, because both
      // are INJECTED. They are declared as production edges because the emitted declarations
      // reference them, not because a line of either executes here. Still an EXACT set match, and
      // still no new third-party resolution.
      '@qf-jarvis/approval-core-adapter',
      '@qf-jarvis/contracts',
      // QFJ-P08-B3 (ADR-0078): the three -- and only three -- new production edges the durable
      // composition needs, to create a pool, build the durable adapter, and compose the runtime.
      '@qf-jarvis/event-backbone',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/model-gateway-composition',
      '@qf-jarvis/postgres-approval-queue',
      '@qf-jarvis/postgres-conversation-state',
      // QFJ-S3-I-B (ADR-0073): the SHADOW runner's fixed synthetic prompt is now a real
      // `PromptDefinition`, so its identity and its bytes cannot drift apart. Still an EXACT set.
      '@qf-jarvis/prompt-registry',
      '@qf-jarvis/riya-web-conversation-service',
      'zod',
    ]);
    // QFJ-P08-B3: dev dependencies exist now, and are EXACTLY the test-only fixture packages the
    // proofs need. An EXACT set, not merely a superset. QFJ-P08 (ADR-0082) adds two: the operator
    // boundary's specs build a REAL governed recommendation and a REAL approval request rather than
    // hand-assembling fixtures, which would prove only that the service agrees with a fixture.
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/approval-runtime',
      '@qf-jarvis/conversation-control',
      '@qf-jarvis/core-decision-adapter',
      '@qf-jarvis/model-reply-adapter',
      '@qf-jarvis/recommendation-runtime',
    ]);
    // `pg` is absent from BOTH lists: the app composes a pool through event-backbone's public API
    // and never touches the driver.
    expect(manifest.dependencies?.['pg']).toBeUndefined();
    expect(manifest.devDependencies?.['pg']).toBeUndefined();
    expect(manifest.dependencies?.['zod']).toBe('4.4.3');
  });

  it('the composition is reached only through its declared entry points', () => {
    // Production source may import the composition root and the ONE internal subpath ADR-0065 §5
    // authorises. A deep `dist/` or `src/` reach-around would bypass the package boundary.
    const ALLOWED = new Set([
      '@qf-jarvis/model-gateway-composition',
      '@qf-jarvis/model-gateway-composition/internal/evidence-registry',
    ]);
    for (const file of allFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const specifier of text.match(/@qf-jarvis\/[a-z-]+(?:\/[A-Za-z0-9/_.-]+)?/g) ?? []) {
        if (!specifier.startsWith('@qf-jarvis/model-gateway-composition')) {
          continue;
        }
        expect(ALLOWED.has(specifier)).toBe(true);
      }
      expect(text).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src)\//);
    }
  });
});

describe('no raw-secret fixture is committed', () => {
  it('every credential-shaped literal is an unmistakable synthetic fake', () => {
    for (const file of allFiles()) {
      const text = readFileSync(file, 'utf8');
      // A real Groq key is `gsk_` followed by a long opaque run. Nothing of that shape may exist.
      expect(text).not.toMatch(/gsk_[A-Za-z0-9]{8,}/);
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      // Any fixture that looks like a credential must announce itself.
      // Only a credential-LENGTH literal must announce itself; a short probe like a bare prefix used
      // to assert ABSENCE is not credential-shaped and needs no marker.
      for (const literal of text.match(/'FAKE[A-Z0-9_]{20,}'/g) ?? []) {
        expect(literal).toContain('DO_NOT_USE');
      }
    }
  });

  it('no source file carries a literal control byte', () => {
    // Built numerically so this assertion does not itself contain one.
    // eslint-disable-next-line no-control-regex -- detecting control bytes IS this scan's purpose.
    const control = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f]');
    for (const file of allFiles()) {
      expect(control.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});

describe('(71-77) package API and dependency locks are untouched', () => {
  it('(71, 72) leaf package dependencies are unchanged', () => {
    for (const pkg of ['model-gateway', 'model-evaluation']) {
      const manifest = JSON.parse(readRepo(`packages/${pkg}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    }
    const composition = JSON.parse(readRepo('packages/model-gateway-composition/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(composition.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/model-reply-adapter',
    ]);
  });

  it('(73-77) every package-root runtime API count is unchanged', async () => {
    const expected: Readonly<Record<string, number>> = {
      'model-evaluation': 35,
      // MVP-P2A.2 HF4-R7: 71 -> 74. The Groq strict-schema projection —
      // `projectGroqStrictJsonSchema`, `renderStructuredJsonSchema`, `GROQ_STRICT_PROJECTION_REASONS`.
      // RUN S9's nine ordinary safety requests were rejected HTTP 400 because the raw Zod rendering
      // forwarded keywords Groq's strict documentation does not establish. Pure functions and a closed
      // vocabulary over a JSON Schema document: no credential, no transport, no configuration.
      // POST-MD120B3: 74 -> 77. The DIAGNOSTIC-ONLY Groq Responses API surface —
      // `GROQ_RESPONSES_ENDPOINT`, `createFetchGroqResponsesTransport`,
      // `createGroqResponsesDiagnosticProvider`. MD120B3 reproduced the strict Chat Completions
      // rejection across BOTH governed GPT-OSS models, so the next diagnostic moves the OUTPUT
      // CONTRACT. Nothing registers a provider, declares a capability or joins the routing table;
      // the serving path stays Chat Completions and a spec proves no production composition builds
      // either factory.
      'model-gateway': 77,
      'model-gateway-composition': 2,
      // MVP-P2A.2 HF1: 24 -> 27. The semantic approval-digest helper and its two readable parts.
      // Pure functions over an already-parsed SmokeConfig -- no filesystem, no clock, no network, no
      // credential.
      // MVP-P2A.2 HF4-R4: 27 -> 28. `createSystemSmokeWireDeps`, the ONE pairing of the instrumented
      // transport with the recorder that owns its wire milestones. RUN S5's smoke PASSED while
      // printing every wire milestone ABSENT because that pairing was a convention duplicated across
      // two composition roots and the second one got it wrong. It exposes no internals, reads no
      // environment, holds no credential, and changes no request, timer or retry semantic.
      // Restated exactly; the count is still pinned.
      // MVP-P2A.2 HF4-R5: 28 -> 30. `createClipboardCredentialResolver` and
      // `createWindowsPowerShellClipboardSource`, the one-shot Windows clipboard credential ingress
      // the owner asked for so the credential is copied once instead of typed twice. Both are needed
      // by the candidate evidence operator, which is the composition root that selects an ingress;
      // the helper program, its arguments, its exit codes and its output bound stay module-private.
      // Restated exactly; the count is still pinned.
      'groq-staging-smoke': 30,
      'event-backbone': 39,
      // QFJ-S3-D-A (ADR-0070): the new Anisha behaviour package, locked from the day it lands.
      'anisha-agent': 14,
      // QFJ-S3-I-A (ADR-0072): the prompt registry foundation, locked from the day it lands.
      'prompt-registry': 7,
      // QFJ-P08-A (ADR-0074): the conversation control foundation, locked from the day it lands.
      'conversation-control': 9,
      // QFJ-P08-B2 (ADR-0077): the durable adapter, locked from the day it lands.
      'postgres-conversation-state': 3,
      // QFJ-P05.05 (ADR-0079): the governed recommendation runtime, locked from the day it lands.
      'recommendation-runtime': 4,
      // QFJ-P08 (ADR-0080): the approval runtime foundation, locked from the day it lands.
      'approval-runtime': 3,
      // QFJ-P08 (ADR-0081): the durable approval queue, locked from the day it lands.
      'postgres-approval-queue': 3,
      // QFJ-P08 (ADR-0082): the Core approval submission adapter, locked from the day it lands.
      'approval-core-adapter': 3,
      // QFJ-P08 (ADR-0083): the communication authorization correlation runtime, locked from the
      // day it lands.
      'communication-authorization-runtime': 3,
      // QFJ-P09.01 (ADR-0084): the execution intent correlation runtime, locked from the day it
      // lands. It validates Core's intent; it issues none.
      'execution-intent-runtime': 3,
      // QFJ-P09.02 (ADR-0090): the test-only Core -> n8n execution dispatch boundary, locked from
      // the day it lands. Seven root symbols: the verifier, the key registry and its two error
      // types, the closed reason set, and the two protocol constants that make the B4 domain and
      // key purpose distinct from event ingestion. No transport, no fake and no bridge is exported.
      'execution-dispatch-runtime': 7,
      // RWC-P2A (ADR-0093): Riya's conversational continuity contract, locked from the day it
      // lands. Five root symbols: the two frozen vocabularies, the constructor, the closed
      // error-code set and the error class. The schemas, the provenance precedence ranks and the
      // discovery-field mapping are internal -- exporting the ranks would be exporting the first
      // half of the merge RWC-P4 owns.
      'riya-conversation-continuity': 5,
      // RWC-P2C (ADR-0094): the private Riya web conversation service, locked from the day it
      // lands. Four root symbols: the factory, the closed disposition set, the closed error-code
      // set and the error class. The turn schema, the envelope builder, the outcome mapper and the
      // in-memory store fake are all internal or test-only.
      //
      // RWC-P6B (ADR-0102): 4 -> 7. A SECOND capability lives in the same package now -- the
      // structured-action service -- and it adds exactly three: its factory and its two closed
      // vocabularies. The four action schemas, the deterministic idempotency-key helper and the
      // discovery projection stay internal, and the first of those matters most: a caller able to
      // derive a submission key could submit under one the service never checked.
      //
      // RWC-P8 (ADR-0104): 7 -> 9. The channel-neutral surface adds exactly two runtime values --
      // the closed channel vocabulary and the closed begin-outcome vocabulary. The channel turn
      // schema, the channel result and the coordinator port are TYPES; the port has no
      // implementation in this package at all, and `createRiyaWebConversationService` remains the
      // ONE factory. `handleTurn` and `RiyaWebConversationResultV2` are unchanged.
      //
      // RWC-P9 (ADR-0105): 9 -> 11, and both additions are OBSERVABILITY -- the closed operational
      // event vocabulary and its no-op default. The admission gate itself is deliberately NOT here:
      // `maxConcurrentTextTurns` is configuration, and the gate, its counter and its release token
      // stay internal, because a caller able to reach the gate could hand this process capacity it
      // does not have.
      'riya-web-conversation-service': 11,
      // QFJ-P09.03 (ADR-0091): the durable execution replay / idempotency store, locked from the
      // day it lands. Three root symbols: the factory, the closed error-code set and the error
      // class. The SQL, the table name, the input validator, the error classifier and the pool are
      // all internal, and the returned object is exactly an ExecutionReplayGuard -- one method.
      'postgres-execution-replay-store': 3,
      // JOS-01B (ADR-0086): the read-only control-plane snapshot contract, locked from the day it
      // lands. A version constant, an error-code list, one error class and one parse function --
      // the schemas are deliberately NOT exported, so every payload goes through one entry point.
      'control-plane-read-contract': 4,
      // QFJ-P08-A (ADR-0075): agent-runtime 45 -> 46 (the operations snapshot constructor) and
      // jarvis-runtime unchanged at 6. Both are named here so the composition phase that touched
      // them is locked centrally, not only in their own packages.
      'agent-runtime': 46,
      'jarvis-runtime': 6,
    };
    for (const [pkg, count] of Object.entries(expected)) {
      const barrel = (await import(
        `../../../../packages/${pkg}/dist/index.js`
      )) as unknown as Record<string, unknown>;
      expect(Object.keys(barrel)).toHaveLength(count);
    }
    // Nineteen real dynamic imports of built bundles, each pulling its own module graph. This
    // takes over four seconds on its own against the 5s default, so it was already one busy
    // machine away from a timeout that says nothing about the API counts it exists to lock.
    // Given an explicit budget rather than left to lose a race with whatever runs beside it.
  }, 30_000);

  it('apps/api adds no package-root runtime export of its own', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(0);
  });
});

describe('(78, 79, 80, 81) repository invariants', () => {
  it('(78, 79) migrations 0001-0012 are byte-identical and 0013 is absent', () => {
    const LOCKED: Record<string, string> = {
      '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
      '0002_event_runtime_grants.sql':
        '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
      '0003_ingestion_rejection_and_event_conflict.sql':
        '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
      '0004_projection_foundation.sql':
        '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
      '0005_projection_event_positions.sql':
        '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
      '0006_projection_failure_operations.sql':
        'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
      '0007_subject_activity_projection.sql':
        '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
      '0008_conversation_control_persistence.sql':
        'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
      '0009_durable_approval_queue.sql':
        'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
      '0010_execution_replay_claim.sql':
        '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
      '0011_riya_conversation_continuity.sql':
        '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
      // RWC-P8 (ADR-0104): the ONE authorized addition. Durable logical-turn idempotency, sitting
      // BELOW the ingress transport replay guard rather than replacing it. Repository and
      // LOCAL/CI only; nothing is applied to a managed database.
      '0012_riya_logical_turn_idempotency.sql':
        '5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e',
    };
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED));
    for (const [name, hash] of Object.entries(LOCKED)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((name) => name.startsWith('0013'))).toBe(false);
  });

  it('(80) no source references the protected reconciliation directory', () => {
    for (const file of allFiles()) {
      expect(readFileSync(file, 'utf8')).not.toContain('qfj-managed-reconciliation');
    }
  });

  it('(81) the specs import nothing database-, container- or network-capable', () => {
    const dir = join(APP_DIR, 'src', 'tests');
    const specs = readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(specs.length).toBeGreaterThan(0);
    /**
     * The ONE spec permitted to spawn a process, and only `node:child_process`.
     *
     * `deployment-containment.test.ts` proves the merged-main deployment guard by RUNNING it: a
     * guard deciding whether unreviewed code can reach production is worth executing against real
     * commits — including a real unmerged one — rather than pattern-matching its source.
     *
     * The exception is narrow on purpose. It buys process spawning and nothing else: the network
     * modules below stay forbidden for this spec too, and its fixture is a throwaway git repository
     * whose `origin` is a local bare repo, so it reaches no network even while exercising a code
     * path that fetches. Every other spec remains fully hermetic.
     */
    const PROCESS_CAPABLE = 'deployment-containment.test.ts';

    /**
     * The ONE spec permitted to import `node:http`, and only that.
     *
     * The ADR-0097 ingress spec runs the REAL handler behind a real ephemeral loopback server. A
     * hand-rolled `IncomingMessage` double would prove the function works on the object the test
     * built; chunked bodies, duplicated headers, byte-exact signatures, status codes and response
     * headers are properties of HTTP, so HTTP is what they are proved against. It reaches no
     * network: the server binds 127.0.0.1 on an ephemeral port and is closed after each case, and
     * the only `fetch` in the file targets that loopback server. Every other network module stays
     * forbidden for it.
     */
    const LOOPBACK_HTTP_CAPABLE = 'private-riya-web-ingress.test.ts';

    for (const name of specs) {
      const text = readFileSync(join(dir, name), 'utf8');
      // Anchored to line starts: unanchored, `import` also matches `import.meta.url`.
      const statements = text.match(/^import[\s\S]*?from\s*['"][^'"]+['"]/gm) ?? [];
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        if (name === PROCESS_CAPABLE) {
          expect(statement, name).not.toMatch(/node:(net|http|https|dns|tls|dgram)/);
        } else if (name === LOOPBACK_HTTP_CAPABLE) {
          expect(statement, name).not.toMatch(/node:(net|https|dns|tls|dgram|child_process)/);
        } else {
          expect(statement, name).not.toMatch(/node:(net|http|https|dns|tls|dgram|child_process)/);
        }
        if (statement.startsWith('import type')) {
          // A TYPE import is erased: it grants a spec no capability at all, only a name for a shape
          // it must build a fake of. QFJ-P08 (ADR-0082): the operator spec names the durable queue's
          // result types so its fake cannot drift from the real contract. `pg` itself is still
          // forbidden here -- a driver type would mean the spec was reasoning about rows.
          expect(statement, name).not.toMatch(/from ['"]pg['"]/);
          expect(statement, name).not.toMatch(/\b(supabase|dockerode|groq-sdk|openai)\b/);
          continue;
        }
        expect(statement).not.toMatch(/\b(pg|postgres|supabase|dockerode|groq-sdk|openai)\b/);
      }
      if (name !== LOOPBACK_HTTP_CAPABLE) {
        expect(text, name).not.toMatch(/\bfetch\s*\(/);
      }
    }
  });
});
