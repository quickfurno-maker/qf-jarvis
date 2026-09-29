import {
  JARVIS_V1_OPENAI_CATALOGUE_OBSERVATION,
  JARVIS_V1_OPENAI_DATA_CONTROLS_REF,
  JARVIS_V1_OPENAI_MODEL_BY_TIER,
  JARVIS_V1_OPENAI_PROVIDER_MODE,
  JARVIS_V1_OPENAI_RELEASE_ID_BY_TIER,
  JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER,
  JARVIS_V1_OPENAI_TIERS,
  JARVIS_V1_PRODUCTION_AGENTS,
  JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
  JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
  JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
  JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT,
  type JarvisV1OpenAITier,
  type JarvisV1ProductionAgent,
} from '@qf-jarvis/jarvis-v1-production-profile';
import { OPENAI_RESPONSES_ENDPOINT } from '@qf-jarvis/model-gateway';
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
const REF = /^[A-Za-z0-9._:/-]{1,240}$/u;
export type OpenAIProductionSealBindingRefusal =
  | 'seal-invalid'
  | 'seal-digest-mismatch'
  | 'source-head-mismatch'
  | 'provider-mode-mismatch'
  | 'coverage-mismatch'
  | 'prompt-coverage-mismatch'
  | 'knowledge-revision-mismatch'
  | 'release-mismatch';

export interface OpenAIProductionTierBinding {
  readonly tier: JarvisV1OpenAITier;
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: typeof JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF;
  readonly promptBindings: ModelReplyPromptBindings;
  readonly riyaConversationEvolutionPromptBinding: ModelReplyPromptBinding;
  readonly riyaGroundedConversationEvolutionPromptBinding: ModelReplyPromptBinding;
  readonly riyaGroundedReplyPromptBinding: ModelReplyPromptBinding;
  readonly evaluationEvidence: readonly ApprovalEvidence[];
  readonly productionApprovals: readonly ProductionApprovalClaim[];
}

export interface OpenAIProductionSealBinding {
  readonly seal: unknown;
  readonly LUNA: OpenAIProductionTierBinding;
  readonly SOL: OpenAIProductionTierBinding;
}
export type OpenAIProductionSealBindingResult =
  | { readonly ok: true; readonly binding: OpenAIProductionSealBinding }
  | { readonly ok: false; readonly reason: OpenAIProductionSealBindingRefusal };

const refuse = (reason: OpenAIProductionSealBindingRefusal): OpenAIProductionSealBindingResult =>
  Object.freeze({ ok: false as const, reason });

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    items.push(item);
  }
  return Object.freeze(items);
}
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
function expectedConfigDigest(tier: JarvisV1OpenAITier): string {
  return contentDigest({
    providerId: 'openai',
    modelId: JARVIS_V1_OPENAI_MODEL_BY_TIER[tier],
    modelVersion: JARVIS_V1_OPENAI_CATALOGUE_OBSERVATION,
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    store: false,
    toolAccess: 'NONE',
    strictJsonSchema: true,
    reasoningEffort: JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER[tier],
    maxInputTokens: JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
    maxCompletionTokens: JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
    dataControlsRef: JARVIS_V1_OPENAI_DATA_CONTROLS_REF,
  });
}
function expectedRelease(tier: JarvisV1OpenAITier): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: JARVIS_V1_OPENAI_RELEASE_ID_BY_TIER[tier],
    providerId: 'openai',
    modelId: JARVIS_V1_OPENAI_MODEL_BY_TIER[tier],
    modelVersion: JARVIS_V1_OPENAI_CATALOGUE_OBSERVATION,
    configDigest: expectedConfigDigest(tier),
    executionClass: 'HOSTED',
  });
}
function releaseFrom(value: unknown): ProviderReleaseRef | null {
  if (!record(value)) return null;
  try {
    return createProviderReleaseRef({
      releaseId: value['releaseId'] as string,
      providerId: value['providerId'] as string,
      modelId: value['modelId'] as string,
      modelVersion: value['modelVersion'] as string,
      configDigest: value['configDigest'] as string,
      executionClass: value['executionClass'] as 'HOSTED',
    });
  } catch {
    return null;
  }
}
function tierForRelease(release: ProviderReleaseRef): JarvisV1OpenAITier | null {
  for (const tier of JARVIS_V1_OPENAI_TIERS) {
    if (releaseKey(release) === releaseKey(expectedRelease(tier))) return tier;
  }
  return null;
}
function agentForEvidence(evidence: ApprovalEvidence): JarvisV1ProductionAgent | null {
  for (const agent of JARVIS_V1_PRODUCTION_AGENTS) {
    const prompt = JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT[agent];
    if (
      evidence.binding.promptFamily === prompt.promptId &&
      evidence.binding.promptVersion === prompt.promptVersion &&
      evidence.binding.promptDigest === prompt.contentDigest
    )
      return agent;
  }
  return null;
}
function parseEvidence(
  value: unknown,
  expectedKnowledgeRevision: string | null | undefined,
): ApprovalEvidence | null {
  if (!record(value) || !record(value['binding'])) return null;
  const binding = value['binding'];
  const release = releaseFrom(binding['release']);
  if (release === null || tierForRelease(release) === null) return null;
  const knowledgeRevision = binding['knowledgeRevision'];
  const knowledgeMatches =
    expectedKnowledgeRevision === undefined
      ? true
      : expectedKnowledgeRevision === null
        ? knowledgeRevision === undefined
        : knowledgeRevision === expectedKnowledgeRevision;
  if (
    !knowledgeMatches ||
    typeof value['evaluationRef'] !== 'string' ||
    !REF.test(value['evaluationRef']) ||
    value['target'] !== 'ACTIVE_MODEL_RELEASE' ||
    value['synthetic'] !== false ||
    value['productionApproval'] !== true ||
    typeof value['suiteResultDigest'] !== 'string' ||
    !SHA256.test(value['suiteResultDigest']) ||
    typeof value['caseSetDigest'] !== 'string' ||
    !SHA256.test(value['caseSetDigest']) ||
    typeof value['createdAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['createdAt'])) ||
    binding['capabilityProfileRef'] !== JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF ||
    typeof binding['promptFamily'] !== 'string' ||
    typeof binding['promptVersion'] !== 'number' ||
    !Number.isSafeInteger(binding['promptVersion']) ||
    typeof binding['promptDigest'] !== 'string' ||
    !SHA256.test(binding['promptDigest'])
  )
    return null;
  return value as unknown as ApprovalEvidence;
}

function bindTier(
  tier: JarvisV1OpenAITier,
  evidenceList: readonly ApprovalEvidence[],
): OpenAIProductionTierBinding | null {
  const release = expectedRelease(tier);
  const evidence = evidenceList.filter(
    (item) => releaseKey(item.binding.release) === releaseKey(release),
  );
  if (evidence.length !== JARVIS_V1_PRODUCTION_AGENTS.length) return null;

  const agents = new Set<JarvisV1ProductionAgent>();
  const bindings: Partial<Record<'CLIENT' | 'VENDOR' | 'PROSPECT', ModelReplyPromptBinding>> = {};
  const approvals: ProductionApprovalClaim[] = [];
  for (const item of evidence) {
    const agent = agentForEvidence(item);
    if (agent === null || agents.has(agent)) return null;
    agents.add(agent);
    const prompt = JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT[agent];
    if (
      item.binding.promptFamily !== prompt.promptId ||
      item.binding.promptVersion !== prompt.promptVersion ||
      item.binding.promptDigest !== prompt.contentDigest
    )
      return null;
    const promptBinding: ModelReplyPromptBinding = Object.freeze({
      promptFamily: item.binding.promptFamily,
      promptVersion: item.binding.promptVersion,
      evaluationRef: item.evaluationRef,
      evaluationPromptDigest: item.binding.promptDigest,
    });
    if (agent === 'RIYA') bindings.CLIENT = promptBinding;
    else if (agent === 'ANISHA') bindings.VENDOR = promptBinding;
    else bindings.PROSPECT = promptBinding;
    approvals.push(
      Object.freeze({
        evaluationRef: item.evaluationRef,
        evidenceDigest: contentDigest(item),
        approvalTarget: 'ACTIVE_MODEL_RELEASE',
        release,
        capabilityProfileRef: JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
      }),
    );
  }
  if (
    bindings.CLIENT === undefined ||
    bindings.VENDOR === undefined ||
    bindings.PROSPECT === undefined
  )
    return null;
  const promptBindings: ModelReplyPromptBindings = Object.freeze({
    CLIENT: bindings.CLIENT,
    VENDOR: bindings.VENDOR,
    PROSPECT: bindings.PROSPECT,
  });
  return Object.freeze({
    tier,
    release,
    capabilityProfileRef: JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF,
    promptBindings,
    riyaConversationEvolutionPromptBinding: bindings.CLIENT,
    riyaGroundedConversationEvolutionPromptBinding: bindings.CLIENT,
    riyaGroundedReplyPromptBinding: bindings.CLIENT,
    evaluationEvidence: Object.freeze(evidence),
    productionApprovals: Object.freeze(approvals),
  });
}
export function bindOpenAIV1SealForProduction(
  value: unknown,
  expectedHeadSha: string,
  expectedKnowledgeRevision?: string | null,
): OpenAIProductionSealBindingResult {
  if (!SHA40.test(expectedHeadSha) || !record(value)) return refuse('seal-invalid');
  if (
    expectedKnowledgeRevision !== undefined &&
    expectedKnowledgeRevision !== null &&
    (!REF.test(expectedKnowledgeRevision) ||
      expectedKnowledgeRevision.toLowerCase() === 'latest' ||
      expectedKnowledgeRevision.includes('*'))
  )
    return refuse('knowledge-revision-mismatch');
  if (value['sourceHeadSha'] !== expectedHeadSha) return refuse('source-head-mismatch');
  if (
    value['version'] !== 1 ||
    value['target'] !== 'ACTIVE_MODEL_RELEASE' ||
    value['providerMode'] !== JARVIS_V1_OPENAI_PROVIDER_MODE ||
    value['providerDataControlsRef'] !== JARVIS_V1_OPENAI_DATA_CONTROLS_REF ||
    !Array.isArray(value['evidence']) ||
    !Array.isArray(value['runtimes']) ||
    typeof value['sealDigest'] !== 'string'
  )
    return refuse('seal-invalid');

  const sealBody: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (key !== 'sealDigest') sealBody[key] = item;
  if (contentDigest(sealBody) !== value['sealDigest']) return refuse('seal-digest-mismatch');

  const evidence: ApprovalEvidence[] = [];
  for (const raw of value['evidence']) {
    const parsed = parseEvidence(raw, expectedKnowledgeRevision);
    if (parsed === null) {
      if (
        expectedKnowledgeRevision !== undefined &&
        record(raw) &&
        record(raw['binding']) &&
        raw['binding']['knowledgeRevision'] !== (expectedKnowledgeRevision ?? undefined)
      )
        return refuse('knowledge-revision-mismatch');
      return refuse('release-mismatch');
    }
    evidence.push(parsed);
  }
  if (evidence.length !== 6) return refuse('coverage-mismatch');
  const tiers = new Set<JarvisV1OpenAITier>();
  for (const rawRuntime of value['runtimes']) {
    if (
      !record(rawRuntime) ||
      !JARVIS_V1_OPENAI_TIERS.includes(rawRuntime['tier'] as JarvisV1OpenAITier)
    ) {
      return refuse('coverage-mismatch');
    }
    const tier = rawRuntime['tier'] as JarvisV1OpenAITier;
    if (tiers.has(tier)) return refuse('coverage-mismatch');
    tiers.add(tier);
    const release = releaseFrom(rawRuntime['release']);
    const refs = stringArray(rawRuntime['evidenceRefs']);
    const digests = stringArray(rawRuntime['promptDigests']);
    if (
      release === null ||
      releaseKey(release) !== releaseKey(expectedRelease(tier)) ||
      rawRuntime['capabilityProfileRef'] !== JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF ||
      refs === null ||
      digests === null ||
      typeof rawRuntime['coverageDigest'] !== 'string'
    )
      return refuse('coverage-mismatch');

    const tierEvidence = evidence.filter(
      (item) => releaseKey(item.binding.release) === releaseKey(release),
    );
    const expectedRefs = tierEvidence.map((item) => item.evaluationRef);
    const expectedDigests = tierEvidence.map((item) => item.binding.promptDigest);
    if (!sameSet(refs, expectedRefs) || !sameSet(digests, expectedDigests)) {
      return refuse('coverage-mismatch');
    }
    const expectedCoverage = contentDigest({
      tier,
      release: releaseKey(release),
      evidenceRefs: refs,
      promptDigests: digests,
    });
    if (rawRuntime['coverageDigest'] !== expectedCoverage) return refuse('coverage-mismatch');
  }
  if (tiers.size !== 2) return refuse('coverage-mismatch');

  const luna = bindTier('LUNA', evidence);
  const sol = bindTier('SOL', evidence);
  if (luna === null || sol === null) return refuse('prompt-coverage-mismatch');
  return Object.freeze({
    ok: true as const,
    binding: Object.freeze({ seal: value, LUNA: luna, SOL: sol }),
  });
}
