/**
 * ClientConfirmationV1 — the client actually said yes, and here is the record of it.
 *
 * Reassigning a client's lead to three new vendors, and creating a second lead in a
 * new category, are both things that happen **to a real person's project**. Neither
 * may be inferred, and neither may be assumed from silence or from an agent's
 * confidence that it would be welcome.
 *
 * So confirmation is an **artifact with an identity**, not a boolean somebody set.
 * The difference matters at exactly the moment it is challenged: `confirmed: true`
 * is a claim, and a claim is worth nothing six months later when a client says they
 * never agreed. A `ClientConfirmationV1` points at the canonical event in which the
 * confirmation was recorded, so the answer to "prove it" is a lookup rather than an
 * argument.
 *
 * ### What it does not carry
 *
 * Not what the client *said*. There is no free-text field for their words, and that
 * is deliberate: a verbatim quote is personal data, it invites a transcript to be
 * pasted in, and it is not what the system needs. What the system needs is *which
 * confirmation, captured how, evidenced where* — and a stable `statementCode` that
 * can actually be counted.
 */

import { z } from 'zod';

import { clientConfirmationIdSchema, eventIdSchema } from '../common/identifiers.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { machineTokenSchema } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';

/**
 * How the confirmation was captured.
 *
 * Open as a machine token rather than a closed enum: Core owns the channels through
 * which it actually speaks to clients, and enumerating them here would be inventing
 * a fact about a system Phase 2 has not integrated with.
 */
export const confirmationChannelCodeSchema = machineTokenSchema;

/**
 * This contract is versioned like every other, and that is not ceremony.
 *
 * A client confirmation is the **evidence that gates a reassignment and a linked lead** —
 * the artifact that stands between "a model thought they were unhappy" and "three more
 * vendors were charged for this lead". It is embedded inside four other contracts.
 *
 * An embedded contract with no version is the one you cannot evolve safely: the day
 * `statementCode` needs to become a structured object, every consumer that already parsed
 * the old shape has no way to tell which shape it is holding. The version is what makes
 * that a rejection rather than a silent misread.
 *
 * **The version is never defaulted.** A confirmation that does not say which version it is
 * does not parse — the same rule the event registry applies, for the same reason: an
 * unknown version is rejected, never guessed at.
 */
export const CLIENT_CONFIRMATION_CONTRACT_VERSION = 1;

export const clientConfirmationV1Schema = z.strictObject({
  confirmationId: clientConfirmationIdSchema,
  contractVersion: z.literal(CLIENT_CONFIRMATION_CONTRACT_VERSION),

  /** Who confirmed. An opaque Core reference to the client — never a name, never a number. */
  confirmedBy: entityReferenceSchema,
  confirmedAt: utcTimestampSchema,

  /** Through what channel Core captured it. */
  confirmationChannelCode: confirmationChannelCodeSchema,

  /**
   * The canonical event in which the confirmation was recorded.
   *
   * This is the field that turns the record into evidence. Without it, a
   * confirmation is a thing Jarvis asserts; with it, a confirmation is a thing an
   * auditor can go and read in Core.
   */
  evidenceEventId: eventIdSchema,

  /**
   * What was confirmed, as a stable code.
   *
   * `client-requested-replacement-vendors`, `client-confirmed-additional-category`.
   * Countable, so "how often do clients actually ask for a replacement?" has an
   * answer.
   */
  statementCode: machineTokenSchema,
});

export type ClientConfirmationV1 = z.infer<typeof clientConfirmationV1Schema>;
