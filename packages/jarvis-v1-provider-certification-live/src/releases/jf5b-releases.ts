/**
 * The JF-5B certification release identities, and the SIX provider x prompt evaluation bindings.
 *
 * ### Why six, and not two
 *
 * An `ApprovalEvidence` carries ONE `EvaluationBinding`, and a binding carries ONE prompt family,
 * version and digest. After JF-5A there are three distinct production prompt BODIES with three distinct
 * digests. So a single binding cannot describe what a provider was certified for across three agents,
 * and "Groq passed Jarvis" is not a sentence the evidence model can express truthfully.
 *
 * Six bindings is what honesty costs: each says exactly which provider release served exactly which
 * reviewed prompt bytes. AUTO failover is a routing property measured separately; it is not a seventh
 * prompt approval and cannot stand in for any of the six.
 *
 * ### Why NEW release identities rather than the historical ones
 *
 * The Riya Groq candidate release from the earlier evidence lane is immutable history: its receipts
 * were produced against it and must stay readable. Editing it so JF-5B looks current would rewrite what
 * an earlier run actually measured. JF-5B pins its own identities, with its own dated catalogue
 * observation label, and leaves the old ones alone.
 */
import { AAROHI_ACQUISITION_PROMPT_V1 } from '@qf-jarvis/aarohi-prompts';
import { ANISHA_VENDOR_JOURNEY_PROMPT_V1 } from '@qf-jarvis/anisha-prompts';
import { createEvaluationBinding } from '@qf-jarvis/model-evaluation';
import type { EvaluationBinding, ProviderReleaseRef } from '@qf-jarvis/model-evaluation';
import { RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1 } from '@qf-jarvis/riya-prompts';
import type { PromptDefinition } from '@qf-jarvis/prompt-registry';

/**
 * The catalogue OBSERVATION label, not a weight hash.
 *
 * Neither provider publishes an immutable identifier for the weights behind an alias, so claiming one
 * would be a fabricated identity. What is true and checkable is the date on which this lane observed
 * the provider's catalogue, and that is what the label says.
 */
export const JF5B_CATALOGUE_SNAPSHOT = 'certification-snapshot-2026-09-11';

/** The capability profile the three agents' structured turns run under. */
export const JF5B_CAPABILITY_PROFILE_REF = 'cap.jf5b.structured.v1';

/**
 * The observed Nara data-controls posture, as a reference rather than a claim.
 *
 * Deliberately NOT called ZDR. The documented posture is that prompt and output content is forwarded to
 * the underlying model provider, is not used to train Nara's own models and is not sold, and may be
 * retained for a limited period for abuse detection, debugging and legal obligations; request logs and
 * usage records are retained for defined operational periods; and providers and infrastructure may
 * process data internationally.
 *
 * That is a posture a certification run can work under with SYNTHETIC fixtures only. Accepting it for
 * production is an owner decision, and JF-5C records it.
 */
export const NARA_DATA_CONTROLS_REF =
  'datacontrols.nara.observed.2026-09-11.forwarded-retained-limited';

/** Groq's posture reference, recorded the same way and for the same reason. */
export const GROQ_DATA_CONTROLS_REF = 'datacontrols.groq.observed.2026-09-11.staging-synthetic';

/** The suite, fixture and evaluator identities every JF-5B binding shares. */
export const JF5B_EVALUATION_SUITE_ID = 'suite.jf5b.three-agent-live';
export const JF5B_EVALUATION_SUITE_VERSION = 1;
export const JF5B_RED_TEAM_SUITE_ID = 'redteam.jf5b.three-agent-live';
export const JF5B_RED_TEAM_SUITE_VERSION = 1;
export const JF5B_FIXTURE_MANIFEST_ID = 'fixtures.jf5b.synthetic-three-agent';
export const JF5B_FIXTURE_MANIFEST_VERSION = 1;
export const JF5B_EVALUATOR_IMPL_ID = 'qfj.eval.deterministic';
export const JF5B_EVALUATOR_IMPL_VERSION = 1;
export const JF5B_POLICY_CONTRACT_REVISION = 'policy.jf5b.rev.1';
export const JF5B_CREATED_AT = '2026-09-11T00:00:00Z';

/** The three agents JF-5B certifies, and the prompt each one owns. */
export const CERTIFIED_AGENTS = ['RIYA', 'ANISHA', 'AAROHI'] as const;
export type CertifiedAgent = (typeof CERTIFIED_AGENTS)[number];

export const PROMPT_BY_AGENT: Readonly<Record<CertifiedAgent, PromptDefinition>> = Object.freeze({
  RIYA: RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1,
  ANISHA: ANISHA_VENDOR_JOURNEY_PROMPT_V1,
  AAROHI: AAROHI_ACQUISITION_PROMPT_V1,
});

/** The two providers certified directly. AUTO is routing, not a third provider. */
export const CERTIFIED_PROVIDERS = ['groq', 'nara'] as const;
export type CertifiedProvider = (typeof CERTIFIED_PROVIDERS)[number];

export interface Jf5bReleaseInput {
  readonly providerId: CertifiedProvider;
  /** The exact model id. For Nara this is the alias discovery selected; never a router alias. */
  readonly modelId: string;
  /** A digest over the exact execution identity and provider posture. Never a key, path or timestamp. */
  readonly configDigest: string;
}

/**
 * Build one JF-5B certification release.
 *
 * `executionClass` is `HOSTED` for both: each is a remote inference engine. The release says what ran,
 * not whether it may serve — nothing here approves anything.
 */
export function createJf5bRelease(input: Jf5bReleaseInput): ProviderReleaseRef {
  return Object.freeze({
    releaseId: `rel.jf5b.${input.providerId}.1`,
    providerId: input.providerId,
    modelId: input.modelId,
    modelVersion: JF5B_CATALOGUE_SNAPSHOT,
    configDigest: input.configDigest,
    executionClass: 'HOSTED' as const,
  });
}

/** One binding: exactly one provider release, exactly one reviewed prompt body. */
export function createJf5bBinding(
  release: ProviderReleaseRef,
  agent: CertifiedAgent,
  knowledgeRevision?: string,
): EvaluationBinding {
  const prompt = PROMPT_BY_AGENT[agent];
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
    // The exact reviewed bytes. Read from the prompt package, never typed in here: a digest a caller
    // could supply is a digest that can disagree with what actually ran.
    promptDigest: prompt.contentDigest,
    capabilityProfileRef: JF5B_CAPABILITY_PROFILE_REF,
    policyContractRevision: JF5B_POLICY_CONTRACT_REVISION,
    createdAt: JF5B_CREATED_AT,
    ...(knowledgeRevision === undefined ? {} : { knowledgeRevision }),
  });
}

/** All SIX bindings, in a fixed order. Two providers x three prompt bodies. */
export function createJf5bBindingMatrix(
  groq: ProviderReleaseRef,
  nara: ProviderReleaseRef,
  knowledgeRevision?: string,
): readonly EvaluationBinding[] {
  const releases: Readonly<Record<CertifiedProvider, ProviderReleaseRef>> = Object.freeze({
    groq,
    nara,
  });
  const bindings: EvaluationBinding[] = [];
  for (const provider of CERTIFIED_PROVIDERS) {
    for (const agent of CERTIFIED_AGENTS) {
      bindings.push(createJf5bBinding(releases[provider], agent, knowledgeRevision));
    }
  }
  return Object.freeze(bindings);
}
