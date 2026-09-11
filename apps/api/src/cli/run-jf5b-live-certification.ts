/**
 * The JF-5B live certification CLI (ADR-0152, as corrected by JF-5B-R1).
 *
 * ### Why this lives in `apps/api` and not in the harness package
 *
 * The harness is an evaluation-only LIBRARY: gates, the pure discovery rules, release and binding
 * builders, the ledger and the sanitized models. It deliberately depends on none of the runtime, so it
 * cannot reach the Mastra three-agent composition — and it should not be able to.
 *
 * `apps/api` is the layer that already owns that composition (`createThreeAgentJarvisRuntimeComposition`
 * over the JF-4A one-step workflow), already depends on the Jarvis runtime, the gateway and the
 * evaluation framework, and already has the established one-shot process pattern used by
 * `run-shadow-once`. So the executable belongs here, and it COMPOSES. It contains no provider routing:
 * the Model Gateway still decides which provider serves a turn.
 *
 * ### Importing this module runs nothing
 *
 * Every capability the live run needs — terminal, network, filesystem, clock — arrives as an injected
 * seam. The default production wiring is assembled only by the `bin` entry. So a spec drives the whole
 * phase sequence, including every refusal, with zero network, and CI can never open the live gate.
 *
 * ### The phase order is the safety property
 *
 * Preflight, then the typed confirmation, then — and only then — a credential. A run that asked for a
 * key and afterwards discovered the output path was wrong would already be holding the key.
 */
import {
  EXECUTE_LIVE_FLAG,
  EXIT_CODES,
  JF5B_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
  buildNaraShortlist,
  checkArgvGate,
  checkOutputPath,
  checkTypedConfirmation,
  createCallLedger,
  fetchNaraModelCatalogue,
  parseCertifyArgv,
  parseNaraModelDiscovery,
  renderPreflightSummary,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type {
  ArtifactWriter,
  ConfirmationReader,
  ExitCode,
  NaraDiscoveryTransport,
  OperatorIo,
  RepositoryFacts,
  RunOutcome,
  RunPhase,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

import type { CertificationRunner } from './jf5b-certification-runner.js';
import type { GroqConnectivityCheck, NaraCredentialGate } from './jf5b-live-deps.js';

/** Everything the CLI needs from the outside world. Production wires it in `bin`; specs fake it. */
export interface Jf5bCliDeps {
  readonly io: OperatorIo;
  readonly confirmation: ConfirmationReader;
  readonly facts: RepositoryFacts;
  readonly runId: string;
  /** Phase 1: the EXISTING Groq staging smoke, composed. Never a second connectivity call. */
  readonly groqConnectivity: GroqConnectivityCheck;
  /** Phase 2: the Nara credential, through the existing masked-TTY primitive. */
  readonly naraCredential: NaraCredentialGate;
  readonly discoveryTransport: NaraDiscoveryTransport;
  /** Phases 3-4: the real three-agent Mastra composition. */
  readonly runner: CertificationRunner;
  readonly artifacts: ArtifactWriter;
}

const stop = (
  phaseReached: RunPhase,
  exitCode: ExitCode,
  reason: string,
  groqCalls = 0,
  naraCalls = 0,
): RunOutcome => Object.freeze({ phaseReached, exitCode, reason, groqCalls, naraCalls });

/**
 * Run the whole sequence, or stop at the first refusal.
 *
 * Returns an outcome rather than throwing, and never a partial success: a phase that failed stops the
 * run, and the artifacts written are a sanitized failure receipt rather than a manifest.
 */
export async function runJf5bLiveCertificationCli(
  argv: readonly string[],
  deps: Jf5bCliDeps,
): Promise<RunOutcome> {
  // ---------------------------------------------------------------- PHASE 0: precheck, no credential
  const parsed = parseCertifyArgv(argv);

  if (parsed.unknown.length > 0) {
    // An unrecognised switch is a refusal, not something to ignore. `--api-key` and friends land here,
    // which is why there is no branch that could interpret one.
    deps.io.err(`refused: unrecognised argument(s): ${parsed.unknown.join(' ')}`);
    return stop('PRECHECK', EXIT_CODES.INVALID_USAGE, 'unknown-argument');
  }

  const argvRefusal = checkArgvGate(argv);
  if (argvRefusal !== undefined) {
    deps.io.err(`refused: ${argvRefusal}`);
    deps.io.err(`this command performs live provider calls and needs ${EXECUTE_LIVE_FLAG}`);
    return stop('PRECHECK', EXIT_CODES.GATE_REFUSED, argvRefusal);
  }
  if (parsed.outputDirectory === undefined) {
    deps.io.err('refused: --output-dir is required and must be outside the repository');
    return stop('PRECHECK', EXIT_CODES.INVALID_USAGE, 'output-directory-missing');
  }
  if (parsed.groqSmokeConfig === undefined) {
    deps.io.err('refused: --groq-smoke-config is required by the existing Groq smoke contract');
    return stop('PRECHECK', EXIT_CODES.INVALID_USAGE, 'groq-smoke-config-missing');
  }

  if (!deps.facts.worktreeClean) {
    // A dirty tree means the artifacts could not name what actually ran.
    deps.io.err('refused: the worktree is dirty; a live result must name an exact head');
    return stop('PRECHECK', EXIT_CODES.PRECHECK_FAILED, 'worktree-dirty');
  }
  const pathRefusal = checkOutputPath(
    deps.facts.resolvedOutputDirectory,
    deps.facts.repositoryRoot,
  );
  if (pathRefusal !== undefined) {
    deps.io.err(`refused: ${pathRefusal}`);
    return stop('PRECHECK', EXIT_CODES.PRECHECK_FAILED, pathRefusal);
  }

  for (const line of renderPreflightSummary({
    headSha: deps.facts.headSha,
    worktreeClean: deps.facts.worktreeClean,
    ciRunId: 'verified-before-run',
    ciConclusion: 'success',
    outputDirectory: deps.facts.resolvedOutputDirectory,
    runId: deps.runId,
  })) {
    deps.io.out(line);
  }

  // ---------------------------------------------------------------- the SECOND gate, at a terminal
  const typed = deps.confirmation.isInteractive()
    ? await deps.confirmation.readLine(`Type ${LIVE_CONFIRMATION_PHRASE} to proceed: `)
    : '';
  const confirmRefusal = checkTypedConfirmation(typed, deps.confirmation.isInteractive());
  if (confirmRefusal !== undefined) {
    deps.io.err(`refused: ${confirmRefusal}; no credential was requested and no call was made`);
    return stop('PRECHECK', EXIT_CODES.GATE_REFUSED, confirmRefusal);
  }

  const ledger = createCallLedger(JF5B_BUDGET);
  deps.artifacts.ensureDirectory(deps.facts.resolvedOutputDirectory);

  // ---------------------------------------------------------------- PHASE 1: Groq connectivity
  deps.io.out('phase 1: groq connectivity (existing staging smoke)');
  const groq = await deps.groqConnectivity.run({
    smokeConfigPath: parsed.groqSmokeConfig,
    reserve: () => ledger.reserve('groq', 0.01) === undefined,
  });
  if (!groq.ok) {
    // STOP cleanly. No Nara credential is requested, so a Groq failure costs nothing on the other side.
    deps.io.err(`groq connectivity failed: ${groq.reason}`);
    deps.artifacts.writeFile(
      'receipt-failure.json',
      JSON.stringify(
        {
          runId: deps.runId,
          headSha: deps.facts.headSha,
          phase: 'GROQ_CONNECTIVITY',
          reason: groq.reason,
        },
        null,
        2,
      ),
    );
    return stop(
      'GROQ_CONNECTIVITY',
      EXIT_CODES.GROQ_CONNECTIVITY_FAILED,
      groq.reason,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }

  // ---------------------------------------------------------------- PHASE 2: Nara discovery
  deps.io.out('phase 2: nara authenticated model discovery');
  const credential = await deps.naraCredential.read();
  if (!credential.ok) {
    deps.io.err(`nara credential refused: ${credential.failure}`);
    return stop(
      'NARA_DISCOVERY',
      EXIT_CODES.CREDENTIAL_REFUSED,
      credential.failure,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }

  const catalogue = await fetchNaraModelCatalogue(
    deps.discoveryTransport,
    credential.key,
    () => ledger.reserve('nara', 0.001) === undefined,
  );
  if (!catalogue.ok) {
    deps.io.err(`nara discovery failed: ${catalogue.failure}`);
    return stop(
      'NARA_DISCOVERY',
      EXIT_CODES.NARA_DISCOVERY_FAILED,
      catalogue.failure,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }

  const discovered = parseNaraModelDiscovery(catalogue.payload);
  if (discovered === undefined) {
    deps.io.err('nara discovery failed: the payload is not a model list; nothing was selected');
    return stop(
      'NARA_DISCOVERY',
      EXIT_CODES.NARA_DISCOVERY_FAILED,
      'discovery-not-a-model-list',
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }
  deps.io.out(
    `  returned ${String(discovered.totalReturned)}, eligible ${String(discovered.eligible.length)}, rejected ${String(discovered.rejected.length)}`,
  );

  // ---------------------------------------------------------------- PHASE 2b: deterministic shortlist
  const shortlist = buildNaraShortlist(discovered.eligible);
  if (!shortlist.ok) {
    // The honest stop. The sanitized alias list is printed so the owner can choose; nothing is guessed.
    deps.io.err(`nara selection refused: ${shortlist.refusal}`);
    for (const model of discovered.eligible) {
      deps.io.out(`  eligible: ${model.modelId}`);
    }
    return stop(
      'NARA_SELECTION',
      EXIT_CODES.NARA_SELECTION_REFUSED,
      shortlist.refusal,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }
  for (const model of shortlist.shortlist) {
    deps.io.out(`  shortlisted: ${model.modelId}`);
  }

  // ---------------------------------------------------------------- PHASES 2c-5: through the runner
  //
  // Selection probes, the six direct certifications and the AUTO routing cases all run agent turns, and
  // every agent turn must traverse the existing Mastra workflow. That composition lives in the runner,
  // beside the application code that owns it, so this file stays a sequence rather than a second
  // composition root.
  deps.io.out('phase 2c: bounded selection probes through the Model Gateway');
  const selected = await deps.runner.selectNaraModel({
    shortlist: shortlist.shortlist,
    apiKey: credential.key,
    runId: deps.runId,
    ledger,
  });
  if (!selected.ok) {
    deps.io.err(`nara selection refused: ${selected.reason}`);
    return stop(
      'NARA_SELECTION',
      EXIT_CODES.NARA_SELECTION_REFUSED,
      selected.reason,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }
  deps.io.out(`  selected: ${selected.modelId}`);

  deps.io.out('phase 3: six direct provider certifications');
  const certification = await deps.runner.certifyAllSix({
    naraModelId: selected.modelId,
    naraApiKey: credential.key,
    // The holder phase 1 already resolved. One prompt for one secret.
    groqApiKey: groq.key,
    runId: deps.runId,
    headSha: deps.facts.headSha,
    ledger,
  });
  if (!certification.ok) {
    deps.io.err(`certification failed: ${certification.reason}`);
    return stop(
      'CERTIFICATION',
      EXIT_CODES.CERTIFICATION_FAILED,
      certification.reason,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }

  deps.io.out('phase 4: AUTO routing');
  const routing = await deps.runner.certifyAutoRouting({
    naraModelId: selected.modelId,
    naraApiKey: credential.key,
    groqApiKey: groq.key,
    runId: deps.runId,
    ledger,
  });
  if (!routing.ok) {
    deps.io.err(`auto routing failed: ${routing.reason}`);
    return stop(
      'AUTO_ROUTING',
      EXIT_CODES.AUTO_ROUTING_FAILED,
      routing.reason,
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }

  // ---------------------------------------------------------------- PHASE 5: artifacts
  deps.io.out('phase 5: artifacts');
  deps.artifacts.writeFile('raw/live-outputs.json', certification.rawBundle);
  deps.artifacts.writeFile('review/blinded-review-bundle.json', certification.reviewBundle);
  deps.artifacts.writeFile('receipts/cases.json', JSON.stringify(certification.cases, null, 2));
  deps.artifacts.writeFile('manifest.json', JSON.stringify(certification.manifest, null, 2));
  const manifestDigest = deps.artifacts.digestOf('manifest.json');

  deps.io.out(`  manifest digest ${manifestDigest}`);
  deps.io.out('  NO production approval was minted. JF-5C owns the owner seal.');

  return Object.freeze({
    phaseReached: 'ARTIFACTS' as const,
    exitCode: EXIT_CODES.OK,
    groqCalls: ledger.groqCalls(),
    naraCalls: ledger.naraCalls(),
    manifestDigest,
  });
}
