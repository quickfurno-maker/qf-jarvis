/**
 * JF-5C — owner production-evidence seal.
 *
 * Pure and non-activating. v2 consumes the sanitized JF-5B Groq-only three-binding manifest
 * plus blinded human review decisions. It performs no I/O and exposes no rollout control.
 * Historical dual-provider v1 manifests remain parseable upstream but are refused here.
 */
import {
  ACTIVE_CERTIFICATION_PROVIDERS,
  CERTIFIED_AGENTS,
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
  JF5B_PROVIDER_MODE,
  JF5B_RED_TEAM_SUITE_ID,
  JF5B_RED_TEAM_SUITE_VERSION,
  PROMPT_BY_AGENT,
  createJf5bCoverageManifest,
  manifestReadiness,
  type ActiveCertifiedProvider,
  type CertifiedAgent,
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

export const JF5C_SEAL_VERSION = 2 as const;
export const JF5C_APPROVAL_TARGET = 'ACTIVE_MODEL_RELEASE' as const;

export interface Jf5cHumanReview {
  readonly provider: ActiveCertifiedProvider;
  readonly agent: CertifiedAgent;
  readonly reviewerRef: string;
  readonly reviewedAt: string;
  readonly reviewBundleDigest: string;
  readonly decision: 'ACCEPT' | 'REJECT';
}

export interface Jf5cOwnerAcceptance {
  readonly ownerRef: string;
  readonly acceptedAt: string;
  readonly decision: 'ACCEPT' | 'REJECT';
}
export interface Jf5cProviderCoverageSeal {
  readonly provider: ActiveCertifiedProvider;
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
  readonly providerMode: typeof JF5B_PROVIDER_MODE;
  readonly providerDataControlsRefs: readonly [typeof GROQ_DATA_CONTROLS_REF];
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
  | 'provider-mode-mismatch'
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

function reviewKey(provider: ActiveCertifiedProvider, agent: CertifiedAgent): string {
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
      ...(entry.knowledgeRevision === undefined
        ? {}
        : { knowledgeRevision: entry.knowledgeRevision }),
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

  if (
    manifest.manifestVersion !== 2 ||
    manifest.entries.some((entry) => entry.provider !== 'groq')
  ) {
    return refusal('provider-mode-mismatch');
  }
  if (!instant(input.sealedAt) || !SAFE_REF.test(input.ownerAcceptance.ownerRef)) {
    return refusal('invalid-input');
  }
  if (!instant(input.ownerAcceptance.acceptedAt) || input.ownerAcceptance.decision !== 'ACCEPT') {
    return refusal('invalid-input');
  }
  const dataControls = [...manifest.dataControlsRefs];
  if (dataControls.length !== 1 || dataControls[0] !== GROQ_DATA_CONTROLS_REF) {
    return refusal('manifest-data-controls-mismatch');
  }
  if (!manifestReadiness(manifest).allSafetyPassed) {
    return refusal('safety-incomplete');
  }
  if (input.reviews.length !== ACTIVE_CERTIFICATION_PROVIDERS.length * CERTIFIED_AGENTS.length) {
    return refusal('review-set-mismatch');
  }
  const reviews = new Map<string, Jf5cHumanReview>();
  for (const review of input.reviews) {
    if (
      !ACTIVE_CERTIFICATION_PROVIDERS.includes(review.provider) ||
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

  const manifestRevisions = manifest.entries.flatMap((entry) =>
    entry.knowledgeRevision === undefined ? [] : [entry.knowledgeRevision],
  );
  if (
    manifestRevisions.length > 0 &&
    (manifestRevisions.length !== manifest.entries.length || new Set(manifestRevisions).size !== 1)
  ) {
    return refusal('binding-mismatch');
  }

  const manifestDigest = contentDigest(manifest);
  const evidence: ApprovalEvidence[] = [];
  const bindingsByProvider = new Map<ActiveCertifiedProvider, EvaluationBinding[]>();

  for (const entry of manifest.entries) {
    if (entry.provider !== 'groq') return refusal('provider-mode-mismatch');
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
      lane: 'jf5c.production-seal.v2.groq-only',
      manifestDigest,
      provider: entry.provider,
      agent: entry.agent,
      resultDigest: entry.resultDigest,
      reviewBundleDigest: review.reviewBundleDigest,
      reviewerRef: review.reviewerRef,
      reviewedAt: review.reviewedAt,
      ownerRef: input.ownerAcceptance.ownerRef,
      ownerAcceptedAt: input.ownerAcceptance.acceptedAt,
      providerMode: JF5B_PROVIDER_MODE,
      providerDataControlsRef: GROQ_DATA_CONTROLS_REF,
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
  for (const provider of ACTIVE_CERTIFICATION_PROVIDERS) {
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

  const providerDataControlsRefs: Jf5cProductionSeal['providerDataControlsRefs'] = Object.freeze([
    GROQ_DATA_CONTROLS_REF,
  ]);

  const body = {
    version: JF5C_SEAL_VERSION,
    target: JF5C_APPROVAL_TARGET,
    sourceRunId: manifest.runId,
    sourceHeadSha: manifest.headSha,
    sourceManifestDigest: manifestDigest,
    sealedAt: input.sealedAt,
    ownerRef: input.ownerAcceptance.ownerRef,
    providerMode: JF5B_PROVIDER_MODE,
    providerDataControlsRefs,
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
