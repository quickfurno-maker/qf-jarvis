/**
 * Per-record eligibility for a governed-knowledge retrieval (QFJ-P04.03, ADR-0051 §H–§K).
 *
 * `recordEligibility` returns the FIRST content-free reason a record is not deliverable to a request,
 * or `null` when it is deliverable. The order is deliberate: lifecycle and freshness first, then
 * tenant/permission/data-class, then the privacy gate LAST — so the gate runs immediately before any
 * content could be exposed and is never consulted for a record the caller may not see.
 */
import type { KnowledgePrivacyGate } from '../contracts/privacy-gate.js';
import type { KnowledgeRecord } from '../contracts/knowledge-record.js';
import { parseInstant } from '../contracts/instant.js';
import { GLOBAL_TENANT } from '../contracts/permissions.js';
import type { KnowledgeRetrievalRequest } from '../contracts/retrieval-request.js';
import { dataClassRank } from '../contracts/vocabularies.js';
import type { KnowledgeDataClass, KnowledgeRetrievalReason } from '../contracts/vocabularies.js';

/**
 * True iff a record of class `recordClass` may be delivered to a request of class `requestClass`.
 * `HUMAN_ONLY` knowledge is NEVER delivered to a model; otherwise a record may only go to a request
 * that is at least as restrictive (rank ≥ the record's).
 */
export function dataClassDeliverable(
  recordClass: KnowledgeDataClass,
  requestClass: KnowledgeDataClass,
): boolean {
  if (recordClass === 'HUMAN_ONLY') {
    return false;
  }
  return dataClassRank(recordClass) <= dataClassRank(requestClass);
}

/**
 * The first reason `record` is not deliverable to `request`, or `null` if it is. The privacy gate is
 * consulted only for a subject-linked record that has already passed every other check.
 */
export function recordEligibility(
  record: KnowledgeRecord,
  request: KnowledgeRetrievalRequest,
  privacyGate: KnowledgePrivacyGate | undefined,
): KnowledgeRetrievalReason | null {
  // Supersession is the most specific exclusion, so it is reported ahead of a plain
  // not-active state (a superseded record is typically also RETIRED).
  if (record.supersededBy !== undefined) {
    return 'knowledge-superseded';
  }
  if (record.lifecycleState !== 'ACTIVE') {
    return 'knowledge-not-active';
  }
  const asOf = parseInstant(request.asOf);
  if (asOf < parseInstant(record.effectiveFrom)) {
    return 'knowledge-not-effective';
  }
  if (record.expiresAt !== undefined && asOf >= parseInstant(record.expiresAt)) {
    return 'knowledge-expired';
  }
  const { tenantScope, allowedAgentScopes, allowedPurposes } = record.permissions;
  if (tenantScope !== GLOBAL_TENANT && tenantScope !== request.tenantId) {
    return 'knowledge-tenant-denied';
  }
  if (
    !allowedAgentScopes.includes(request.agentScope) ||
    !allowedPurposes.includes(request.purpose)
  ) {
    return 'knowledge-permission-denied';
  }
  if (!dataClassDeliverable(record.classification, request.dataClass)) {
    return 'knowledge-data-class-denied';
  }
  if (record.subjectRef !== undefined) {
    if (privacyGate === undefined) {
      return 'knowledge-privacy-gate-missing';
    }
    if (privacyGate.subjectStatus(record.subjectRef) !== 'clear') {
      return 'knowledge-subject-erased';
    }
  }
  return null;
}
