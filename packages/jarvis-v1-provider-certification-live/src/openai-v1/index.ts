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
  createEvaluationBinding,
  createProviderReleaseRef,
  type EvaluationBinding,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-evaluation';
import { z } from 'zod';

export const OPENAI_V1_CERTIFICATION_TIERS = JARVIS_V1_OPENAI_TIERS;
export type OpenAIV1CertificationTier = JarvisV1OpenAITier;
export const OPENAI_V1_CERTIFICATION_AGENTS = JARVIS_V1_PRODUCTION_AGENTS;
export type OpenAIV1CertificationAgent = JarvisV1ProductionAgent;
export const OPENAI_V1_PROVIDER_MODE = JARVIS_V1_OPENAI_PROVIDER_MODE;
export const OPENAI_V1_CATALOGUE_OBSERVATION = JARVIS_V1_OPENAI_CATALOGUE_OBSERVATION;
export const OPENAI_V1_DATA_CONTROLS_REF = JARVIS_V1_OPENAI_DATA_CONTROLS_REF;
export const OPENAI_V1_MODEL_BY_TIER = JARVIS_V1_OPENAI_MODEL_BY_TIER;
export const OPENAI_V1_RELEASE_ID_BY_TIER = JARVIS_V1_OPENAI_RELEASE_ID_BY_TIER;
export const OPENAI_V1_CAPABILITY_PROFILE_REF = JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF;
export const OPENAI_V1_MAX_INPUT_TOKENS = JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS;
export const OPENAI_V1_MAX_COMPLETION_TOKENS = JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS;
export const OPENAI_V1_PROMPT_BY_AGENT = JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT;
export const OPENAI_V1_EVALUATION_SUITE_ID = 'suite.openai-v1.three-agent-live' as const;
export const OPENAI_V1_EVALUATION_SUITE_VERSION = 1 as const;
export const OPENAI_V1_RED_TEAM_SUITE_ID = 'redteam.openai-v1.three-agent-live' as const;
export const OPENAI_V1_RED_TEAM_SUITE_VERSION = 1 as const;
export const OPENAI_V1_FIXTURE_MANIFEST_ID = 'fixtures.openai-v1.synthetic-three-agent' as const;
export const OPENAI_V1_FIXTURE_MANIFEST_VERSION = 1 as const;
export const OPENAI_V1_EVALUATOR_IMPL_ID = 'qfj.eval.deterministic' as const;
export const OPENAI_V1_EVALUATOR_IMPL_VERSION = 1 as const;
export const OPENAI_V1_POLICY_CONTRACT_REVISION = 'policy.openai-v1.rev.1' as const;
export const OPENAI_V1_CREATED_AT = '2026-09-29T00:00:00Z' as const;

const SHA256 = /^[0-9a-f]{64}$/u;
const GOVERNED_DIGEST = /^[0-9a-f]{8,64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SAFE_REF = /^[A-Za-z0-9._:/-]{1,200}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function openAIV1ConfigDigest(tier: OpenAIV1CertificationTier): string {
  return contentDigest({
    providerId: 'openai',
    modelId: OPENAI_V1_MODEL_BY_TIER[tier],
    modelVersion: OPENAI_V1_CATALOGUE_OBSERVATION,
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    store: false,
    tools: 'NONE',
    strictJsonSchema: true,
    reasoningEffort: JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER[tier],
    maxInputTokens: OPENAI_V1_MAX_INPUT_TOKENS,
    maxCompletionTokens: OPENAI_V1_MAX_COMPLETION_TOKENS,
    dataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
  });
}
export function createOpenAIV1Release(tier: OpenAIV1CertificationTier): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: OPENAI_V1_RELEASE_ID_BY_TIER[tier],
    providerId: 'openai',
    modelId: OPENAI_V1_MODEL_BY_TIER[tier],
    modelVersion: OPENAI_V1_CATALOGUE_OBSERVATION,
    configDigest: openAIV1ConfigDigest(tier),
    executionClass: 'HOSTED',
  });
}

export function createOpenAIV1Binding(
  tier: OpenAIV1CertificationTier,
  agent: OpenAIV1CertificationAgent,
  knowledgeRevision?: string,
): EvaluationBinding {
  const prompt = OPENAI_V1_PROMPT_BY_AGENT[agent];
  return createEvaluationBinding({
    evaluationSuiteId: OPENAI_V1_EVALUATION_SUITE_ID,
    evaluationSuiteVersion: OPENAI_V1_EVALUATION_SUITE_VERSION,
    redTeamSuiteId: OPENAI_V1_RED_TEAM_SUITE_ID,
    redTeamSuiteVersion: OPENAI_V1_RED_TEAM_SUITE_VERSION,
    fixtureManifestId: OPENAI_V1_FIXTURE_MANIFEST_ID,
    fixtureManifestVersion: OPENAI_V1_FIXTURE_MANIFEST_VERSION,
    evaluatorImplId: OPENAI_V1_EVALUATOR_IMPL_ID,
    evaluatorImplVersion: OPENAI_V1_EVALUATOR_IMPL_VERSION,
    release: createOpenAIV1Release(tier),
    promptFamily: prompt.promptId,
    promptVersion: prompt.promptVersion,
    promptDigest: prompt.contentDigest,
    capabilityProfileRef: OPENAI_V1_CAPABILITY_PROFILE_REF,
    policyContractRevision: OPENAI_V1_POLICY_CONTRACT_REVISION,
    createdAt: OPENAI_V1_CREATED_AT,
    ...(knowledgeRevision === undefined ? {} : { knowledgeRevision }),
  });
}

export function createOpenAIV1BindingMatrix(
  knowledgeRevision?: string,
): readonly EvaluationBinding[] {
  return Object.freeze(
    OPENAI_V1_CERTIFICATION_TIERS.flatMap((tier) =>
      OPENAI_V1_CERTIFICATION_AGENTS.map((agent) =>
        createOpenAIV1Binding(tier, agent, knowledgeRevision),
      ),
    ),
  );
}
export interface OpenAIV1CertificationEntry {
  readonly tier: OpenAIV1CertificationTier;
  readonly agent: OpenAIV1CertificationAgent;
  readonly releaseId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly configDigest: string;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly promptDigest: string;
  readonly knowledgeRevision?: string;
  readonly caseSetDigest: string;
  readonly resultDigest: string;
  readonly reviewBundleDigest: string;
  readonly safety: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
}

export interface OpenAIV1CertificationManifest {
  readonly manifestVersion: 1;
  readonly providerMode: typeof OPENAI_V1_PROVIDER_MODE;
  readonly runId: string;
  readonly headSha: string;
  readonly createdAt: string;
  readonly dataControlsRef: typeof OPENAI_V1_DATA_CONTROLS_REF;
  readonly entries: readonly OpenAIV1CertificationEntry[];
}
const entrySchema = z
  .object({
    tier: z.enum(OPENAI_V1_CERTIFICATION_TIERS),
    agent: z.enum(OPENAI_V1_CERTIFICATION_AGENTS),
    releaseId: z.string().regex(SAFE_REF),
    modelId: z.string().regex(SAFE_REF),
    modelVersion: z.string().regex(SAFE_REF),
    // Model-evaluation config digests are governed deterministic digests (8-64 hex), not
    // necessarily cryptographic SHA-256. Preserve the framework's existing identity grammar.
    configDigest: z.string().regex(GOVERNED_DIGEST),
    promptFamily: z.string().regex(SAFE_REF),
    promptVersion: z.number().int().min(1),
    promptDigest: z.string().regex(SHA256),
    knowledgeRevision: z.string().regex(SAFE_REF).optional(),
    caseSetDigest: z.string().regex(SHA256),
    resultDigest: z.string().regex(SHA256),
    reviewBundleDigest: z.string().regex(SHA256),
    safety: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  })
  .strict();

const manifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    providerMode: z.literal(OPENAI_V1_PROVIDER_MODE),
    runId: z.string().regex(SAFE_REF),
    headSha: z.string().regex(SHA1),
    createdAt: z.string().regex(INSTANT),
    dataControlsRef: z.literal(OPENAI_V1_DATA_CONTROLS_REF),
    entries: z
      .array(entrySchema)
      .length(OPENAI_V1_CERTIFICATION_TIERS.length * OPENAI_V1_CERTIFICATION_AGENTS.length),
  })
  .strict();

function bindingMatchesEntry(
  entry: Omit<OpenAIV1CertificationEntry, 'knowledgeRevision'> & {
    readonly knowledgeRevision?: string | undefined;
  },
): boolean {
  const expected =
    entry.knowledgeRevision === undefined
      ? createOpenAIV1Binding(entry.tier, entry.agent)
      : createOpenAIV1Binding(entry.tier, entry.agent, entry.knowledgeRevision);
  return (
    entry.releaseId === expected.release.releaseId &&
    entry.modelId === expected.release.modelId &&
    entry.modelVersion === expected.release.modelVersion &&
    entry.configDigest === expected.release.configDigest &&
    entry.promptFamily === expected.promptFamily &&
    entry.promptVersion === expected.promptVersion &&
    entry.promptDigest === expected.promptDigest
  );
}

export function createOpenAIV1CertificationManifest(
  input: OpenAIV1CertificationManifest,
): OpenAIV1CertificationManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) throw new TypeError('invalid-openai-v1-certification-manifest');
  const entries = parsed.data.entries;
  const expectedKeys = new Set(
    OPENAI_V1_CERTIFICATION_TIERS.flatMap((tier) =>
      OPENAI_V1_CERTIFICATION_AGENTS.map((agent) => `${tier}/${agent}`),
    ),
  );
  const actualKeys = entries.map((entry) => `${entry.tier}/${entry.agent}`);
  if (
    new Set(actualKeys).size !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key)) ||
    entries.some((entry) => !bindingMatchesEntry(entry))
  ) {
    throw new TypeError('invalid-openai-v1-certification-manifest');
  }
  const revisions = entries.flatMap((entry) =>
    entry.knowledgeRevision === undefined ? [] : [entry.knowledgeRevision],
  );
  if (
    revisions.length > 0 &&
    (revisions.length !== entries.length || new Set(revisions).size !== 1)
  ) {
    throw new TypeError('invalid-openai-v1-certification-manifest');
  }
  return Object.freeze({
    ...parsed.data,
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          tier: entry.tier,
          agent: entry.agent,
          releaseId: entry.releaseId,
          modelId: entry.modelId,
          modelVersion: entry.modelVersion,
          configDigest: entry.configDigest,
          promptFamily: entry.promptFamily,
          promptVersion: entry.promptVersion,
          promptDigest: entry.promptDigest,
          ...(entry.knowledgeRevision === undefined
            ? {}
            : { knowledgeRevision: entry.knowledgeRevision }),
          caseSetDigest: entry.caseSetDigest,
          resultDigest: entry.resultDigest,
          reviewBundleDigest: entry.reviewBundleDigest,
          safety: entry.safety,
        }),
      ),
    ),
  });
}
export function openAIV1CertificationReady(manifest: OpenAIV1CertificationManifest): boolean {
  let canonical: OpenAIV1CertificationManifest;
  try {
    canonical = createOpenAIV1CertificationManifest(manifest);
  } catch {
    return false;
  }
  return canonical.entries.every((entry) => entry.safety === 'PASS');
}
