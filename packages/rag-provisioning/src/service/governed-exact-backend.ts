/**
 * The GOVERNED_EXACT retrieval backend (JF-3, ADR-0148).
 *
 * ### It provisions access to an authority; it is not one
 *
 * Every rule that decides whether a record may be seen already lives in `@qf-jarvis/governed-knowledge`:
 * effective and expiry windows, supersession, authority tiers, conflict resolution, classification,
 * permissions, subject privacy, citation generation, record and character bounds. This file calls
 * `retrieveGovernedKnowledge` and returns what it returns.
 *
 * That is the whole design. Copying any of those rules here would create a second knowledge authority,
 * and the failure mode of two authorities is not that one is wrong — it is that they disagree quietly,
 * and the more permissive one wins whichever path a caller happens to take.
 *
 * ### What it cannot do
 *
 * No endpoint, no base URL, no environment read, no HTTP call, no socket, no filesystem, no clock, no
 * embedding, no vector index, no similarity ranking, no provider call, no model call, no database. The
 * registry arrives already constructed and immutable, and there is no method here that could mutate it.
 *
 * Those absences are worded rather than spelled, deliberately. The package containment scan is a
 * literal text search over production source, so a comment that NAMES the forbidden specifier is
 * indistinguishable from code that uses it. Describing the ban keeps the scan honest.
 *
 * ### The privacy gate is passed through, never substituted
 *
 * If a caller supplies one it reaches the authority unchanged. If none is supplied, none is invented —
 * a subject-linked record then fails closed inside the authority, which is exactly where that decision
 * belongs. A gate manufactured here to "make retrieval work" would be this package deciding a privacy
 * question it has no standing to decide.
 */
import { retrieveGovernedKnowledge } from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeObservabilityHook,
  KnowledgePrivacyGate,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';

import { ACTIVE_ELIGIBLE_BACKEND } from '../contracts/vocabularies.js';
import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';

export interface GovernedExactBackendOptions {
  /** The immutable governed registry. Constructed by the caller; never built or mutated here. */
  readonly registry: GovernedKnowledgeRegistry;
  /**
   * The exact revision this registry represents.
   *
   * Supplied rather than derived, because the registry contract does not publish one. The knowledge
   * pack that built the registry owns the revision and hands both over together, so the two cannot
   * drift apart without somebody changing one and not the other — which the profile check then catches.
   */
  readonly knowledgeRevision: string;
  /** Optional subject privacy gate. Passed through to the authority verbatim, or absent. */
  readonly privacyGate?: KnowledgePrivacyGate;
  /** Optional content-free knowledge observability. */
  readonly observability?: KnowledgeObservabilityHook;
}

/**
 * Build the governed-exact backend.
 *
 * Frozen, with no mutation surface: a caller holding one can retrieve and read its identity, and can do
 * nothing else to it.
 */
export function createGovernedExactBackend(
  options: GovernedExactBackendOptions,
): RagRetrievalBackend {
  const { registry, knowledgeRevision, privacyGate, observability } = options;

  // Refused at construction, not at retrieval: a backend that cannot name what it holds should not
  // exist at all. `latest` and a wildcard are refused for the same reason the profile refuses them --
  // a moving pointer approves whatever is current rather than a specific body of knowledge.
  const normalized = typeof knowledgeRevision === 'string' ? knowledgeRevision.trim() : '';
  if (
    normalized.length === 0 ||
    normalized.toLowerCase() === 'latest' ||
    normalized.includes('*')
  ) {
    throw new Error('A governed-exact backend requires an exact knowledge revision.');
  }

  return Object.freeze({
    backendKind: ACTIVE_ELIGIBLE_BACKEND,
    knowledgeRevision,
    retrieve(request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult {
      // ONE call, to the authority, with the request as given. No pre-filtering, no re-ranking, no
      // second attempt, no widening of a request that returned nothing.
      return retrieveGovernedKnowledge(registry, request, {
        ...(privacyGate === undefined ? {} : { privacyGate }),
        ...(observability === undefined ? {} : { observability }),
      });
    },
  });
}
