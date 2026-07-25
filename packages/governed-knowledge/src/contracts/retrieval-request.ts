/**
 * The bounded, exact governed-knowledge retrieval request (QFJ-P04.03, ADR-0051 §I).
 *
 * A request carries ONLY safe bounded metadata — never a prompt, message, or free-text query. It
 * selects records by EXACT identity or EXACT topic (a bounded list of each), as of an instant, under
 * a tenant/agent/purpose/data-class scope, with a hard `maxRecords` and content-size bound. There is
 * no free-text, semantic, or "return any document" mode. `createRetrievalRequest` validates and
 * freezes; it throws a content-free {@link GovernedKnowledgeError} (`invalid-request`) on violation.
 */
import { z } from 'zod';

import { GovernedKnowledgeError } from './errors.js';
import { isCanonicalInstant } from './instant.js';
import type { KnowledgeVersionRef } from './knowledge-record.js';
import {
  KNOWLEDGE_AGENT_SCOPES,
  KNOWLEDGE_DATA_CLASSES,
  KNOWLEDGE_PURPOSES,
} from './vocabularies.js';
import type { KnowledgeAgentScope, KnowledgeDataClass, KnowledgePurpose } from './vocabularies.js';

/** The maximum number of exact id or topic selectors a single request may carry. */
export const MAX_REQUEST_SELECTORS = 32;

/** The exact selectors a request may use. At least one id or topic must be present. */
export interface KnowledgeSelectors {
  readonly ids: readonly KnowledgeVersionRef[];
  readonly topics: readonly string[];
}

/** One bounded, exact retrieval request. */
export interface KnowledgeRetrievalRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly agentScope: KnowledgeAgentScope;
  readonly purpose: KnowledgePurpose;
  readonly dataClass: KnowledgeDataClass;
  readonly asOf: string;
  readonly maxRecords: number;
  readonly maxContentChars: number;
  readonly requireCitation: boolean;
  readonly selectors: KnowledgeSelectors;
}

/** The input accepted by {@link createRetrievalRequest}; selector arrays default to empty. */
export interface KnowledgeRetrievalRequestInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly agentScope: KnowledgeAgentScope;
  readonly purpose: KnowledgePurpose;
  readonly dataClass: KnowledgeDataClass;
  readonly asOf: string;
  readonly maxRecords: number;
  readonly maxContentChars: number;
  readonly requireCitation: boolean;
  readonly selectors: {
    readonly ids?: readonly KnowledgeVersionRef[];
    readonly topics?: readonly string[];
  };
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);

const requestSchema = z
  .object({
    requestId: IDENTIFIER,
    tenantId: IDENTIFIER,
    agentScope: z.enum(KNOWLEDGE_AGENT_SCOPES),
    purpose: z.enum(KNOWLEDGE_PURPOSES),
    dataClass: z.enum(KNOWLEDGE_DATA_CLASSES),
    asOf: z.string().refine(isCanonicalInstant),
    maxRecords: z.int().min(1).max(64),
    maxContentChars: z.int().min(1).max(200_000),
    // Every result must be citable — the flag exists to make that explicit and is required true.
    requireCitation: z.literal(true),
    selectors: z
      .object({
        ids: z
          .array(z.object({ knowledgeId: IDENTIFIER, version: VERSION }).strict())
          .max(MAX_REQUEST_SELECTORS)
          .optional(),
        topics: z.array(IDENTIFIER).max(MAX_REQUEST_SELECTORS).optional(),
      })
      .strict(),
  })
  .strict();

/** Validate and freeze a candidate request. Throws `GovernedKnowledgeError('invalid-request')`. */
export function createRetrievalRequest(
  input: KnowledgeRetrievalRequestInput,
): KnowledgeRetrievalRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new GovernedKnowledgeError('invalid-request');
  }
  const r = parsed.data;
  const ids = r.selectors.ids ?? [];
  const topics = r.selectors.topics ?? [];
  if (ids.length + topics.length === 0) {
    throw new GovernedKnowledgeError('invalid-request');
  }
  return Object.freeze({
    requestId: r.requestId,
    tenantId: r.tenantId,
    agentScope: r.agentScope,
    purpose: r.purpose,
    dataClass: r.dataClass,
    asOf: r.asOf,
    maxRecords: r.maxRecords,
    maxContentChars: r.maxContentChars,
    requireCitation: r.requireCitation,
    selectors: Object.freeze({
      ids: Object.freeze(
        ids.map((i) => Object.freeze({ knowledgeId: i.knowledgeId, version: i.version })),
      ),
      topics: Object.freeze([...topics]),
    }),
  });
}
