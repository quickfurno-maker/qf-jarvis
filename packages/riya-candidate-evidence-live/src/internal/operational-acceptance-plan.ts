/**
 * The POST-SRV1 operational acceptance plan (O0-O3).
 *
 * ### The one axis nothing has measured
 *
 * Every matrix so far held the completion budget at the low control value, which was right: SDH4 and
 * SRV1 were isolating a SCHEMA, and varying two axes at once would have isolated neither. SRV1's
 * result was that the two repaired observation arrays are accepted independently while the evolution
 * group and the exact document come back HTTP 400 carrying the provider's own `json_validate_failed`
 * code.
 *
 * That leaves the operational envelope entirely unmeasured. Riya's real requests do not run at 512 —
 * they run at `RIYA_COMPLETION_BUDGET_TOKENS`, and they carry the production message shape rather
 * than a two-line synthetic pair. Neither has ever been on the wire together with the repaired
 * schema.
 *
 * So this plan varies exactly that, and nothing else.
 *
 * ### What each probe asks
 *
 * O0 is the control at the OPERATIONAL budget: does the 14,848-token envelope get accepted at all,
 * carrying the known-good minimal schema? If it does not, the later probes would be measuring the
 * envelope rather than the schema, so the run stops.
 *
 * O1 re-runs SRV1's rejected evolution group at the operational budget, messages unchanged.
 * O2 re-runs SRV1's rejected exact document at the operational budget, messages unchanged.
 * O3 is the strongest probe: exact document, operational budget, and the captured REPRESENTATIVE
 * production messages. It is the closest thing to a real Riya turn that can be sent without
 * evaluating anything.
 *
 * ### O2 and O3 are authored to differ by MESSAGES — which is NOT a controlled experiment
 *
 * Both are built from the same projected object, so their schema bytes are identical by construction
 * rather than by comparison. Provider, model, budget, timeout, retry posture, fallback posture,
 * strict mode and transport are shared.
 *
 * They are still not an A/B test. The production Groq body carries no `temperature`, no `top_p` and
 * no `seed`, and Groq documents temperature as defaulting to 1, so the two probes are independent
 * generation draws however carefully their authored fields are matched. A disagreement between them
 * is therefore a DESCRIPTION — the representative request was refused in the same run the synthetic
 * one was taken — and never a demonstration that the messages caused it.
 *
 * Controlling the draw is deliberately NOT the fix. A diagnostic-only temperature or seed would make
 * this harness deterministic while making it measure a request posture production never sends.
 *
 * This module PLANS. It sends nothing.
 */
import type { CanaryMessage } from '../diagnostic-canary-port.js';

/** The four probes. New identifiers: SRV1's V0-V4 describe a different envelope. */
export const OPERATIONAL_ACCEPTANCE_STEP_IDS = [
  'O0_MINIMAL_CONTROL_OPERATIONAL',
  'O1_EVOLUTION_GROUP_OPERATIONAL',
  'O2_EXACT_SYNTHETIC_OPERATIONAL',
  'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
] as const;
export type OperationalAcceptanceStepId = (typeof OPERATIONAL_ACCEPTANCE_STEP_IDS)[number];

/**
 * The POST-RA1 neutral probe. Its OWN step id, deliberately outside the matrix above.
 *
 * RA1's `O3` carried the `CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY` adversarial turn. This carries an ordinary client turn, and
 * a shared identifier would make the two indistinguishable on a receipt — which is the entire reason
 * a neutral run is worth authorizing.
 */
export const NEUTRAL_CLIENT_STEP_ID = 'N0_EXACT_NEUTRAL_CLIENT_OPERATIONAL' as const;
export type NeutralClientStepId = typeof NEUTRAL_CLIENT_STEP_ID;

/**
 * The POST-NRA1 model-differential probe. Its OWN step id again.
 *
 * It carries the SAME neutral messages and the SAME projected schema as `N0`; only the model on the
 * wire differs. A shared identifier would make the 20B rejection and the 120B result indistinguishable
 * on a receipt, which is the one comparison this run exists to support.
 */
export const MODEL_DIFFERENTIAL_STEP_ID = 'M0_EXACT_NEUTRAL_CLIENT_GPT_OSS_120B_STRICT' as const;
export type ModelDifferentialStepId = typeof MODEL_DIFFERENTIAL_STEP_ID;

/** The role a probe plays. Only `CONTROL` can invalidate a run; `EXACT_REPRESENTATIVE` is strongest. */
export const OPERATIONAL_PROBE_KINDS = [
  'CONTROL',
  'GROUP',
  'EXACT_SYNTHETIC',
  'EXACT_REPRESENTATIVE',
] as const;
export type OperationalProbeKind = (typeof OPERATIONAL_PROBE_KINDS)[number];

/**
 * Where a probe's messages come from.
 *
 * POST-RA1 adds a THIRD. `CAPTURED_REPRESENTATIVE` is the SAFETY-DERIVED capture RA1 sent — the
 * `CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY` adversarial turn — and it keeps that spelling because it
 * appears on immutable receipts. `CAPTURED_NEUTRAL_CLIENT` is the ordinary client turn, and it is a separate token
 * precisely so RA1 and a future neutral run can never be confused in a report.
 */
export const OPERATIONAL_MESSAGE_SOURCES = [
  'SYNTHETIC_TINY',
  'CAPTURED_REPRESENTATIVE',
  'CAPTURED_NEUTRAL_CLIENT',
] as const;
export type OperationalMessageSource = (typeof OPERATIONAL_MESSAGE_SOURCES)[number];

/**
 * One probe: what it isolates, the real fragment it carries, and which messages go with it.
 *
 * Generic over the step id so the POST-RA1 neutral probe can share this exact shape without joining
 * the matrix vocabulary. Widening `OperationalAcceptanceStepId` itself would have let a neutral step
 * flow into the matrix classifier, which reasons about a set of four.
 */
export interface DiagnosticProbe<TStepId extends string> {
  readonly stepId: TStepId;
  readonly probeKind: OperationalProbeKind;
  /** The structure this probe isolates. It asserts nothing about any other probe. */
  readonly probeDimension: string;
  /** Where in the real projected schema the fragment came from. A path, never a value. */
  readonly derivedFromPath: string;
  readonly messageSource: OperationalMessageSource;
  /** The schema to send. */
  readonly schema: unknown;
  /** The messages to send. */
  readonly messages: readonly CanaryMessage[];
}

/** The matrix probe: one of O0-O3. */
export type OperationalAcceptanceProbe = DiagnosticProbe<OperationalAcceptanceStepId>;
/** The POST-RA1 neutral probe. Same shape, its own identifier. */
export type NeutralClientProbe = DiagnosticProbe<NeutralClientStepId>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Wrap a real fragment in the smallest closed object that can legally carry it. */
function wrap(propertyName: string, fragment: unknown): unknown {
  return Object.freeze({
    type: 'object',
    properties: { [propertyName]: fragment },
    required: [propertyName],
    additionalProperties: false,
  });
}

export interface OperationalAcceptancePlanInput {
  /** The ONE projected production document. O1, O2 and O3 are all derived from this object. */
  readonly projectedSchema: unknown;
  /** The fixed tiny pair O0, O1 and O2 carry. */
  readonly syntheticMessages: readonly CanaryMessage[];
  /** The CAPTURED representative production messages O3 carries. Never reconstructed. */
  readonly representativeMessages: readonly CanaryMessage[];
}

/**
 * Build the plan from the REAL projected document.
 *
 * Throws if the evolution group cannot be located — a plan that silently skipped it would spend a
 * live authorization measuring three probes while reporting four.
 */
export function planOperationalAcceptance(
  input: OperationalAcceptancePlanInput,
): readonly OperationalAcceptanceProbe[] {
  const projected = input.projectedSchema;
  if (!isRecord(projected) || projected['type'] !== 'object') {
    throw new Error('QFJ_OPERATIONAL_ACCEPTANCE_ROOT_NOT_OBJECT');
  }
  const properties = isRecord(projected['properties']) ? projected['properties'] : undefined;
  const evolution = properties?.['evolution'];
  if (!isRecord(evolution)) {
    throw new Error('QFJ_OPERATIONAL_ACCEPTANCE_EVOLUTION_NOT_LOCATED');
  }
  if (input.representativeMessages.length === 0) {
    // O3 is the point of the run. A plan whose strongest probe carried no messages would be a plan
    // that quietly measured O2 twice.
    throw new Error('QFJ_OPERATIONAL_ACCEPTANCE_REPRESENTATIVE_MESSAGES_MISSING');
  }

  const probe = (
    stepId: OperationalAcceptanceStepId,
    probeKind: OperationalProbeKind,
    probeDimension: string,
    derivedFromPath: string,
    messageSource: OperationalMessageSource,
    schema: unknown,
    messages: readonly CanaryMessage[],
  ): OperationalAcceptanceProbe =>
    Object.freeze({
      stepId,
      probeKind,
      probeDimension,
      derivedFromPath,
      messageSource,
      schema,
      messages,
    });

  return Object.freeze([
    // The CONTROL, at the OPERATIONAL budget. Same known-good minimal shape every governed matrix has
    // used, so a rejection here is about the envelope rather than about Riya.
    probe(
      'O0_MINIMAL_CONTROL_OPERATIONAL',
      'CONTROL',
      'CLOSED_OBJECT_STRING_ENUM_AT_OPERATIONAL_BUDGET',
      '$',
      'SYNTHETIC_TINY',
      Object.freeze({
        type: 'object',
        properties: { ok: { type: 'string', enum: ['OK'] } },
        required: ['ok'],
        additionalProperties: false,
      }),
      input.syntheticMessages,
    ),
    // SRV1's V3, re-asked at the operational budget with the messages held constant.
    probe(
      'O1_EVOLUTION_GROUP_OPERATIONAL',
      'GROUP',
      'EVOLUTION_GROUP_AT_OPERATIONAL_BUDGET',
      '$.evolution',
      'SYNTHETIC_TINY',
      wrap('evolution', evolution),
      input.syntheticMessages,
    ),
    // SRV1's V4, re-asked the same way. Shares its schema OBJECT with O3 below.
    probe(
      'O2_EXACT_SYNTHETIC_OPERATIONAL',
      'EXACT_SYNTHETIC',
      'FULL_DOCUMENT_AT_OPERATIONAL_BUDGET',
      '$',
      'SYNTHETIC_TINY',
      projected,
      input.syntheticMessages,
    ),
    // The strongest probe: identical to O2 in every AUTHORED respect except the messages. The draw
    // is still uncontrolled, so a disagreement describes the pair rather than explaining it.
    probe(
      'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
      'EXACT_REPRESENTATIVE',
      'FULL_DOCUMENT_WITH_REPRESENTATIVE_MESSAGES',
      '$',
      'CAPTURED_REPRESENTATIVE',
      projected,
      input.representativeMessages,
    ),
  ]);
}

/**
 * Plan the ONE neutral client probe (POST-RA1).
 *
 * Deliberately a separate function rather than a fifth member of the matrix above. The matrix exists
 * to compare probes against each other; this run compares nothing, because everything it would have
 * compared against is already settled — `O0` and `O2` both returned HTTP 200 at this budget in OAD3.
 *
 * The schema is the SAME projected object the matrix uses, so the neutral run and RA1 differ in the
 * client turn and in nothing else a reader has to verify by hand.
 */
export function planNeutralClientProbe(input: {
  readonly projectedSchema: unknown;
  readonly neutralMessages: readonly CanaryMessage[];
}): NeutralClientProbe {
  const projected = input.projectedSchema;
  if (!isRecord(projected) || projected['type'] !== 'object') {
    throw new Error('QFJ_NEUTRAL_CLIENT_ROOT_NOT_OBJECT');
  }
  if (input.neutralMessages.length === 0) {
    // The messages ARE the question. A probe carrying none would measure nothing and still spend the
    // one authorized request.
    throw new Error('QFJ_NEUTRAL_CLIENT_MESSAGES_MISSING');
  }
  return Object.freeze({
    stepId: NEUTRAL_CLIENT_STEP_ID,
    probeKind: 'EXACT_REPRESENTATIVE',
    probeDimension: 'FULL_DOCUMENT_WITH_NEUTRAL_CLIENT_MESSAGES',
    derivedFromPath: '$',
    messageSource: 'CAPTURED_NEUTRAL_CLIENT',
    schema: projected,
    messages: input.neutralMessages,
  });
}

/**
 * Plan the ONE model-differential probe (POST-NRA1).
 *
 * Takes the SAME inputs `planNeutralClientProbe` takes and produces the same schema and messages —
 * only the step id differs, because only the MODEL differs on the wire, and the model is not a
 * property of the probe. That keeps "the request is identical to NRA1's" a consequence of the code
 * rather than a claim in a comment.
 */
export function planModelDifferentialProbe(input: {
  readonly projectedSchema: unknown;
  readonly neutralMessages: readonly CanaryMessage[];
}): DiagnosticProbe<ModelDifferentialStepId> {
  const neutral = planNeutralClientProbe(input);
  return Object.freeze({
    ...neutral,
    stepId: MODEL_DIFFERENTIAL_STEP_ID,
    probeDimension: 'FULL_DOCUMENT_WITH_NEUTRAL_CLIENT_MESSAGES_ON_GPT_OSS_120B',
  });
}
