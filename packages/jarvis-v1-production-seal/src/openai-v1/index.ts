import {
  OPENAI_V1_CAPABILITY_PROFILE_REF,
  OPENAI_V1_CERTIFICATION_AGENTS,
  OPENAI_V1_CERTIFICATION_TIERS,
  OPENAI_V1_DATA_CONTROLS_REF,
  OPENAI_V1_PROVIDER_MODE,
  createOpenAIV1Binding,
  createOpenAIV1CertificationManifest,
  openAIV1CertificationReady,
  type OpenAIV1CertificationAgent,
  type OpenAIV1CertificationManifest,
  type OpenAIV1CertificationTier,
} from '@qf-jarvis/jarvis-v1-provider-certification-live/openai-v1';
import {
  contentDigest,
  releaseKey,
  type ApprovalEvidence,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-evaluation';

export const OPENAI_V1_SEAL_VERSION = 1 as const;
export const OPENAI_V1_APPROVAL_TARGET = 'ACTIVE_MODEL_RELEASE' as const;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_REF = /^[A-Za-z0-9._:/-]{1,200}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
export interface OpenAIV1HumanReview {
  readonly tier: OpenAIV1CertificationTier;
  readonly agent: OpenAIV1CertificationAgent;
  readonly reviewerRef: string;
  readonly reviewedAt: string;
  readonly reviewBundleDigest: string;
  readonly decision: 'ACCEPT' | 'REJECT';
}

export interface OpenAIV1OwnerAcceptance {
  readonly ownerRef: string;
  readonly acceptedAt: string;
  readonly acceptedDataControlsRef: string;
  readonly decision: 'ACCEPT' | 'REJECT';
}

export interface OpenAIV1RuntimeCoverageSeal {
  readonly tier: OpenAIV1CertificationTier;
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: typeof OPENAI_V1_CAPABILITY_PROFILE_REF;
  readonly evidenceRefs: readonly string[];
  readonly promptDigests: readonly string[];
  readonly coverageDigest: string;
}
export interface OpenAIV1ProductionSeal {
  readonly version: typeof OPENAI_V1_SEAL_VERSION;
  readonly target: typeof OPENAI_V1_APPROVAL_TARGET;
  readonly sourceRunId: string;
  readonly sourceHeadSha: string;
  readonly sourceManifestDigest: string;
  readonly sealedAt: string;
  readonly ownerRef: string;
  readonly providerMode: typeof OPENAI_V1_PROVIDER_MODE;
  readonly providerDataControlsRef: typeof OPENAI_V1_DATA_CONTROLS_REF;
  readonly evidence: readonly ApprovalEvidence[];
  readonly runtimes: readonly OpenAIV1RuntimeCoverageSeal[];
  readonly sealDigest: string;
}

export interface OpenAIV1ProductionApprovalClaim {
  readonly evaluationRef: string;
  readonly evidenceDigest: string;
  readonly approvalTarget: typeof OPENAI_V1_APPROVAL_TARGET;
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: typeof OPENAI_V1_CAPABILITY_PROFILE_REF;
}
export interface OpenAIV1RuntimeApprovalMaterial {
  readonly tier: OpenAIV1CertificationTier;
  readonly release: ProviderReleaseRef;
  readonly evaluationEvidence: readonly ApprovalEvidence[];
  readonly productionApprovals: readonly OpenAIV1ProductionApprovalClaim[];
}

export type OpenAIV1SealRefusal =
  | 'invalid-input'
  | 'safety-incomplete'
  | 'review-set-mismatch'
  | 'review-rejected'
  | 'review-bundle-mismatch'
  | 'binding-mismatch'
  | 'data-controls-mismatch';

export type OpenAIV1SealResult =
  | { readonly ok: true; readonly seal: OpenAIV1ProductionSeal }
  | { readonly ok: false; readonly reason: OpenAIV1SealRefusal };

function instant(value: string): boolean {
  return INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function reviewKey(tier: OpenAIV1CertificationTier, agent: OpenAIV1CertificationAgent): string {
  return `${tier}/${agent}`;
}
function refuse(reason: OpenAIV1SealRefusal): OpenAIV1SealResult {
  return Object.freeze({ ok: false as const, reason });
}

function sameRelease(bindings: readonly ApprovalEvidence[]): ProviderReleaseRef | null {
  const first = bindings[0]?.binding.release;
  if (first === undefined) return null;
  const key = releaseKey(first);
  return bindings.every((item) => releaseKey(item.binding.release) === key) ? first : null;
}

export function createOpenAIV1ProductionSeal(input: {
  readonly manifest: OpenAIV1CertificationManifest;
  readonly reviews: readonly OpenAIV1HumanReview[];
  readonly ownerAcceptance: OpenAIV1OwnerAcceptance;
  readonly sealedAt: string;
}): OpenAIV1SealResult {
  let manifest: OpenAIV1CertificationManifest;
  try {
    manifest = createOpenAIV1CertificationManifest(input.manifest);
  } catch {
    return refuse('invalid-input');
  }
  if (!openAIV1CertificationReady(manifest)) return refuse('safety-incomplete');
  if (
    !instant(input.sealedAt) ||
    !SAFE_REF.test(input.ownerAcceptance.ownerRef) ||
    !instant(input.ownerAcceptance.acceptedAt) ||
    input.ownerAcceptance.decision !== 'ACCEPT'
  ) {
    return refuse('invalid-input');
  }
  if (input.ownerAcceptance.acceptedDataControlsRef !== OPENAI_V1_DATA_CONTROLS_REF) {
    return refuse('data-controls-mismatch');
  }

  const expectedReviewCount =
    OPENAI_V1_CERTIFICATION_TIERS.length * OPENAI_V1_CERTIFICATION_AGENTS.length;
  if (input.reviews.length !== expectedReviewCount) return refuse('review-set-mismatch');

  const reviews = new Map<string, OpenAIV1HumanReview>();
  for (const review of input.reviews) {
    if (
      !OPENAI_V1_CERTIFICATION_TIERS.includes(review.tier) ||
      !OPENAI_V1_CERTIFICATION_AGENTS.includes(review.agent) ||
      !SAFE_REF.test(review.reviewerRef) ||
      !instant(review.reviewedAt) ||
      !SHA256.test(review.reviewBundleDigest)
    ) {
      return refuse('invalid-input');
    }
    const key = reviewKey(review.tier, review.agent);
    if (reviews.has(key)) return refuse('review-set-mismatch');
    reviews.set(key, review);
  }

  const manifestDigest = contentDigest(manifest);
  const evidence: ApprovalEvidence[] = [];

  for (const entry of manifest.entries) {
    const review = reviews.get(reviewKey(entry.tier, entry.agent));
    if (review === undefined) return refuse('review-set-mismatch');
    if (review.decision !== 'ACCEPT') return refuse('review-rejected');
    if (review.reviewBundleDigest !== entry.reviewBundleDigest) {
      return refuse('review-bundle-mismatch');
    }
    const binding = createOpenAIV1Binding(entry.tier, entry.agent, entry.knowledgeRevision);
    if (
      entry.releaseId !== binding.release.releaseId ||
      entry.configDigest !== binding.release.configDigest ||
      entry.promptDigest !== binding.promptDigest
    ) {
      return refuse('binding-mismatch');
    }

    evidence.push(
      Object.freeze({
        evaluationRef: `evref-${contentDigest({
          lane: 'openai-v1.production-seal',
          manifestDigest,
          tier: entry.tier,
          agent: entry.agent,
          resultDigest: entry.resultDigest,
          reviewBundleDigest: review.reviewBundleDigest,
          reviewerRef: review.reviewerRef,
          reviewedAt: review.reviewedAt,
          ownerRef: input.ownerAcceptance.ownerRef,
          ownerAcceptedAt: input.ownerAcceptance.acceptedAt,
          providerDataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
        })}`,
        target: OPENAI_V1_APPROVAL_TARGET,
        binding,
        suiteResultDigest: entry.resultDigest,
        caseSetDigest: entry.caseSetDigest,
        createdAt: input.sealedAt,
        synthetic: false,
        productionApproval: true,
      }),
    );
  }
  const runtimes: OpenAIV1RuntimeCoverageSeal[] = [];
  for (const tier of OPENAI_V1_CERTIFICATION_TIERS) {
    const tierEvidence = evidence.filter(
      (item) =>
        item.binding.release.releaseId === createOpenAIV1Binding(tier, 'RIYA').release.releaseId,
    );
    if (tierEvidence.length !== OPENAI_V1_CERTIFICATION_AGENTS.length) {
      return refuse('binding-mismatch');
    }
    const release = sameRelease(tierEvidence);
    if (release === null) return refuse('binding-mismatch');
    const promptDigests = tierEvidence.map((item) => item.binding.promptDigest);
    if (new Set(promptDigests).size !== OPENAI_V1_CERTIFICATION_AGENTS.length) {
      return refuse('binding-mismatch');
    }
    const evidenceRefs = tierEvidence.map((item) => item.evaluationRef);
    runtimes.push(
      Object.freeze({
        tier,
        release,
        capabilityProfileRef: OPENAI_V1_CAPABILITY_PROFILE_REF,
        evidenceRefs: Object.freeze(evidenceRefs),
        promptDigests: Object.freeze(promptDigests),
        coverageDigest: contentDigest({
          tier,
          release: releaseKey(release),
          evidenceRefs,
          promptDigests,
        }),
      }),
    );
  }

  const body = Object.freeze({
    version: OPENAI_V1_SEAL_VERSION,
    target: OPENAI_V1_APPROVAL_TARGET,
    sourceRunId: manifest.runId,
    sourceHeadSha: manifest.headSha,
    sourceManifestDigest: manifestDigest,
    sealedAt: input.sealedAt,
    ownerRef: input.ownerAcceptance.ownerRef,
    providerMode: OPENAI_V1_PROVIDER_MODE,
    providerDataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
    evidence: Object.freeze(evidence),
    runtimes: Object.freeze(runtimes),
  });
  return Object.freeze({
    ok: true as const,
    seal: Object.freeze({
      ...body,
      sealDigest: contentDigest(body),
    }),
  });
}
export function openAIV1RuntimeApprovalMaterial(
  seal: OpenAIV1ProductionSeal,
  tier: OpenAIV1CertificationTier,
): OpenAIV1RuntimeApprovalMaterial {
  const runtime = seal.runtimes.find((item) => item.tier === tier);
  if (runtime === undefined) throw new TypeError('openai-v1-runtime-not-sealed');
  const evaluationEvidence = seal.evidence.filter(
    (item) => item.binding.release.releaseId === runtime.release.releaseId,
  );
  if (evaluationEvidence.length !== OPENAI_V1_CERTIFICATION_AGENTS.length) {
    throw new TypeError('openai-v1-runtime-evidence-mismatch');
  }
  const productionApprovals = evaluationEvidence.map((evidence) =>
    Object.freeze({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: contentDigest(evidence),
      approvalTarget: OPENAI_V1_APPROVAL_TARGET,
      release: runtime.release,
      capabilityProfileRef: OPENAI_V1_CAPABILITY_PROFILE_REF,
    }),
  );
  return Object.freeze({
    tier,
    release: runtime.release,
    evaluationEvidence: Object.freeze(evaluationEvidence),
    productionApprovals: Object.freeze(productionApprovals),
  });
}
