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
  JF5B_GROQ_ONLY_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
  checkArgvGate,
  checkOutputPath,
  checkTypedConfirmation,
  createCallLedger,
  parseCertifyArgv,
  renderPreflightSummary,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type {
  ArtifactWriter,
  ConfirmationReader,
  ExitCode,
  LiveCaseRecord,
  OperatorIo,
  RepositoryFacts,
  RunOutcome,
  RunPhase,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

import { renderSchemaIssues } from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { JF5B_GROQ_MODEL_ID } from '../composition/jf5b-certification-runner-impl.js';
import type { CertificationRunner, Jf5bCaseDiagnostic } from './jf5b-certification-runner.js';
import type { GroqConnectivityCheck } from './jf5b-live-deps.js';

/** Everything the CLI needs from the outside world. Production wires it in `bin`; specs fake it. */
export interface Jf5bCliDeps {
  readonly io: OperatorIo;
  readonly confirmation: ConfirmationReader;
  readonly facts: RepositoryFacts;
  readonly runId: string;
  /** Phase 1: the EXISTING Groq staging smoke, composed. Never a second connectivity call. */
  readonly groqConnectivity: GroqConnectivityCheck;
  /** Phases 3-4: the real three-agent Mastra composition. */
  readonly runner: CertificationRunner;
  readonly artifacts: ArtifactWriter;
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
/**
 * Persist the same SANITIZED phase-3 diagnostics the terminal prints, so a completed owner-local live
 * run can be inspected later without preserving terminal scrollback. Structure/numbers, schema
 * `path:code` tokens and corpus claim tokens only. Never model text, provider bodies, headers or keys.
 */
function writeSanitizedCaseDiagnostics(
  artifacts: Jf5bCliDeps['artifacts'],
  diagnostics: readonly Jf5bCaseDiagnostic[],
): void {
  const items = diagnostics.filter(
    (one) =>
      one.wireDiagnostic !== undefined ||
      one.schemaIssues !== undefined ||
      one.matchedClaim !== undefined,
  );
  if (items.length === 0) return;
  artifacts.writeFile(
    'review/phase3-sanitized-diagnostics.json',
    JSON.stringify(
      {
        note: 'SANITIZED ONLY. No model text, provider body, header or credential.',
        items: items.map((one) => ({
          provider: one.provider,
          agent: one.agent,
          caseId: one.caseId,
          ...(one.wireDiagnostic === undefined ? {} : { wireDiagnostic: one.wireDiagnostic }),
          ...(one.schemaIssues === undefined ? {} : { schemaIssues: one.schemaIssues }),
          ...(one.matchedClaim === undefined ? {} : { matchedClaim: one.matchedClaim }),
        })),
      },
      null,
      2,
    ),
  );
}

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

  const ledger = createCallLedger(JF5B_GROQ_ONLY_BUDGET);
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

  // ---------------------------------------------------------------- PHASE 2: Groq-only three-agent certification
  deps.io.out('phase 2: groq-only three-agent certification through the Model Gateway');
  const certification = await deps.runner.certifyGroqOnly({
    groqApiKey: groq.key,
    runId: deps.runId,
    headSha: deps.facts.headSha,
    ledger,
  });

  if (!certification.ok) {
    deps.io.err(`certification failed: ${certification.reason}`);
    printCertificationFailure(deps.io, certification.cases, certification.diagnostics);
    writeSanitizedCaseDiagnostics(deps.artifacts, certification.diagnostics);
    writeForbiddenClaimExcerpts(deps.artifacts, certification.diagnostics);
    deps.artifacts.writeFile(
      'receipt-certification-failure.json',
      JSON.stringify(
        {
          runId: deps.runId,
          headSha: deps.facts.headSha,
          providerMode: 'GROQ_ONLY',
          phase: 'CERTIFICATION',
          reason: certification.reason,
          groqCalls: ledger.groqCalls(),
          naraCalls: ledger.naraCalls(),
          counts: summarizeCaseCounts(certification.cases),
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

  if (certification.manifest === undefined) {
    deps.io.err('certification failed: manifest-missing');
    return stop(
      'CERTIFICATION',
      EXIT_CODES.CERTIFICATION_FAILED,
      'manifest-missing',
      ledger.groqCalls(),
      ledger.naraCalls(),
    );
  }

  // ---------------------------------------------------------------- PHASE 3: artifacts
  deps.io.out('phase 3: artifacts');
  deps.artifacts.writeFile('raw/live-outputs.json', certification.rawBundle);
  deps.artifacts.writeFile('review/blinded-review-bundle.json', certification.reviewBundle);
  deps.artifacts.writeFile('receipts/cases.json', JSON.stringify(certification.cases, null, 2));
  deps.artifacts.writeFile('manifest.json', JSON.stringify(certification.manifest, null, 2));
  const manifestDigest = deps.artifacts.digestOf('manifest.json');

  deps.io.out(`  manifest digest ${manifestDigest}`);
  deps.io.out('  provider mode GROQ_ONLY; Nara is disabled and was not contacted.');
  deps.io.out('  NO production approval was minted. JF-5C owns the owner seal.');

  return Object.freeze({
    phaseReached: 'ARTIFACTS' as const,
    exitCode: EXIT_CODES.OK,
    groqCalls: ledger.groqCalls(),
    naraCalls: ledger.naraCalls(),
    manifestDigest,
  });
}
