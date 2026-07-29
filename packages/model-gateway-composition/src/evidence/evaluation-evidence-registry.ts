/**
 * The frozen evaluation-evidence registry and verifier (QFJ-S2-C-B, ADR-0063 §2, §5, §6).
 *
 * This is the BRIDGE. `@qf-jarvis/model-gateway` may not depend on `@qf-jarvis/model-evaluation` and
 * vice versa — both are locked to `dependencies: ["zod"]` — so the one layer that may see both owns the
 * join: it reads `ApprovalEvidence`, derives its digest, and implements the gateway's type-only
 * `EvaluationEvidenceVerifier`.
 *
 * INTERNAL. Nothing here is exported from the package root, so the runtime export count stays at 2.
 *
 * The registry is built once, deeply frozen, and has no `register` method afterwards. It performs no
 * I/O of any kind: no database, no filesystem, no network, no environment access.
 *
 * On the digest: `contentDigest` is deterministic, canonical and dependency-free — and NOT a security
 * primitive. It detects drift and mismatch, not a motivated forger. The real control is that evidence
 * must be REGISTERED by the operator at composition, not merely referenced. Signing and evaluator
 * provenance are deferred (ADR-0063 §5).
 */
import {
  contentDigest,
  createEvaluationBinding,
  EVALUATION_APPROVAL_TARGETS,
  type ApprovalEvidence,
  type EvaluationApprovalTarget,
} from '@qf-jarvis/model-evaluation';
import type {
  EvaluationEvidenceVerifier,
  EvidenceVerificationRequest,
  EvidenceVerificationResult,
  GatewayMode,
} from '@qf-jarvis/model-gateway';

/**
 * Which rollout modes each approval target may authorize (ADR-0063 §2).
 *
 * TOTAL over the target vocabulary — a `Record`, so adding a target without deciding its ladder is a
 * compile error rather than a silent empty set. `OFF` never appears: OFF needs no evidence. `FALLBACK`
 * never appears either — it serves the STABLE release and stays governed by the stable approval.
 *
 * The ladder is a superset relation: a higher target satisfies every lower mode.
 */
const MODES_BY_TARGET: Readonly<Record<EvaluationApprovalTarget, readonly GatewayMode[]>> =
  Object.freeze({
    ACTIVE_MODEL_RELEASE: Object.freeze(['SHADOW', 'CANARY', 'ACTIVE'] as const),
    CANARY_ELIGIBILITY: Object.freeze(['SHADOW', 'CANARY'] as const),
    SHADOW_ELIGIBILITY: Object.freeze(['SHADOW'] as const),
    // A connectivity smoke proves a socket opened. It says nothing about model quality.
    CONNECTIVITY_SMOKE: Object.freeze([] as const),
    // Research evidence for a capability this repository does not implement.
    SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY: Object.freeze([] as const),
  });

/** Modes that may only be served by non-synthetic, production-approved evidence (ADR-0063 §4). */
const PRODUCTION_MODES: ReadonlySet<GatewayMode> = new Set<GatewayMode>(['CANARY', 'ACTIVE']);

/** Why a registry refused to accept a supplied evidence set. Closed; never a payload. */
export type EvidenceRegistrationRefusal =
  /** An evidence object is not structurally valid, or its binding fails re-validation. */
  | 'evidence-invalid'
  /** `synthetic` and `productionApproval` are both true, or a connectivity target broke its rule. */
  | 'evidence-approval-flags-invalid'
  /** The same `evaluationRef` was supplied twice with different content. */
  | 'conflicting-evidence-registration';

/** A built registry: a frozen lookup plus the verifier the gateway consumes. */
export interface EvaluationEvidenceRegistry {
  readonly verifier: EvaluationEvidenceVerifier;
  /** Deterministic, sorted list of registered references. Identifiers only — for audit and tests. */
  readonly references: () => readonly string[];
  readonly size: () => number;
}

export type EvidenceRegistryResult =
  | { readonly ok: true; readonly registry: EvaluationEvidenceRegistry }
  | { readonly ok: false; readonly reason: EvidenceRegistrationRefusal };

/** One registered entry: the frozen evidence plus the digest DERIVED from it (never supplied). */
interface RegisteredEvidence {
  readonly evidence: ApprovalEvidence;
  readonly derivedDigest: string;
}

/**
 * Derive the digest of a COMPLETE evidence object.
 *
 * No third digest is stored on the evidence itself — a digest kept beside the thing it digests is a
 * second source of truth. `contentDigest` canonicalises recursively, so field order cannot change the
 * result, and every field participates.
 */
function deriveEvidenceDigest(evidence: ApprovalEvidence): string {
  return contentDigest(evidence);
}

/**
 * Structural validation using the EXISTING model-evaluation factory, plus the flag invariants.
 *
 * The parameter is `unknown` on purpose. The declared config type promises `ApprovalEvidence`, but this
 * is the boundary where UNTRUSTED evidence enters — a caller can hand over a plain object that merely
 * satisfies the compiler. Narrowing here keeps the runtime guard real instead of assuming the type.
 */
function validateEvidence(candidate: unknown): EvidenceRegistrationRefusal | undefined {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return 'evidence-invalid';
  }
  const evidence = candidate as ApprovalEvidence;
  if (!(EVALUATION_APPROVAL_TARGETS as readonly string[]).includes(evidence.target)) {
    return 'evidence-invalid';
  }
  if (typeof evidence.evaluationRef !== 'string' || evidence.evaluationRef.length === 0) {
    return 'evidence-invalid';
  }
  if (typeof evidence.synthetic !== 'boolean' || typeof evidence.productionApproval !== 'boolean') {
    return 'evidence-approval-flags-invalid';
  }
  // Evidence cannot be both synthetic and production-approved.
  if (evidence.synthetic && evidence.productionApproval) {
    return 'evidence-approval-flags-invalid';
  }
  // A connectivity smoke is always synthetic and never production approval.
  if (
    evidence.target === 'CONNECTIVITY_SMOKE' &&
    (!evidence.synthetic || evidence.productionApproval)
  ) {
    return 'evidence-approval-flags-invalid';
  }
  // Re-validate the binding through the existing factory: a forged plain object fails its grammar,
  // its wildcard rejection, and its canonical-instant rule.
  try {
    createEvaluationBinding(evidence.binding);
  } catch {
    return 'evidence-invalid';
  }
  return undefined;
}

/** Whether registered evidence names exactly the release the transition would serve. */
function releaseMatches(
  evidence: ApprovalEvidence,
  release: EvidenceVerificationRequest['release'],
): boolean {
  const bound = evidence.binding.release;
  return (
    bound.releaseId === release.releaseId &&
    bound.providerId === release.providerId &&
    bound.modelId === release.modelId &&
    bound.modelVersion === release.modelVersion &&
    bound.configDigest === release.configDigest &&
    bound.executionClass === release.executionClass
  );
}

/**
 * Build the frozen registry. Fail-closed: any invalid or conflicting evidence refuses the whole
 * construction rather than silently dropping an entry.
 *
 * Duplicates: the same `evaluationRef` with an IDENTICAL derived digest is idempotent — one entry. The
 * same ref with a DIFFERENT digest is a conflict and refuses.
 */
export function createEvaluationEvidenceRegistry(
  evidenceSet: readonly ApprovalEvidence[],
): EvidenceRegistryResult {
  const entries = new Map<string, RegisteredEvidence>();

  for (const evidence of evidenceSet) {
    const invalid = validateEvidence(evidence);
    if (invalid !== undefined) {
      return Object.freeze({ ok: false as const, reason: invalid });
    }
    const derivedDigest = deriveEvidenceDigest(evidence);
    const existing = entries.get(evidence.evaluationRef);
    if (existing !== undefined) {
      if (existing.derivedDigest !== derivedDigest) {
        return Object.freeze({ ok: false as const, reason: 'conflicting-evidence-registration' });
      }
      // Identical duplicate: idempotent, one entry.
      continue;
    }
    entries.set(
      evidence.evaluationRef,
      Object.freeze({ evidence: Object.freeze(evidence), derivedDigest }),
    );
  }

  const verifier: EvaluationEvidenceVerifier = Object.freeze({
    verify(request: EvidenceVerificationRequest): EvidenceVerificationResult {
      const entry = entries.get(request.evaluationRef);
      if (entry === undefined) {
        return { ok: false, reason: 'evidence-missing' };
      }
      // The caller's digest is a CLAIM. Compare it against the digest derived from what is registered.
      if (entry.derivedDigest !== request.evidenceDigest) {
        return { ok: false, reason: 'evidence-digest-mismatch' };
      }
      const { evidence } = entry;
      if (!releaseMatches(evidence, request.release)) {
        return { ok: false, reason: 'evidence-release-mismatch' };
      }
      if (evidence.binding.capabilityProfileRef !== request.capabilityProfileRef) {
        return { ok: false, reason: 'evidence-capability-mismatch' };
      }
      // The attestation must claim the target the evidence actually carries.
      if (evidence.target !== request.approvalTarget) {
        return { ok: false, reason: 'evidence-target-insufficient' };
      }
      const permitted = MODES_BY_TARGET[evidence.target];
      if (!permitted.includes(request.mode)) {
        return { ok: false, reason: 'evidence-target-insufficient' };
      }
      if (PRODUCTION_MODES.has(request.mode)) {
        if (evidence.synthetic) {
          return { ok: false, reason: 'synthetic-evidence-forbidden' };
        }
        if (!evidence.productionApproval) {
          return { ok: false, reason: 'production-approval-required' };
        }
      }
      return { ok: true };
    },
  });

  const references = Object.freeze([...entries.keys()].sort());

  return Object.freeze({
    ok: true as const,
    registry: Object.freeze({
      verifier,
      references: () => references,
      size: () => references.length,
    }),
  });
}
