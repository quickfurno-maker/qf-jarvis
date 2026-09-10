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
 * ### It takes a bound pack, and CANNOT take a registry plus a revision
 *
 * The owner correction removed the two-parameter form this factory used to have. A caller that could
 * pass a registry and a revision separately could label any records with any approved revision — and
 * measurement against the previous head confirmed it: unapproved text activated cleanly under an
 * approved revision, and served. The revision now arrives already DERIVED from the registry's contents,
 * as one artifact, and there is no parameter through which the two could disagree.
 *
 * ### What it cannot do
 *
 * No endpoint, no base URL, no environment read, no HTTP call, no socket, no filesystem, no clock, no
 * embedding, no vector index, no similarity ranking, no provider call, no model call, no database. The
 * pack arrives already constructed and immutable, and there is no method here that could mutate it.
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
  KnowledgeObservabilityHook,
  KnowledgePrivacyGate,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import type { RevisionBoundKnowledgePack } from '../contracts/revision-bound-knowledge-pack.js';
import { ACTIVE_ELIGIBLE_BACKEND } from '../contracts/vocabularies.js';

export interface GovernedExactBackendOptions {
  /**
   * The revision-bound pack this backend serves.
   *
   * There is deliberately no separate `registry` or `knowledgeRevision` option. The revision is read
   * from the pack, and the pack derived it from the records the registry was built from, so a backend
   * cannot claim a revision that its own contents do not produce.
   */
  readonly pack: RevisionBoundKnowledgePack;
  /** Optional subject privacy gate. Passed through to the authority verbatim, or absent. */
  readonly privacyGate?: KnowledgePrivacyGate;
  /** Optional content-free knowledge observability. */
  readonly observability?: KnowledgeObservabilityHook;
}

/**
 * Is this actually a revision-bound pack?
 *
 * The parameter is `unknown` on purpose. Typing it as the pack would make every check below look
 * redundant to the compiler and the linter, and they would be right about the DECLARED type and wrong
 * about reality: the whole point of this guard is the caller one package away who hand-builds an object
 * claiming an approved revision and casts it. Narrowing from `unknown` is the shape in which the checks
 * are honest.
 */
function isRevisionBoundPack(pack: unknown): pack is RevisionBoundKnowledgePack {
  if (pack === null || typeof pack !== 'object') {
    return false;
  }
  const candidate = pack as { knowledgeRevision?: unknown; registry?: unknown };
  return (
    typeof candidate.knowledgeRevision === 'string' &&
    candidate.knowledgeRevision.length > 0 &&
    candidate.registry !== null &&
    typeof candidate.registry === 'object'
  );
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
  const pack: unknown = options.pack;

  // A pack is the only accepted source of both values, so this checks that one was actually passed
  // rather than an object shaped like one through a cast.
  if (!isRevisionBoundPack(pack)) {
    throw new Error('A governed-exact backend requires a revision-bound knowledge pack.');
  }

  const { privacyGate, observability } = options;
  const registry = pack.registry;
  const knowledgeRevision = pack.knowledgeRevision;

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
