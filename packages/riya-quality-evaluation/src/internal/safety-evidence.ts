/**
 * Deep re-proof of generic safety evidence (RWC-P10 owner correction on PR #111).
 *
 * ### What the shallow version missed
 *
 * The first implementation checked a handful of top-level fields and then copied the NESTED release,
 * prompt, capability, knowledge and policy identity straight out of `evidence.binding`. A
 * deserialized or hand-assembled object with an eligible target, `synthetic: true`,
 * `productionApproval: false` and `binding: {}` satisfied every check and reached candidate
 * materialization — so the one thing the binding exists to guarantee, that quality identity comes
 * from safety identity, rested on the caller not lying.
 *
 * This module re-proves the whole artifact:
 *
 * 1. **Exact own keys.** Not a superset and not a subset. A missing field is an incomplete artifact;
 *    an extra one is somebody attaching meaning the contract does not have.
 * 2. **The nested binding is RECONSTRUCTED** through `createEvaluationBinding` — the same public
 *    constructor `@qf-jarvis/model-evaluation` uses. Its `.strict()` schema, its identifier grammar
 *    and its wildcard refusal all apply, and the reconstructed value is what gets copied afterwards.
 *    Restating those rules here would be a second copy to keep in step with the first.
 * 3. **Digest grammar**, lowercase hex of the exact width `contentDigest` produces.
 * 4. **Canonical UTC `createdAt`.**
 * 5. **`evaluationRef` self-consistency** — recomputed from the canonical binding and compared.
 *
 * ### What this is NOT
 *
 * It is canonical-structure and self-consistency validation. It is **not** a cryptographic trust
 * root: `contentDigest` is a non-cryptographic FNV-1a identity hash, there is no signature, no key
 * and no evidence registry. Somebody who can run this code can also compute a consistent
 * `evaluationRef` for evidence they invented.
 *
 * What it does buy is real and worth having: an artifact that was truncated, partially deserialized,
 * hand-edited in one field, or assembled from a stale binding will not pass. Claiming more than that
 * would be the same kind of overstatement this package refuses everywhere else.
 */
import { contentDigest, createEvaluationBinding, releaseKey } from '@qf-jarvis/model-evaluation';
import type {
  ApprovalEvidence,
  EvaluationApprovalTarget,
  EvaluationBinding,
  EvaluationBindingInput,
} from '@qf-jarvis/model-evaluation';

import { RiyaQualityEvaluationError } from '../contracts/errors.js';

/** The safety targets a quality candidate binding may rest on. */
export const RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS: readonly EvaluationApprovalTarget[] =
  Object.freeze(['ACTIVE_MODEL_RELEASE', 'SHADOW_ELIGIBILITY', 'CANARY_ELIGIBILITY']);

/** Exactly the own keys an `ApprovalEvidence` carries. Sorted, so the comparison is order-free. */
const EVIDENCE_KEYS: readonly string[] = Object.freeze([
  'binding',
  'caseSetDigest',
  'createdAt',
  'evaluationRef',
  'productionApproval',
  'suiteResultDigest',
  'synthetic',
  'target',
]);

/**
 * The digest width `@qf-jarvis/model-evaluation`'s `contentDigest` actually emits.
 *
 * Thirty-two lowercase hex characters — four concatenated 32-bit FNV-1a hashes. Pinning the real
 * width matters in both directions: a wider pattern would accept a truncated digest, and a narrower
 * one would refuse every genuine artifact the generic evaluator produces.
 */
const DIGEST = /^[0-9a-f]{32}$/;

/** Canonical UTC ISO-8601, matching the generic package's own instant grammar. */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const isCanonicalInstant = (value: string): boolean =>
  CANONICAL_INSTANT.test(value) && Number.isFinite(Date.parse(value));

/** A safety artifact that has been proved, together with the canonical binding to copy from. */
export interface ProvenSafetyEvidence {
  readonly evaluationRef: string;
  readonly target: EvaluationApprovalTarget;
  /** RECONSTRUCTED through the generic constructor. Never the caller's object. */
  readonly canonicalBinding: EvaluationBinding;
}

/**
 * Prove one generic safety artifact, or refuse with a bounded code.
 *
 * Throws `safety-evidence-required` for a structurally unusable artifact,
 * `safety-evidence-not-canonical` for one whose nested binding, digests, instant or self-reference do
 * not reconstruct, `safety-evidence-target-not-eligible` for a target carrying no behavioural claim,
 * and `safety-evidence-not-synthetic` for anything production-approving.
 *
 * No zod message, no generic-package error text and no field value escapes: the artifact contains
 * release and prompt identity, and a validation error that quoted one would put it in a stack trace.
 */
export function proveGenericSafetyEvidence(value: unknown): ProvenSafetyEvidence {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RiyaQualityEvaluationError('safety-evidence-required');
  }
  const candidate = value as Record<string, unknown>;

  // EXACT keys. A subset is an incomplete artifact; a superset is somebody attaching meaning the
  // contract does not have, and silently ignoring it is how a second identity source appears.
  const keys = Object.keys(candidate).sort();
  if (keys.length !== EVIDENCE_KEYS.length || keys.some((key, i) => key !== EVIDENCE_KEYS[i])) {
    throw new RiyaQualityEvaluationError('safety-evidence-required');
  }
  if (typeof candidate['evaluationRef'] !== 'string' || candidate['evaluationRef'].length === 0) {
    throw new RiyaQualityEvaluationError('safety-evidence-required');
  }
  if (typeof candidate['target'] !== 'string') {
    throw new RiyaQualityEvaluationError('safety-evidence-required');
  }

  // THE re-proof. The caller's nested object goes through the generic package's own constructor, so
  // its strict schema, identifier grammar and wildcard refusal all apply -- and what is copied
  // afterwards is the value that constructor returned, never the value that came in.
  let canonicalBinding: EvaluationBinding;
  try {
    canonicalBinding = createEvaluationBinding(candidate['binding'] as EvaluationBindingInput);
  } catch {
    throw new RiyaQualityEvaluationError('safety-evidence-not-canonical');
  }

  const suiteResultDigest = candidate['suiteResultDigest'];
  const caseSetDigest = candidate['caseSetDigest'];
  if (
    typeof suiteResultDigest !== 'string' ||
    !DIGEST.test(suiteResultDigest) ||
    typeof caseSetDigest !== 'string' ||
    !DIGEST.test(caseSetDigest)
  ) {
    throw new RiyaQualityEvaluationError('safety-evidence-not-canonical');
  }
  if (typeof candidate['createdAt'] !== 'string' || !isCanonicalInstant(candidate['createdAt'])) {
    throw new RiyaQualityEvaluationError('safety-evidence-not-canonical');
  }

  const target = candidate['target'] as EvaluationApprovalTarget;
  if (!RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS.includes(target)) {
    throw new RiyaQualityEvaluationError('safety-evidence-target-not-eligible');
  }
  if (candidate['synthetic'] !== true || candidate['productionApproval'] !== false) {
    throw new RiyaQualityEvaluationError('safety-evidence-not-synthetic');
  }

  // Self-consistency: the artifact's own reference must be the one its content produces. This is the
  // check that catches a binding swapped underneath a reference somebody kept -- exactly the drift
  // where a candidate is quality-measured against a release safety never covered.
  const expectedRef = `evref-${contentDigest({
    target,
    release: releaseKey(canonicalBinding.release),
    suiteResultDigest,
  })}`;
  if (candidate['evaluationRef'] !== expectedRef) {
    throw new RiyaQualityEvaluationError('safety-evidence-not-canonical');
  }

  return Object.freeze({
    evaluationRef: candidate['evaluationRef'],
    target,
    canonicalBinding,
  });
}

/** The declared input type, kept for callers that already hold a well-typed artifact. */
export type SafetyEvidenceInput = ApprovalEvidence;
