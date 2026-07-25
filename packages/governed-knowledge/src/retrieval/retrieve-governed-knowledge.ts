/**
 * The governed-knowledge retrieval authority (QFJ-P04.03, ADR-0051 §H–§M).
 *
 * Deterministic, exact, bounded, fail-closed. It resolves each EXACT id selector (strictly — any
 * missing or ineligible id fails the whole retrieval) and each EXACT topic selector (to the single
 * current record via authority resolution), enforces `maxRecords` and the content-size bound, and
 * returns every surviving record WITH a citation. Every outcome — success or a single content-free
 * reason — is reported through the injected observability hook. No free-text query, no fuzzy
 * matching, no model or network call.
 */
import { buildCitation } from '../contracts/citation.js';
import type { KnowledgeEvent, KnowledgeObservabilityHook } from '../contracts/observability.js';
import { NOOP_KNOWLEDGE_OBSERVABILITY } from '../contracts/observability.js';
import type { KnowledgePrivacyGate } from '../contracts/privacy-gate.js';
import type { KnowledgeRecord } from '../contracts/knowledge-record.js';
import { recordIdentityKey } from '../contracts/knowledge-record.js';
import type { KnowledgeRetrievalRequest } from '../contracts/retrieval-request.js';
import type {
  KnowledgeRetrievalResult,
  RetrievedKnowledge,
} from '../contracts/retrieval-result.js';
import type { KnowledgeRetrievalReason } from '../contracts/vocabularies.js';
import type { GovernedKnowledgeRegistry } from '../registry/governed-knowledge-registry.js';
import { recordEligibility } from './authorization.js';
import { resolveTopic } from './conflict-resolution.js';

/** Injected collaborators for a retrieval; both are optional (privacy gate absent → fails closed). */
export interface RetrieveOptions {
  readonly privacyGate?: KnowledgePrivacyGate;
  readonly observability?: KnowledgeObservabilityHook;
}

interface EventContext {
  readonly knowledgeId?: string;
  readonly version?: number;
  readonly topic?: string;
  readonly record?: KnowledgeRecord;
  readonly count: number;
}

function makeEvent(
  request: KnowledgeRetrievalRequest,
  reason: KnowledgeRetrievalReason,
  ctx: EventContext,
): KnowledgeEvent {
  const record = ctx.record;
  return Object.freeze({
    type: 'knowledge-retrieval',
    reason,
    requestId: request.requestId,
    agentScope: request.agentScope,
    knowledgeId: ctx.knowledgeId ?? record?.knowledgeId,
    version: ctx.version ?? record?.version,
    topic: ctx.topic ?? record?.topic,
    authorityTier: record?.authorityTier,
    classification: record?.classification,
    count: ctx.count,
  });
}

/** Retrieve governed knowledge for a bounded exact request; fails closed with one safe reason. */
export function retrieveGovernedKnowledge(
  registry: GovernedKnowledgeRegistry,
  request: KnowledgeRetrievalRequest,
  options?: RetrieveOptions,
): KnowledgeRetrievalResult {
  const hook = options?.observability ?? NOOP_KNOWLEDGE_OBSERVABILITY;
  const gate = options?.privacyGate;

  const seen = new Set<string>();
  const resolved: KnowledgeRecord[] = [];

  const fail = (reason: KnowledgeRetrievalReason, ctx: EventContext): KnowledgeRetrievalResult => {
    hook.onEvent(makeEvent(request, reason, ctx));
    return { ok: false, reason };
  };

  const admit = (record: KnowledgeRecord): void => {
    const key = recordIdentityKey(record.knowledgeId, record.version);
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(record);
    }
  };

  // Exact id selectors — strict: a missing or ineligible id fails the whole retrieval.
  for (const idRef of request.selectors.ids) {
    const record = registry.resolveExact(idRef.knowledgeId, idRef.version);
    if (record === undefined) {
      return fail('knowledge-not-found', {
        knowledgeId: idRef.knowledgeId,
        version: idRef.version,
        count: 0,
      });
    }
    const reason = recordEligibility(record, request, gate);
    if (reason !== null) {
      return fail(reason, { record, count: 0 });
    }
    admit(record);
  }

  // Exact topic selectors — resolve to the single current record.
  for (const topic of request.selectors.topics) {
    const candidates = registry.listByTopic(topic);
    const eligible = candidates.filter((r) => recordEligibility(r, request, gate) === null);
    const resolution = resolveTopic(eligible);
    if (resolution.kind === 'none') {
      return fail('knowledge-not-found', { topic, count: candidates.length });
    }
    if (resolution.kind === 'conflict') {
      return fail('knowledge-conflict', { topic, count: eligible.length });
    }
    admit(resolution.record);
  }

  // Bounded result: hard record and content-size limits.
  if (resolved.length > request.maxRecords) {
    return fail('knowledge-limit-exceeded', { count: resolved.length });
  }
  const totalChars = resolved.reduce((sum, r) => sum + r.content.length, 0);
  if (totalChars > request.maxContentChars) {
    return fail('knowledge-limit-exceeded', { count: resolved.length });
  }

  const records: readonly RetrievedKnowledge[] = Object.freeze(
    resolved.map((record) => Object.freeze({ record, citation: buildCitation(record) })),
  );
  hook.onEvent(makeEvent(request, 'knowledge-served', { count: records.length }));
  return Object.freeze({ ok: true, records });
}
