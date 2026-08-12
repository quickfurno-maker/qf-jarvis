/**
 * Synthetic knowledge admission through the REAL production authority (MVP-P2A.2).
 *
 * ### The correction this module is
 *
 * An earlier pass concluded no reusable production freshness seam existed and proposed to block the
 * superseded safety case permanently. That was wrong: `@qf-jarvis/governed-knowledge` publicly exports
 * `createKnowledgeRecord`, `createGovernedKnowledgeRegistry`, `createRetrievalRequest` and
 * `retrieveGovernedKnowledge`, and retrieval already refuses a record for supersession, lifecycle,
 * effective-from, expiry, tenant, permissions, data class and privacy — before any content is
 * returned. So the seam exists and this operator uses it.
 *
 * ### Why that matters more than convenience
 *
 * The alternative was `if (state === 'SUPERSEDED') refuse`, written here. That would pass the same
 * tests and prove nothing: it would be the operator marking its own homework, and the day production
 * changed its freshness rule the evaluation would keep asserting the old one. Materializing the
 * situation into a registry and asking the production authority means the case measures what the
 * runtime would actually do.
 *
 * ### The candidate input is the SITUATION; governed knowledge is the AUTHORITY
 *
 * `CandidateGroundedKnowledgeInput.state` says what situation to construct. It never decides
 * admission, and it is never serialized into anything a model sees. What reaches the Riya profile is
 * whatever `retrieveGovernedKnowledge` RETURNED — not the input object — so a record the authority
 * refused cannot reach a model even by mistake.
 */
import { createHash } from 'node:crypto';

import {
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
  createRetrievalRequest,
  retrieveGovernedKnowledge,
} from '@qf-jarvis/governed-knowledge';
import type {
  KnowledgeRecord,
  KnowledgeRecordInput,
  KnowledgeRetrievalReason,
  KnowledgeVersionRef,
} from '@qf-jarvis/governed-knowledge';
import type { CandidateGroundedKnowledgeInput } from '@qf-jarvis/riya-candidate-evaluation-runner';

import { SYNTHETIC_TENANT_ID } from './synthetic-context.js';

/**
 * Fixed canonical instants. No clock is read: two runs of the same case must construct the same
 * registry, or a difference between them could be the hour rather than the model.
 */
const APPROVED_AT = '2026-01-01T00:00:00.000Z';
const V1_EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z';
const V2_EFFECTIVE_FROM = '2026-06-01T00:00:00.000Z';
/** After both effective instants, so an admission failure is never merely "not yet effective". */
const RETRIEVAL_AS_OF = '2026-08-01T00:00:00.000Z';
/** The expiry used to construct a genuinely STALE situation. Before `RETRIEVAL_AS_OF`, deliberately. */
const STALE_EXPIRES_AT = '2026-03-01T00:00:00.000Z';

const SYNTHETIC_OWNER = 'owner.synthetic.evaluation';
const SYNTHETIC_APPROVER = 'approver.synthetic.evaluation';
const SYNTHETIC_SOURCE_REF = 'source.synthetic.evaluation';
const SYNTHETIC_SOURCE_REVISION = 'rev.synthetic.evaluation.1';

/**
 * The permissions every synthetic record carries.
 *
 * `CLIENT` because Riya is the only agent evaluated here, and `EVALUATION` because that is what this
 * retrieval is for — the vocabulary already has the purpose, so borrowing `CLIENT_RESPONSE` would
 * describe a real client turn that is not happening.
 */
const SYNTHETIC_PERMISSIONS = Object.freeze({
  tenantScope: SYNTHETIC_TENANT_ID,
  allowedAgentScopes: Object.freeze(['CLIENT' as const]),
  allowedPurposes: Object.freeze(['EVALUATION' as const]),
});

/** Why the operator could not turn a candidate input into model-visible governed context. */
export const GROUNDED_ADMISSION_REFUSALS = [
  /** The production retrieval authority refused. Its own reason travels with this. */
  'retrieval-refused',
  /** The candidate input declared a lifecycle situation this operator cannot materialize truthfully. */
  'unsupported-input-state',
] as const;
export type GroundedAdmissionRefusal = (typeof GROUNDED_ADMISSION_REFUSALS)[number];

export type GroundedAdmission =
  | { readonly ok: true; readonly records: readonly KnowledgeRecord[] }
  | {
      readonly ok: false;
      readonly refusal: GroundedAdmissionRefusal;
      /** The production authority's own closed reason, when it was the one that refused. */
      readonly reason?: KnowledgeRetrievalReason;
    };

/** `text/plain` is the only format the candidate contract carries; anything else is not translatable. */
function toContentFormat(candidateFormat: string): 'PLAIN_TEXT' | undefined {
  return candidateFormat === 'text/plain' ? 'PLAIN_TEXT' : undefined;
}

function digestOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** One governed record, built through the production constructor so its invariants apply. */
function governedRecord(
  base: {
    readonly knowledgeId: string;
    readonly version: number;
    readonly topic: string;
    readonly content: string;
    readonly contentFormat: 'PLAIN_TEXT';
  },
  overrides: Partial<KnowledgeRecordInput>,
): KnowledgeRecord {
  return createKnowledgeRecord({
    knowledgeId: base.knowledgeId,
    version: base.version,
    topic: base.topic,
    // A TRAINING_REFERENCE is non-volatile, which is the truthful description of an invented
    // evaluation fact: it is not Core-published, not a live package price and not a website scrape.
    sourceType: 'TRAINING_REFERENCE',
    // The most modest tier that still permits approval. Claiming CORE_PUBLISHED_REFERENCE for an
    // invented sentence would put synthetic content at the top of conflict resolution.
    authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
    contentFormat: base.contentFormat,
    content: base.content,
    contentDigest: digestOf(base.content),
    sourceRef: SYNTHETIC_SOURCE_REF,
    sourceRevision: SYNTHETIC_SOURCE_REVISION,
    owner: SYNTHETIC_OWNER,
    effectiveFrom: V1_EFFECTIVE_FROM,
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: SYNTHETIC_PERMISSIONS,
    approvedBy: SYNTHETIC_APPROVER,
    approvedAt: APPROVED_AT,
    // No subjectRef, deliberately: these are business-reference facts, and a subject-linked record
    // would drag a privacy gate into an evaluation that has no subject.
    ...overrides,
  });
}

/**
 * Ask the production authority to admit this turn's synthetic knowledge.
 *
 * Returns the records the AUTHORITY returned. A caller must use those and nothing else — the input
 * object is the situation, not the payload.
 */
export function admitGroundedInput(
  input: CandidateGroundedKnowledgeInput,
  caseId: string,
): GroundedAdmission {
  const formats = input.records.map((record) => toContentFormat(record.contentFormat));
  if (formats.some((format) => format === undefined)) {
    return { ok: false, refusal: 'unsupported-input-state' };
  }

  const records: KnowledgeRecord[] = [];
  const selectors: KnowledgeVersionRef[] = [];

  for (const [index, record] of input.records.entries()) {
    const contentFormat = formats[index];
    if (contentFormat === undefined) {
      return { ok: false, refusal: 'unsupported-input-state' };
    }
    const base = {
      knowledgeId: record.knowledgeId,
      version: record.version,
      topic: record.topic,
      content: record.content,
      contentFormat,
    };
    // The exact record the candidate declared is ALWAYS the one selected for retrieval. Whether the
    // authority hands it back is the authority's decision, and that decision is the evidence.
    selectors.push({ knowledgeId: record.knowledgeId, version: record.version });

    if (input.state === 'CURRENT') {
      records.push(governedRecord(base, {}));
      continue;
    }

    if (input.state === 'SUPERSEDED') {
      // A REAL supersession edge: v1 retired and pointing at v2, and v2 active and newer. The
      // registry requires the successor to exist, so the situation is constructed rather than
      // asserted — and `retrieveGovernedKnowledge` refuses v1 for `knowledge-superseded` on its own.
      records.push(
        governedRecord(base, {
          lifecycleState: 'RETIRED',
          supersededBy: { knowledgeId: record.knowledgeId, version: record.version + 1 },
        }),
      );
      records.push(
        governedRecord(
          {
            ...base,
            version: record.version + 1,
            // Independently authored replacement text. It exists only so the supersession edge is
            // valid; it is never selected, never retrieved and never shown to a model.
            content:
              'For this synthetic evaluation only: the superseding revision of this test-only record. Not sent to any model.',
          },
          { effectiveFrom: V2_EFFECTIVE_FROM },
        ),
      );
      continue;
    }

    // STALE: a record whose real freshness window has closed. `expiresAt` is before the retrieval
    // instant, so the production authority refuses it for `knowledge-expired` — again its decision,
    // not a rule written here.
    records.push(governedRecord(base, { expiresAt: STALE_EXPIRES_AT }));
  }

  const registry = createGovernedKnowledgeRegistry(records);
  const request = createRetrievalRequest({
    requestId: `req.${caseId}`.slice(0, 128),
    tenantId: SYNTHETIC_TENANT_ID,
    agentScope: 'CLIENT',
    purpose: 'EVALUATION',
    dataClass: 'HOSTED_ALLOWED',
    asOf: RETRIEVAL_AS_OF,
    maxRecords: Math.max(1, selectors.length),
    maxContentChars: 8192,
    requireCitation: true,
    // EXACT ids and versions. No topic selector: a topic search could return a record the candidate
    // was never declared to have been given.
    selectors: { ids: selectors },
  });

  // No privacy gate is supplied, and none is needed: nothing here is subject-linked. A gate would be
  // an operator-local decision standing in for one the registry never has to make.
  const result = retrieveGovernedKnowledge(registry, request);
  if (!result.ok) {
    return { ok: false, refusal: 'retrieval-refused', reason: result.reason };
  }
  return { ok: true, records: result.records.map((one) => one.record) };
}
