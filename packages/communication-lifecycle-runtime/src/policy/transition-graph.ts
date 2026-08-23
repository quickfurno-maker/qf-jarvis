/**
 * The eighteen-state communication lifecycle graph (QFJ-P09.05, ADR-0110).
 *
 * INTERNAL. Reused verbatim from the `stateDiagram-v2` block in
 * docs/architecture/communication-model.md, which is authoritative. Not renamed, not merged, not
 * extended, and not "tidied" -- the document's snake_case node names are that document's rendering
 * convention; the canonical machine values are the kebab-case members of `COMMUNICATION_STATES`,
 * and a spec re-derives this table from the document on every run so the two cannot drift apart in
 * silence.
 *
 * ### Why this is a TOTAL map and not a lookup with a fallback
 *
 * The type is `Record<CommunicationState, ...>`, so TypeScript requires an entry for every member of
 * the canonical vocabulary. Adding a nineteenth state to `COMMUNICATION_STATES` therefore FAILS TO
 * COMPILE here until somebody writes down what that state may become.
 *
 * That is the entire point. The failure mode being designed out is a new state quietly inheriting a
 * verdict by falling through a `transitions[state] ?? []` or a `default:` branch. Both readings are
 * wrong and both are silent: an empty fallback would make a legitimate new state a dead end that
 * refuses every move, and a permissive fallback would let an undecided state reach `delivered`. A
 * compile error is the only outcome that puts the decision in front of a human.
 *
 * ### `completed` is a sink, and nothing self-transitions
 *
 * `completed` has no outgoing edge because the document ends the lifecycle there (`completed -->
 * [*]`). No state may transition to itself: a record whose state did not change is not a movement,
 * and accepting it would let a caller replay the same fact forever while the lifecycle appears to
 * advance.
 *
 * There is no convenience edge anywhere in this table. Every shortcut somebody might reach for --
 * `draft` straight to `execution-submitted`, `authorization-requested` straight to `delivered`,
 * `failed` back to `execution-submitted` for a retry -- is absent deliberately. The last of those is
 * worth naming: a follow-up "is a **new request**, not a retry", so it starts a new lifecycle at
 * `draft` rather than reopening a closed one.
 */
import { type CommunicationState } from '@qf-jarvis/contracts';

/**
 * The only state a lifecycle may begin at.
 *
 * The document's start marker is `[*] --> draft`, and it is the ONLY edge out of the start marker.
 * START is coordination context, not a nineteenth member of `COMMUNICATION_STATES`: inventing a
 * `start` state would fork the vocabulary and hand every consumer a value the canonical contract
 * has never heard of.
 */
export const COMMUNICATION_LIFECYCLE_START_STATE: CommunicationState = 'draft';

/** The authoritative edge set. Total over the canonical vocabulary; frozen all the way down. */
export const COMMUNICATION_LIFECYCLE_TRANSITIONS: Readonly<
  Record<CommunicationState, readonly CommunicationState[]>
> = Object.freeze({
  draft: Object.freeze(['authorization-requested', 'cancelled'] as const),

  'authorization-requested': Object.freeze(['authorized', 'rejected', 'cancelled'] as const),

  // `authorized` may go straight to execution (send now) or wait (send later). Both are in the
  // document; neither is a shortcut this package invented.
  authorized: Object.freeze(['scheduled', 'execution-submitted', 'cancelled'] as const),

  // `scheduled --> rejected` exists because eligibility is re-validated at the scheduled moment and
  // may have changed since Core authorized. A prior authorization is not a future permission slip.
  scheduled: Object.freeze(['execution-submitted', 'rejected', 'cancelled', 'expired'] as const),

  // Note what is NOT here: `execution-submitted --> delivered`. Submission is not acceptance and
  // acceptance is not delivery, and collapsing the three is the exact defect the state vocabulary
  // exists to prevent.
  'execution-submitted': Object.freeze(['provider-accepted', 'failed', 'expired'] as const),

  'provider-accepted': Object.freeze([
    'delivered',
    'answered',
    'no-answer',
    'busy',
    'failed',
  ] as const),

  delivered: Object.freeze(['read', 'completed'] as const),

  read: Object.freeze(['follow-up-requested', 'completed'] as const),

  answered: Object.freeze(['human-handoff-required', 'follow-up-requested', 'completed'] as const),

  'no-answer': Object.freeze(['follow-up-requested', 'completed'] as const),

  busy: Object.freeze(['follow-up-requested', 'completed'] as const),

  failed: Object.freeze(['completed'] as const),

  // A refusal is a closed lifecycle, not a state to argue with. There is no edge back to
  // `authorization-requested`: asking again after Core said no is a NEW request, made deliberately,
  // and never something a coordination layer performs on a caller's behalf.
  rejected: Object.freeze(['completed'] as const),

  cancelled: Object.freeze(['completed'] as const),

  expired: Object.freeze(['completed'] as const),

  'follow-up-requested': Object.freeze(['completed'] as const),

  'human-handoff-required': Object.freeze(['completed'] as const),

  /** The sink. Zero outgoing edges, by the document. */
  completed: Object.freeze([] as const),
});
