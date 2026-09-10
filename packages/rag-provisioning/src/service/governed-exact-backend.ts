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
 * ### It takes an AUTHENTIC bound pack — shape is not enough
 *
 * The first owner correction removed the two-parameter form this factory used to have, because a
 * caller that could pass a registry and a revision separately could label any records with any
 * approved revision. Measurement confirmed it: unapproved text activated cleanly under an approved
 * revision, and served.
 *
 * The second correction closed what that left open. TypeScript interfaces are structural, so an object
 * literal with the right four fields satisfies the pack type at compile time and passed the shape
 * check this file used to perform — including an object holding pack A's approved revision beside
 * pack B's registry. Measured on head `8532a2c`, that forgery constructed a backend, reached `active`,
 * and served B's records while reporting A's revision.
 *
 * A shape check cannot prove provenance, so this file no longer performs one. It asks
 * `createRevisionBoundKnowledgePack` whether it made this exact object. A pack's revision is derived
 * from its own records, and membership of that factory's private registry is keyed on object identity
 * — so a spread, a clone, a deserialized copy and a hand-written literal are all refused, because
 * copying a pack's fields does not copy the derivation that produced them.
 *
 * That refusal is intended, including for the deserialized case. A revision-bound pack is an in-memory
 * capability, not a bearer token: a pack that crossed a process boundary must be rebuilt from its
 * governed records through the factory, which re-derives the revision and so re-proves it.
 *
 * **Runtime authenticity is process-local and is not a cryptographic signature.** It establishes that
 * this object was derived here, in this process. It attests nothing about who approved the records.
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
import { isAuthenticRevisionBoundKnowledgePack } from './create-revision-bound-knowledge-pack.js';

export interface GovernedExactBackendOptions {
  /**
   * The revision-bound pack this backend serves.
   *
   * There is deliberately no separate `registry` or `knowledgeRevision` option. The revision is read
   * from the pack, and the pack derived it from the records the registry was built from, so a backend
   * cannot claim a revision that its own contents do not produce.
   *
   * It must be a pack `createRevisionBoundKnowledgePack` actually built. Satisfying this type is not
   * sufficient and is not meant to be: the type describes a shape, and a shape is copyable.
   */
  readonly pack: RevisionBoundKnowledgePack;
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
  const pack: unknown = options.pack;

  // Not "is this pack-shaped" -- "did the factory derive this exact object". The shape of a pack is
  // trivially reproducible; its derivation is not.
  if (!isAuthenticRevisionBoundKnowledgePack(pack)) {
    throw new Error(
      'A governed-exact backend requires a knowledge pack derived by createRevisionBoundKnowledgePack.',
    );
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
