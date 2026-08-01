/**
 * Deterministic proposal-identity derivation (QFJ post-S3-C repair, ADR-0069).
 *
 * A proposal id used to be `${runId}-reply`. That was two caller identifiers glued together plus a
 * suffix, so a perfectly valid envelope could produce an id well past the 128-character bound
 * `createOrchestrationProposal` enforces — and the turn failed at the very end, after the model had
 * already been called. Making the run id bounded is necessary but not sufficient: even a single
 * maximum-length `runtimeId` plus `-reply` is 134 characters.
 *
 * So proposal identity gets its own derivation with a FIXED output width. The inputs are the exact
 * tuple that distinguishes one proposal from another; the output is a bounded, opaque, deterministic
 * reference.
 *
 * The digest is IDENTITY EVIDENCE, NOT AUTHENTICATION. It is a non-cryptographic FNV-1a hash over
 * canonically-ordered JSON, chosen for the same reason the M3 idempotency key uses one: it must be
 * dependency-free, `node:crypto`-free, and reproducible from the same tuple in any process. It is not
 * a security primitive and must never be relied on as one. (M3's helper lives in
 * `core-decision-adapter`; importing it here would invert the dependency direction, so the few lines
 * are restated rather than shared.)
 *
 * Deliberately internal: not exported from the orchestration barrel or the package root, because a
 * proposal id is something the orchestrator derives, never something a caller supplies.
 */
import type { OrchestrationProposalKind } from './vocabularies.js';

/** Canonical JSON with sorted object keys, so key order can never change the derived identity. */
function canonicalJson(value: Readonly<Record<string, string | number>>): string {
  const sorted: Record<string, string | number> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry !== undefined) {
      sorted[key] = entry;
    }
  }
  return JSON.stringify(sorted);
}

/** One FNV-1a 32-bit word, as eight lowercase hex characters. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The exact identity that distinguishes one proposal from another. */
export interface ProposalIdentity {
  readonly runtimeId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly expectedRevision: number;
  readonly proposalVersion: number;
  readonly proposalKind: OrchestrationProposalKind;
}

/**
 * Derive a bounded, deterministic proposal id: `proposal.` + 32 lowercase hex characters (41 total).
 *
 * Fixed width regardless of how long the inputs are, which is the whole point — it cannot be pushed
 * past the identifier bound by a long conversation or message id, and it leaves ample room under the
 * M3 `commandId` limit that concatenates a 128-character conversation id with this value.
 *
 * Nothing is truncated, rewritten, randomized or time-derived: the same tuple always yields the same
 * id, and a different tuple yields a different one. No raw caller text, provider value, prompt
 * reference, model output or subject data enters the digest — only bounded identifiers, two integers
 * and a closed vocabulary value, none of which is client content.
 */
export function deriveProposalId(identity: ProposalIdentity): string {
  const canonical = canonicalJson({
    conversationId: identity.conversationId,
    expectedRevision: identity.expectedRevision,
    messageId: identity.messageId,
    proposalKind: identity.proposalKind,
    proposalVersion: identity.proposalVersion,
    runtimeId: identity.runtimeId,
  });
  // Domain-separated so this digest can never collide with the M3 idempotency key over the same tuple.
  const a = fnv1a(`qfj.proposal|${canonical}`);
  const b = fnv1a(`${canonical}|qfj.proposal.b`);
  const c = fnv1a(`qfj.proposal.c|${canonical}`);
  const d = fnv1a(`${a}${b}${c}|qfj.proposal.d`);
  return `proposal.${a}${b}${c}${d}`;
}
