/**
 * Retrieval permissions carried by every governed-knowledge record (QFJ-P04.03, ADR-0051).
 *
 * A record declares WHO may retrieve it: a tenant scope (a specific tenant id or the reserved
 * {@link GLOBAL_TENANT}), the closed set of agent scopes allowed to read it, and the closed set of
 * retrieval purposes it may answer. Permissions carry no content and no subject reference.
 */
import { z } from 'zod';

import { KNOWLEDGE_AGENT_SCOPES, KNOWLEDGE_PURPOSES } from './vocabularies.js';
import type { KnowledgeAgentScope, KnowledgePurpose } from './vocabularies.js';

/** The reserved tenant-scope marker meaning "available to every tenant". */
export const GLOBAL_TENANT = 'GLOBAL';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** The declared retrieval permissions of one record. */
export interface RetrievalPermissions {
  /** A specific tenant id, or {@link GLOBAL_TENANT} for a cross-tenant record. */
  readonly tenantScope: string;
  /** The agent scopes allowed to retrieve this record (non-empty, de-duplicated). */
  readonly allowedAgentScopes: readonly KnowledgeAgentScope[];
  /** The retrieval purposes this record may answer (non-empty, de-duplicated). */
  readonly allowedPurposes: readonly KnowledgePurpose[];
}

export const retrievalPermissionsSchema = z
  .object({
    tenantScope: IDENTIFIER,
    allowedAgentScopes: z.array(z.enum(KNOWLEDGE_AGENT_SCOPES)).min(1).max(4),
    allowedPurposes: z.array(z.enum(KNOWLEDGE_PURPOSES)).min(1).max(KNOWLEDGE_PURPOSES.length),
  })
  .strict();

/** Freeze a validated permissions object, de-duplicating its scope/purpose lists deterministically. */
export function freezePermissions(input: RetrievalPermissions): RetrievalPermissions {
  const agentScopes = KNOWLEDGE_AGENT_SCOPES.filter((s) => input.allowedAgentScopes.includes(s));
  const purposes = KNOWLEDGE_PURPOSES.filter((p) => input.allowedPurposes.includes(p));
  return Object.freeze({
    tenantScope: input.tenantScope,
    allowedAgentScopes: Object.freeze(agentScopes),
    allowedPurposes: Object.freeze(purposes),
  });
}
