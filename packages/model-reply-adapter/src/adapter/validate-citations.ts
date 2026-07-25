/**
 * Exact citation authorization (QFJ-M4, ADR-0057 §H).
 *
 * Every citation the model returns must EXACTLY match a citation in the input plan (same `knowledgeId`
 * and `version`). A fabricated, versionless (schema-rejected earlier), stale, superseded, conflicting,
 * or otherwise unauthorized citation is rejected — the whole draft fails closed. No citation is ever
 * silently dropped to make output pass, and the adapter performs no fresh retrieval.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';

import type { StructuredReply } from '../contracts/reply-schema.js';

function key(knowledgeId: string, version: number): string {
  return `${knowledgeId}@${String(version)}`;
}

/** True iff every returned citation is an exact member of the plan's authorized citations. */
export function citationsAuthorized(reply: StructuredReply, plan: ReplyPlan): boolean {
  const authorized = new Set(plan.citations.map((c) => key(c.knowledgeId, c.version)));
  for (const c of reply.citations) {
    if (!authorized.has(key(c.knowledgeId, c.version))) {
      return false;
    }
  }
  return true;
}
