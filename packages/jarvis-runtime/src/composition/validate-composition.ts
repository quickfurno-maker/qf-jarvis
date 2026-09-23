/**
 * Fail-closed configuration validation (QFJ-M5, ADR-0059 §G).
 *
 * A missing MANDATORY dependency (authoritative state, model identity, policy, clock) is a wiring
 * error: the composition root refuses to construct, throwing `JarvisRuntimeError('invalid-config')`.
 * Optional integration dependencies (gateway invoker, Core transport, knowledge port) are NOT checked
 * here — their absence fails closed at runtime through the lower adapter.
 *
 * Two OPTIONAL configurations are nonetheless checked here, and for the same reason: each is
 * absent-or-COMPLETE, and a half-wired one is a deployment mistake that would otherwise look like a
 * business outcome. RWC-P7's `riyaGroundedKnowledge` is the older of the two; the JF-4 shared
 * three-agent RAG policy is the newer (ADR-0150 §43).
 */
import { GovernedKnowledgeError, createRetrievalRequest } from '@qf-jarvis/governed-knowledge';
import {
  MAX_HYBRID_CANDIDATES,
  MAX_HYBRID_RESULTS,
  MAX_HYBRID_TOPIC_FILTERS,
} from '@qf-jarvis/knowledge-index';

import {
  AGENT_KNOWLEDGE_BINDINGS,
  GROUNDED_AGENT_ACTORS,
  isGroundedAgentActor,
} from '../contracts/agent-knowledge-policy.js';
import { JarvisRuntimeError } from '../contracts/errors.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';

/** Assert the mandatory dependencies are present, or throw a safe fail-closed wiring error. */
export function assertMandatoryDependencies(config: JarvisRuntimeConfig): void {
  // Guard against untyped callers that bypass the compile-time contract: view the config through a
  // partial lens so a genuinely-absent mandatory dependency is caught at runtime and fails closed.
  const c: Partial<JarvisRuntimeConfig> = config;
  const missing =
    c.authoritativeState === undefined ||
    c.policy === undefined ||
    typeof c.clock !== 'function' ||
    c.release === undefined ||
    !promptIdentityConfigured(c) ||
    typeof c.capabilityProfileRef !== 'string' ||
    c.capabilityProfileRef.length === 0 ||
    !groundedKnowledgeConfigured(c) ||
    !agentGroundedKnowledgeConfigured(c) ||
    !agentHybridKnowledgeConfigured(c) ||
    (c.agentGroundedKnowledge !== undefined && c.agentHybridKnowledge !== undefined);
  if (missing) {
    throw new JarvisRuntimeError('invalid-config');
  }
}

/**
 * The RWC-P7 grounded wiring is either ABSENT or COMPLETE (ADR-0103 §4, §10).
 *
 * Absent is a valid, unchanged deployment: no retrieval, no grounded prompt, INTRO..SUMMARY served by
 * the RWC-P4B path exactly as before.
 *
 * Present means a deployer has decided Riya may answer from governed knowledge, and a half-wired
 * version of that decision is the dangerous one. A registry with no evaluated grounded prompts would
 * refuse every turn at runtime, which looks like an outage; a topic list containing a duplicate would
 * silently retrieve one record twice and cross-check against a citation list that no longer lines up.
 * Both are deployment mistakes rather than business outcomes, so they fail at CONSTRUCTION — before a
 * single client is waiting on the answer.
 */
function groundedKnowledgeConfigured(c: Partial<JarvisRuntimeConfig>): boolean {
  const grounded = c.riyaGroundedKnowledge;
  if (grounded === undefined) {
    return true;
  }
  if (typeof grounded !== 'object' || Array.isArray(grounded)) {
    return false;
  }
  // A real registry, not a shape that happens to have the right name. The lookup capability is what
  // retrieval actually uses, so it is what construction checks for.
  const registry: unknown = grounded.registry;
  if (
    typeof registry !== 'object' ||
    registry === null ||
    typeof (registry as { readonly listByTopic?: unknown }).listByTopic !== 'function'
  ) {
    return false;
  }
  const topics = grounded.topics;
  if (
    !Array.isArray(topics) ||
    topics.length < 1 ||
    topics.length > MAX_GROUNDED_TOPICS ||
    !topics.every((topic) => typeof topic === 'string' && topic.length > 0) ||
    new Set(topics).size !== topics.length
  ) {
    return false;
  }
  // BOTH grounded bindings, BOTH evaluated. A grounded deployment serves pre-summary and
  // post-summary turns from the same configuration, and there is no fallback for either.
  return (
    evaluatedBinding(c.riyaGroundedConversationEvolutionPromptBinding) &&
    evaluatedBinding(c.riyaGroundedReplyPromptBinding)
  );
}

/**
 * The JF-4 shared three-agent RAG policy is either ABSENT or COMPLETE (owner correction, ADR-0150 §43).
 *
 * Absent is valid and unchanged: no agent grounds, which is what every deployment does today.
 *
 * Present means a deployer has decided that Riya, Anisha and/or Aarohi may answer from governed
 * knowledge, and the half-wired versions of that decision are the dangerous ones. Before this check,
 * four structural states were expressible and three were wrong:
 *
 * - a `registry` instead of a port, which answers production turns while stepping around the JF-3
 *   provisioning boundary that decides whether a pack is ACTIVE and whether its revision is approved;
 * - BOTH, leaving an entire body of knowledge sitting unused beside the port until one line changes and
 *   it silently becomes the one that answers;
 * - NEITHER, where configured agents ground on nothing and the deployment looks configured.
 *
 * None of those is a per-turn decision, so none of them is left to be discovered mid-conversation. They
 * fail at CONSTRUCTION, through the existing `invalid-config` taxonomy, before a client is waiting.
 *
 * The checks read through `unknown` on purpose. The contract already makes `retrieval` required and
 * `registry` a `never`, so a typed caller cannot express any of this — the point of re-checking is the
 * caller that arrives through a cast, which is exactly the one a compile-time rule does not reach.
 */
function agentGroundedKnowledgeConfigured(c: Partial<JarvisRuntimeConfig>): boolean {
  const configured: unknown = c.agentGroundedKnowledge;
  if (configured === undefined) {
    return true;
  }
  if (typeof configured !== 'object' || configured === null || Array.isArray(configured)) {
    return false;
  }
  const policy = configured as {
    readonly retrieval?: unknown;
    readonly registry?: unknown;
    readonly agents?: unknown;
  };

  // A direct registry is refused outright, including one supplied ALONGSIDE a valid port. There is no
  // merge and no precedence: a second reach to the authority is the defect, not the choice between two.
  if ('registry' in policy && policy.registry !== undefined) {
    return false;
  }

  // A real port, not a shape that happens to have the right name. `retrieve` is what grounding calls,
  // so it is what construction checks for.
  const retrieval = policy.retrieval;
  if (
    typeof retrieval !== 'object' ||
    retrieval === null ||
    typeof (retrieval as { readonly retrieve?: unknown }).retrieve !== 'function'
  ) {
    return false;
  }

  const agents = policy.agents;
  if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
    return false;
  }
  for (const [actor, entry] of Object.entries(agents as Record<string, unknown>)) {
    // Only the three grounded business agents. A `JARVIS` or misspelled key is a deployment that
    // believes it configured something; silently ignoring it is how an agent ends up ungrounded in
    // production while its configuration file says otherwise.
    if (!isGroundedAgentActor(actor)) {
      return false;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return false;
    }
    if (!validTopicList(actor, (entry as { readonly topics?: unknown }).topics)) {
      return false;
    }
  }
  return true;
}

/**
 * The scalable shared hybrid policy is absent-or-complete and mutually exclusive with the exact
 * shared policy. The retrieval implementation is injected, while every scope/purpose remains closed
 * in AGENT_KNOWLEDGE_BINDINGS.
 */
function agentHybridKnowledgeConfigured(c: Partial<JarvisRuntimeConfig>): boolean {
  const configured: unknown = c.agentHybridKnowledge;
  if (configured === undefined) return true;
  if (typeof configured !== 'object' || configured === null || Array.isArray(configured))
    return false;

  const policy = configured as {
    readonly knowledgeRevision?: unknown;
    readonly retrieval?: unknown;
    readonly agents?: unknown;
  };
  const revision = policy.knowledgeRevision;
  const retrieval = policy.retrieval;
  if (
    typeof revision !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(revision) ||
    revision === '*' ||
    revision.toLocaleLowerCase() === 'latest' ||
    typeof retrieval !== 'object' ||
    retrieval === null ||
    typeof (retrieval as { readonly retrieve?: unknown }).retrieve !== 'function' ||
    (retrieval as { readonly knowledgeRevision?: unknown }).knowledgeRevision !== revision
  ) {
    return false;
  }

  const agents = policy.agents;
  if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) return false;

  // Shared three-agent hybrid turns use the per-scope evaluated prompt binding below. Riya's
  // separate dedicated grounded evolution/reply APIs keep their own fail-closed binding checks at
  // invocation time; enabling RIYA here must not make an otherwise-valid shared WhatsApp runtime
  // unconstructable merely because those separate APIs are not enabled in this deployment.

  for (const [actor, entry] of Object.entries(agents as Record<string, unknown>)) {
    if (!isGroundedAgentActor(actor)) return false;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;

    // Hybrid content changes the model's user payload. It may therefore run only under an explicitly
    // evaluated per-scope binding; a legacy/global or unevaluated prompt cannot be silently upgraded
    // into a grounded prompt by configuration.
    const binding = AGENT_KNOWLEDGE_BINDINGS[actor];
    if (c.promptBindings === undefined || !evaluatedBinding(c.promptBindings[binding.agentScope])) {
      return false;
    }

    const item = entry as {
      readonly topicFilters?: unknown;
      readonly candidatePool?: unknown;
      readonly maxResults?: unknown;
      readonly maxContentChars?: unknown;
    };
    if (!hybridTopicFiltersValid(actor, item.topicFilters)) return false;
    if (
      typeof item.candidatePool !== 'number' ||
      !Number.isInteger(item.candidatePool) ||
      item.candidatePool < 1 ||
      item.candidatePool > MAX_HYBRID_CANDIDATES ||
      typeof item.maxResults !== 'number' ||
      !Number.isInteger(item.maxResults) ||
      item.maxResults < 1 ||
      item.maxResults > Math.min(MAX_HYBRID_RESULTS, 8) ||
      item.maxResults > item.candidatePool ||
      typeof item.maxContentChars !== 'number' ||
      !Number.isInteger(item.maxContentChars) ||
      item.maxContentChars < 256 ||
      item.maxContentChars > 4096
    ) {
      return false;
    }
  }
  return true;
}

function hybridTopicFiltersValid(actor: string, topics: unknown): boolean {
  if (!Array.isArray(topics) || topics.length > MAX_HYBRID_TOPIC_FILTERS) return false;
  if (!topics.every((topic) => typeof topic === 'string' && topic.length > 0)) return false;
  if (new Set(topics as readonly string[]).size !== topics.length) return false;
  if (topics.length === 0) return true;

  const binding = AGENT_KNOWLEDGE_BINDINGS[actor as keyof typeof AGENT_KNOWLEDGE_BINDINGS];
  try {
    createRetrievalRequest({
      requestId: PROBE_REF,
      tenantId: PROBE_REF,
      agentScope: binding.agentScope,
      purpose: binding.purpose,
      dataClass: 'HOSTED_ALLOWED',
      asOf: PROBE_INSTANT,
      maxRecords: 1,
      maxContentChars: 1,
      requireCitation: true,
      selectors: { topics: topics as readonly string[] },
    });
    return true;
  } catch (error) {
    if (error instanceof GovernedKnowledgeError) return false;
    throw error;
  }
}

/**
 * One agent's exact topic list: 0..8, unique, and each one a legal governed topic.
 *
 * ZERO is valid and means this agent retrieves nothing — the one shape RWC-P7 refuses and this policy
 * must not, because "Aarohi is configured with no approved topics yet" is a true state of the world.
 * It is emphatically not "retrieve everything": `topicsForActor` returns `undefined` for it.
 *
 * The SYNTAX is checked by the governed authority's own request validator rather than by a regex
 * written here. That grammar is module-private inside `@qf-jarvis/governed-knowledge` and has no
 * exported bare-string form, so the only way to reuse it — instead of writing a second grammar that
 * would drift from it — is to build one throwaway request carrying just these selectors and see whether
 * the authority accepts it. Nothing is retrieved and no registry is consulted; the probe's identifiers
 * and instant are fixed literals that exist only to satisfy the fields this check is not about.
 */
function validTopicList(actor: string, topics: unknown): boolean {
  if (!Array.isArray(topics) || topics.length > MAX_GROUNDED_TOPICS) {
    return false;
  }
  if (!topics.every((topic) => typeof topic === 'string' && topic.length > 0)) {
    return false;
  }
  if (new Set(topics as readonly string[]).size !== topics.length) {
    return false;
  }
  if (topics.length === 0) {
    return true;
  }
  const binding = AGENT_KNOWLEDGE_BINDINGS[actor as keyof typeof AGENT_KNOWLEDGE_BINDINGS];
  try {
    createRetrievalRequest({
      requestId: PROBE_REF,
      tenantId: PROBE_REF,
      agentScope: binding.agentScope,
      purpose: binding.purpose,
      dataClass: 'HOSTED_ALLOWED',
      asOf: PROBE_INSTANT,
      maxRecords: 1,
      maxContentChars: 1,
      requireCitation: true,
      selectors: { topics: topics as readonly string[] },
    });
    return true;
  } catch (error) {
    // Only the authority's own refusal means "these topics are not legal". Anything else is a defect
    // here and must not be reported as a deployment's mistake.
    if (error instanceof GovernedKnowledgeError) {
      return false;
    }
    throw error;
  }
}

/**
 * The inert values the topic probe needs and this check does not care about.
 *
 * Neither is a business fact, neither reaches a registry, and neither appears in a real request: the
 * run's own envelope supplies every one of these at retrieval time (ADR-0103). They are here only
 * because the authority validates a whole request and this check validates one field of it.
 */
const PROBE_REF = 'jf4.topic.syntax.probe';
const PROBE_INSTANT = '2026-01-01T00:00:00Z';

/** Every grounded actor, for the spec that proves the key check is exactly this set. */
export const GROUNDED_POLICY_ACTORS = GROUNDED_AGENT_ACTORS;

/**
 * The governed topic ceiling, shared by both grounded configurations.
 *
 * Retrieval is exact, so one topic resolves to at most one record. RWC-P7 requires 1..8; the shared
 * three-agent policy permits 0..8, because zero approved topics is a true state and zero retrieval is
 * the honest response to it. ONE constant, so the two cannot drift apart.
 */
const MAX_GROUNDED_TOPICS = 8;

function evaluatedBinding(binding: JarvisRuntimeConfig['riyaGroundedReplyPromptBinding']): boolean {
  return (
    binding !== undefined &&
    typeof binding.evaluationRef === 'string' &&
    binding.evaluationRef.length > 0 &&
    typeof binding.evaluationPromptDigest === 'string' &&
    binding.evaluationPromptDigest.length > 0
  );
}

/**
 * A prompt identity is configured in EXACTLY ONE of the two shapes (QFJ-S3-I-B, ADR-0073).
 *
 * The legacy shape is a single `promptFamily`/`promptVersion`, which — because a definition is
 * scope-bound — can serve only one agent. The per-scope shape names a binding per agent scope, so one
 * runtime serves Riya and Anisha without a second composition.
 *
 * Supplying both is refused rather than merged. A merge would have to decide which one wins for a
 * scope named in both, and every possible answer silently sends some agent a prompt its deployer did
 * not choose — the exact failure this ADR exists to remove. M4 enforces the same rule at its own
 * boundary; this check is here so a mixed config fails at composition rather than mid-turn.
 */
function promptIdentityConfigured(c: Partial<JarvisRuntimeConfig>): boolean {
  const legacyPresent =
    c.promptFamily !== undefined ||
    c.promptVersion !== undefined ||
    c.evaluationRef !== undefined ||
    c.evaluationPromptDigest !== undefined;
  if (c.promptBindings !== undefined) {
    return !legacyPresent && hasAtLeastOneBinding(c.promptBindings);
  }
  return (
    typeof c.promptFamily === 'string' &&
    c.promptFamily.length > 0 &&
    typeof c.promptVersion === 'number'
  );
}

/** An empty bindings object configures no agent at all, which is a wiring error, not a policy. */
function hasAtLeastOneBinding(
  bindings: NonNullable<JarvisRuntimeConfig['promptBindings']>,
): boolean {
  return (
    bindings.CLIENT !== undefined ||
    bindings.VENDOR !== undefined ||
    // JF-5A (ADR-0151): a runtime configured for Aarohi alone is configured.
    bindings.PROSPECT !== undefined ||
    bindings.COORDINATION !== undefined ||
    bindings.SYSTEM !== undefined
  );
}
