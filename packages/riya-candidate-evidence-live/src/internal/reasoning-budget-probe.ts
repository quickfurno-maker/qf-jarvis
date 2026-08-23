/**
 * The shared one-probe primitive behind every low-reasoning budget differential (POST-RLD1).
 *
 * INTERNAL. Nothing here is exported from the package root: a caller who could build one of these
 * directly could choose its own budget, and choosing a budget is exactly the governed decision a run
 * goal exists to make.
 *
 * ### Why this was extracted rather than copied
 *
 * RLD1 sent the neutral production request at `reasoning_effort='low'` and
 * `max_completion_tokens=4096`, and the provider returned `json_validate_failed`. The next question
 * moves ONE field: the same request at 8192.
 *
 * Two independently written ports could each send "the same request", and the claim that they
 * differed in one key would then rest entirely on a spec comparing two separate code paths. Built
 * here instead, provider construction is CENTRALISED: the model, the endpoint, the transport, the
 * config, the capability ceiling and the adapter are decided by this file, once, for every caller.
 *
 * Be precise about what that does and does not establish. This runner still ACCEPTS `completionBudget`
 * and `reasoningEffort` as parameters, and each run supplies its own probe metadata — so the
 * primitive alone does not make a one-variable run impossible to break.
 *
 * What holds the current guarantee is the combination: for the TWO governed callers, the effort is
 * read from one shared constant, the messages and schema come from one shared neutral capture,
 * provider construction happens here, and a spec diffs the two RECORDED WIRE BODIES and requires
 * exactly one changed key. Centralisation removes the ways they could drift silently; the shared
 * references and that test are what pin the values.
 *
 * ### What is deliberately NOT shared
 *
 * The step id, the classification vocabulary, the emitters, the ledger counter, the run goal and the
 * exit code all stay per-run. A receipt must always be able to say which budget produced it, and a
 * shared token would make RLD1's immutable evidence unreadable. This file is generic over the step
 * id precisely so the identifier cannot be shared by accident.
 *
 * The reasoning EFFORT is a parameter here rather than a constant, but every current caller passes
 * `'low'`: RLD1 fixed that posture, and the budget differential holds it fixed on purpose. A caller
 * that moved both at once would be running a two-variable experiment, which is why the goal — not
 * this file — decides.
 */
import {
  createFetchGroqTransport,
  createGroqChatReasoningDiagnosticProvider,
  createGroqProviderConfig,
  createSystemClock,
  GroqApiKey,
} from '@qf-jarvis/model-gateway';
import type {
  GroqChatReasoningDiagnosticInput,
  GroqChatReasoningDiagnosticProvider,
  GroqGptOssReasoningEffort,
  GroqProviderConfig,
  GroqTransport,
  ModelUsage,
} from '@qf-jarvis/model-gateway';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_SUPPORTS_STRICT_JSON,
  CANDIDATE_CATALOG_SNAPSHOT,
} from '../candidate-release.js';
import { createCandidateTransportObservations } from '../candidate-transport-observation.js';
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
  CandidateTransportObservations,
} from '../candidate-transport-observation.js';
import type {
  ProjectStructuredResult,
  StructuredWireSchema,
} from '../diagnostic-canary-materials.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';

/** What one probe did, at the provider boundary AND at the local validator. Content-free. */
export interface ReasoningBudgetObservation<TStepId extends string> {
  readonly stepId: TStepId;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
  /** Whether the full production projector was reached at all. False unless a document came back. */
  readonly localValidationCompleted: boolean;
  /** What it said. Meaningless — and always false — unless `localValidationCompleted`. */
  readonly localValidationPassed: boolean;
  /**
   * POST-SFD1. WHICH STAGE of local validation refused, as two independent booleans per stage.
   *
   * ### Why this exists
   *
   * SFD1's unauthorized duplicate observation returned HTTP 200 and then
   * `localValidationCompleted=true` / `localValidationPassed=false`. That says production refused
   * the document and nothing else. It cannot say whether the document failed the WIRE SHAPE the
   * provider was asked for, or passed the shape and then failed a later production invariant --
   * grounded citations, the canonical observation batch, availability refs, the reducer, the
   * prospective state, the next-question plan. Those two point at completely different next steps,
   * and the receipt could not tell them apart.
   *
   * Both authorities already travel with the captured request, so no second validator is written
   * here and none may be: `structuredWireSchema.safeParse` is the gateway's own first stage, and
   * `projectStructuredResult` is production's own acceptance authority.
   *
   * ### The policy, chosen deliberately
   *
   * When the provider completes, BOTH stages run, and the projector runs even if the wire parse
   * already failed. That keeps `localValidationPassed` byte-identical to what it has always been --
   * it is still exactly the projector's verdict -- so this addition cannot move any existing
   * classification. The localization is carried by the PAIR, not by suppressing a stage.
   *
   * A wire failure implies a production failure by construction, since the projector's own first
   * stage is that same parse; a spec pins that rather than leaving it as an assumption.
   */
  readonly wireValidationCompleted: boolean;
  readonly wireValidationPassed: boolean;
  readonly productionValidationCompleted: boolean;
  readonly productionValidationPassed: boolean;
}

/** What one probe run produced: the observation, and the usage the ledger must settle with. */
export interface ReasoningBudgetRunResult<TStepId extends string> {
  readonly outcome: ReasoningBudgetObservation<TStepId>;
  /**
   * The provider-reported usage, when there was any.
   *
   * Handed up so the operator can call `ledger.settle(usage, …)` rather than
   * `ledger.settle(undefined, …)`. Absent means the provider reported nothing, and the ledger's
   * conservative bound then applies and is labelled as one.
   */
  readonly usage?: ModelUsage;
}

/** What the port learned from one invocation. */
export interface ReasoningBudgetSeamResult {
  readonly providerCompleted: boolean;
  readonly structuredValue?: unknown;
  /** Present only when the provider REPORTED usage. Absent is absent, never zero. */
  readonly usage?: ModelUsage;
}

/** The narrow seam the runner invokes. Deliberately not the gateway's provider contract. */
export interface ReasoningBudgetSeam {
  readonly invoke: (input: {
    readonly messages: readonly {
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }[];
    readonly structuredJsonSchema: unknown;
    readonly maxCompletionTokens: number;
    readonly reasoningEffort: GroqGptOssReasoningEffort;
    readonly signal: AbortSignal;
  }) => Promise<ReasoningBudgetSeamResult>;
}

export interface ReasoningBudgetRunnerDeps<TStepId extends string> {
  readonly stepId: TStepId;
  /** THE variable across runs. Every other input to the request is fixed by this file. */
  readonly completionBudget: number;
  /** Fixed at `'low'` by both current callers: the value RLD1 sent, HELD rather than re-tested. */
  readonly reasoningEffort: GroqGptOssReasoningEffort;
  readonly providerForCompletionBudget: (budget: number) => ReasoningBudgetSeam;
  readonly observations: CandidateTransportObservations;
  /**
   * The FULL production acceptance authority, carried through the capture.
   *
   * Injected rather than imported so the runner cannot acquire a second opinion about what
   * production accepts. It remains the ONLY thing that decides `localValidationPassed`: the wire
   * schema below localizes a refusal, it never overrules this.
   */
  readonly projectStructuredResult: ProjectStructuredResult;
  /**
   * POST-SFD1. The gateway's own first-stage structured schema, from the SAME captured request.
   *
   * Optional so every pre-existing caller is untouched: without it the two wire fields report
   * `false`/`false` and nothing else moves. Supplied, it localizes a 2xx refusal into "failed the
   * shape" versus "passed the shape and failed a later production invariant".
   *
   * `safeParse` is the only thing ever called on it, and only its boolean survives -- no issue list,
   * no path, no offending value.
   */
  readonly structuredWireSchema?: StructuredWireSchema;
}

/** Build the runner for ONE probe. */
export function createReasoningBudgetProbeRunner<TStepId extends string>(
  deps: ReasoningBudgetRunnerDeps<TStepId>,
): (probe: DiagnosticProbe<TStepId>) => Promise<ReasoningBudgetRunResult<TStepId>> {
  return async (probe: DiagnosticProbe<TStepId>): Promise<ReasoningBudgetRunResult<TStepId>> => {
    const provider = deps.providerForCompletionBudget(deps.completionBudget);
    let providerCompleted = false;
    let localValidationCompleted = false;
    let localValidationPassed = false;
    let wireValidationCompleted = false;
    let wireValidationPassed = false;
    let productionValidationCompleted = false;
    let productionValidationPassed = false;
    let usage: ModelUsage | undefined;
    await deps.observations.duringCase(probe.stepId, async () => {
      let structuredValue: unknown;
      try {
        const result = await provider.invoke({
          messages: probe.messages,
          structuredJsonSchema: probe.schema,
          maxCompletionTokens: deps.completionBudget,
          reasoningEffort: deps.reasoningEffort,
          signal: new AbortController().signal,
        });
        providerCompleted = result.providerCompleted;
        structuredValue = result.structuredValue;
        // Token COUNTS only. The gateway's `ModelUsage` carries integers and nothing else — no text,
        // no ids, no headers — so propagating it cannot carry content out of the provider boundary.
        usage = result.usage;
      } catch {
        // The thrown object is never read, so nothing it carries can reach the record below.
        providerCompleted = false;
        return;
      }
      if (!providerCompleted) {
        // Nothing came back to validate. The projector is NOT run, and a check that never ran must
        // not report a verdict — `localValidationCompleted` stays false and the classifier reads it.
        return;
      }
      // The FULL production acceptance authority, run exactly as the M4 adapter runs it.
      //
      // The projection is consumed as a presence check and discarded in this statement: only the
      // boolean survives it. A projector that throws is a refusal like any other, and the thrown
      // object is never read.
      localValidationCompleted = true;
      // STAGE 1 -- the wire shape, using the gateway's own schema from this same captured request.
      // Only the boolean survives: zod's issues quote the values that failed, and those values are
      // the model's answer.
      if (deps.structuredWireSchema !== undefined) {
        wireValidationCompleted = true;
        try {
          wireValidationPassed = deps.structuredWireSchema.safeParse(structuredValue).success;
        } catch {
          wireValidationPassed = false;
        }
      }
      // STAGE 2 -- the FULL production authority, run REGARDLESS of stage 1's answer.
      //
      // Running it unconditionally is what keeps `localValidationPassed` exactly what it has always
      // been. Skipping it after a wire failure would have been defensible -- the refusal is already
      // localized -- but it would make this field's meaning depend on a stage that did not exist
      // when the historical receipts were written.
      productionValidationCompleted = true;
      try {
        localValidationPassed = deps.projectStructuredResult(structuredValue) !== undefined;
      } catch {
        // A throw is a refusal like any other, and the thrown object is never read.
        localValidationPassed = false;
      }
      productionValidationPassed = localValidationPassed;
    });
    const observed = deps.observations.observationFor(probe.stepId);
    const outcome: ReasoningBudgetObservation<TStepId> = Object.freeze({
      stepId: deps.stepId,
      providerTransportStarted: observed.providerTransportStarted,
      providerHttpStatus: observed.providerHttpStatus,
      providerHttpClass: observed.providerHttpClass,
      providerErrorType: observed.providerErrorType,
      providerErrorCode: observed.providerErrorCode,
      providerCompleted,
      localValidationCompleted,
      localValidationPassed,
      wireValidationCompleted,
      wireValidationPassed,
      productionValidationCompleted,
      productionValidationPassed,
    });
    return Object.freeze({ outcome, ...(usage === undefined ? {} : { usage }) });
  };
}

/** The provider factory, plus everything a spec needs to assert about what it built. */
export interface ReasoningBudgetProviderFactory {
  readonly providerForCompletionBudget: (budget: number) => ReasoningBudgetSeam;
  readonly observations: CandidateTransportObservations;
  readonly requestCompletionBudgetsUsed: () => readonly number[];
  readonly capabilityCeilingsUsed: () => readonly number[];
  readonly candidateModelsUsed: () => readonly string[];
  readonly endpointsUsed: () => readonly string[];
  readonly reasoningEffortsUsed: () => readonly GroqGptOssReasoningEffort[];
}

/**
 * Build the provider factory every low-reasoning budget run shares.
 *
 * The model, the capability ceiling, the endpoint (through the Chat Completions transport factory),
 * the adapter and the config are all decided HERE, once. A run supplies a credential, an optional
 * fake transport, and a budget — and the budget is the only one of those that changes what reaches
 * the wire.
 *
 * The Responses transport factory is deliberately not read here, and its SSRF guard would refuse
 * this endpoint anyway: the two transports cannot reach each other's URL.
 */
export function createReasoningBudgetProviderFactory(deps: {
  readonly credential: unknown;
  readonly openTransport?: () => GroqTransport;
  /** The error thrown when the credential is not a bound Groq key. Per-run, so it names the run. */
  readonly unboundCredentialError: string;
  /**
   * WHICH governed diagnostic adapter speaks the wire. Defaults to the reasoning-effort adapter that
   * RLD1 and RBD1 used.
   *
   * A parameter rather than a constant because POST-RBD1 varies exactly this: the best-effort adapter
   * builds its body by DERIVING from the reasoning adapter's and flipping one leaf, so the two differ
   * in `response_format.json_schema.strict` and in nothing else. Both take the same input, return the
   * same provider-neutral result, and run through the same shared Chat Completions exchange inside
   * the gateway -- so one response cannot classify two ways between them.
   *
   * It is deliberately NOT a production seam: every adapter reachable here is diagnostic-only, and
   * the config handed to it is built below from the production candidate constants.
   */
  readonly createProvider?: (
    config: GroqProviderConfig,
    clock: ReturnType<typeof createSystemClock>,
  ) => GroqChatReasoningDiagnosticProvider;
}): ReasoningBudgetProviderFactory {
  const apiKey: unknown = deps.credential;
  if (!(apiKey instanceof GroqApiKey)) {
    // Fails CLOSED, before the probe. Nothing about the value is read, printed or retained.
    throw new Error(deps.unboundCredentialError);
  }

  const clock = createSystemClock();
  const observations = createCandidateTransportObservations();
  const endpointsUsed: string[] = [];
  const underlying = (deps.openTransport ?? createFetchGroqTransport)();
  const observedTransport = observations.observe(
    Object.freeze({
      send: (request: Parameters<GroqTransport['send']>[0], signal: AbortSignal) => {
        // Recorded so a spec can assert the CONTRACT on the wire rather than trusting the factory
        // name. The URL is an endpoint identifier, never request content.
        endpointsUsed.push(request.url);
        return underlying.send(request, signal);
      },
    }),
  );

  const requestCompletionBudgetsUsed: number[] = [];
  const capabilityCeilingsUsed: number[] = [];
  const candidateModelsUsed: string[] = [];
  const reasoningEffortsUsed: GroqGptOssReasoningEffort[] = [];

  const providerForCompletionBudget = (budget: number): ReasoningBudgetSeam => {
    requestCompletionBudgetsUsed.push(budget);
    const config = createGroqProviderConfig({
      providerId: CANDIDATE_PROVIDER_ID,
      // The PRODUCTION candidate. The model is a thing every one of these differentials holds fixed.
      modelId: CANDIDATE_MODEL_ID,
      modelVersion: CANDIDATE_CATALOG_SNAPSHOT,
      executionClass: 'HOSTED',
      maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      // The MODEL CAPABILITY ceiling — 65,536, and NOT the per-request budget. Held fixed at the
      // value every earlier gate used; a diagnostic may narrow the request, never widen the ceiling.
      maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
      apiKey,
      transport: observedTransport,
      dataControlsAttested: true,
    });
    capabilityCeilingsUsed.push(config.maxCompletionTokens);
    candidateModelsUsed.push(config.modelId);
    // The governed diagnostic adapter for THIS run. Defaults to the merged reasoning-effort adapter;
    // POST-RBD1 supplies the best-effort one, whose body is derived from this one's.
    const provider = (deps.createProvider ?? createGroqChatReasoningDiagnosticProvider)(
      config,
      clock,
    );
    return {
      invoke: async (input: GroqChatReasoningDiagnosticInput) => {
        reasoningEffortsUsed.push(input.reasoningEffort);
        const result = await provider.invoke({ ...input, maxCompletionTokens: budget });
        if (result.status !== 'completed') {
          // A non-completion carries no usage worth settling. The transport observation already
          // recorded WHAT happened; nothing else about the result is read.
          return { providerCompleted: false };
        }
        return {
          providerCompleted: true,
          ...(result.output.mode === 'STRUCTURED' ? { structuredValue: result.output.value } : {}),
          // Propagated when the provider reported it. The field the historical seams dropped.
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        };
      },
    };
  };

  return Object.freeze({
    providerForCompletionBudget,
    observations,
    requestCompletionBudgetsUsed: () => Object.freeze([...requestCompletionBudgetsUsed]),
    capabilityCeilingsUsed: () => Object.freeze([...capabilityCeilingsUsed]),
    candidateModelsUsed: () => Object.freeze([...candidateModelsUsed]),
    endpointsUsed: () => Object.freeze([...endpointsUsed]),
    reasoningEffortsUsed: () => Object.freeze([...reasoningEffortsUsed]),
  });
}
