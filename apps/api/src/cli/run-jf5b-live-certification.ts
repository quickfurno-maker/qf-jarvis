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
  checkOwnerCandidates,
  checkTypedConfirmation,
  createCallLedger,
  fetchNaraModelCatalogue,
  parseCertifyArgv,
  parseNaraModelDiscovery,
  renderPreflightSummary,
  resolveOwnerCandidateShortlist,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type {
  ArtifactWriter,
  ConfirmationReader,
  ExitCode,
  LiveCaseRecord,
  NaraDiscoveryTransport,
  OperatorIo,
  RepositoryFacts,
  RunOutcome,
  RunPhase,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

import { renderSchemaIssues } from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { JF5B_GROQ_MODEL_ID } from '../composition/jf5b-certification-runner-impl.js';
import type {
  CertificationRunner,
  Jf5bCaseDiagnostic,
  NaraProbeSummary,
} from './jf5b-certification-runner.js';
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

/**
 * Print the SANITIZED per-candidate probe summary (JF-5B-R4).
 *
 * Two authenticated live runs ended with `no-shortlisted-alias-passed-the-hard-gates` and nothing else.
 * That is true, and it is almost useless: it says five aliases failed without saying what any of them
 * did, which is how a lane ends up guessing at another blind model set.
 *
 * Every field below comes from the existing `NaraProbeScore` or the existing sanitized
 * `LiveCaseRecord`. There is no reply text, no response body, no message content, no header and no
 * credential in either — `LiveCaseRecord` carries a DIGEST of the output and never the output, which is
 * exactly why it is the right vocabulary to print.
 */
function printProbeSummaries(io: OperatorIo, probes: readonly NaraProbeSummary[]): void {
  for (const probe of probes) {
    const score = probe.score;
    io.out(
      `  probe ${score.modelId}: hardGates=${score.hardGatesPassed ? 'PASS' : 'FAIL'} ` +
        `quality=${String(score.qualityPassed)}/${String(score.qualityAttempted)} ` +
        `p95=${String(score.p95LatencyMs)}ms tokens=${String(score.totalTokens)}`,
    );
    for (const record of probe.cases) {
      const parts = [
        `    ${record.caseId}`,
        `outcome=${record.outcome}`,
        `structuredValid=${record.structuredOutputValid ? 'yes' : 'no'}`,
        `calls=${String(record.networkCalls)}`,
        `attempts=${String(record.providerAttempts)}`,
        `latency=${String(record.latencyMs)}ms`,
      ];
      if (record.providerErrorClass !== undefined) {
        parts.push(`errorClass=${record.providerErrorClass}`);
      }
      if (record.reason !== undefined) {
        parts.push(`reason=${record.reason}`);
      }
      io.out(parts.join(' '));
    }
  }
}

/**
 * The SANITIZED phase-3 failure diagnostics (JF-5B-R5).
 *
 * Run-7 proved the R4 repair worked: two aliases passed the structured hard gates, the unchanged scorer
 * picked one, and phase 3 then stopped with a single line — `certification failed:
 * forbidden-claim-asserted`. True, and almost useless: 90 executions produced one sentence naming no
 * provider, no agent and no case.
 *
 * `certifyAllSix` already returned every record, on the failure branch as much as the success one. This
 * function is the only thing that was missing: the CLI discarded them. Nothing is computed here that
 * was not already measured, and no new record type exists.
 *
 * ### What may be printed, and what may not
 *
 * `LiveCaseRecord` is content-free by construction, and even so this prints a SUBSET of it. `outputDigest`
 * is deliberately withheld: a 64-hex string is not evidence an operator can act on, and a digest on
 * screen is a digest in a terminal scrollback. Raw text, the bundles, prompt or message bodies, headers
 * and credentials are not reachable from a record at all.
 *
 * PASS records are counted, never dumped. A failure report that reprinted 80 successes would bury the
 * ten lines somebody needs.
 */
function summarizeCaseCounts(cases: readonly LiveCaseRecord[]): {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly inconclusive: number;
  readonly other: number;
} {
  const count = (outcome: LiveCaseRecord['outcome']): number =>
    cases.filter((one) => one.outcome === outcome).length;
  const pass = count('PASS');
  const fail = count('FAIL');
  const inconclusive = count('INCONCLUSIVE');
  return {
    total: cases.length,
    pass,
    fail,
    inconclusive,
    other: cases.length - pass - fail - inconclusive,
  };
}

/**
 * The R8 diagnostic for one case, if there is one, keyed by its identity (JF-5B-R8).
 *
 * A map rather than a join, because the diagnostics arrive in execution order and the printer walks the
 * cases in provider-then-agent order; matching them by position would be a silent mis-attribution the
 * first time either order changed.
 */
function diagnosticIndex(
  diagnostics: readonly Jf5bCaseDiagnostic[],
): ReadonlyMap<string, Jf5bCaseDiagnostic> {
  return new Map(
    diagnostics.map((one) => [`${one.provider}/${one.agent}/${one.caseId}`, one] as const),
  );
}

/**
 * One sanitized line per non-PASS case. Existing record fields, plus the R8 diagnostics.
 *
 * What R8 adds to the TERMINAL is a wire line (structure and numbers), a list of schema `path:code`
 * tokens, and the exact governed claim token. What it does NOT add is the excerpt: an excerpt is model
 * text, a terminal is scrollback, and the excerpt has its own owner-local file for that reason.
 */
function renderCaseLine(record: LiveCaseRecord, diagnostic?: Jf5bCaseDiagnostic): string {
  const parts = [
    `  case ${record.provider}/${record.agent}/${record.caseId}:`,
    `outcome=${record.outcome}`,
    `structuredValid=${record.structuredOutputValid ? 'yes' : 'no'}`,
    `calls=${String(record.networkCalls)}`,
    `attempts=${String(record.providerAttempts)}`,
    `retry=${String(record.retryCount)}`,
    `latency=${String(record.latencyMs)}ms`,
  ];
  if (record.providerErrorClass !== undefined) {
    parts.push(`errorClass=${record.providerErrorClass}`);
  }
  if (record.reason !== undefined) {
    parts.push(`reason=${record.reason}`);
  }
  parts.push(`model=${record.modelId}`);
  if (diagnostic?.wireDiagnostic !== undefined) {
    parts.push(diagnostic.wireDiagnostic);
  }
  if (diagnostic?.schemaIssues !== undefined) {
    parts.push(renderSchemaIssues(diagnostic.schemaIssues));
  }
  if (diagnostic?.matchedClaim !== undefined) {
    // The token as the CORPUS wrote it. A fixture string, not model output — which is exactly why it is
    // safe on a terminal and the excerpt beside it is not.
    parts.push(`matchedClaim="${diagnostic.matchedClaim}"`);
  }
  return parts.join(' ');
}

/** Print the aggregate, then every non-PASS case, grouped by provider and agent in corpus order. */
function printCertificationFailure(
  io: OperatorIo,
  cases: readonly LiveCaseRecord[],
  diagnostics: readonly Jf5bCaseDiagnostic[] = [],
): void {
  const byCase = diagnosticIndex(diagnostics);
  const counts = summarizeCaseCounts(cases);
  io.out('phase 3 SANITIZED FAILURE DIAGNOSTICS');
  io.out(
    `  cases ${String(counts.total)}: PASS ${String(counts.pass)} FAIL ${String(counts.fail)} ` +
      `INCONCLUSIVE ${String(counts.inconclusive)} OTHER ${String(counts.other)}`,
  );
  // The provider/agent grouping comes free: both are fields on the record, and the records arrive in
  // provider-then-agent-then-corpus order because that is the order they were executed in.
  for (const provider of ['groq', 'nara'] as const) {
    for (const agent of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
      const pair = cases.filter((one) => one.provider === provider && one.agent === agent);
      if (pair.length === 0) {
        continue;
      }
      const pairCounts = summarizeCaseCounts(pair);
      io.out(
        `  ${provider}/${agent}: PASS ${String(pairCounts.pass)} FAIL ${String(pairCounts.fail)} ` +
          `INCONCLUSIVE ${String(pairCounts.inconclusive)}`,
      );
    }
  }
  const nonPass = cases.filter((one) => one.outcome !== 'PASS');
  if (nonPass.length === 0) {
    return;
  }
  io.out(`  non-PASS cases (${String(nonPass.length)}):`);
  for (const record of nonPass) {
    io.out(
      renderCaseLine(record, byCase.get(`${record.provider}/${record.agent}/${record.caseId}`)),
    );
  }
}

/**
 * The OWNER-LOCAL bounded excerpt file, written outside the repository on a phase-3 failure (JF-5B-R8).
 *
 * ### Why this file exists, and why it is separate from everything else
 *
 * Run-10 produced seven forbidden-claim FAILs. The terminal names the rule that fired and the claim it
 * fired on. It does not, and must not, show what the model actually said — a terminal is scrollback, and
 * scrollback is pasted. But deciding whether a FAIL is correct REQUIRES reading the sentence, and R6
 * exists precisely because an earlier lane had to guess at exactly that and guessed wrong.
 *
 * So the sentence goes in one place: a file, in the already-approved external run directory, holding
 * only the rows that failed on a claim, each with at most 240 code points centred on the exact
 * occurrence the verdict rests on. Not the output. Not the digest. Not the prompt. Not a PASS. Not a
 * provider failure, which has no claim to excerpt.
 *
 * A `SECRET_AND_PII_LEAKAGE` case is excluded from quoting entirely and says so in the file, because
 * those fixtures exist to provoke exactly the text nobody may copy anywhere.
 *
 * Nothing reads this back. It is not the manifest, not the receipt, not evidence of a certification, and
 * no outcome anywhere depends on whether it was written.
 */
function writeForbiddenClaimExcerpts(
  artifacts: Jf5bCliDeps['artifacts'],
  diagnostics: readonly Jf5bCaseDiagnostic[],
): void {
  const items = diagnostics.filter(
    (one) =>
      one.matchedClaim !== undefined &&
      (one.excerpt !== undefined || one.excerptOmitted !== undefined),
  );
  if (items.length === 0) {
    return;
  }
  artifacts.writeFile(
    'review/phase3-forbidden-claim-excerpts.json',
    JSON.stringify(
      {
        note: 'OWNER REVIEW ONLY. Bounded local excerpts. Not evidence, not sealed, not read back.',
        items: items.map((one) => ({
          provider: one.provider,
          agent: one.agent,
          caseId: one.caseId,
          matchedClaim: one.matchedClaim,
          ...(one.excerpt === undefined ? {} : { excerpt: one.excerpt }),
          ...(one.excerptOmitted === undefined ? {} : { excerptOmitted: one.excerptOmitted }),
        })),
      },
      null,
      2,
    ),
  );
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

  // The owner candidate set is checked for SHAPE here, before the summary is even rendered: a set
  // that could never be probed should cost nothing, and certainly not a credential. Whether each alias
  // is currently ENTITLED is a question only the authenticated endpoint can answer, and phase 2b asks
  // it after discovery.
  const candidateShape = checkOwnerCandidates(parsed.naraCandidates);
  if (!candidateShape.ok) {
    deps.io.err(`refused: ${candidateShape.refusal} (${candidateShape.modelId})`);
    return stop('PRECHECK', EXIT_CODES.INVALID_USAGE, candidateShape.refusal);
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
    naraCandidates: parsed.naraCandidates,
    groqCertificationModelId: JF5B_GROQ_MODEL_ID,
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

  // ---------------------------------------------------------------- PHASE 2b: the shortlist
  //
  // Two paths, one outcome: a list of models THIS run's authenticated discovery returned.
  //
  //   - with owner candidates, each is re-verified against `discovered.eligible` by exact
  //     case-sensitive match and the DISCOVERED object is carried forward;
  //   - without them, the existing metadata rule applies unchanged, including its honest refusal.
  //
  // The owner answers "which models are worth probing?" and nothing else. No ranking happens on either
  // path, and the scorer in phase 2c still chooses the winner.
  const shortlist =
    parsed.naraCandidates.length > 0
      ? resolveOwnerCandidateShortlist(parsed.naraCandidates, discovered.eligible)
      : buildNaraShortlist(discovered.eligible);
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
  deps.io.out(
    `  candidate source       ${parsed.naraCandidates.length > 0 ? 'OWNER_EXPLICIT' : 'DISCOVERY_METADATA'}`,
  );
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
  printProbeSummaries(deps.io, selected.probes);
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
    printCertificationFailure(deps.io, certification.cases, certification.diagnostics);
    // The excerpts go to a FILE, never the terminal, and only on failure. See the function's header.
    writeForbiddenClaimExcerpts(deps.artifacts, certification.diagnostics);
    // ONE sanitized receipt, in the already-approved external run directory. Deliberately NOT the raw
    // bundle, the review bundle or the manifest: a failed certification has nothing to seal, and a raw
    // bundle beside a refusal is content kept for a claim nobody is making.
    deps.artifacts.writeFile(
      'receipt-certification-failure.json',
      JSON.stringify(
        {
          runId: deps.runId,
          headSha: deps.facts.headSha,
          phase: 'CERTIFICATION',
          reason: certification.reason,
          selectedNaraModelId: selected.modelId,
          groqCalls: ledger.groqCalls(),
          naraCalls: ledger.naraCalls(),
          counts: summarizeCaseCounts(certification.cases),
          // The SAME sanitized subset the terminal prints, and no more. `outputDigest` is not here.
          nonPassCases: certification.cases
            .filter((one) => one.outcome !== 'PASS')
            .map((one) => ({
              provider: one.provider,
              agent: one.agent,
              caseId: one.caseId,
              modelId: one.modelId,
              outcome: one.outcome,
              structuredOutputValid: one.structuredOutputValid,
              networkCalls: one.networkCalls,
              providerAttempts: one.providerAttempts,
              retryCount: one.retryCount,
              latencyMs: one.latencyMs,
              ...(one.providerErrorClass === undefined
                ? {}
                : { providerErrorClass: one.providerErrorClass }),
              ...(one.reason === undefined ? {} : { reason: one.reason }),
            })),
        },
        null,
        2,
      ),
    );
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
