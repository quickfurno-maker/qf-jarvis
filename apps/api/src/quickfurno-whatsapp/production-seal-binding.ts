/**
 * JF-7 production binding for the JF-5C Groq-only seal.
 *
 * This module is pure: no filesystem, credential, provider or network access. It turns one immutable
 * JF-5C v2 artifact into the exact evidence/approval/prompt inputs production composition is allowed to
 * consume. Anything incomplete or inconsistent refuses before the model credential is read.
 */
import {
  JARVIS_V1_GROQ_DATA_CONTROLS_REF,
  JARVIS_V1_PRODUCTION_AGENTS,
  JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
  JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT,
  JARVIS_V1_PRODUCTION_PROVIDER_MODE,
  type JarvisV1ProductionAgent,
} from '@qf-jarvis/jarvis-v1-production-profile';
import type { Jf5cProductionSeal } from '@qf-jarvis/jarvis-v1-production-seal';
import {
  contentDigest,
  createProviderReleaseRef,
  releaseKey,
  type ApprovalEvidence,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-evaluation';
import type { ProductionApprovalClaim } from '@qf-jarvis/model-gateway-composition';
import type {
  ModelReplyPromptBinding,
  ModelReplyPromptBindings,
} from '@qf-jarvis/model-reply-adapter';

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CONTENT_DIGEST = /^[0-9a-f]{32}$/u;
const REF = /^[A-Za-z0-9._:/-]{1,240}$/u;

export type ProductionSealBindingRefusal =
  | 'seal-invalid'
  | 'seal-digest-mismatch'
  | 'source-head-mismatch'
  | 'provider-mode-mismatch'
  | 'coverage-mismatch'
  | 'prompt-coverage-mismatch'
  | 'knowledge-revision-mismatch'
  | 'release-mismatch';

export interface ProductionSealBinding {
  readonly seal: Jf5cProductionSeal;
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: typeof JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF;
  readonly promptBindings: ModelReplyPromptBindings;
  readonly riyaConversationEvolutionPromptBinding: ModelReplyPromptBinding;
  /**
   * Riya's three task-class prompt definitions intentionally share one prompt family, version, body
   * and digest. The reviewed CLIENT evidence therefore binds the grounded variants to the exact same
   * reviewed bytes without fabricating a second prompt identity.
   */
  readonly riyaGroundedConversationEvolutionPromptBinding: ModelReplyPromptBinding;
  readonly riyaGroundedReplyPromptBinding: ModelReplyPromptBinding;
  readonly evaluationEvidence: readonly ApprovalEvidence[];
  readonly productionApprovals: readonly ProductionApprovalClaim[];
}

export type ProductionSealBindingResult =
  | { readonly ok: true; readonly binding: ProductionSealBinding }
  | { readonly ok: false; readonly reason: ProductionSealBindingRefusal };

function refusal(reason: ProductionSealBindingRefusal): ProductionSealBindingResult {
  return Object.freeze({ ok: false as const, reason });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const aa = [...a].sort();
  const bb = [...b].sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function releaseFrom(value: unknown): ProviderReleaseRef | null {
  if (!record(value)) return null;
  try {
    return createProviderReleaseRef({
      releaseId: value['releaseId'] as string,
      providerId: value['providerId'] as string,
      modelId: value['modelId'] as string,
      modelVersion: value['modelVersion'] as string,
      executionClass: value['executionClass'] as 'HOSTED',
      configDigest: value['configDigest'] as string,
    });
  } catch {
    return null;
  }
}

function agentForEvidence(evidence: ApprovalEvidence): JarvisV1ProductionAgent | null {
  for (const agent of JARVIS_V1_PRODUCTION_AGENTS) {
    const prompt = JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT[agent];
    if (
      evidence.binding.promptFamily === prompt.promptId &&
      evidence.binding.promptVersion === prompt.promptVersion &&
      evidence.binding.promptDigest === prompt.contentDigest
    ) {
      return agent;
    }
  }
  return null;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return Object.freeze(out);
}

export function bindJf5cSealForProduction(
  value: unknown,
  expectedHeadSha: string,
  expectedKnowledgeRevision?: string,
): ProductionSealBindingResult {
  if (!SHA40.test(expectedHeadSha) || !record(value)) return refusal('seal-invalid');
  if (
    expectedKnowledgeRevision !== undefined &&
    (!REF.test(expectedKnowledgeRevision) ||
      expectedKnowledgeRevision.toLowerCase() === 'latest' ||
      expectedKnowledgeRevision.includes('*'))
  ) {
    return refusal('knowledge-revision-mismatch');
  }

  const providerDataControlsRefs = stringArray(value['providerDataControlsRefs']);
  const evidenceRaw = Array.isArray(value['evidence']) ? (value['evidence'] as unknown[]) : null;
  const providersRaw = Array.isArray(value['providers']) ? (value['providers'] as unknown[]) : null;
  if (
    value['version'] !== 2 ||
    value['target'] !== 'ACTIVE_MODEL_RELEASE' ||
    typeof value['sourceRunId'] !== 'string' ||
    !REF.test(value['sourceRunId']) ||
    typeof value['sourceHeadSha'] !== 'string' ||
    !SHA40.test(value['sourceHeadSha']) ||
    typeof value['sourceManifestDigest'] !== 'string' ||
    !CONTENT_DIGEST.test(value['sourceManifestDigest']) ||
    typeof value['sealedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['sealedAt'])) ||
    typeof value['ownerRef'] !== 'string' ||
    !REF.test(value['ownerRef']) ||
    value['providerMode'] !== JARVIS_V1_PRODUCTION_PROVIDER_MODE ||
    providerDataControlsRefs === null ||
    evidenceRaw === null ||
    providersRaw === null ||
    typeof value['sealDigest'] !== 'string' ||
    !CONTENT_DIGEST.test(value['sealDigest'])
  ) {
    return refusal('seal-invalid');
  }
  if (
    providerDataControlsRefs.length !== 1 ||
    providerDataControlsRefs[0] !== JARVIS_V1_GROQ_DATA_CONTROLS_REF
  ) {
    return refusal('provider-mode-mismatch');
  }
  if (value['sourceHeadSha'] !== expectedHeadSha) return refusal('source-head-mismatch');

  const sealBody: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'sealDigest') sealBody[key] = item;
  }
  if (contentDigest(sealBody) !== value['sealDigest']) return refusal('seal-digest-mismatch');

  if (providersRaw.length !== 1 || evidenceRaw.length !== JARVIS_V1_PRODUCTION_AGENTS.length) {
    return refusal('coverage-mismatch');
  }

  const providerCoverageRaw = providersRaw[0];
  if (!record(providerCoverageRaw)) return refusal('coverage-mismatch');
  const providerEvidenceRefs = stringArray(providerCoverageRaw['evidenceRefs']);
  const providerPromptDigests = stringArray(providerCoverageRaw['promptDigests']);
  if (
    providerCoverageRaw['provider'] !== 'groq' ||
    providerCoverageRaw['capabilityProfileRef'] !== JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF ||
    providerEvidenceRefs === null ||
    providerPromptDigests === null ||
    typeof providerCoverageRaw['coverageDigest'] !== 'string' ||
    !CONTENT_DIGEST.test(providerCoverageRaw['coverageDigest'])
  ) {
    return refusal('coverage-mismatch');
  }

  const release = releaseFrom(providerCoverageRaw['release']);
  if (release?.providerId !== 'groq' || release.executionClass !== 'HOSTED') {
    return refusal('release-mismatch');
  }

  const promptBindings: Partial<Record<'CLIENT' | 'VENDOR' | 'PROSPECT', ModelReplyPromptBinding>> =
    {};
  const agents = new Set<JarvisV1ProductionAgent>();
  const evidenceRefs: string[] = [];
  const promptDigests: string[] = [];
  const approvals: ProductionApprovalClaim[] = [];
  const evidenceList: ApprovalEvidence[] = [];

  for (const rawEvidence of evidenceRaw) {
    if (
      !record(rawEvidence) ||
      typeof rawEvidence['evaluationRef'] !== 'string' ||
      !REF.test(rawEvidence['evaluationRef']) ||
      rawEvidence['target'] !== 'ACTIVE_MODEL_RELEASE' ||
      rawEvidence['synthetic'] !== false ||
      rawEvidence['productionApproval'] !== true ||
      typeof rawEvidence['suiteResultDigest'] !== 'string' ||
      !SHA256.test(rawEvidence['suiteResultDigest']) ||
      typeof rawEvidence['caseSetDigest'] !== 'string' ||
      !SHA256.test(rawEvidence['caseSetDigest']) ||
      typeof rawEvidence['createdAt'] !== 'string' ||
      !Number.isFinite(Date.parse(rawEvidence['createdAt'])) ||
      !record(rawEvidence['binding'])
    ) {
      return refusal('seal-invalid');
    }

    const bindingRaw = rawEvidence['binding'];
    const evidenceRelease = releaseFrom(bindingRaw['release']);
    if (
      evidenceRelease === null ||
      bindingRaw['capabilityProfileRef'] !== JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF ||
      typeof bindingRaw['promptFamily'] !== 'string' ||
      typeof bindingRaw['promptVersion'] !== 'number' ||
      !Number.isSafeInteger(bindingRaw['promptVersion']) ||
      typeof bindingRaw['promptDigest'] !== 'string' ||
      !SHA256.test(bindingRaw['promptDigest']) ||
      (expectedKnowledgeRevision !== undefined &&
        bindingRaw['knowledgeRevision'] !== expectedKnowledgeRevision)
    ) {
      return expectedKnowledgeRevision !== undefined &&
        bindingRaw['knowledgeRevision'] !== expectedKnowledgeRevision
        ? refusal('knowledge-revision-mismatch')
        : refusal('release-mismatch');
    }
    if (releaseKey(evidenceRelease) !== releaseKey(release)) return refusal('release-mismatch');

    const evidence = rawEvidence as unknown as ApprovalEvidence;
    const agent = agentForEvidence(evidence);
    if (agent === null || agents.has(agent)) return refusal('prompt-coverage-mismatch');
    agents.add(agent);
    evidenceList.push(evidence);
    evidenceRefs.push(evidence.evaluationRef);
    promptDigests.push(evidence.binding.promptDigest);

    const binding: ModelReplyPromptBinding = Object.freeze({
      promptFamily: evidence.binding.promptFamily,
      promptVersion: evidence.binding.promptVersion,
      evaluationRef: evidence.evaluationRef,
      evaluationPromptDigest: evidence.binding.promptDigest,
    });
    if (agent === 'RIYA') promptBindings.CLIENT = binding;
    else if (agent === 'ANISHA') promptBindings.VENDOR = binding;
    else promptBindings.PROSPECT = binding;

    approvals.push(
      Object.freeze({
        evaluationRef: evidence.evaluationRef,
        evidenceDigest: contentDigest(evidence),
        approvalTarget: 'ACTIVE_MODEL_RELEASE',
        release,
        capabilityProfileRef: JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
      }),
    );
  }

  if (
    agents.size !== JARVIS_V1_PRODUCTION_AGENTS.length ||
    promptBindings.CLIENT === undefined ||
    promptBindings.VENDOR === undefined ||
    promptBindings.PROSPECT === undefined
  ) {
    return refusal('prompt-coverage-mismatch');
  }

  const expectedPromptDigests = JARVIS_V1_PRODUCTION_AGENTS.map(
    (agent) => JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT[agent].contentDigest,
  );
  if (
    !sameSet(providerEvidenceRefs, evidenceRefs) ||
    !sameSet(providerPromptDigests, promptDigests) ||
    !sameSet(promptDigests, expectedPromptDigests)
  ) {
    return refusal('coverage-mismatch');
  }
  const expectedCoverageDigest = contentDigest({
    provider: 'groq',
    release: releaseKey(release),
    evidenceRefs,
    promptDigests,
  });
  if (providerCoverageRaw['coverageDigest'] !== expectedCoverageDigest) {
    return refusal('coverage-mismatch');
  }

  const frozenBindings: ModelReplyPromptBindings = Object.freeze({
    CLIENT: promptBindings.CLIENT,
    VENDOR: promptBindings.VENDOR,
    PROSPECT: promptBindings.PROSPECT,
  });
  return Object.freeze({
    ok: true as const,
    binding: Object.freeze({
      seal: value as unknown as Jf5cProductionSeal,
      release,
      capabilityProfileRef: JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
      promptBindings: frozenBindings,
      riyaConversationEvolutionPromptBinding: promptBindings.CLIENT,
      riyaGroundedConversationEvolutionPromptBinding: promptBindings.CLIENT,
      riyaGroundedReplyPromptBinding: promptBindings.CLIENT,
      evaluationEvidence: Object.freeze(evidenceList),
      productionApprovals: Object.freeze(approvals),
    }),
  });
}
