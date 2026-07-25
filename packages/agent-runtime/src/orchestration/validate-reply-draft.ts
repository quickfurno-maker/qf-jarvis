/**
 * The model reply-draft validator (QFJ-M2, ADR-0055 §E, §F).
 *
 * A candidate draft from the injected model port must be a structured object with exactly the safe
 * fields — a raw provider body/header or a chain-of-thought field makes it invalid (the schema is
 * strict). Every citation it claims must be present EXACTLY (id + version) in the plan's permitted
 * citations; a fabricated or versionless citation is refused. No live model was called to produce it.
 */
import type { ModelReplyDraft, ReplyPlan } from './contracts.js';
import { modelReplyDraftSchema } from './contracts.js';

export type ReplyDraftValidation =
  { readonly ok: true; readonly draft: ModelReplyDraft } | { readonly ok: false };

/** Validate a candidate draft against the plan's exact citations. Returns the frozen draft or fails. */
export function validateReplyDraft(candidate: unknown, plan: ReplyPlan): ReplyDraftValidation {
  const parsed = modelReplyDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false };
  }
  const permitted = new Set(plan.citations.map((c) => `${c.knowledgeId}@${String(c.version)}`));
  for (const citation of parsed.data.citations) {
    if (!permitted.has(`${citation.knowledgeId}@${String(citation.version)}`)) {
      return { ok: false };
    }
  }
  return {
    ok: true,
    draft: Object.freeze({
      structured: true,
      replyBody: parsed.data.replyBody,
      citations: Object.freeze(parsed.data.citations.map((c) => Object.freeze({ ...c }))),
      usageTraceId: parsed.data.usageTraceId,
    }),
  };
}
