/**
 * What this operator cannot reach.
 *
 * It is the one package allowed to depend on both evaluation and execution, which makes it the one
 * package where "just import the runtime for a moment" would be easiest and worst. So the absences
 * are asserted rather than trusted: no serving composition, no rollout, no database, no transport of
 * its own, and no way for anything else to compose it.
 *
 * Scans read source with comments stripped, because this package documents at length the things it
 * refuses to be and scanning the prose would report every prohibition as a violation. The importer
 * firewall reads RAW source, where a false negative is the expensive direction.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

/**
 * Production source: everything under `src/` except the specs and the explicitly test-only surface.
 *
 * `src/testing/` is excluded because it is not shipped behaviour — it exists so a spec can drive a
 * synthetic configuration, and a separate assertion proves no production module imports it.
 */
const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true)
    .filter((file) => !file.split(sep).includes('testing'))
    .map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

describe('the operator implements no transport and holds no secret ingress', () => {
  it('WRITES NO HTTP OF ITS OWN', () => {
    // The existing Groq transport is imported by NAME and used; nothing here speaks the wire.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'axios',
        'node:http',
        'node:https',
        'undici',
        'XMLHttpRequest',
        'api.groq.com',
        'Authorization',
        'Bearer ',
        'groq-sdk',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      // `fetch(` never appears; only the existing factory is referenced.
      expect(code, `${file} must not call fetch directly`).not.toMatch(/[^a-zA-Z]fetch\(/u);
      // `openai` appears ONLY inside a governed identifier — the Groq catalogue model id
      // `openai/gpt-oss-20b` and the capability ref that names it — never as an SDK import. Scoped
      // by line rather than banned outright, because both are the real identities under evaluation.
      for (const line of code.split(String.fromCharCode(10))) {
        if (!line.includes('openai')) {
          continue;
        }
        const governed =
          line.includes('openai/gpt-oss-20b') || line.includes('cap.groq.openai-gpt-oss-20b');
        expect(governed, `${file} may name openai only in a governed identifier`).toBe(true);
      }
    }
  });

  it('reads no environment and loads no .env', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['process.env', 'dotenv', '.env', 'process.argv[']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('THE GOVERNED SMOKE DIGEST IS NOT OVERRIDABLE FROM PRODUCTION', () => {
    // The override used to sit on `PreflightInput`, which made the lock advisory for anybody holding
    // the production contract. It is gone: `runPreflight` always passes the governed constant, and
    // the only other caller is a file named for being test-only.
    const preflight = readFileSync(join(SRC, 'preflight.ts'), 'utf8');
    expect(preflight).not.toContain('expectedSmokeConfigDigest');
    expect(preflight).toContain('return preflightCore(input, EXPECTED_SMOKE_CONFIG_DIGEST);');

    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).not.toContain('preflightCore');
    expect(cli).not.toContain('preflightOverrideForTesting');
    expect(cli).not.toContain('runPreflightForTesting');
  });

  it('NO PRODUCTION MODULE IMPORTS THE TEST-ONLY PREFLIGHT SEAM', () => {
    // If anything that ships could reach it, the digest lock would be one import away from being
    // decorative again.
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not import the testing preflight`).not.toContain(
        'preflight-testing',
      );
      expect(code, `${file} must not name runPreflightForTesting`).not.toContain(
        'runPreflightForTesting',
      );
    }
  });

  it('the CLI constructs no secret source before preflight has passed', () => {
    // The TTY fact is read from the process. Constructing a masked source merely to ask
    // `isInteractive()` would mean a secret source existed before the check that protects it.
    // Imports say nothing about order, so the import block is dropped and only CALLS are compared.
    // Every construction must sit after the operator call begins -- i.e. inside one of the lazily
    // invoked credential callbacks, which the operator only reaches once preflight has passed.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    const body = cli.slice(cli.indexOf('async function main'));
    const operatorAt = body.indexOf('runCandidateEvidenceOperator(');
    expect(operatorAt).toBeGreaterThan(0);
    let cursor = body.indexOf('createNodeMaskedSecretSource(');
    expect(cursor).toBeGreaterThan(0);
    while (cursor !== -1) {
      expect(cursor, 'a secret source is constructed before preflight').toBeGreaterThan(operatorAt);
      cursor = body.indexOf('createNodeMaskedSecretSource(', cursor + 1);
    }
  });

  it('the candidate credential goes through the existing masked resolver', () => {
    // Not a bare `readOnce`: the resolver owns the bounds, the charset and the one-shot guarantee.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).toContain('createMaskedTtyCredentialResolver');
    expect(cli).not.toContain('readOnce');
  });

  it('never fabricates an evaluation binding for the candidate turn', () => {
    // Both must be ABSENT while evidence does not exist. One without the other is a wiring error the
    // adapter refuses, so neither may appear in the turn composition.
    const turn = codeOnly(readFileSync(join(SRC, 'riya-turn.ts'), 'utf8'));
    expect(turn).not.toContain('evaluationRef');
    expect(turn).not.toContain('evaluationPromptDigest');
  });
});

describe('the operator cannot serve, activate or persist', () => {
  it('composes no serving runtime and no production gateway', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'jarvis-runtime',
        'createJarvisRuntime',
        'riya-web-conversation-service',
        'createProductionModelGateway',
        'riya-agent',
        'anisha-agent',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('CREATES AND MUTATES NO ROLLOUT', () => {
    // The evaluation gateway runs ACTIVE inside one short-lived process. That is an execution mode,
    // not a rollout: there is no controller, no policy, no attestation and no transition anywhere.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'rolloutController',
        'createProviderRolloutController',
        'createProviderRolloutPolicy',
        'createRolloutApprovalAttestation',
        'ROLLOUT_SERVE_TARGETS',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('touches no database, migration or business mutation seam', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'postgres',
        'supabase',
        'migration',
        'whatsapp',
        'n8n',
        'core-decision-adapter',
        'approval-runtime',
        'execution-dispatch',
        'riya-intelligence-dataset',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(12);
    expect(migrations.some((name) => name.startsWith('0013'))).toBe(false);
  });
});

describe('the governed knowledge seam is the public one', () => {
  it('imports the package root, never an internal path', () => {
    for (const { file, code } of productionFiles()) {
      expect(code, file).not.toMatch(/@qf-jarvis\/governed-knowledge\/[a-z]/u);
      expect(code, file).not.toContain('governed-knowledge/src');
    }
    const admission = readFileSync(join(SRC, 'governed-grounded-input.ts'), 'utf8');
    expect(admission).toContain("from '@qf-jarvis/governed-knowledge'");
  });
});

describe('nothing composes the operator', () => {
  it('NO PACKAGE OR APP IMPORTS THIS LEAF', () => {
    // RAW source at an import firewall. An operator that could be composed could be started, and the
    // whole point of a leaf is that the arrow only points one way.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-candidate-evidence-live') continue;
        // The bridge's own containment spec names this package in prose; its dependency list is
        // pinned exactly by that spec, so a real import there is already impossible.
        // The smoke package names this specifier inside its own dependency-lock spec, and that same
        // spec pins its dependencies exactly -- so a real import from there is already impossible.
        if (entry === 'groq-staging-smoke') continue;
        if (entry === 'riya-candidate-evaluation-runner') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-candidate-evidence-live')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });

  it('declares exactly the dependencies it composes', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/core-service-availability-read',
      '@qf-jarvis/governed-knowledge',
      '@qf-jarvis/groq-staging-smoke',
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/model-gateway-composition',
      '@qf-jarvis/model-reply-adapter',
      '@qf-jarvis/riya-candidate-evaluation-runner',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      '@qf-jarvis/riya-model-interaction',
      '@qf-jarvis/riya-prompts',
      '@qf-jarvis/riya-quality-evaluation',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
  });

  it('names no Human Gold corpus and no benchmark package', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['gold-v1', 'HUMAN_AUTHORED', 'riya-model-benchmark']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
