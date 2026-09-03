/**
 * The pilot executor (AS3A, ADR-0143 §14, §17).
 *
 * ### Dry run is the default, and it is a real dry run
 *
 * In `DRY_RUN` the function does everything except talk to a provider: the plan is proved, the
 * schedule is built, the ceilings are computed and the summary is returned. It constructs no
 * transport and makes zero calls. That is what makes it safe to run anywhere, including CI, including
 * on a machine whose environment happens to hold two credentials.
 *
 * ### Orchestration is AS2's and acceptance is AS1's
 *
 * Nothing here re-implements either. The executor's whole job is composition: wire real invokers into
 * AS2's `orchestrateRiyaSyntheticRun`, then hand what comes out to AS1's
 * `validateRiyaAiSyntheticCorpus`. A second orchestrator would drift from the one the fakes prove, and
 * a second acceptance path would be a gate nobody could compare against the first.
 *
 * ### Concurrency is the MINIMUM of policy and budget
 *
 * AS2's policy bounds concurrency for correctness; the budget bounds it for a run that costs money. A
 * pilot usually wants far less than the policy permits, and taking the minimum means neither can be
 * widened by the other.
 *
 * ### The protected exam enters HERE and nowhere earlier
 *
 * It is a parameter of this function, passed straight to the validator. It is never given to a
 * prompt renderer, an adapter, a transport, a verifier or a critic — there is no path from this
 * parameter to any of them, because it is not stored on anything they can reach.
 */
import {
  createRiyaSyntheticGenerationPolicy,
  orchestrateRiyaSyntheticRun,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticCandidateV1,
  RiyaSyntheticInvokerRegistry,
  RiyaSyntheticModelInvoker,
  RiyaSyntheticRunOutcomeV1,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import {
  riyaAiSyntheticDiversityMetrics,
  validateRiyaAiSyntheticCorpus,
} from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type { ValidateRiyaAiSyntheticOptions } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';

import type { AnthropicMessagesTransport } from '../adapters/anthropic-messages-invoker.js';
import { createAnthropicMessagesInvoker } from '../adapters/anthropic-messages-invoker.js';
import type { OpenAiResponsesTransport } from '../adapters/openai-responses-invoker.js';
import { createOpenAiResponsesInvoker } from '../adapters/openai-responses-invoker.js';
import type { RiyaSyntheticPilotPlanV1 } from '../contracts/pilot-plan.js';
import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import type { RiyaSyntheticArtifactWriter } from './artifact-writer.js';
import type { RiyaSyntheticExecutionMode } from './execution-guard.js';
import type { RiyaSyntheticPreflightResultV1 } from './preflight.js';
import { createRiyaSyntheticSpendGate } from './spend-gate.js';
import type {
  RiyaSyntheticScheduler,
  RiyaSyntheticSpendLedgerV1,
  RiyaSyntheticStopReason,
} from './spend-gate.js';

/** The protected exam's type, borrowed from the validator so this package needs no evaluation import. */
export type RiyaSyntheticProtectedIndex = NonNullable<
  ValidateRiyaAiSyntheticOptions['protectedIndex']
>;

export interface ExecuteRiyaSyntheticPilotOptions {
  readonly plan: RiyaSyntheticPilotPlanV1;
  readonly preflight: RiyaSyntheticPreflightResultV1;
  readonly mode: RiyaSyntheticExecutionMode;
  /** Required only when the plan uses that family, and only in EXECUTE. */
  readonly openaiTransport?: OpenAiResponsesTransport;
  readonly anthropicTransport?: AnthropicMessagesTransport;
  /** Monotonic milliseconds, injected so wall-clock enforcement is testable and artifacts stable. */
  readonly now: () => number;
  /** Absent means "produce the summary, write nothing" — which is what a dry run wants. */
  readonly writer?: RiyaSyntheticArtifactWriter;
  /** Arms the run deadline. Injected so a spec can drive it without waiting out a wall clock. */
  readonly scheduler?: RiyaSyntheticScheduler;
  /** The protected exam. Reaches the validator, and nothing else, ever. */
  readonly protectedIndex?: RiyaSyntheticProtectedIndex;
}

/** One line of the candidate index. Identities and closed codes; never dialogue. */
export interface RiyaSyntheticCandidateIndexRowV1 {
  readonly scenarioRef: string;
  readonly generationRef: string;
  readonly status: RiyaSyntheticRunOutcomeV1['status'];
  readonly errorCode?: string;
  readonly teacherConfigRef: string;
  readonly criticConfigRefs: readonly string[];
  readonly trajectoryId?: string;
}

export interface RiyaSyntheticPilotResultV1 {
  readonly planRef: string;
  readonly mode: RiyaSyntheticExecutionMode;
  readonly plannedCandidates: number;
  readonly generatedCandidates: number;
  readonly failedCandidates: number;
  readonly notStartedCandidates: number;
  /**
   * AS1's own count of accepted EVIDENCE records. Not recomputed, and not a count of trajectories.
   *
   * Named for what it counts. `acceptedTrajectories` was the earlier name and it conflated two
   * different things: an evidence record is what AS1 counts, and a corpus can hold clean evidence
   * while still failing a corpus-level rule.
   */
  readonly acceptedEvidenceCount: number;
  readonly blockingFindings: number;
  /** AS1's corpus-level verdict. A pilot is expected to fail this; that is what a pilot is for. */
  readonly corpusEligible: boolean;
  readonly stopReason?: RiyaSyntheticStopReason;
  readonly ledger: RiyaSyntheticSpendLedgerV1;
  readonly index: readonly RiyaSyntheticCandidateIndexRowV1[];
  /** Names of the artifacts written, with their digests. Empty when no writer was supplied. */
  readonly artifacts: readonly { readonly name: string; readonly sha256: string }[];
}

const EMPTY_LEDGER: RiyaSyntheticSpendLedgerV1 = Object.freeze({
  providerRequests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reservedOutputTokens: 0,
  peakReservedOutputTokens: 0,
  elapsedMs: 0,
});

/** JSON Lines. One self-contained object per line, so a partial file is still readable. */
function toJsonl(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
}

/**
 * Run a pilot.
 *
 * In `DRY_RUN` this makes ZERO provider calls and needs no transport and no credential.
 */
export async function executeRiyaSyntheticPilot(
  options: ExecuteRiyaSyntheticPilotOptions,
): Promise<RiyaSyntheticPilotResultV1> {
  const { plan, preflight, mode, now } = options;

  if (mode === 'DRY_RUN') {
    return Object.freeze({
      planRef: plan.planRef,
      mode,
      plannedCandidates: preflight.plannedCandidates,
      generatedCandidates: 0,
      failedCandidates: 0,
      notStartedCandidates: preflight.plannedCandidates,
      acceptedEvidenceCount: 0,
      blockingFindings: 0,
      corpusEligible: false,
      ledger: EMPTY_LEDGER,
      index: Object.freeze([]),
      artifacts: Object.freeze([]),
    });
  }

  // A family the plan uses with no transport is a wiring fault, and it must be found before the
  // orchestrator starts rather than as a candidate failure halfway through.
  if (preflight.requiresOpenaiCredential && options.openaiTransport === undefined) {
    throw new RiyaSyntheticPilotError('preflight-rejected');
  }
  if (preflight.requiresAnthropicCredential && options.anthropicTransport === undefined) {
    throw new RiyaSyntheticPilotError('preflight-rejected');
  }

  const controller = new AbortController();
  // The gate ARMS the run deadline here, which is the moment EXECUTE begins. It is disposed below,
  // so a finished pilot never leaves a timer behind.
  const gate = createRiyaSyntheticSpendGate({
    budget: plan.budget,
    now,
    controller,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
  });

  const invokers = new Map<string, RiyaSyntheticModelInvoker>();
  if (options.openaiTransport !== undefined && preflight.openaiModels.size > 0) {
    const invoker = gate.wrap(
      createOpenAiResponsesInvoker({
        transport: options.openaiTransport,
        models: preflight.openaiModels,
        onProviderFailure: gate.observeProviderFailure,
        // HARD, and always passed on an EXECUTE run: an over-large body is refused before transport.
        maxRequestInputUtf8Bytes: plan.budget.maxRequestInputUtf8Bytes,
      }),
    );
    for (const configRef of preflight.openaiModels.keys()) invokers.set(configRef, invoker);
  }
  if (options.anthropicTransport !== undefined && preflight.anthropicModels.size > 0) {
    const invoker = gate.wrap(
      createAnthropicMessagesInvoker({
        transport: options.anthropicTransport,
        models: preflight.anthropicModels,
        onProviderFailure: gate.observeProviderFailure,
        maxRequestInputUtf8Bytes: plan.budget.maxRequestInputUtf8Bytes,
      }),
    );
    for (const configRef of preflight.anthropicModels.keys()) invokers.set(configRef, invoker);
  }
  const registry: RiyaSyntheticInvokerRegistry = invokers;

  // The MINIMUM of policy and budget, rebuilt through the policy constructor so the effective values
  // are proved rather than assumed.
  const { version: _policyVersion, ...policyFields } = plan.policy;
  const effectivePolicy = createRiyaSyntheticGenerationPolicy({
    ...policyFields,
    maxConcurrentCandidates: Math.min(
      plan.policy.maxConcurrentCandidates,
      plan.budget.maxConcurrentCandidates,
    ),
    maxConcurrentInvocations: Math.min(
      plan.policy.maxConcurrentInvocations,
      plan.budget.maxConcurrentInvocations,
    ),
  });

  let run;
  try {
    run = await orchestrateRiyaSyntheticRun({
      items: preflight.items,
      inventory: plan.inventory,
      policy: effectivePolicy,
      invokers: registry,
      criticQualityDimensions: plan.criticQualityDimensions,
      signal: controller.signal,
    });
  } finally {
    // The deadline has done its job either way. Leaving it armed would fire an abort into a finished
    // run and, in a long-lived process, keep one timer alive per pilot.
    gate.dispose();
  }

  const index: RiyaSyntheticCandidateIndexRowV1[] = [];
  const candidates: RiyaSyntheticCandidateV1[] = [];
  for (const [position, outcome] of run.outcomes.entries()) {
    const item = preflight.items[position];
    /* c8 ignore next -- outcomes are placed at their input index, so this cannot be undefined */
    if (item === undefined) continue;
    if (outcome.candidate !== undefined) candidates.push(outcome.candidate);
    index.push({
      scenarioRef: outcome.scenarioRef,
      generationRef: item.allocation.generationRef,
      status: outcome.status,
      ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
      teacherConfigRef: item.allocation.riyaTeacherConfigRef,
      criticConfigRefs: item.allocation.criticConfigRefs,
      ...(outcome.candidate === undefined
        ? {}
        : { trajectoryId: outcome.candidate.trajectory.trajectoryId }),
    });
  }

  // AS1's acceptance, reused. The protected index enters here and nowhere else in this package.
  const validation = validateRiyaAiSyntheticCorpus({
    trajectories: candidates.map((one) => one.trajectory),
    scenarios: preflight.items.map((item) => item.scenario),
    provenances: candidates.map((one) => one.provenance),
    evidence: candidates.map((one) => one.evidence),
    policy: plan.acceptancePolicy,
    ...(options.protectedIndex === undefined ? {} : { protectedIndex: options.protectedIndex }),
  });

  // AS1 reports findings against trajectory ids. A candidate with no finding against it is one AS1
  // did not block; `eligible` is the corpus-level verdict and is reported separately, because a
  // corpus can fail on a policy-wide rule while every individual trajectory is clean.
  const faultedTrajectoryIds = new Set<string>(
    validation.report.findings
      .map((finding) => finding.trajectoryId)
      .filter((id): id is string => id !== undefined),
  );
  const ledger = gate.ledger();
  const stopReason = gate.stopReason();

  const artifacts: { name: string; sha256: string }[] = [];
  const writer = options.writer;
  if (writer !== undefined) {
    const manifest = {
      planRef: plan.planRef,
      mode,
      budgetRef: plan.budget.budgetRef,
      scheduledScenarios: preflight.scheduledScenarios,
      plannedCandidates: preflight.plannedCandidates,
      candidateCeilingApplied: preflight.scheduledScenarios > preflight.plannedCandidates,
      configs: preflight.configs,
      // Instruction identities, not instruction bodies. A prompt body in an artifact is a prompt body
      // in a repository the moment somebody copies the directory.
      instructionRefs: preflight.configs.map((one) => one.instructionRef),
      ledger,
      ...(stopReason === undefined ? {} : { stopReason }),
      peakConcurrentCandidates: run.peakConcurrentCandidates,
      peakConcurrentInvocations: run.peakConcurrentInvocations,
    };
    // NAMED for what they are. An earlier version called these `accepted-pilot.jsonl` and
    // `rejected-pilot.jsonl`, which claimed more than AS1 had proved: AS1's `eligible` is a
    // CORPUS-level verdict, and a corpus-level blocker carries no trajectory id at all -- so rows
    // could look "accepted" inside an ineligible corpus. These names say only what the partition
    // means: whether AS1 raised a finding against that trajectory. Acceptance is the report's word,
    // and the report is the authority.
    const cleanRows = index.filter(
      (row) => row.trajectoryId !== undefined && !faultedTrajectoryIds.has(row.trajectoryId),
    );
    const blockedRows = index.filter(
      (row) => row.trajectoryId === undefined || faultedTrajectoryIds.has(row.trajectoryId),
    );

    /**
     * The canonical generated evidence, one row per candidate.
     *
     * Without this a pilot spends real money and leaves nothing to look at: the index carries refs
     * and statuses, and a reviewer deciding whether the next stage is worth running needs the
     * generated behaviour itself. Every field is a canonical AS1/AS2 artifact -- trajectory,
     * provenance, critic verdicts, acceptance evidence -- and nothing else: no raw provider request
     * or response, no prompt body, no reasoning, no thinking block, no credential, no protected exam.
     *
     * It is ignored local pilot evidence. It is not a production corpus and not a training approval.
     */
    const generatedRows = candidates.map((candidate) => ({
      scenarioRef: candidate.provenance.scenarioRef,
      generationRef: candidate.provenance.generationRef,
      trajectory: candidate.trajectory,
      provenance: candidate.provenance,
      verdicts: candidate.verdicts,
      evidence: candidate.evidence,
    }));

    for (const [name, contents] of [
      ['run-manifest.json', JSON.stringify(manifest, null, 2)],
      ['candidate-index.jsonl', toJsonl(index)],
      ['generated-candidates.jsonl', toJsonl(generatedRows)],
      ['evidence-clean-index.jsonl', toJsonl(cleanRows)],
      ['evidence-blocked-index.jsonl', toJsonl(blockedRows)],
      // Every AS1 finding, with the trajectory it names -- or none, for a corpus-level one.
      ['trajectory-findings.jsonl', toJsonl(validation.report.findings)],
      ['acceptance-report.json', JSON.stringify(validation.report, null, 2)],
      [
        'diversity-report.json',
        JSON.stringify(
          riyaAiSyntheticDiversityMetrics(candidates.map((one) => one.trajectory)),
          null,
          2,
        ),
      ],
      ['usage-report.json', JSON.stringify({ ledger, stopReason: stopReason ?? null }, null, 2)],
    ] as const) {
      const written = await writer.write(name, contents);
      artifacts.push({ name: written.name, sha256: written.sha256 });
    }
  }

  return Object.freeze({
    planRef: plan.planRef,
    mode,
    plannedCandidates: preflight.plannedCandidates,
    generatedCandidates: index.filter((row) => row.status === 'GENERATED').length,
    failedCandidates: index.filter((row) => row.status === 'FAILED').length,
    notStartedCandidates: index.filter((row) => row.status === 'NOT_STARTED').length,
    acceptedEvidenceCount: validation.report.acceptedEvidenceCount,
    blockingFindings: validation.report.findings.length,
    corpusEligible: validation.report.eligible,
    ...(stopReason === undefined ? {} : { stopReason }),
    ledger,
    index: Object.freeze(index),
    artifacts: Object.freeze(artifacts),
  });
}
