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
      // `openai` appears ONLY inside a governed identifier — never as an SDK import. Scoped by line
      // rather than banned outright, because these are the real identities under evaluation.
      //
      // POST-NRA1 the allowlist gains `openai/gpt-oss-120b`, the DIAGNOSTIC-ONLY model the strict
      // model differential sends. It is listed deliberately: the guard exists so a new provider model
      // id cannot enter this package without somebody deciding it should, and that decision is this
      // line. Production routing still uses the 20B id, which a separate spec pins.
      for (const line of code.split(String.fromCharCode(10))) {
        if (!line.includes('openai')) {
          continue;
        }
        const governed =
          line.includes('openai/gpt-oss-20b') ||
          line.includes('openai/gpt-oss-120b') ||
          line.includes('cap.groq.openai-gpt-oss-20b');
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

  it('THE PRODUCTION OPERATOR EXPOSES NO PREFLIGHT OVERRIDE', () => {
    // Two earlier attempts put a seam on a production contract: a digest field on `PreflightInput`,
    // then a whole-preflight callback on `OperatorDeps`. Both were reachable by any caller holding
    // the public API, which is the opposite of a lock. Neither exists now.
    const operator = readFileSync(join(SRC, 'operator.ts'), 'utf8');
    expect(operator).not.toContain('preflightOverrideForTesting');
    expect(operator).not.toContain('expectedSmokeConfigDigest');
    // The call is direct, with no `??` fallback to anything injectable.
    expect(codeOnly(operator)).toContain('runPreflight(deps.preflight)');

    const root = readFileSync(join(SRC, 'index.ts'), 'utf8');
    expect(root).not.toContain('preflightCore');
    expect(root).not.toContain('runPreflightForTesting');
    expect(root).not.toContain('preflightOverrideForTesting');
  });

  it('THE PARAMETERISED CORE IS INTERNAL AND UNREACHABLE BY SUBPATH', () => {
    // `preflightCore` takes an expected digest, so it must not be part of the public surface. The
    // package exposes only ".", which closes the deep-import route as well.
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);

    // Only `runPreflight` calls it in production.
    const callers = productionFiles().filter(({ code }) => code.includes('preflightCore('));
    expect(callers.map(({ file }) => file.split(sep).slice(-2).join('/')).sort()).toStrictEqual([
      'internal/preflight-core.ts',
      'src/preflight.ts',
    ]);
  });

  it('THE OBSOLETE EARLY-DISPATCH CANCELLATION INVOKER IS GONE', () => {
    // It fired its "admitted" callback right after `gateway.invoke` returned a promise, which proved
    // dispatch rather than provider entry. Leaving it beside the transport-boundary path would mean
    // two competing cancellation semantics and one of them wrong.
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not name createCancellationInvoker`).not.toContain(
        'createCancellationInvoker',
      );
    }
    expect(readFileSync(join(SRC, 'index.ts'), 'utf8')).not.toContain('createCancellationInvoker');
  });

  it('THE GOVERNED SMOKE DIGEST IS NOT OVERRIDABLE FROM PRODUCTION', () => {
    // The override used to sit on `PreflightInput`, which made the lock advisory for anybody holding
    // the production contract. It is gone: `runPreflight` always passes the governed constant, and
    // the only other caller is a file named for being test-only.
    const preflight = readFileSync(join(SRC, 'preflight.ts'), 'utf8');
    expect(preflight).not.toContain('expectedSmokeConfigDigest');
    expect(preflight).toContain('return preflightCore(input, EXPECTED_SMOKE_CONFIG_DIGEST);');
    // `runPreflight` takes exactly one parameter: there is nowhere to pass another digest.
    expect(preflight).toContain('export function runPreflight(input: PreflightInput)');

    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).not.toContain('preflightCore');
    expect(cli).not.toContain('preflightOverrideForTesting');
    expect(cli).not.toContain('runPreflightForTesting');
  });

  it('NO PRODUCTION MODULE IMPORTS A TEST-ONLY HELPER', () => {
    // Both helpers -- the preflight seam and the contract-response factory -- live under
    // `src/tests/helpers/`, which the emitting build excludes. If production could reach either, the
    // digest lock would be one import away from decorative and the response factory would be one
    // import away from becoming candidate logic.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'preflight-testing',
        'contract-valid-riya-response',
        'runPreflightForTesting',
        'tests/helpers',
      ]) {
        expect(code, `${file} must not reach ${forbidden}`).not.toContain(forbidden);
      }
    }
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
      expect(code, `${file} must not reach into tests/helpers`).not.toContain('tests/helpers');
    }
  });

  it('the CLI constructs no secret source before preflight has passed', () => {
    // The TTY fact is read from the process. Constructing a masked source merely to ask
    // `isInteractive()` would mean a secret source existed before the check that protects it.
    // Imports say nothing about order, so the import block is dropped and only CALLS are compared.
    // Every construction must sit after the operator call begins -- i.e. inside one of the lazily
    // invoked credential callbacks, which the operator only reaches once preflight has passed.
    //
    // HF4-R5 moved both ingress factories behind `createCredentialComposition`, which IS built before
    // the operator call — and constructs nothing when it is. So the property is now proved
    // STRUCTURALLY rather than positionally: every construction site must sit inside an arrow that
    // only the operator's lazily-invoked credential callbacks reach. That is a stronger claim than
    // the old index comparison, which a lambda defined early would have satisfied anyway.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    const body = cli.slice(cli.indexOf('async function main'));
    expect(body.indexOf('runCandidateEvidenceOperator(')).toBeGreaterThan(0);
    for (const factory of [
      'createNodeMaskedSecretSource',
      'createWindowsPowerShellClipboardSource',
    ]) {
      const constructions = body.match(new RegExp(`${factory}\\(`, 'g')) ?? [];
      const lazy = body.match(new RegExp(`\\(\\)\\s*=>\\s*${factory}\\(`, 'g')) ?? [];
      expect(constructions.length, `${factory} must be constructed in main()`).toBeGreaterThan(0);
      expect(lazy.length, `${factory} is constructed eagerly, before preflight`).toBe(
        constructions.length,
      );
    }
  });

  it('the candidate credential goes through the existing bounded resolvers', () => {
    // Not a bare `readOnce`: a resolver owns the bounds, the charset and the one-shot guarantee, and
    // HF4-R5 kept that true for BOTH ingresses by sharing one predicate rather than adding a second
    // credential policy. The wiring moved out of `bin.ts` into the composition module so a spec could
    // reach it; neither file may reach past a resolver to a raw read.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    const composition = codeOnly(readFileSync(join(SRC, 'credential-composition.ts'), 'utf8'));
    expect(composition).toContain('createMaskedTtyCredentialResolver');
    expect(composition).toContain('createClipboardCredentialResolver');
    expect(cli).not.toContain('readOnce');
    expect(composition).not.toContain('readOnce');
    // And neither one reimplements the acceptance rule it is supposed to be delegating to.
    for (const source of [cli, composition]) {
      expect(source).not.toContain('MIN_CREDENTIAL_LENGTH');
      expect(source).not.toContain('MAX_CREDENTIAL_LENGTH');
      expect(source).not.toMatch(/A-Za-z0-9/);
    }
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

  it('THE EVALUATION GATEWAY IS CONSTRUCTED WITH THE DECLARED POSTURE', () => {
    // A mutation campaign found this gap: `CANDIDATE_ALLOW_FALLBACK` was asserted as a constant, but
    // nothing checked the value the gateway is ACTUALLY built with. Flipping `allowFallback` in the
    // composition passed every test. The posture is a property of the construction, so the
    // construction is what gets pinned.
    const gateway = codeOnly(readFileSync(join(SRC, 'evaluation-gateway.ts'), 'utf8'));
    expect(gateway).toContain('allowFallback: false');
    expect(gateway).not.toContain('allowFallback: true');
    // Exactly one provider, named inline. A second would make a case answerable by a model nobody
    // is evaluating.
    expect(gateway).toContain('providers: [new GroqModelProvider(config, clock)]');
    expect(gateway).toContain("mode: 'ACTIVE'");
    // The optional gateway seams that would turn this into something governed by a rollout.
    for (const forbidden of ['rolloutController:', 'routingProfile:', 'evidenceVerifier:']) {
      expect(gateway, `evaluation gateway must not configure ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('EVERY CANDIDATE REQUEST CARRIES A ZERO RETRY BUDGET', () => {
    // Same class of gap: the constant said zero while nothing checked the request the adapter is
    // actually configured with.
    const turn = codeOnly(readFileSync(join(SRC, 'riya-turn.ts'), 'utf8'));
    expect(turn).toContain('retryBudget: 0');
    // POST-S11: the same request object now also carries the derived COMPLETION budget, so the
    // Groq provider stops putting its configured model ceiling on the wire for every turn. Asserted
    // here beside the retry lock because both are properties of the one request the adapter builds.
    expect(turn).toContain('completionBudget: RIYA_COMPLETION_BUDGET_TOKENS');
    // And no retry crept in beside it.
    expect(turn).not.toMatch(/retryBudget:\s*[1-9]/u);
    expect(turn).not.toMatch(/retryBudget:[ ]*[1-9]/u);
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

describe('HF4-R4 — the transport observer is wired, passive, and off the package root', () => {
  it('BOTH candidate gateways are built over the OBSERVED transport, and share one recorder', () => {
    // A recorder wired into one gateway and not the other would leave whichever half it missed
    // reporting NOT_REACHED for every case — indistinguishable, on the terminal, from a run that
    // never sent anything. One recorder, both gateways, asserted at the composition root.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).toContain('createCandidateTransportObservations()');
    expect(cli.match(/createCandidateTransportObservations\(\)/gu)).toHaveLength(1);
    expect(cli).toContain('transport: observations.observe(createFetchGroqTransport())');
    expect(cli).toContain('observations.observe(');
    expect(cli.match(/observations\.observe\(/gu)).toHaveLength(2);
    expect(cli).toContain('transportObservations: observations');
    // A gateway constructed WITHOUT a transport would fall back to the bare fetch transport and be
    // invisible to the observer.
    expect(cli).not.toMatch(/createCandidateGateway\(\{\s*apiKey\s*\}\)/u);
  });

  it('THE SMOKE RUNS OVER THE INSTRUMENTED TRANSPORT AND ITS OWN RECORDER', () => {
    // RUN S5's smoke PASSED and printed every wire milestone ABSENT because this call site handed
    // the harness a plain transport and no recorder. The pairing now comes from the smoke package as
    // one value, so it cannot be half-composed here again.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).toContain('createSystemSmokeWireDeps()');
    expect(cli).not.toMatch(/transport:\s*createFetchGroqTransport\(\),\s*\n\s*credentialSource/u);
  });

  it('THE OBSERVER IS PASSIVE — it writes no request, no retry and no fallback', () => {
    const observer = codeOnly(
      readFileSync(join(SRC, 'candidate-transport-observation.ts'), 'utf8'),
    );
    for (const forbidden of ['retry', 'fallback', 'setTimeout', 'AbortController', '.abort(']) {
      expect(observer, `the observer must not name ${forbidden}`).not.toContain(forbidden);
    }
    // The response is returned and the error is rethrown, both unchanged.
    expect(observer).toContain('return response;');
    expect(observer).toContain('throw error;');
  });

  it('the R4 diagnostic surface stays OFF the package root — export delta is zero', () => {
    const root = codeOnly(readFileSync(join(SRC, 'index.ts'), 'utf8'));
    for (const internal of [
      'candidate-transport-observation.js',
      'execution-health.js',
      'createCandidateTransportObservations',
      'CANDIDATE_PROVIDER_HTTP_CLASSES',
      'CANDIDATE_PROVIDER_ERROR_TYPES',
      'CANDIDATE_PROVIDER_ERROR_CODES',
      'summariseExecutionHealth',
      'emitExecutionDiagnostics',
    ]) {
      expect(root, `${internal} must not be root-exported`).not.toContain(internal);
    }
  });
});

describe('HF3 — the run goal narrows, and can never widen', () => {
  const operatorCode = (): string => codeOnly(readFileSync(join(SRC, 'operator.ts'), 'utf8'));

  it('THE SAFETY AUTHORITY IS STILL THE ONLY SOURCE OF ELIGIBILITY', () => {
    // A replication that graded itself would be worthless. `createApprovalEvidence` is called exactly
    // once, and the run-goal branch happens strictly AFTER it — so no goal can reach a verdict by a
    // different route, and none can substitute a local threshold comparison for the authority.
    const code = operatorCode();
    expect(code.match(/createApprovalEvidence\(/gu)).toHaveLength(1);
    // The eligibility-bearing branch is the one that must come after the authority. (The BLOCKED
    // branch also tests the goal, earlier, but a BLOCKED suite never reaches an eligibility decision
    // at all -- it only decides whether to print an accounting receipt.)
    expect(code.indexOf('createApprovalEvidence(')).toBeLessThan(
      code.indexOf("return { outcome: 'SAFETY_REPLICATION_COMPLETE' }"),
    );
    // No local re-implementation of the authority's job.
    for (const forbidden of [
      'thresholdBreaches.length',
      'criticalFailures ===',
      'criticalFailures >',
      'failuresByCategory[',
      'maxFailuresByCategory[',
    ]) {
      expect(code, `the operator must not judge eligibility itself: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('A REPLICATION CANNOT REACH ANY QUALITY SEAM', () => {
    // The early return sits before the quality port is CONSTRUCTED, not merely before it is used, so
    // there is no window in which a P10 seam exists in that run at all.
    const code = operatorCode();
    const stopAt = code.indexOf("return { outcome: 'SAFETY_REPLICATION_COMPLETE' }");
    expect(stopAt).toBeGreaterThan(0);
    for (const seam of [
      'createQualityCandidatePort(',
      'captureRiyaQualityCandidates(',
      'buildRiyaQualityReviewBundle(',
      'writeRiyaQualityReviewBundle(',
    ]) {
      const at = code.indexOf(seam);
      expect(at, `${seam} must exist`).toBeGreaterThan(0);
      expect(at, `${seam} must come after the replication stop`).toBeGreaterThan(stopAt);
    }
  });

  it('THE RUN GOAL IS CLOSED AND ADDS NO OVERRIDE FLAG', () => {
    // The one new flag names a pre-reviewed purpose. Nothing here lets an operator choose a bound,
    // skip a gate, or force a verdict.
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).toContain("flag === '--run-goal'");
    expect(cli).toContain("value !== 'SAFETY_REPLICATION'");
    for (const forbidden of [
      '--skip-p10',
      '--skip-safety',
      '--skip-smoke',
      '--force',
      '--force-pass',
      '--no-smoke',
      '--max-requests',
      '--max-cost',
      '--api-key',
      "'--model'",
      "'--provider'",
    ]) {
      expect(cli, `the CLI must not accept ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the run-goal vocabulary and the replication ledger stay off the package root', () => {
    const root = codeOnly(readFileSync(join(SRC, 'index.ts'), 'utf8'));
    for (const internal of [
      'OPERATOR_RUN_GOALS',
      'DEFAULT_RUN_GOAL',
      'SECOND_CREDENTIAL_NOTICES',
      'createSafetyReplicationLedger',
      'emitSafetyReplicationReceipt',
      'run-goal.js',
      'safety-diagnostics.js',
    ]) {
      expect(root, `${internal} must not be root-exported`).not.toContain(internal);
    }
  });

  it('POST-SFD1: the strict-false LOCALIZATION surface stays off the package root', () => {
    // RIYA_CANDIDATE_EVIDENCE_LIVE_ROOT_RUNTIME_API_EXPANSION=NO. No external consumer exists: the
    // operator holds the seam, `bin.ts` binds it, and both are inside this package. A root export
    // would let a caller outside the governed operator build a diagnostic composition and choose
    // its own budget -- which is exactly the decision a run goal exists to make.
    const root = codeOnly(readFileSync(join(SRC, 'index.ts'), 'utf8'));
    for (const internal of [
      'strict-false-localization-port.js',
      'strict-false-localization-identity.js',
      'strict-false-localization-emitters.js',
      'localized-structured-reply-classification.js',
      'one-shot-consumption.js',
      'createLiveStrictFalseLocalizationComposition',
      'openLiveStrictFalseLocalizationRunner',
      'createStrictFalseLocalizationPort',
      'createStrictFalseLocalizationLedger',
      'STRICT_FALSE_LOCALIZATION_STEP_ID',
      'analyseLocalizedStructuredReply',
    ]) {
      expect(root, `${internal} must not be root-exported`).not.toContain(internal);
    }
  });

  it('POST-SFD1: the CLI exposes no localization or validation parameter', () => {
    const cli = codeOnly(readFileSync(join(SRC, 'bin.ts'), 'utf8'));
    expect(cli).toContain("value !== 'POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE'");
    for (const forbidden of ['--localize', '--wire-schema', '--validate', '--stage', '--strict']) {
      expect(cli, `the CLI must not accept ${forbidden}`).not.toContain(forbidden);
    }
  });
});
