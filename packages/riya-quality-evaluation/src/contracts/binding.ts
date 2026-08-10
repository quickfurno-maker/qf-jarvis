/**
 * The quality candidate binding — DERIVED from generic safety evidence (RWC-P10, ADR-0106 §16).
 *
 * ### Safety first, structurally rather than by convention
 *
 * A caller does not supply the release, the model, the prompt family, the prompt version or the
 * prompt digest. It supplies an `ApprovalEvidence` produced by `@qf-jarvis/model-evaluation`, and
 * every one of those identities is COPIED out of it.
 *
 * That is what makes "generic safety evidence is mandatory" a property of the type system rather
 * than a rule in a document. A quality binding cannot be constructed for a release that has not
 * passed generic safety, and it cannot claim a prompt digest different from the one safety covered
 * — which is the exact drift that would let a candidate pass safety on one prompt and be measured
 * for quality on another.
 *
 * ### Which safety targets qualify, and why two do not
 *
 * `ACTIVE_MODEL_RELEASE`, `SHADOW_ELIGIBILITY` and `CANARY_ELIGIBILITY` are statements about a
 * release having been evaluated for behaviour. Quality may sit on top of those.
 *
 * `CONNECTIVITY_SMOKE` is refused because it says only that a transport reached a provider and got a
 * well-formed response back. It is not a behavioural claim at all, and layering sales-quality
 * measurement on it would produce an artifact that LOOKS like a certified candidate while resting on
 * evidence that a socket opened.
 *
 * `SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` is refused because it is research evidence for a
 * retrieval capability that is deliberately not enabled. Quality evidence derived from it would
 * attach a conversational verdict to a subsystem this repository has not turned on.
 *
 * ### Synthetic in, synthetic out
 *
 * The evidence must be `synthetic: true` and `productionApproval: false`. This package manufactures
 * no production artifact, and it must not be able to launder one: quality evidence built on
 * production-approving evidence would inherit an authority it was never granted.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';
import type {
  ApprovalEvidence,
  EvaluationApprovalTarget,
  EvaluationExecutionClass,
} from '@qf-jarvis/model-evaluation';
import { z } from 'zod';

import { proveGenericSafetyEvidence } from '../internal/safety-evidence.js';
import { RiyaQualityEvaluationError } from './errors.js';

export { RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS } from '../internal/safety-evidence.js';

/** The exact release identity a quality run was measured against. Copied, never supplied. */
export interface RiyaQualityReleaseRef {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly configDigest: string;
  readonly executionClass: EvaluationExecutionClass;
}

export interface RiyaQualityCandidateBindingV1 {
  readonly version: 1;
  readonly qualitySuiteId: string;
  readonly qualitySuiteVersion: number;
  readonly fixtureManifestId: string;
  readonly fixtureManifestVersion: number;
  readonly thresholdsId: string;
  readonly thresholdsVersion: number;
  readonly evaluatorImplId: string;
  readonly evaluatorImplVersion: number;
  /** Everything below is COPIED from the safety evidence. None of it is caller-supplied. */
  readonly release: RiyaQualityReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly promptDigest: string;
  readonly capabilityProfileRef: string;
  readonly knowledgeRevision: string | undefined;
  readonly policyContractRevision: string;
  /** The generic safety evidence this quality run rests on. */
  readonly safetyEvaluationRef: string;
  readonly safetyTarget: EvaluationApprovalTarget;
  readonly createdAt: string;
}

export interface RiyaQualityCandidateBindingInput {
  /** The generic safety evidence. The ONLY source of release/prompt/capability/knowledge/policy. */
  readonly safetyEvidence: ApprovalEvidence;
  readonly qualitySuiteId: string;
  readonly qualitySuiteVersion: number;
  readonly fixtureManifestId: string;
  readonly fixtureManifestVersion: number;
  readonly thresholdsId: string;
  readonly thresholdsVersion: number;
  readonly createdAt: string;
}

/** This evaluator's own identity, so evidence names which implementation produced it. */
export const RIYA_QUALITY_EVALUATOR_IMPL_ID = 'riya-quality-evaluator';
export const RIYA_QUALITY_EVALUATOR_IMPL_VERSION = 1;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * The WHOLE input, parsed strictly.
 *
 * The first version projected the known fields out and parsed the projection, so a caller passing
 * `promptDigest`, `release` or `modelId` alongside the evidence had those keys silently dropped. The
 * value was still correct -- the evidence decided -- but a caller who believed they had overridden a
 * release would have been wrong and would never have been told. A refusal is the only honest answer:
 * the safety evidence is the ONLY release and prompt identity source, and offering something that
 * looks like an override is worse than offering none.
 */
const inputSchema = z
  .object({
    // Proved separately and in full by `proveGenericSafetyEvidence`. Present here only so the strict
    // key set is complete.
    safetyEvidence: z.unknown(),
    qualitySuiteId: IDENTIFIER,
    qualitySuiteVersion: VERSION,
    fixtureManifestId: IDENTIFIER,
    fixtureManifestVersion: VERSION,
    thresholdsId: IDENTIFIER,
    thresholdsVersion: VERSION,
    createdAt: z.string().regex(CANONICAL_INSTANT),
  })
  .strict();

const rejectWildcard = (value: string): void => {
  if (value.toLowerCase() === 'latest' || value.includes('*')) {
    throw new RiyaQualityEvaluationError('invalid-candidate-binding');
  }
};

/**
 * Derive a quality candidate binding from generic safety evidence.
 *
 * Throws `safety-evidence-required` when the artifact is structurally unusable,
 * `safety-evidence-not-canonical` when its nested binding, digests, instant or self-reference do not
 * reconstruct, `safety-evidence-target-not-eligible` for a target that carries no behavioural claim,
 * `safety-evidence-not-synthetic` for anything production-approving, and
 * `invalid-candidate-binding` for a malformed or over-specified suite/fixture/threshold input.
 */
export function createRiyaQualityCandidateBinding(
  input: RiyaQualityCandidateBindingInput,
): RiyaQualityCandidateBindingV1 {
  // The WHOLE artifact is re-proved, and the binding it returns is RECONSTRUCTED through the generic
  // package's own constructor -- so what is copied below is never the caller's nested object.
  const proven = proveGenericSafetyEvidence(input.safetyEvidence);

  // The whole input, not a projection: an extra `promptDigest` or `release` key is a refusal.
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaQualityEvaluationError('invalid-candidate-binding');
  }
  for (const token of [
    parsed.data.qualitySuiteId,
    parsed.data.fixtureManifestId,
    parsed.data.thresholdsId,
  ]) {
    rejectWildcard(token);
  }

  const safety = proven.canonicalBinding;
  return Object.freeze({
    version: 1 as const,
    qualitySuiteId: parsed.data.qualitySuiteId,
    qualitySuiteVersion: parsed.data.qualitySuiteVersion,
    fixtureManifestId: parsed.data.fixtureManifestId,
    fixtureManifestVersion: parsed.data.fixtureManifestVersion,
    thresholdsId: parsed.data.thresholdsId,
    thresholdsVersion: parsed.data.thresholdsVersion,
    evaluatorImplId: RIYA_QUALITY_EVALUATOR_IMPL_ID,
    evaluatorImplVersion: RIYA_QUALITY_EVALUATOR_IMPL_VERSION,
    release: Object.freeze({ ...safety.release }),
    promptFamily: safety.promptFamily,
    promptVersion: safety.promptVersion,
    promptDigest: safety.promptDigest,
    capabilityProfileRef: safety.capabilityProfileRef,
    knowledgeRevision: safety.knowledgeRevision,
    policyContractRevision: safety.policyContractRevision,
    safetyEvaluationRef: proven.evaluationRef,
    safetyTarget: proven.target,
    createdAt: parsed.data.createdAt,
  });
}

/**
 * The PARITY key: everything two candidates must share to be comparable at all.
 *
 * Deliberately absent are the release, the provider, the model and the prompt — those are exactly
 * what a comparison exists to vary. Present are the things that, if they differed, would mean the
 * two runs were measured against different questions: the suite, the fixtures, the thresholds, and
 * the capability, knowledge and policy the answers were expected to respect.
 */
export function riyaQualityParityKey(binding: RiyaQualityCandidateBindingV1): string {
  return contentDigest([
    binding.qualitySuiteId,
    binding.qualitySuiteVersion,
    binding.fixtureManifestId,
    binding.fixtureManifestVersion,
    binding.thresholdsId,
    binding.thresholdsVersion,
    binding.evaluatorImplId,
    binding.evaluatorImplVersion,
    binding.capabilityProfileRef,
    binding.knowledgeRevision ?? null,
    binding.policyContractRevision,
  ]);
}
