/**
 * The RWC-P7 per-run governed knowledge bridge (ADR-0103 §5–§9).
 *
 * ### What it is
 *
 * One object, built fresh for ONE inbound run, that satisfies the generic M2 `KnowledgePort` and
 * additionally remembers the minimized content that retrieval produced. M2 keeps receiving exactly
 * the citations it has always received; the content is captured on the side and handed to the Riya
 * profile, which puts it in the same one model call.
 *
 * That is the whole shape of the slice. The generic `KnowledgePort` contract is NOT widened to carry
 * raw content — every agent in the repository shares it, and a port that returned governed text would
 * make "the model saw a document" a thing that could happen anywhere, silently, on a path nobody
 * reviewed for it.
 *
 * ### Per run, and the reason is concurrency
 *
 * The capture is a closure variable created by this factory. There is no module-level variable, no
 * process global and no cross-run cache, because two conversations are served concurrently by one
 * process and a shared slot would let one client's answer be grounded in the other's records.
 *
 * ### Exact topics. Never a query.
 *
 * The topics are configured at deployment and passed through verbatim. Nothing here reads the
 * client's message, derives a topic from it, ranks anything, embeds anything or searches. QFJ-P04.05
 * keeps semantic and vector RAG DISABLED, and this file is where that would quietly stop being true
 * if it were going to.
 *
 * ### One retrieval, then the door closes
 *
 * `retrieveGovernedKnowledge` is called at most once per run. A second `retrieve()` in the same run
 * fails closed WITHOUT calling it again: M2 calls it once by construction, so a second call means
 * something is wrong with the composition, and answering it would be capturing content for a turn
 * that has already built its message.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import type {
  KnowledgePort,
  KnowledgeRetrievalRequest as M2KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult as M2KnowledgeRetrievalResult,
} from '@qf-jarvis/agent-runtime';
import { createRetrievalRequest, retrieveGovernedKnowledge } from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeObservabilityHook,
} from '@qf-jarvis/governed-knowledge';
import type { RiyaGroundedKnowledgeContextV1 } from '@qf-jarvis/riya-model-interaction';

/**
 * The RWC-P7 record ceiling.
 *
 * Also the maximum number of configured topics, because retrieval is exact and one topic resolves to
 * at most one current record. Internal: it is a Riya-local budget, not a contract, and root-exporting
 * it so a test could read it would make it one.
 */
export const MAX_RIYA_GROUNDED_RECORDS = 8;

/**
 * The per-record content ceiling handed to governed retrieval.
 *
 * Chosen against the EXISTING Riya user-content bound of 12288, not by widening it: continuity, the
 * bounded P5 availability projection and the client's own message all have to fit alongside. Eight
 * records at this bound cannot all fit at once, and that is fine — the honest failure is a refusal
 * before the gateway, never a truncation, because a truncated record is a governed document that no
 * longer says what it was approved to say.
 */
export const MAX_RIYA_GROUNDED_CONTENT_CHARS = 4096;

/** What a Riya-aware run needs to ground itself. */
export interface RiyaGroundedKnowledgeBridge {
  /** Handed to M2 as the ordinary knowledge port. Returns citations only, exactly as M2 expects. */
  readonly knowledgePort: KnowledgePort;
  /** The minimized content captured by the ONE successful retrieval, or `undefined`. */
  readCaptured(): RiyaGroundedKnowledgeContextV1 | undefined;
}

/** What the bridge is built from. All injected; nothing is read from disk, env, HTTP or a database. */
export interface RiyaGroundedKnowledgeBridgeInput {
  readonly envelope: InboundEnvelope;
  readonly registry: GovernedKnowledgeRegistry;
  readonly topics: readonly string[];
  readonly observability?: KnowledgeObservabilityHook;
}

/** Build the bridge for exactly one run. */
export function createRiyaGroundedKnowledgeBridge(
  input: RiyaGroundedKnowledgeBridgeInput,
): RiyaGroundedKnowledgeBridge {
  const { envelope, registry } = input;
  const topics = Object.freeze([...input.topics]);

  // Function-scoped. Two concurrent runs hold two bridges and two captures.
  let captured: RiyaGroundedKnowledgeContextV1 | undefined;
  let attempted = false;

  const refused = (): M2KnowledgeRetrievalResult =>
    // The EXISTING M2 fail-closed reason. Nothing about the governed failure -- not the reason, the
    // topic, the source, the subject or the record -- crosses this boundary, because M2's refusal
    // travels all the way out to a caller and a governed reason names business documents.
    Object.freeze({ ok: false as const, reason: 'orchestration-knowledge-refused' as const });

  const knowledgePort: KnowledgePort = {
    retrieve(request: M2KnowledgeRetrievalRequest): Promise<M2KnowledgeRetrievalResult> {
      if (attempted) {
        // A second retrieval in one run. Never a second governed call.
        return Promise.resolve(refused());
      }
      attempted = true;

      // The orchestrator builds this request from the SAME envelope, so a mismatch is a composition
      // defect rather than a business outcome -- and it is exactly the shape of defect that would
      // ground one conversation in another's records.
      if (
        request.conversationId !== envelope.conversationId ||
        request.dataClass !== envelope.dataClass ||
        request.topics.length !== topics.length ||
        !topics.every((topic, index) => request.topics[index] === topic)
      ) {
        return Promise.resolve(refused());
      }

      let result;
      try {
        // Built through the REAL governed constructor. Restating its schema here would be a second
        // definition of what a legal retrieval is, and the first thing it would get wrong is a bound.
        //
        // No `privacyGate` is supplied, and that is deliberate (ADR-0103 §7). The conversation privacy
        // gate available here answers a question about THIS conversation's subject and ignores the
        // reference it is handed; using it as a knowledge gate could mark a record about a DIFFERENT
        // person clear. Omitting it means governed-knowledge's own `knowledge-privacy-gate-missing`
        // rule refuses every subject-linked record before any content is exposed. P7 grounds business
        // FAQ, policy and process content; personal-memory retrieval is not in this slice.
        const governedRequest = createRetrievalRequest({
          requestId: envelope.messageId,
          tenantId: envelope.tenantId,
          agentScope: 'CLIENT',
          purpose: 'CLIENT_RESPONSE',
          dataClass: envelope.dataClass,
          asOf: envelope.receivedAt,
          maxRecords: topics.length,
          maxContentChars: MAX_RIYA_GROUNDED_CONTENT_CHARS,
          requireCitation: true,
          selectors: { topics: [...topics] },
        });
        result = retrieveGovernedKnowledge(registry, governedRequest, {
          ...(input.observability === undefined ? {} : { observability: input.observability }),
        });
      } catch {
        return Promise.resolve(refused());
      }

      if (!result.ok) {
        // Missing, expired, inactive, superseded, conflicting, permission-denied, data-class-denied or
        // subject-linked-without-a-gate. Every one of them stops the turn BEFORE the model and before
        // Core, and none of them falls back to the model's general knowledge.
        return Promise.resolve(refused());
      }

      // The MINIMIZED capture. Five fields per record; owner, approver, permissions, source
      // reference, authority tier, effective and expiry instants, supersession and any subject
      // reference are all left behind.
      captured = Object.freeze({
        version: 1 as const,
        records: Object.freeze(
          result.records.map((retrieved) =>
            Object.freeze({
              knowledgeId: retrieved.record.knowledgeId,
              version: retrieved.record.version,
              topic: retrieved.record.topic,
              contentFormat: retrieved.record.contentFormat,
              content: retrieved.record.content,
            }),
          ),
        ),
      });

      // M2 gets its EXISTING citation shape and nothing more. Order is preserved so the capture and
      // the plan's citations correspond element by element -- the Riya profile cross-checks exactly
      // that before it serializes a byte.
      return Promise.resolve(
        Object.freeze({
          ok: true as const,
          citations: Object.freeze(
            result.records.map((retrieved) =>
              Object.freeze({
                knowledgeId: retrieved.citation.knowledgeId,
                version: retrieved.citation.version,
                source: retrieved.citation.sourceRef,
                digest: retrieved.citation.contentDigest,
              }),
            ),
          ),
        }),
      );
    },
  };

  return Object.freeze({
    knowledgePort,
    readCaptured: () => captured,
  });
}
