/**
 * The POST-SFD1 strict-false LOCAL-VALIDATION LOCALIZATION port (future live label SFD2).
 *
 * ### The question, and why it needed a run at all
 *
 * SFD1's CANONICAL result was HTTP 413 — the provider judged the request and refused it, so neither
 * local stage ran and no local verdict exists. An unauthorized second execution, NONCANONICAL and
 * not evidence about the authorized run, observed HTTP 200 with the document refused by production.
 *
 * That refusal has two readings pointing at completely different investigations: the document failed
 * the WIRE SHAPE the provider was asked for, or it passed the shape and failed a later production
 * invariant. `localValidationPassed=false` cannot tell them apart, and the receipt is all anybody
 * has after a live run.
 *
 * ### Nothing on the wire changes, and the construction is what makes that true
 *
 * This port supplies NO wire parameter of its own. The budget and the effort are read from SFD1's
 * identity; the provider factory is the SAME shared primitive with the SAME best-effort adapter; the
 * probe is DERIVED from SFD1's probe rather than re-planned, so the messages and the schema are the
 * same objects.
 *
 * The one thing this port adds is `structuredWireSchema` — a LOCAL validator, from the same captured
 * request, which the runner calls after a completion and never sends anywhere. A spec byte-compares
 * the two serialized bodies at the transport boundary to prove the wire is untouched.
 *
 * ### Both authorities come from the capture, and neither is written here
 *
 * `structuredWireSchema.safeParse` is the gateway's own first stage; `projectStructuredResult` is
 * production's own acceptance authority. There is no hand-authored Riya validator in this lane and
 * there must never be one — a shadow validator drifts from production and starts reporting refusals
 * production would not make, which is worse than the ambiguity being removed.
 *
 * Only booleans survive either stage. Zod's issues quote the values that failed, and those values
 * are the model's answer.
 */
import { createGroqChatBestEffortDiagnosticProvider } from '@qf-jarvis/model-gateway';
import type {
  GroqGptOssReasoningEffort,
  GroqTransport,
  ModelUsage,
} from '@qf-jarvis/model-gateway';

import type { CandidateTransportObservations } from './candidate-transport-observation.js';
import type {
  CapturedProductionRiyaRequest,
  ProjectStructuredResult,
  StructuredWireSchema,
} from './diagnostic-canary-materials.js';
import {
  planStrictFalseLocalizationProbe,
  STRICT_FALSE_LOCALIZATION_STEP_ID,
} from './internal/operational-acceptance-plan.js';
import type {
  DiagnosticProbe,
  StrictFalseLocalizationStepId,
} from './internal/operational-acceptance-plan.js';
import {
  createReasoningBudgetProbeRunner,
  createReasoningBudgetProviderFactory,
} from './internal/reasoning-budget-probe.js';
import type {
  ReasoningBudgetObservation,
  ReasoningBudgetSeam,
} from './internal/reasoning-budget-probe.js';
import { captureNeutralClientRiyaRequest } from './neutral-client-diagnostic-request.js';
import {
  STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET,
  STRICT_FALSE_LOCALIZATION_REASONING_EFFORT,
} from './strict-false-localization-identity.js';

/** The probe this run sends. One, ever. */
export type StrictFalseLocalizationProbe = DiagnosticProbe<StrictFalseLocalizationStepId>;

/** What the ONE probe observed, at the provider boundary and at BOTH local stages. Content-free. */
export type StrictFalseLocalizationOutcome =
  ReasoningBudgetObservation<StrictFalseLocalizationStepId>;

/**
 * The completion budget, HELD at SFD1's 8,192.
 *
 * Read from the localization identity, which reads it from SFD1's, which reads it from RBD1's. There
 * is no literal on this path a future edit could move while a receipt still claimed an identical
 * request.
 */
export const STRICT_FALSE_LOCALIZATION_OUTPUT_BUDGET = STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET;

export interface StrictFalseLocalizationPortDeps {
  readonly providerForCompletionBudget: (budget: number) => ReasoningBudgetSeam;
  readonly observations: CandidateTransportObservations;
  /** STAGE 2. The FULL production acceptance authority, carried through the capture. */
  readonly projectStructuredResult: ProjectStructuredResult;
  /**
   * STAGE 1. The gateway's own first-stage structured schema, from the SAME captured request.
   *
   * REQUIRED here, unlike on the shared runner where it is optional for backward compatibility. A
   * localization run without the wire stage would classify `STRUCTURED_REPLY_INCONCLUSIVE` on every
   * 2xx — it would spend a live authorization to learn nothing, which is the exact failure this lane
   * exists to prevent.
   */
  readonly structuredWireSchema: StructuredWireSchema;
}

/** What one probe run produced: the outcome record, and the usage the ledger must settle with. */
export interface StrictFalseLocalizationRunResult {
  readonly outcome: StrictFalseLocalizationOutcome;
  /** Present only when the provider REPORTED usage. Absent means the ledger's bound applies. */
  readonly usage?: ModelUsage;
}

/** Build the runner for the ONE probe, at the held budget and effort, with BOTH stages wired. */
export function createStrictFalseLocalizationPort(
  deps: StrictFalseLocalizationPortDeps,
): (probe: StrictFalseLocalizationProbe) => Promise<StrictFalseLocalizationRunResult> {
  return createReasoningBudgetProbeRunner({
    stepId: STRICT_FALSE_LOCALIZATION_STEP_ID,
    // HELD, both. Neither is a variable of this run, and neither is spelled out here.
    completionBudget: STRICT_FALSE_LOCALIZATION_OUTPUT_BUDGET,
    reasoningEffort: STRICT_FALSE_LOCALIZATION_REASONING_EFFORT,
    providerForCompletionBudget: deps.providerForCompletionBudget,
    observations: deps.observations,
    projectStructuredResult: deps.projectStructuredResult,
    // The ONE addition, and it never reaches the wire.
    structuredWireSchema: deps.structuredWireSchema,
  });
}

export interface LiveStrictFalseLocalizationDeps {
  readonly credential: unknown;
  /** Production: the shared factory's `createFetchGroqTransport()`. Specs: a deterministic fake. */
  readonly openTransport?: () => GroqTransport;
  readonly captured?: CapturedProductionRiyaRequest;
  readonly projectedSchema?: unknown;
}

/** What the composition built, exposed so a spec can assert the parts as well as the behaviour. */
export interface LiveStrictFalseLocalizationComposition {
  /** The ONE probe. Never a list — the shape itself says only one request is sent. */
  readonly probe: StrictFalseLocalizationProbe;
  readonly run: (probe: StrictFalseLocalizationProbe) => Promise<StrictFalseLocalizationRunResult>;
  readonly observations: CandidateTransportObservations;
  /** Request budgets asked for. Expect exactly one, and expect it to be SFD1's 8,192. */
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  /** Capability ceilings the built configs declared. Expect 65,536, unchanged from every gate. */
  readonly capabilityCeilingsUsed: () => readonly number[];
  readonly candidateModelsUsed: () => readonly string[];
  readonly endpointsUsed: () => readonly string[];
  /** Efforts asked for. Expect exactly one, and expect `'low'` — the held posture. */
  readonly reasoningEffortsUsed: () => readonly GroqGptOssReasoningEffort[];
}

/** Build the composition over the already-captured, already-projected NEUTRAL request. */
export function createLiveStrictFalseLocalizationComposition(
  deps: LiveStrictFalseLocalizationDeps & {
    readonly captured: CapturedProductionRiyaRequest;
    readonly projectedSchema: unknown;
  },
): LiveStrictFalseLocalizationComposition {
  const factory = createReasoningBudgetProviderFactory({
    credential: deps.credential,
    ...(deps.openTransport === undefined ? {} : { openTransport: deps.openTransport }),
    unboundCredentialError: 'QFJ_STRICT_FALSE_LOCALIZATION_CREDENTIAL_NOT_BOUND',
    // The SAME best-effort adapter SFD1 used, not a second implementation of it. Its body is derived
    // from the reasoning adapter's, so `json_schema` mode, the schema name and the schema body are
    // whatever the strict path produced and only `strict` is flipped.
    createProvider: createGroqChatBestEffortDiagnosticProvider,
  });

  // DERIVED from SFD1's probe, not re-planned. The schema and the messages are the same objects.
  const probe = planStrictFalseLocalizationProbe({
    projectedSchema: deps.projectedSchema,
    neutralMessages: deps.captured.messages,
  });

  const run = createStrictFalseLocalizationPort({
    providerForCompletionBudget: factory.providerForCompletionBudget,
    observations: factory.observations,
    // BOTH authorities, from the SAME capture. Neither is rebuilt and neither is optional here.
    projectStructuredResult: deps.captured.projectStructuredResult,
    structuredWireSchema: deps.captured.structuredWireSchema,
  });

  return Object.freeze({
    probe,
    run,
    observations: factory.observations,
    requestCompletionBudgetsUsed: factory.requestCompletionBudgetsUsed,
    capabilityCeilingsUsed: factory.capabilityCeilingsUsed,
    candidateModelsUsed: factory.candidateModelsUsed,
    endpointsUsed: factory.endpointsUsed,
    reasoningEffortsUsed: factory.reasoningEffortsUsed,
  });
}

/** What the operator receives: the ONE probe, and the runner bound to the credential. */
export interface StrictFalseLocalizationRunner {
  readonly probe: StrictFalseLocalizationProbe;
  readonly run: (probe: StrictFalseLocalizationProbe) => Promise<StrictFalseLocalizationRunResult>;
}

/**
 * The seam `bin.ts` passes to the operator.
 *
 * Captures the SAME neutral request SFD1 used and projects ONCE before the probe exists. A failure
 * in either throws, which the operator turns into a closed bind failure before any request is spent.
 */
export async function openLiveStrictFalseLocalizationRunner(
  deps: LiveStrictFalseLocalizationDeps & {
    readonly projectSchema: (rawSchema: unknown) => unknown;
  },
): Promise<StrictFalseLocalizationRunner> {
  const captured = deps.captured ?? (await captureNeutralClientRiyaRequest());
  const projectedSchema =
    deps.projectedSchema ?? deps.projectSchema(captured.rawStructuredJsonSchema);
  const composition = createLiveStrictFalseLocalizationComposition({
    ...deps,
    captured,
    projectedSchema,
  });
  return Object.freeze({ probe: composition.probe, run: composition.run });
}
