/**
 * The deterministic Core intake idempotency key (RWC-P6B, ADR-0102 §11; ADR-0101 §13).
 *
 * ### What the key must mean
 *
 * *This is the same business intake.* Not the same click, not the same attempt, not the same
 * conversational moment — the same enquiry about the same project for the same person. Everything
 * about the construction below follows from that one sentence.
 *
 * ### Why the revision, the action reference and any clock are excluded
 *
 * A conversation's revision moves for reasons that have nothing to do with the intake: a concurrent
 * turn, a provenance strengthening, the client fixing a typo elsewhere. If any of those changed the
 * key, a retry after a network wobble would derive a new one, Core would see a submission it has
 * never met, and a real person would receive two enquiries about one kitchen. A nonce or a timestamp
 * would do the same thing on purpose.
 *
 * Conversely a materially changed discovery MUST derive a different key. A client who edits their city
 * and resubmits is making a different enquiry, and Core deduplicating it against the old one would
 * silently discard the correction.
 *
 * ### Fixed order, explicit nulls, no iteration
 *
 * The seven discovery slots are written out in a fixed order with `?? null` for the optional ones. An
 * absent value and an empty one must not collide, and a key built by walking whatever keys an object
 * happened to have would change meaning the day a field was added.
 *
 * ### The preimage never leaves this function
 *
 * It contains a description of a real person's home. It is hashed and discarded: never logged, never
 * stored, never returned, and never put in an error.
 */
import { createHash } from 'node:crypto';

import { idempotencyKeySchema } from '@qf-jarvis/contracts';
import type { NeedDiscovery } from '@qf-jarvis/riya-agent';

import { RiyaWebConversationError } from '../contracts/errors.js';

/** The preferred RWC-P6B form, as ADR-0101 §13 fixed it. */
export const RIYA_INTAKE_IDEMPOTENCY_PREFIX = 'riya-intake.';

/**
 * Derive the canonical key for one business intake.
 *
 * Pure and total: same inputs, same key, on any machine and at any time. That is what makes the
 * recovery path in ADR-0102 §14 safe — a later action can re-derive this exact key and ask Core about
 * the submission this one may or may not have made.
 */
export function riyaIntakeIdempotencyKey(input: {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly subjectRef: string;
  readonly discovery: NeedDiscovery;
}): string {
  const discovery = input.discovery;
  const preimage = JSON.stringify([
    // The P6 contract version. A future shape change must not collide with a key derived under this
    // one, because the two would describe different submissions.
    1,
    input.tenantId,
    input.conversationId,
    input.subjectRef,
    discovery.serviceInterestRef ?? null,
    discovery.locationRef ?? null,
    discovery.propertyTypeRef ?? null,
    discovery.scopeSummary ?? null,
    discovery.budgetNote ?? null,
    discovery.timelineNote ?? null,
    discovery.consultationPreferenceRef ?? null,
  ]);
  const key = `${RIYA_INTAKE_IDEMPOTENCY_PREFIX}${createHash('sha256')
    .update(preimage, 'utf8')
    .digest('hex')}`;

  // Re-proved through the ONE shared authority rather than assumed. The construction above cannot
  // produce an illegal key today; the check is what keeps that true if either the prefix or the shared
  // grammar is ever changed, and the alternative is discovering the disagreement at Core.
  if (!idempotencyKeySchema.safeParse(key).success) {
    throw new RiyaWebConversationError('repository-invariant');
  }
  return key;
}
