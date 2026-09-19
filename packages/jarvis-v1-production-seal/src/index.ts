/**
 * JF-5C — owner production-evidence seal.
 *
 * Pure and non-activating. It consumes the sanitized JF-5B six-binding manifest,
 * blinded human review decisions, and explicit owner acceptance of the observed
 * Nara data-controls posture. It performs no I/O and exposes no rollout control.
 */
import {
  CERTIFIED_AGENTS,
  CERTIFIED_PROVIDERS,
  GROQ_DATA_CONTROLS_REF,
  JF5B_CAPABILITY_PROFILE_REF,
  JF5B_CREATED_AT,
  JF5B_EVALUATION_SUITE_ID,
  JF5B_EVALUATION_SUITE_VERSION,
  JF5B_EVALUATOR_IMPL_ID,
  JF5B_EVALUATOR_IMPL_VERSION,
  JF5B_FIXTURE_MANIFEST_ID,
  JF5B_FIXTURE_MANIFEST_VERSION,
  JF5B_POLICY_CONTRACT_REVISION,
  JF5B_RED_TEAM_SUITE_ID,
  JF5B_RED_TEAM_SUITE_VERSION,
  NARA_DATA_CONTROLS_REF,
  PROMPT_BY_AGENT,
  createJf5bCoverageManifest,
  manifestReadiness,
  type CertifiedAgent,
  type CertifiedProvider,
  type Jf5bCoverageManifest,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import {
  contentDigest,
  createEvaluationBinding,
  createProviderReleaseRef,
  releaseKey,
  type ApprovalEvidence,
  type EvaluationBinding,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-evaluation';

export const JF5C_SEAL_VERSION = 1 as const;
export const JF5C_APPROVAL_TARGET = 'ACTIVE_MODEL_RELEASE' as const;

export interface Jf5cHumanReview {
  readonly provider: CertifiedProvider;
  readonly agent: CertifiedAgent;
  readonly reviewerRef: string;
  readonly reviewedAt: string;
  readonly reviewBundleDigest: string;
  readonly decision: 'ACCEPT' | 'REJECT';
}

export interface Jf5cOwnerAcceptance {
  readonly ownerRef: string;
  readonly acceptedAt: string;
  readonly naraDataControlsRef: string;
  readonly decision: 'ACCEPT' | 'REJECT';
}
export interface Jf5cProviderCoverageSeal {
  readonly provider: CertifiedProvider;
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: typeof JF5B_CAPABILITY_PROFILE_REF;
  readonly evidenceRefs: readonly string[];
  readonly promptDigests: readonly string[];
  readonly coverageDigest: string;
}

export interface Jf5cProductionSeal {
  readonly version: typeof JF5C_SEAL_VERSION;
  readonly target: typeof JF5C_APPROVAL_TARGET;
  readonly sourceRunId: string;
  readonly sourceHeadSha: string;
  readonly sourceManifestDigest: string;
  readonly sealedAt: string;
  readonly ownerRef: string;
  readonly naraDataControlsRef: typeof NARA_DATA_CONTROLS_REF;
  readonly evidence: readonly ApprovalEvidence[];
  readonly providers: readonly Jf5cProviderCoverageSeal[];
  readonly sealDigest: string;
}

export type Jf5cSealRefusal =
  | 'invalid-input'
  | 'safety-incomplete'
  | 'manifest-data-controls-mismatch'
  | 'review-set-mismatch'
  | 'review-rejected'
  | 'review-bundle-mismatch'
  | 'nara-data-controls-not-accepted'
  | 'binding-mismatch';

export type Jf5cSealResult =
  | { readonly ok: true; readonly seal: Jf5cProductionSeal }
  | { readonly ok: false; readonly reason: Jf5cSealRefusal };
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_REF = /^[A-Za-z0-9._:/-]{1,160}$/u;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function instant(value: string): boolean {
  return CANONICAL_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function reviewKey(provider: CertifiedProvider, agent: CertifiedAgent): string {
  return `${provider}/${agent}`;
}

function refusal(reason: Jf5cSealRefusal): Jf5cSealResult {
  return Object.freeze({ ok: false as const, reason });
}

function expectedBinding(entry: Jf5bCoverageManifest['entries'][number]): EvaluationBinding | null {
  const prompt = PROMPT_BY_AGENT[entry.agent];
  if (
    entry.evaluationSuiteId !== JF5B_EVALUATION_SUITE_ID ||
    entry.evaluationSuiteVersion !== JF5B_EVALUATION_SUITE_VERSION ||
    entry.redTeamSuiteId !== JF5B_RED_TEAM_SUITE_ID ||
    entry.fixtureManifestId !== JF5B_FIXTURE_MANIFEST_ID ||
    entry.promptFamily !== prompt.promptId ||
    entry.promptVersion !== prompt.promptVersion ||
    entry.promptDigest !== prompt.contentDigest
  ) {
    return null;
  }
  let release: ProviderReleaseRef;
  try {
    release = createProviderReleaseRef({
      releaseId: entry.releaseId,
      providerId: entry.provider,
      modelId: entry.modelId,
      modelVersion: entry.modelVersion,
      configDigest: entry.configDigest,
      executionClass: 'HOSTED',
    });
    return createEvaluationBinding({
      evaluationSuiteId: JF5B_EVALUATION_SUITE_ID,
      evaluationSuiteVersion: JF5B_EVALUATION_SUITE_VERSION,
      redTeamSuiteId: JF5B_RED_TEAM_SUITE_ID,
      redTeamSuiteVersion: JF5B_RED_TEAM_SUITE_VERSION,
      fixtureManifestId: JF5B_FIXTURE_MANIFEST_ID,
      fixtureManifestVersion: JF5B_FIXTURE_MANIFEST_VERSION,
      evaluatorImplId: JF5B_EVALUATOR_IMPL_ID,
      evaluatorImplVersion: JF5B_EVALUATOR_IMPL_VERSION,
      release,
      promptFamily: prompt.promptId,
      promptVersion: prompt.promptVersion,
      promptDigest: prompt.contentDigest,
      capabilityProfileRef: JF5B_CAPABILITY_PROFILE_REF,
      policyContractRevision: JF5B_POLICY_CONTRACT_REVISION,
      createdAt: JF5B_CREATED_AT,
    });
  } catch {
    return null;
  }
}

function sameProviderRelease(bindings: readonly EvaluationBinding[]): ProviderReleaseRef | null {
  const first = bindings[0]?.release;
  if (!first) return null;
  const key = releaseKey(first);
  return bindings.every((binding) => releaseKey(binding.release) === key) ? first : null;
}
export function createJf5cProductionSeal(input: {
  readonly manifest: Jf5bCoverageManifest;
  readonly reviews: readonly Jf5cHumanReview[];
  readonly ownerAcceptance: Jf5cOwnerAcceptance;
  readonly sealedAt: string;
}): Jf5cSealResult {
  let manifest: Jf5bCoverageManifest;
  try {
    manifest = createJf5bCoverageManifest(input.manifest);
  } catch {
    return refusal('invalid-input');
  }

  if (!instant(input.sealedAt) || !SAFE_REF.test(input.ownerAcceptance.ownerRef)) {
    return refusal('invalid-input');
  }
  if (
    !instant(input.ownerAcceptance.acceptedAt) ||
    input.ownerAcceptance.decision !== 'ACCEPT' ||
    input.ownerAcceptance.naraDataControlsRef !== NARA_DATA_CONTROLS_REF
  ) {
    return refusal('nara-data-controls-not-accepted');
  }
  const dataControls = [...manifest.dataControlsRefs].sort();
  const requiredControls = [GROQ_DATA_CONTROLS_REF, NARA_DATA_CONTROLS_REF].sort();
  if (
    dataControls.length !== requiredControls.length ||
    dataControls.some((value, index) => value !== requiredControls[index])
  ) {
    return refusal('manifest-data-controls-mismatch');
  }
  if (!manifestReadiness(manifest).allSafetyPassed) {
    return refusal('safety-incomplete');
  }
  if (input.reviews.length !== CERTIFIED_PROVIDERS.length * CERTIFIED_AGENTS.length) {
    return refusal('review-set-mismatch');
  }
  const reviews = new Map<string, Jf5cHumanReview>();
  for (const review of input.reviews) {
    if (
      !CERTIFIED_PROVIDERS.includes(review.provider) ||
      !CERTIFIED_AGENTS.includes(review.agent) ||
      !SAFE_REF.test(review.reviewerRef) ||
      !instant(review.reviewedAt) ||
      !SHA256.test(review.reviewBundleDigest)
    ) {
      return refusal('invalid-input');
    }
    const key = reviewKey(review.provider, review.agent);
    if (reviews.has(key)) return refusal('review-set-mismatch');
    reviews.set(key, review);
  }

  const manifestDigest = contentDigest(manifest);
  const evidence: ApprovalEvidence[] = [];
  const bindingsByProvider = new Map<CertifiedProvider, EvaluationBinding[]>();

  for (const entry of manifest.entries) {
    const review = reviews.get(reviewKey(entry.provider, entry.agent));
    if (!review) return refusal('review-set-mismatch');
    if (review.decision !== 'ACCEPT') return refusal('review-rejected');
    if (
      entry.reviewBundleDigest === undefined ||
      review.reviewBundleDigest !== entry.reviewBundleDigest
    ) {
      return refusal('review-bundle-mismatch');
    }
    const binding = expectedBinding(entry);
    if (!binding) return refusal('binding-mismatch');
    const evaluationRef = `evref-${contentDigest({
      lane: 'jf5c.production-seal.v1',
      manifestDigest,
      provider: entry.provider,
      agent: entry.agent,
      resultDigest: entry.resultDigest,
      reviewBundleDigest: review.reviewBundleDigest,
      reviewerRef: review.reviewerRef,
      reviewedAt: review.reviewedAt,
      ownerRef: input.ownerAcceptance.ownerRef,
      ownerAcceptedAt: input.ownerAcceptance.acceptedAt,
      naraDataControlsRef: NARA_DATA_CONTROLS_REF,
    })}`;

    evidence.push(
      Object.freeze({
        evaluationRef,
        target: JF5C_APPROVAL_TARGET,
        binding,
        suiteResultDigest: entry.resultDigest,
        caseSetDigest: entry.caseSetDigest,
        createdAt: input.sealedAt,
        synthetic: false,
        productionApproval: true,
      }),
    );
    const group = bindingsByProvider.get(entry.provider) ?? [];
    group.push(binding);
    bindingsByProvider.set(entry.provider, group);
  }

  const providers: Jf5cProviderCoverageSeal[] = [];
  for (const provider of CERTIFIED_PROVIDERS) {
    const bindings = bindingsByProvider.get(provider) ?? [];
    if (bindings.length !== CERTIFIED_AGENTS.length) return refusal('binding-mismatch');
    const release = sameProviderRelease(bindings);
    if (!release) return refusal('binding-mismatch');
    const providerEvidence = evidence.filter(
      (item) => item.binding.release.providerId === provider,
    );
    const promptDigests = providerEvidence.map((item) => item.binding.promptDigest);
    if (new Set(promptDigests).size !== CERTIFIED_AGENTS.length) {
      return refusal('binding-mismatch');
    }
    const evidenceRefs = providerEvidence.map((item) => item.evaluationRef);
    providers.push(
      Object.freeze({
        provider,
        release,
        capabilityProfileRef: JF5B_CAPABILITY_PROFILE_REF,
        evidenceRefs: Object.freeze(evidenceRefs),
        promptDigests: Object.freeze(promptDigests),
        coverageDigest: contentDigest({
          provider,
          release: releaseKey(release),
          evidenceRefs,
          promptDigests,
        }),
      }),
    );
  }

  const body = {
    version: JF5C_SEAL_VERSION,
    target: JF5C_APPROVAL_TARGET,
    sourceRunId: manifest.runId,
    sourceHeadSha: manifest.headSha,
    sourceManifestDigest: manifestDigest,
    sealedAt: input.sealedAt,
    ownerRef: input.ownerAcceptance.ownerRef,
    naraDataControlsRef: NARA_DATA_CONTROLS_REF,
    evidence: Object.freeze(evidence),
    providers: Object.freeze(providers),
  } as const;
  return Object.freeze({
    ok: true as const,
    seal: Object.freeze({
      ...body,
      sealDigest: contentDigest(body),
    }),
  });
}
