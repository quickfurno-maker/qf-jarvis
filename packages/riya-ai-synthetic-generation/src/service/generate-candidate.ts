/**
 * Turn-by-turn candidate generation (AS2, ADR-0143 §6).
 *
 * ### One turn at a time, and neither side sees the future
 *
 * There is deliberately no "write me a ten-turn conversation" call anywhere in this package. Asking
 * one model for a whole transcript scripts both sides at once: the customer's later objection is
 * written by something that already knows the answer, corrections arrive exactly where they are most
 * convenient, and the result is a conversation nobody could have had. It reads beautifully and
 * teaches the model that customers cooperate.
 *
 * So the loop alternates. The simulator writes one USER turn from the visible history; the teacher
 * writes one ASSISTANT turn from the visible history; neither input type has a field the other's
 * future could arrive through.
 *
 * ### Every result is untrusted until a constructor says otherwise
 *
 * Parse bounded bytes, apply a strict schema, then build the turn through the dataset's own
 * constructor. A model that returned a plausible object still has not produced a turn until
 * `createRiyaDatasetAssistantTurn` says so.
 *
 * ### Repair is transport-only, and capped
 *
 * One retry, for bytes that were not JSON. A candidate whose conversation is merely poor is REJECTED
 * — never re-rolled in place. Retrying until something passes turns the acceptance gate into a
 * search target, and the corpus ends up optimised for whatever the gate cannot see.
 */
import {
  createRiyaDatasetAssistantTurn,
  createRiyaDatasetAuthoritativeContextTurn,
  createRiyaDatasetUserTurn,
  createRiyaIntelligenceTrajectory,
  createRiyaTrainingState,
} from '@qf-jarvis/riya-intelligence-dataset';
import { RIYA_DATASET_QUALITY_DIMENSIONS } from '@qf-jarvis/riya-intelligence-dataset';
import type {
  RiyaDatasetQualityDimension,
  RiyaDatasetTurnV1,
  RiyaIntelligenceTrajectoryV1,
} from '@qf-jarvis/riya-intelligence-dataset';
import {
  createRiyaAiSyntheticScenario,
  createRiyaAiSyntheticCriticVerdict,
  createRiyaAiSyntheticGenerationProvenance,
  createRiyaAiSyntheticTrajectoryAcceptanceEvidence,
  riyaAiSyntheticProvenanceSha256,
  riyaAiSyntheticScenarioSha256,
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type {
  RiyaAiSyntheticCriticVerdictV1,
  RiyaAiSyntheticGenerationProvenanceV1,
  RiyaAiSyntheticScenarioV1,
  RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1,
} from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';

import { RiyaSyntheticGenerationError } from '../contracts/errors.js';
import { createRiyaSyntheticInvocationRequest } from '../contracts/invocation.js';
import type { RiyaSyntheticConfigInventoryV1 } from '../contracts/model-config.js';
import { configFor } from '../contracts/model-config.js';
import {
  criticOutputSchema,
  customerTurnOutputSchema,
  parseRiyaSyntheticModelOutput,
  teacherTurnOutputSchema,
  verifierOutputSchema,
} from '../contracts/model-output.js';
import type { RiyaSyntheticGenerationPolicyV1 } from '../contracts/policy.js';
import type { RiyaSyntheticRoleAllocationV1 } from '../contracts/role-allocation.js';
import { resolveRiyaSyntheticRoleAllocation } from '../contracts/role-allocation.js';
import type {
  RiyaSyntheticAvailableAuthorityFactV1,
  RiyaSyntheticVisibleTurn,
} from '../contracts/role-input.js';
import { customerScenarioView, teacherScenarioView } from '../contracts/role-input.js';
import { createRiyaSyntheticConfigInventory } from '../contracts/model-config.js';
import { createRiyaSyntheticGenerationPolicy } from '../contracts/policy.js';
import { createRiyaSyntheticRoleAllocation } from '../contracts/role-allocation.js';
import type { RiyaSyntheticRole } from '../contracts/model-config.js';
import type { RiyaSyntheticModelInvoker } from '../ports/model-invoker.js';
import { sha256OfCanonical } from '../internal/digest.js';
import { createRiyaSyntheticConcurrencyGate } from '../internal/concurrency.js';
import type { RiyaSyntheticConcurrencyGate } from '../internal/concurrency.js';

/** Which invoker serves which configuration. Resolution is the caller's wiring, not ours. */
export type RiyaSyntheticInvokerRegistry = ReadonlyMap<string, RiyaSyntheticModelInvoker>;

export interface GenerateRiyaSyntheticCandidateOptions {
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly allocation: RiyaSyntheticRoleAllocationV1;
  readonly inventory: RiyaSyntheticConfigInventoryV1;
  readonly policy: RiyaSyntheticGenerationPolicyV1;
  readonly invokers: RiyaSyntheticInvokerRegistry;
  readonly criticQualityDimensions: readonly RiyaDatasetQualityDimension[];
  readonly signal?: AbortSignal;
}

/**
 * The INTERNAL shape, carrying the shared limiter.
 *
 * Deliberately not part of the public options. Exposing the gate would make concurrency enforcement
 * a parameter a caller could satisfy with a no-op function, defeating
 * `policy.maxConcurrentInvocations` from outside the package -- a hook is not a guarantee if anybody
 * can pass their own.
 */
interface InternalGenerateOptions extends GenerateRiyaSyntheticCandidateOptions {
  readonly invocationGate: RiyaSyntheticConcurrencyGate;
}

export interface RiyaSyntheticCandidateV1 {
  readonly trajectory: RiyaIntelligenceTrajectoryV1;
  readonly provenance: RiyaAiSyntheticGenerationProvenanceV1;
  readonly evidence: RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1;
  readonly verdicts: readonly RiyaAiSyntheticCriticVerdictV1[];
}

/** Every governed authority fact supplied EARLIER in this trajectory, with its value and class. */
function authorityFactsFrom(
  turns: readonly RiyaDatasetTurnV1[],
): readonly RiyaSyntheticAvailableAuthorityFactV1[] {
  return turns
    .filter((turn) => turn.type === 'AUTHORITATIVE_CONTEXT')
    .flatMap((turn) =>
      turn.facts.map((fact) => ({
        factRef: fact.factRef,
        factClass: fact.factClass,
        value: fact.value,
      })),
    );
}

/** The critic rubric, held to the canonical closed vocabulary. */
function reprovedCriticDimensions(
  dimensions: readonly RiyaDatasetQualityDimension[],
): readonly RiyaDatasetQualityDimension[] {
  const allowed: ReadonlySet<string> = new Set<string>(RIYA_DATASET_QUALITY_DIMENSIONS);
  if (
    dimensions.length === 0 ||
    new Set(dimensions).size !== dimensions.length ||
    dimensions.some((one) => !allowed.has(one))
  ) {
    throw new RiyaSyntheticGenerationError('invalid-generation-policy');
  }
  return Object.freeze([...dimensions]);
}

/**
 * Invoke one role and return trusted, parsed output.
 *
 * The attempt loop covers two DIFFERENT things, and keeps them separate: a bounded number of
 * transport retries for `TRANSIENT` failures, and at most one structural repair for bytes that were
 * not JSON. A schema mismatch is neither — a model that returned a well-formed object with the wrong
 * enum member will return it again, so re-asking is spend without a hypothesis.
 */
async function invokeRole<T>(
  options: InternalGenerateOptions,
  role: RiyaSyntheticRole,
  configRef: string,
  requestRef: string,
  structuredInput: unknown,
  schema: Parameters<typeof parseRiyaSyntheticModelOutput<T>>[1],
): Promise<T> {
  const invoker = options.invokers.get(configRef);
  if (invoker === undefined) {
    throw new RiyaSyntheticGenerationError('invalid-model-config');
  }
  const config = configFor(options.inventory, configRef);
  const { policy } = options;
  const gate = options.invocationGate;

  let transientLeft = policy.maxTransientRetries;
  let repairLeft = policy.maxStructuralRepairAttempts;
  let attempt = 1;

  for (;;) {
    if (options.signal?.aborted === true) {
      throw new RiyaSyntheticGenerationError('invocation-cancelled');
    }

    const request = createRiyaSyntheticInvocationRequest({
      requestRef: `${requestRef}.a${String(attempt)}`,
      generationRef: options.allocation.generationRef,
      scenarioRef: options.scenario.scenarioRef,
      role,
      configRef,
      inputDigest: sha256OfCanonical(structuredInput),
      outputSchemaRef: `${role}.v${String(config.outputSchemaVersion)}`,
      attempt,
      maxOutputTokens: config.maxOutputTokens,
    });

    // Every invocation gets its OWN controller, combined with whatever signal the candidate is
    // already running under. Losing a race does not stop the loser: without this, a timed-out call
    // keeps its socket open and keeps consuming tokens after AS2 has already rejected the attempt.
    // The candidate controller is deliberately NOT aborted here -- one slow call is not a reason to
    // end the conversation, and conflating them would make a single blip fail the whole candidate.
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const callController = new AbortController();
    const callSignal =
      options.signal === undefined
        ? callController.signal
        : AbortSignal.any([options.signal, callController.signal]);

    const lease = await gate();
    let outcome;
    try {
      // The invocation promise is held, not just raced. Racing decides when WE stop waiting; only
      // awaiting the promise itself tells us the provider work is actually over.
      const invocation = invoker.invoke(request, structuredInput, {
        signal: callSignal,
        timeoutMs: policy.perInvocationTimeoutMs,
      });

      const raced = await Promise.race([
        invocation.then((value) => ({ kind: 'SETTLED' as const, value })),
        new Promise<{ readonly kind: 'TIMEOUT' }>((resolve) => {
          timeoutTimer = setTimeout(() => {
            resolve({ kind: 'TIMEOUT' as const });
          }, policy.perInvocationTimeoutMs);
        }),
      ]);

      if (raced.kind === 'TIMEOUT') {
        // Abort, then DRAIN. Releasing the permit here -- before the call is over -- is what would
        // let a second invocation start while the first is still live, so real provider concurrency
        // could exceed the policy while the gate's own numbers looked compliant.
        callController.abort();
        await invocation.catch(() => undefined);
        throw new RiyaSyntheticGenerationError('invocation-timeout');
      }
      outcome = raced.value;
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      // Reached only after the call has settled -- normally, or by abort above.
      lease.release();
    }

    const { status } = outcome.result;
    if (status === 'CANCELLED') {
      throw new RiyaSyntheticGenerationError('invocation-cancelled');
    }
    if (status === 'TIMEOUT') {
      // Reported BY the adapter. The harness-side timeout is handled above, where the call is also
      // drained. Either way a timeout is a failed generation, never a verdict on the conversation.
      throw new RiyaSyntheticGenerationError('invocation-timeout');
    }
    if (status === 'PROVIDER_ERROR' || status === 'MALFORMED') {
      if (outcome.result.errorClass === 'TRANSIENT' && transientLeft > 0) {
        transientLeft -= 1;
        attempt += 1;
        continue;
      }
      throw new RiyaSyntheticGenerationError(
        outcome.result.errorClass === 'TRANSIENT'
          ? 'transient-provider-failure'
          : 'permanent-provider-failure',
      );
    }

    const payload = outcome.payload;
    if (payload === undefined) {
      throw new RiyaSyntheticGenerationError('invalid-invocation-result');
    }

    try {
      return parseRiyaSyntheticModelOutput(payload, schema);
    } catch (error) {
      const code =
        error instanceof RiyaSyntheticGenerationError ? error.code : 'invalid-model-output';
      // ONLY unparseable bytes are repairable. A schema mismatch is a different failure and is not
      // re-asked -- doing so is the first step toward retrying until something passes.
      if (code === 'invalid-model-output' && repairLeft > 0) {
        repairLeft -= 1;
        attempt += 1;
        continue;
      }
      if (code === 'invalid-model-output') {
        throw new RiyaSyntheticGenerationError('repair-exhausted');
      }
      throw new RiyaSyntheticGenerationError('output-schema-mismatch');
    }
  }
}

/**
 * Generate one candidate, end to end, and bind it to AS1 artifacts.
 *
 * Returns the candidate. It does NOT decide acceptance — that is `validateRiyaAiSyntheticCorpus`,
 * reused rather than reimplemented, and the caller runs it with the protected index that this
 * package never sees.
 */
export async function generateRiyaSyntheticCandidate(
  options: GenerateRiyaSyntheticCandidateOptions,
): Promise<RiyaSyntheticCandidateV1> {
  // The single-candidate API owns its limiter rather than accepting one, so
  // `policy.maxConcurrentInvocations` cannot be defeated by a caller passing a no-op gate.
  const gate = createRiyaSyntheticConcurrencyGate(
    reprovedPolicy(options.policy).maxConcurrentInvocations,
  ).acquire;
  return generateRiyaSyntheticCandidateWithGate({ ...options, invocationGate: gate });
}

/**
 * Re-prove a policy through its own constructor. Throws before anything is spent.
 *
 * INTERNAL, and deliberately not re-exported from the package barrel: it is enforcement machinery,
 * not a caller's utility. It is exported from this module only so the run orchestrator can re-prove
 * the SAME way rather than growing a second copy of this logic that could drift from it.
 */
export function reprovedPolicy(
  policy: RiyaSyntheticGenerationPolicyV1,
): RiyaSyntheticGenerationPolicyV1 {
  const { version: _version, ...fields } = policy;
  return createRiyaSyntheticGenerationPolicy(fields);
}

/**
 * INTERNAL. Generate one candidate under an injected shared limiter.
 *
 * Not exported from the package barrel: the gate is enforcement machinery, not a caller's parameter.
 */
export async function generateRiyaSyntheticCandidateWithGate(
  supplied: InternalGenerateOptions,
): Promise<RiyaSyntheticCandidateV1> {
  // ---- DEEP RE-PROOF, before a single token is spent -------------------------------------------
  //
  // TypeScript types are not runtime authority. A raw or cast object can reach this function --
  // parsed from somewhere, hand-assembled, or forged -- and discovering that halfway through a
  // conversation means the invalid input has already been paid for. Every external contract goes
  // back through the constructor that owns it, and only the re-proved values are used below.
  const { version: _scenarioVersion, ...scenarioFields } = supplied.scenario;
  const scenario = createRiyaAiSyntheticScenario(scenarioFields);
  const { version: _allocationVersion, ...allocationFields } = supplied.allocation;
  const allocation = createRiyaSyntheticRoleAllocation(allocationFields);
  const inventory = createRiyaSyntheticConfigInventory({
    inventoryRef: supplied.inventory.inventoryRef,
    configs: supplied.inventory.configs.map(({ version: _configVersion, ...config }) => config),
  });
  const policy = reprovedPolicy(supplied.policy);
  const criticQualityDimensions = reprovedCriticDimensions(supplied.criticQualityDimensions);

  const options: InternalGenerateOptions = {
    ...supplied,
    scenario,
    allocation,
    inventory,
    policy,
    criticQualityDimensions,
  };

  // Resolve roles and families BEFORE spending a token. A same-family critic set discovered after
  // ten turns has already cost the run, and leaves a candidate somebody may be tempted to keep.
  const families = resolveRiyaSyntheticRoleAllocation(allocation, inventory, policy);

  // Losing a `Promise.race` does not stop the loser. Without this controller the conversation would
  // keep invoking models after the caller had already been rejected -- burning spend on a candidate
  // nobody will ever look at, and making "no invocation runs after the budget expires" false while
  // the timeout still appeared to work.
  //
  // The caller's own signal is combined rather than replaced, so an external abort still wins.
  const candidateController = new AbortController();
  const effectiveSignal =
    options.signal === undefined
      ? candidateController.signal
      : AbortSignal.any([options.signal, candidateController.signal]);
  const ctx: InternalGenerateOptions = { ...options, signal: effectiveSignal };

  // The teacher, the verifier and the critics see a PROJECTION of the plan. Only the customer
  // simulator gets the full scenario, because it owns the hidden customer state.
  const teacherView = teacherScenarioView(scenario);
  const customerView = customerScenarioView(scenario);

  const turns: RiyaDatasetTurnV1[] = [];
  const visibleHistory: RiyaSyntheticVisibleTurn[] = [];
  const askedByTurn: string[][] = [];
  const decisionsByTurn: string[] = [];

  const ceiling = Math.min(scenario.targetAssistantTurns, 12);
  let assistantTurns = 0;

  // ---- synthetic authoritative context (ADR-0143 §4, AS2 §15) ---------------------------------
  //
  // Generated DETERMINISTICALLY, never by a model. Letting a teacher invent business truth is how a
  // corpus acquires a price that was never real, asserted confidently, in a row nothing can later
  // distinguish from a governed one. Values are obviously synthetic for the same reason: a plausible
  // one becomes indistinguishable from current truth within a quarter, and the privacy scanner cannot
  // tell the difference either.
  //
  // It is injected BEFORE the first assistant turn, because the dataset contract refuses a citation
  // whose fact arrives later.
  if (scenario.requiredAuthorityFactClasses.length > 0) {
    turns.push(
      createRiyaDatasetAuthoritativeContextTurn({
        type: 'AUTHORITATIVE_CONTEXT',
        turnRef: 'ctx0',
        authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
        facts: scenario.requiredAuthorityFactClasses.map((factClass, at) => ({
          factRef: `synthetic.fact.${factClass.toLowerCase()}.${String(at)}`,
          value: `synthetic-${factClass.toLowerCase()}-band-${String(at)}`,
          factClass,
        })),
      }),
    );
  }

  // The candidate budget is enforced by RACING the whole conversation rather than by checking a flag
  // between turns. A flag can only notice expiry at a turn boundary, so one slow invocation could
  // overrun the budget by its own timeout and the number would mean nothing. It is also why the flag
  // is gone: a `let` assigned only inside a closure is invisible to control-flow analysis, so the
  // check read as a constant even while it ran.
  const EXPIRED = Symbol('candidate-budget-expired');

  const runConversation = async (): Promise<'COMPLETED'> => {
    for (let index = 0; index < ceiling; index += 1) {
      const customer = await invokeRole(
        ctx,
        'CUSTOMER_SIMULATOR',
        allocation.customerSimulatorConfigRef,
        `${allocation.generationRef}.u${String(index)}`,
        {
          // The customer's own projection: hidden customer state, and NO dataset governance state.
          scenario: customerView,
          visibleHistory: [...visibleHistory],
          turnIndex: index,
          mayConclude: index === ceiling - 1,
        },
        customerTurnOutputSchema,
      );

      turns.push(
        createRiyaDatasetUserTurn({
          type: 'USER',
          turnRef: `u${String(index)}`,
          text: customer.userText,
        }),
      );
      visibleHistory.push({ speaker: 'USER', text: customer.userText });

      const teacher = await invokeRole(
        ctx,
        'RIYA_TEACHER',
        allocation.riyaTeacherConfigRef,
        `${allocation.generationRef}.a${String(index)}`,
        {
          // The PROJECTION. The teacher must not be able to read a fact the customer has not said.
          scenario: teacherView,
          visibleHistory: [...visibleHistory],
          turnIndex: index,
          // Only facts an EARLIER authoritative context turn supplied. The teacher cannot cite what
          // does not exist yet, and the AS1 validator refuses it if it tries.
          // Governed authority WITH values, built only from earlier AUTHORITATIVE_CONTEXT turns.
          // A ref alone lets a teacher label a citation but not ground an answer, which pushes it
          // toward inventing the number -- the exact failure this channel exists to prevent. Never
          // sourced from plannedCustomerFacts: a customer's private fact is not company truth.
          availableAuthorityFacts: authorityFactsFrom(turns),
        },
        teacherTurnOutputSchema,
      );

      const annotation = teacher.annotation;
      turns.push(
        createRiyaDatasetAssistantTurn({
          type: 'ASSISTANT',
          turnRef: `a${String(index)}`,
          text: teacher.assistantText,
          annotation: {
            decision: annotation.decision,
            askedDiscoveryFields: [...annotation.askedDiscoveryFields],
            supportedFactRefs: [...annotation.supportedFactRefs],
            responseObjective: annotation.responseObjective,
            ...(annotation.expectedPhaseAfter === undefined
              ? {}
              : { expectedPhaseAfter: annotation.expectedPhaseAfter }),
          },
        }),
      );
      visibleHistory.push({ speaker: 'ASSISTANT', text: teacher.assistantText });
      askedByTurn.push([...annotation.askedDiscoveryFields]);
      decisionsByTurn.push(annotation.decision);
      assistantTurns += 1;

      if (customer.endsConversation === true && assistantTurns >= 4) {
        break;
      }
    }
    return 'COMPLETED';
  };

  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<typeof EXPIRED>((resolve) => {
    budgetTimer = setTimeout(() => {
      resolve(EXPIRED);
    }, policy.candidateTimeoutMs);
  });
  let raced: 'COMPLETED' | typeof EXPIRED;
  try {
    raced = await Promise.race([runConversation(), budget]);
  } finally {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
  }
  if (raced === EXPIRED) {
    // Abort BEFORE throwing, so the in-flight turn stops rather than continuing to spend against a
    // candidate that has already failed.
    candidateController.abort();
    // A distinct code from `invocation-timeout`: this candidate's individual calls were all inside
    // their own budgets, and it was the accumulated conversation that ran out of time. Collapsing the
    // two would send somebody hunting for a slow provider that was never slow.
    throw new RiyaSyntheticGenerationError('candidate-budget-exceeded');
  }

  // ---- annotation verification ------------------------------------------------------------------
  const verification = await invokeRole(
    ctx,
    'ANNOTATION_VERIFIER',
    allocation.annotationVerifierConfigRef,
    `${allocation.generationRef}.verify`,
    {
      scenario: teacherView,
      visibleHistory: [...visibleHistory],
      askedDiscoveryFieldsByTurn: askedByTurn,
      decisionsByTurn,
    },
    verifierOutputSchema,
  );
  if (verification.decision === 'REJECTED') {
    throw new RiyaSyntheticGenerationError('annotation-verification-failed');
  }

  // ---- canonical trajectory ---------------------------------------------------------------------
  let trajectory: RiyaIntelligenceTrajectoryV1;
  try {
    trajectory = createRiyaIntelligenceTrajectory({
      version: 1,
      trajectoryId: `${scenario.scenarioRef}.t1`,
      trajectoryRevision: 1,
      lineageRootRef: scenario.lineageRootRef,
      split: scenario.split,
      languageMode: scenario.languageMode,
      primaryInteractionKind: scenario.primaryInteractionKind,
      secondaryInteractionKinds: [...scenario.secondaryInteractionKinds],
      persona: scenario.persona,
      difficulty: scenario.difficulty,
      riskClass: scenario.riskClass,
      source: {
        kind: 'TEACHER_GENERATED_SYNTHETIC',
        sourceRef: allocation.riyaTeacherConfigRef,
        synthetic: true,
        // THE binding AS1 checks: teacherRef is the run identity, not a config ref.
        teacherRef: allocation.generationRef,
      },
      initialState: createRiyaTrainingState({
        phase: scenario.startPhase,
        discovery: {},
        fieldProvenance: {},
        summaryConfirmed: false,
      }),
      turns,
      // No fabricated human review, ever. The automated lane carries evidence instead.
      review: [],
    });
  } catch {
    throw new RiyaSyntheticGenerationError('candidate-construction-failed');
  }

  // ---- provenance -------------------------------------------------------------------------------
  const provenance = createRiyaAiSyntheticGenerationProvenance({
    generationRef: allocation.generationRef,
    scenarioRef: scenario.scenarioRef,
    scenarioSha256: riyaAiSyntheticScenarioSha256(scenario),
    scenarioPlannerConfigRef: allocation.scenarioPlannerConfigRef,
    customerSimulatorConfigRef: allocation.customerSimulatorConfigRef,
    riyaTeacherConfigRef: allocation.riyaTeacherConfigRef,
    annotationVerifierConfigRef: allocation.annotationVerifierConfigRef,
    riyaTeacherModelFamilyRef: families.teacherModelFamilyRef,
    customerSimulatorModelFamilyRef: families.customerSimulatorModelFamilyRef,
  });

  // ---- critics ----------------------------------------------------------------------------------
  const verdicts: RiyaAiSyntheticCriticVerdictV1[] = [];
  for (const criticConfigRef of allocation.criticConfigRefs) {
    const critic = await invokeRole(
      ctx,
      'CRITIC',
      criticConfigRef,
      `${allocation.generationRef}.critic.${criticConfigRef}`,
      {
        scenario: teacherView,
        visibleHistory: [...visibleHistory],
        requestedQualityDimensions: [...options.criticQualityDimensions],
      },
      criticOutputSchema,
    );
    const criticConfig = configFor(options.inventory, criticConfigRef);
    verdicts.push(
      createRiyaAiSyntheticCriticVerdict({
        criticRef: `${allocation.generationRef}.${criticConfigRef}`,
        criticConfigRef,
        // Family comes from the INVENTORY. A model does not get to declare its own independence.
        criticModelFamilyRef: criticConfig.modelFamilyRef,
        decision: critic.decision,
        satisfiedQualityDimensions: [...critic.satisfiedQualityDimensions],
        ...(critic.failedQualityDimensions === undefined
          ? {}
          : { failedQualityDimensions: [...critic.failedQualityDimensions] }),
      }),
    );
  }

  // ---- AS1 acceptance evidence ------------------------------------------------------------------
  const evidence = createRiyaAiSyntheticTrajectoryAcceptanceEvidence({
    trajectoryId: trajectory.trajectoryId,
    trajectoryArtifactSha256: trajectoryArtifactSha256(trajectory),
    conversationFingerprint: trajectoryConversationFingerprint(trajectory),
    scenarioRef: scenario.scenarioRef,
    scenarioSha256: riyaAiSyntheticScenarioSha256(scenario),
    generationRef: allocation.generationRef,
    provenanceSha256: riyaAiSyntheticProvenanceSha256(provenance),
    criticVerdicts: verdicts,
  });

  return { trajectory, provenance, evidence, verdicts: Object.freeze([...verdicts]) };
}
