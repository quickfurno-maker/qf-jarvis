/**
 * The revision-bound knowledge pack (JF-3 owner correction, ADR-0148 §11a).
 *
 * ### What was wrong, and why this type exists
 *
 * The first JF-3 head let a caller hand a registry and a revision string to the backend factory as two
 * INDEPENDENT values. The activation gate then proved `profile.knowledgeRevision ===
 * backend.knowledgeRevision`, which is a comparison of two labels — and a label a caller chose says
 * nothing about the records behind it. Measured against that head: a registry holding unapproved text
 * activated cleanly under an approved revision, and served it.
 *
 * A revision that a caller can pick is not an approval of anything. This type removes the
 * independence: the revision and the registry are ONE artifact, produced together from one set of
 * validated records, and the revision is DERIVED from those records rather than supplied alongside
 * them. There is no constructor anywhere in the public surface that pairs an arbitrary registry with
 * an arbitrary revision, because that pairing was the bug.
 *
 * ### What the revision is, and what it is not
 *
 * It is a **content identity**: a SHA-256 over a canonical serialization of every governed field of
 * every record. Change the text, the classification, the permissions, the approver, the lifecycle
 * state or the source identity, and the revision changes.
 *
 * It is **not a signature**, and it proves nothing about human authorship or approval. Anyone who can
 * construct the records can compute the same revision. What it establishes is that a stated revision
 * and a served body of knowledge cannot drift apart — so when an owner approves a revision, the thing
 * they approved is the thing that answers. Real authorship attestation needs a signer identity this
 * repository does not have; JF-6 owes that.
 */
import type { GovernedKnowledgeRegistry } from '@qf-jarvis/governed-knowledge';

/**
 * A validated body of governed knowledge, together with the revision derived from it.
 *
 * The two fields are inseparable by construction. Nothing in this package produces one without the
 * other, and nothing lets either be replaced afterwards.
 */
export interface RevisionBoundKnowledgePack {
  /**
   * The content-addressed revision, of the shape `qfj.knowledge.sha256.<64 lowercase hex>`.
   *
   * Derived, never accepted. This is the value an ACTIVE profile must name.
   */
  readonly knowledgeRevision: string;
  /** The immutable governed registry built from exactly the records the revision was derived from. */
  readonly registry: GovernedKnowledgeRegistry;
  /** How many records the pack holds. */
  readonly recordCount: number;
  /** The exact topics the pack can serve, sorted and de-duplicated. */
  readonly topics: readonly string[];
}
