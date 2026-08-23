/**
 * The one runtime function (QFJ-P09.05, ADR-0110).
 *
 * `communication-state-record.ts` says it plainly: *"`previousState` is carried as optional
 * evidence, not as a validated edge. Transition enforcement is the coordination layer's job in a
 * later phase."* This is that layer, and this is the only entry point into it.
 *
 * ### Why schema validation alone was never going to be enough
 *
 * A `CommunicationStateRecordV1` is a point-in-time fact and validates as one. It already enforces
 * the thing a single record CAN enforce -- reference integrity, so a state that exists only because
 * Core decided, dispatched or recorded something has to carry the artifact proving it. What a single
 * record structurally cannot answer is whether the lifecycle MOVED legally, because that is a
 * question about two records and the schema only ever sees one.
 *
 * The concrete gap: a record with `state: 'delivered'`, a real execution result id, and
 * `previousState: 'draft'` is a perfectly valid `CommunicationStateRecordV1` today. It asserts that
 * a message went from an unapproved draft to delivered without Core ever authorizing it, and every
 * validator in the repository accepts it. This function is what refuses it -- twice over, since
 * `draft` to `delivered` is not an edge and `previousState` is checked against the record actually
 * being left rather than trusted.
 *
 * ### The order of checks, and why it is this order
 *
 * Both records are parsed first, because policy over an unvalidated record is policy over nothing.
 * Then identity, then history, then time, then the edge -- narrowing from "is this even the same
 * communication?" to "is this particular movement legal?". Each check returns immediately, so a
 * caller gets the FIRST and most fundamental disagreement rather than a downstream symptom of it: a
 * record for an entirely different communication should be reported as such, not as a transition
 * that happens not to be in the graph.
 *
 * ### What this function is structurally incapable of
 *
 * It creates nothing. There is no `setState`, `advanceTo`, `markDelivered`, `authorize`, `send` or
 * `execute` here or anywhere in this package, and none could be added without a dependency this
 * package does not have. It does not repair the candidate -- notably it will not insert a missing
 * `previousState`, because a coordination layer that fills in the evidence it then checks is
 * checking its own handwriting. It reads no clock, so a verdict is deterministic and a replayed
 * transition answers the same way tomorrow. And it returns a verdict about an EDGE: QuickFurno Core
 * remains authoritative over every fact the records contain.
 */
import {
  isStrictlyBefore,
  safeParseCommunicationStateRecord,
  type CommunicationStateRecordV1,
} from '@qf-jarvis/contracts';

import type { CommunicationLifecycleTransitionInput } from './contracts/input.js';
import type { CommunicationLifecycleTransitionResult } from './contracts/result.js';
import { LIFECYCLE_CONSISTENT, refuse } from './internal/verdicts.js';
import {
  COMMUNICATION_LIFECYCLE_START_STATE,
  COMMUNICATION_LIFECYCLE_TRANSITIONS,
} from './policy/transition-graph.js';

/** A structural guard, because the declared input type is a claim and not a proof. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The identity fields that must not move while a lifecycle runs.
 *
 * Exactly the five the approved slice names, and no more. The temptation is to add every field the
 * contract has -- and it would be wrong. `approvalDecisionId`, `executionIntentId` and
 * `executionResultId` legitimately APPEAR as the lifecycle advances: a `draft` has none of them, an
 * `authorized` record has a decision id it could not have had before Core decided, and a `delivered`
 * record has an execution result id that did not exist at submission. Requiring those to stay
 * identical across unrelated stages would refuse the normal, correct path, so they are governed
 * where they belong: by the canonical schema's per-state evidence rules, which this function leaves
 * entirely alone.
 *
 * `reasonCode` and `explanation` are likewise expected to differ per record -- each states why THAT
 * state was recorded -- and `recordedAt` must be free to differ, which is what the ordering check
 * further down is about.
 */
function identityRefusal(
  current: CommunicationStateRecordV1,
  next: CommunicationStateRecordV1,
): CommunicationLifecycleTransitionResult | undefined {
  if (current.communicationId !== next.communicationId) {
    return refuse('communication-id-mismatch');
  }
  if (current.channel !== next.channel) {
    return refuse('channel-mismatch');
  }
  // The recipient is an opaque `{ entityType, entityId }` pair, so continuity is a comparison of
  // BOTH halves. Comparing only the id would let a lifecycle move from one entity type to another
  // while keeping a coincidentally equal identifier.
  if (
    current.recipient.entityType !== next.recipient.entityType ||
    current.recipient.entityId !== next.recipient.entityId
  ) {
    return refuse('recipient-mismatch');
  }
  if (current.purposeCode !== next.purposeCode) {
    return refuse('purpose-code-mismatch');
  }
  if (current.correlationId !== next.correlationId) {
    return refuse('correlation-id-mismatch');
  }
  return undefined;
}

function evaluate(input: unknown): CommunicationLifecycleTransitionResult {
  const supplied: Record<string, unknown> = isRecord(input) ? input : {};

  // A missing `current` and an explicit `null` mean the same thing -- lifecycle START -- because
  // both say "there is no record being left". The declared type asks for the explicit `null` so a
  // TypeScript caller cannot start a lifecycle by forgetting a field.
  const suppliedCurrent = supplied['current'] ?? null;

  // Parsed BEFORE the candidate: if the caller's idea of where the lifecycle stands is broken, the
  // premise of the whole question is broken, and reporting a defect in the candidate first would
  // send them to fix the wrong record.
  let current: CommunicationStateRecordV1 | null = null;
  if (suppliedCurrent !== null) {
    const parsedCurrent = safeParseCommunicationStateRecord(suppliedCurrent);
    if (!parsedCurrent.success) {
      // The issues are discarded rather than summarised. They quote the values that failed, and
      // those values include a recipient reference, a purpose code and a human-facing explanation.
      return refuse('current-record-invalid');
    }
    current = parsedCurrent.data;
  }

  const parsedNext = safeParseCommunicationStateRecord(supplied['next']);
  if (!parsedNext.success) {
    return refuse('next-record-invalid');
  }
  const next = parsedNext.data;

  // --- lifecycle START ---------------------------------------------------------------------------
  if (current === null) {
    if (next.state !== COMMUNICATION_LIFECYCLE_START_STATE) {
      // The authoritative diagram's only edge out of the start marker is the one into `draft`. A
      // lifecycle that begins at `authorized` or `delivered` is a lifecycle asserting that Core
      // decided, or that a provider delivered, without anything ever having been requested.
      return refuse('initial-state-not-draft');
    }
    if (next.previousState !== undefined) {
      // There was no record to leave, so a `previousState` here is evidence of a history that is
      // being claimed rather than shown. Fail closed rather than ignoring the field.
      return refuse('initial-previous-state-present');
    }
    return LIFECYCLE_CONSISTENT;
  }

  // --- identity continuity -----------------------------------------------------------------------
  const mismatch = identityRefusal(current, next);
  if (mismatch !== undefined) {
    return mismatch;
  }

  // --- history evidence --------------------------------------------------------------------------
  //
  // This is where `previousState` stops being optional point-in-time evidence and becomes REQUIRED
  // coordination evidence -- at the transition boundary, without the record schema changing at all.
  // A single stored record is still free to omit it; a record offered as a MOVEMENT is not.
  if (next.previousState === undefined) {
    return refuse('previous-state-missing');
  }
  if (next.previousState !== current.state) {
    // The candidate claims to have come from somewhere other than where the lifecycle actually
    // stands. Rewriting it to match would destroy the only evidence that they ever disagreed.
    return refuse('previous-state-mismatch');
  }

  // --- ordering ----------------------------------------------------------------------------------
  //
  // Non-regression, not sequencing. Equal timestamps are ACCEPTED: the canonical timestamp contract
  // permits second-granularity instants, so two records legitimately recorded within the same second
  // carry the same value, and refusing them would invent a precision the contract does not have.
  // What is refused is time running backwards -- a candidate recorded strictly before the record it
  // claims to follow. Both instants come from the validated records; no clock is read, so a replayed
  // transition answers identically.
  //
  // The comparison is the canonical `isStrictlyBefore`, not a local one. Ordering over the contract
  // timestamp is the contract's own question, and a second implementation here would be free to
  // disagree with it about fractional seconds -- which is exactly the kind of disagreement nobody
  // would notice until a lifecycle refused a legitimate advance.
  if (isStrictlyBefore(next.recordedAt, current.recordedAt)) {
    return refuse('timestamp-regression');
  }

  // --- the edge ----------------------------------------------------------------------------------
  //
  // A total map indexed by a state that came out of the canonical schema. There is no `?? []` and no
  // default branch: an unknown state cannot arrive here, because it would have failed the canonical
  // parse above, and a NEW known state cannot arrive here either, because the map would not compile
  // until its policy is written down.
  if (!COMMUNICATION_LIFECYCLE_TRANSITIONS[current.state].includes(next.state)) {
    return refuse('transition-not-allowed');
  }

  return LIFECYCLE_CONSISTENT;
}

/**
 * Decide whether one canonical communication state record may legally follow another.
 *
 * The public signature is typed; the implementation treats its argument as `unknown` and re-parses
 * both records, because a TypeScript type is a claim the caller makes and this function's job is to
 * check claims.
 */
export const evaluateCommunicationLifecycleTransition: (
  input: CommunicationLifecycleTransitionInput,
) => CommunicationLifecycleTransitionResult = evaluate;
