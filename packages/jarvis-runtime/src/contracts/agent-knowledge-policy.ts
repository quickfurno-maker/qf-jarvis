/**
 * The closed per-agent knowledge policy (JF-4B/C/D owner correction, ADR-0150 §4c).
 *
 * ### One RAG authority, three truthful scopes
 *
 * There is one governed-knowledge authority, one JF-3 provisioner, one revision-bound pack and one
 * retrieval implementation. What differs between Riya, Anisha and Aarohi is exactly three things: the
 * agent scope a retrieval runs under, the purpose it runs for, and the exact topics it may ask for.
 *
 * Nothing else differs, and nothing else may. Three registries, three packs or three retrieval paths
 * would each be a second answer to "what may this agent see", and the answers would diverge the first
 * time one of them was fixed.
 *
 * ### The shared production reach is RETRIEVAL-ONLY (owner correction, ADR-0150 §43)
 *
 * One authentic revision-bound pack -> one JF-3 provisioner -> one `GovernedRetrievalPort` -> this
 * policy -> three exact scopes and topic lists. `retrieval` is REQUIRED and there is no `registry`
 * field, so the chain has no side door.
 *
 * A `registry` here would let a deployment hand this package a knowledge authority DIRECTLY and answer
 * production turns from it, stepping around the JF-3 provisioning boundary that decides whether a pack
 * is ACTIVE and whether its revision is the approved one. It made four structural states expressible
 * where the architecture permits one: retrieval only, registry only, both (the runtime silently
 * preferred retrieval and a whole registry sat unused beside it), and neither (configured agents
 * silently ground on nothing). Three of the four were wrong, and two of them were silently wrong.
 *
 * The low-level `createAgentGroundedKnowledgeBridge` still accepts either form, exclusively, for the
 * RWC-P7 tests and the dedicated Riya configuration that predate JF-3. That seam is not this boundary:
 * it takes one turn's envelope, and nothing routes production grounding through it by itself.
 *
 * ### The scope and purpose are CODE-CLOSED
 *
 * A deployment configures TOPICS. It does not configure scope or purpose: those are derived from the
 * actor `assignAgent` already chose, through the total map below.
 *
 * That split is the whole security property. A caller able to name its own scope could read another
 * agent's records — a client turn retrieving vendor-only material, or an acquisition turn reading a
 * registered vendor's operational records. The party type is the trusted caller's statement of fact;
 * the scope is this repository's conclusion from it.
 *
 * ### Zero topics means no retrieval
 *
 * Never "retrieve everything". An agent with no configured topics is an agent with nothing approved to
 * ground on, and the honest behaviour is to ground on nothing — the governed authority would refuse a
 * selector-free request anyway, and inventing one here to fill the gap is how exact retrieval becomes
 * search.
 */
import type { KnowledgeAgentScope, KnowledgePurpose } from '@qf-jarvis/governed-knowledge';

import type { GovernedRetrievalPort } from './runtime-config.js';

/** Riya's scope and purpose, written once. Unchanged from ADR-0103. */
export const RIYA_KNOWLEDGE_SCOPE: KnowledgeAgentScope = 'CLIENT';
export const RIYA_KNOWLEDGE_PURPOSE: KnowledgePurpose = 'CLIENT_RESPONSE';

/** Anisha's. The vocabulary already existed; only the wiring was missing. */
export const ANISHA_KNOWLEDGE_SCOPE: KnowledgeAgentScope = 'VENDOR';
export const ANISHA_KNOWLEDGE_PURPOSE: KnowledgePurpose = 'VENDOR_RESPONSE';

/** Aarohi's. Added with the scope itself (ADR-0150 §4a). */
export const AAROHI_KNOWLEDGE_SCOPE: KnowledgeAgentScope = 'PROSPECT';
export const AAROHI_KNOWLEDGE_PURPOSE: KnowledgePurpose = 'PROSPECT_RESPONSE';

/** The three grounded business agents. `JARVIS`, `HUMAN` and `SYSTEM` ground nothing. */
export const GROUNDED_AGENT_ACTORS = ['RIYA', 'ANISHA', 'AAROHI'] as const;
export type GroundedAgentActor = (typeof GROUNDED_AGENT_ACTORS)[number];

/** What an agent retrieves under. Both values are fixed in code, per actor. */
export interface AgentKnowledgeBinding {
  readonly agentScope: KnowledgeAgentScope;
  readonly purpose: KnowledgePurpose;
}

/**
 * The TOTAL actor to scope/purpose map.
 *
 * Total and closed: there is no default branch and no way to add an entry at runtime. A fourth business
 * agent would have to be added here deliberately, which is where that decision belongs.
 */
export const AGENT_KNOWLEDGE_BINDINGS: Readonly<Record<GroundedAgentActor, AgentKnowledgeBinding>> =
  Object.freeze({
    RIYA: Object.freeze({ agentScope: RIYA_KNOWLEDGE_SCOPE, purpose: RIYA_KNOWLEDGE_PURPOSE }),
    ANISHA: Object.freeze({
      agentScope: ANISHA_KNOWLEDGE_SCOPE,
      purpose: ANISHA_KNOWLEDGE_PURPOSE,
    }),
    AAROHI: Object.freeze({
      agentScope: AAROHI_KNOWLEDGE_SCOPE,
      purpose: AAROHI_KNOWLEDGE_PURPOSE,
    }),
  });

/**
 * What a DEPLOYMENT may configure for one agent: the exact topics, and how to reach the authority.
 *
 * Note what is absent: no `agentScope`, no `purpose`. Those are not omitted for brevity — a field for
 * either would be a field through which a caller could cross an authority boundary.
 */
export interface AgentKnowledgeTopicPolicy {
  /**
   * 0..8 exact topic identifiers, unique, in deployment order.
   *
   * No wildcard, no `latest`, no pattern, and never derived from a message, a model or a channel. Zero
   * topics means no retrieval for this agent.
   */
  readonly topics: readonly string[];
}

/**
 * The per-agent policy a deployment supplies, plus the ONE shared way to reach the authority.
 *
 * Two fields, and that is the whole surface.
 *
 * `retrieval` is supplied ONCE for all three agents, not per agent, and it is REQUIRED. That is the
 * structural half of "one RAG system": there is exactly one place a deployment can point grounding at,
 * so three agents cannot end up on three packs. It is also the reason there is no `registry` field --
 * see the file header. Production grounding reaches the authority through the JF-3 provisioning
 * boundary or it does not reach it at all.
 *
 * There is no `observability` field either, and its absence is deliberate rather than an oversight: the
 * governed-knowledge hook belongs to whoever performs the lookup, which on this path is the injected
 * port. A hook here would be a field this package accepted and then had nowhere to put.
 */
export interface AgentGroundedKnowledgePolicy {
  /** The ONE authority reach, shared by every agent. Required; there is no second form. */
  readonly retrieval: GovernedRetrievalPort;
  /**
   * Never present. Typed `never` rather than omitted so a config carrying a registry is a COMPILE
   * error at the deployment that wrote it, not a runtime surprise -- and `assertMandatoryDependencies`
   * refuses one that reaches here through a cast anyway.
   */
  readonly registry?: never;
  /** Per-agent exact topics. An absent agent grounds nothing. */
  readonly agents: Readonly<Partial<Record<GroundedAgentActor, AgentKnowledgeTopicPolicy>>>;
}

/** Is this actor one of the three grounded business agents? */
export function isGroundedAgentActor(actor: string): actor is GroundedAgentActor {
  return (GROUNDED_AGENT_ACTORS as readonly string[]).includes(actor);
}

/**
 * The topics an actor may ask for under this policy, or `undefined` when it grounds nothing.
 *
 * Returns `undefined` — not an empty list — when the agent is unconfigured, so a caller cannot confuse
 * "this deployment did not configure Aarohi" with "Aarohi is configured to ask for nothing". Both mean
 * no retrieval, and neither means retrieve everything.
 */
export function topicsForActor(
  policy: AgentGroundedKnowledgePolicy,
  actor: string,
): readonly string[] | undefined {
  if (!isGroundedAgentActor(actor)) {
    return undefined;
  }
  const configured = policy.agents[actor];
  if (configured === undefined || configured.topics.length === 0) {
    return undefined;
  }
  return Object.freeze([...configured.topics]);
}
