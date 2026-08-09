/**
 * The two governed advances after confirmation (RWC-P6, ADR-0101 §22–§23).
 *
 * ### These functions decide nothing about contact, consent or business eligibility
 *
 * They are the LAST step of a decision somebody else already made. `CONTACT → CONSENT` happens
 * because Core says contact is captured; `CONSENT → COMPLETE` happens because Core accepted a
 * submission. Each takes the opaque evidence of that decision as an inert value and moves a
 * conversational label.
 *
 * That split is the whole point. The authority matrix puts consent and customer identity under Core
 * — READ for every agent, PROHIBITED to change — and a pure reducer that could not reach Core is a
 * reducer that structurally cannot decide either. What it CAN do is refuse to move without evidence,
 * which is what turns "Core owns consent" from a sentence into a mechanism.
 *
 * ### Evidence proves the caller had it; it is not a permission token
 *
 * A well-formed reference proves the composition obtained something from a parsed Core answer. It
 * does not prove what Core said — RWC-P6B is responsible for reading `GRANTED` rather than
 * `DECLINED`, and for refusing on `OPTED_OUT`. This layer cannot check that, and pretending otherwise
 * would be a reducer claiming an authority it has no way to exercise.
 */
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { z } from 'zod';

import { RiyaConversationCompletionError } from './contracts/errors.js';
import { advancedState, canonicalState } from './internal/state.js';

/**
 * The opaque Core evidence grammar, matching `@qf-jarvis/core-riya-intake` and continuity's own
 * `completionEvidenceRef`.
 *
 * Restated rather than imported so this pure reducer takes no dependency on the Core PORT package —
 * it consumes evidence as a value and must not acquire the ability to fetch one. All three grammars
 * are the same by design: a reference this layer accepted and continuity refused would be a contract
 * that fails at the last step, and a spec pins the agreement.
 *
 * No `@`, no `+`, no whitespace, no `/`: an email, an E.164 number, a URL and a sentence are all
 * unrepresentable.
 */
const EVIDENCE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

function canonicalEvidenceRef(value: string): string {
  const parsed = EVIDENCE_REF.safeParse(value);
  if (!parsed.success) {
    throw new RiyaConversationCompletionError('invalid-evidence-ref');
  }
  return parsed.data;
}

/** What one governed advance produced. */
export interface RiyaCompletionAdvanceResultV1 {
  readonly version: 1;
  readonly state: RiyaConversationContinuityStateV1;
}

/**
 * `CONTACT → CONSENT`, once Core holds contact for this subject.
 *
 * The evidence reference is REQUIRED and then **deliberately discarded**. Continuity has no field for
 * it, and it must not acquire one: the reference is Core's record of Core's capture, and a copy held
 * in Jarvis would be a second place the same fact lives — with its own erasure obligation and its own
 * chance to go stale. Its only job here is to prove the caller had a governed answer rather than a
 * hopeful boolean.
 *
 * Discovery, provenance and `summaryConfirmed` are carried through untouched. Nothing about what the
 * client wants changes because their phone number reached Core.
 */
export function advanceRiyaAfterContactReady(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly contactEvidenceRef: string;
}): RiyaCompletionAdvanceResultV1 {
  const current = canonicalState(args.current);
  canonicalEvidenceRef(args.contactEvidenceRef);

  if (current.phase !== 'CONTACT' || !current.summaryConfirmed) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (current.completionEvidenceRef !== undefined) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (current.discovery.completeness === 'HUMAN_REVIEW_REQUIRED') {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }

  return Object.freeze({
    version: 1 as const,
    state: advancedState({
      from: current,
      discovery: current.discovery,
      fieldProvenance: current.fieldProvenance,
      phase: 'CONSENT',
      summaryConfirmed: true,
    }),
  });
}

/**
 * `CONSENT → COMPLETE`, once Core has accepted the canonical submission.
 *
 * The supplied reference IS the value written to continuity's `completionEvidenceRef` — the only
 * value that may ever be written there. RWC-P6B calls this only after a parsed
 * `CoreRiyaIntakeSubmissionResultV1` whose outcome is `ACCEPTED`, which is the only outcome that
 * carries one.
 *
 * This reducer does not know, and must not appear to know, how Core arrived at that evidence. It
 * cannot see consent, it cannot see a lead, and it holds no `canSubmit`. What it enforces is that a
 * conversation reaches `COMPLETE` only carrying proof that a governed submission happened — which is
 * exactly the rule continuity has enforced since RWC-P2A, now with something real to satisfy it.
 */
export function completeRiyaAfterCoreSubmission(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly completionEvidenceRef: string;
}): RiyaCompletionAdvanceResultV1 {
  const current = canonicalState(args.current);
  const evidence = canonicalEvidenceRef(args.completionEvidenceRef);

  if (current.phase !== 'CONSENT' || !current.summaryConfirmed) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (current.completionEvidenceRef !== undefined) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (current.discovery.completeness === 'HUMAN_REVIEW_REQUIRED') {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }

  return Object.freeze({
    version: 1 as const,
    state: advancedState({
      from: current,
      discovery: current.discovery,
      fieldProvenance: current.fieldProvenance,
      phase: 'COMPLETE',
      summaryConfirmed: true,
      completionEvidenceRef: evidence,
    }),
  });
}
