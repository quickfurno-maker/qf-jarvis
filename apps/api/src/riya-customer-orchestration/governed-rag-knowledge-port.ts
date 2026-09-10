/**
 * The governed-RAG retrieval port for the customer runtime (JF-4, ADR-0149).
 *
 * ### What it is
 *
 * Eleven lines of adapter between two boundaries that were already built to meet: the RWC-P7 grounded
 * bridge asks for one bounded governed retrieval, and JF-3's ACTIVE provisioner performs exactly that.
 * This turns the second into the shape the first accepts, and does nothing else.
 *
 * ### What it deliberately does NOT do
 *
 * It does not build the retrieval request — RWC-P7 does, from the run's own envelope, and a second
 * request builder here would be a second definition of what a legal retrieval is. It does not minimize
 * records, shape citations, enforce one-retrieval-per-run or decide what reaches the model: all of
 * that stays in the bridge. It does not decide whether a record may be seen: that is
 * `@qf-jarvis/governed-knowledge`, reached through JF-3.
 *
 * So there is no retrieval POLICY in this file. There is a call, and a mapping of the outcome.
 *
 * ### The outcome mapping, and the one judgement in it
 *
 * JF-3 returns a discriminated outcome; the bridge expects the governed authority's own result. A
 * served outcome passes its records through untouched. A refusal maps to `{ ok: false, reason }` —
 * carrying the AUTHORITY's reason when there is one, and `knowledge-invariant` when the refusal came
 * from the RAG boundary itself (not ACTIVE, invalid request, backend threw).
 *
 * That substitution is safe to make here because of what the bridge does next: every governed reason
 * collapses to M2's single `orchestration-knowledge-refused`, so no reason reaches a caller either
 * way. What matters is that a refusal stays a refusal — and it does, in every case.
 */
import type {
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';
import type { GovernedRetrievalPort } from '@qf-jarvis/jarvis-runtime';
import { invokeRagRetrieval } from '@qf-jarvis/rag-provisioning';
import type { RagProvisioner } from '@qf-jarvis/rag-provisioning';

/**
 * Adapt an ACTIVE JF-3 provisioner to the runtime's bounded retrieval port.
 *
 * The provisioner is passed in already composed. This function does not build one, does not read a
 * knowledge pack and does not know what a revision is — a deployment that wants ACTIVE retrieval has
 * to have satisfied JF-3's bindings before it gets here, and one that has not simply gets refusals.
 */
export function createGovernedRagRetrievalPort(provisioner: RagProvisioner): GovernedRetrievalPort {
  return Object.freeze({
    retrieve(request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult {
      const outcome = invokeRagRetrieval(provisioner, request);
      if (outcome.ok) {
        return { ok: true, records: outcome.records };
      }
      // `knowledgeReason` is present when the governed authority refused; it is absent when the RAG
      // boundary refused before reaching it. Both are refusals, and the bridge treats them alike.
      return { ok: false, reason: outcome.knowledgeReason ?? 'knowledge-invariant' };
    },
  });
}
