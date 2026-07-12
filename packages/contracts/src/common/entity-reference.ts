/**
 * References to QuickFurno Core entities.
 *
 * A Core entity is referenced, never described. Jarvis names *which* lead, and
 * Core knows what a lead is.
 */

import { z } from 'zod';

import { MACHINE_TOKEN_PATTERN } from './text.js';

export const MAX_ENTITY_TYPE_LENGTH = 64;
export const MAX_ENTITY_ID_LENGTH = 128;

/**
 * The kind of Core entity being referenced: `lead`, `vendor`, `client`,
 * `campaign`.
 *
 * Deliberately **not** a closed enum. QuickFurno Core owns its own entity
 * taxonomy, and Phase 2 has not integrated with Core — so enumerating its entity
 * types here would be inventing a fact about a system we have not yet looked at.
 * That is precisely the failure this phase is designed to avoid: the Phase 2
 * registry establishes the *mechanism*, not an imaginary Core API. The closed
 * list arrives with Core integration, and it will be Core's list, not ours.
 */
export const entityTypeSchema = z
  .string()
  .min(1)
  .max(MAX_ENTITY_TYPE_LENGTH)
  .regex(MACHINE_TOKEN_PATTERN, 'Must be a lowercase machine token, e.g. "lead"');

/**
 * An opaque QuickFurno Core identifier.
 *
 * **Opaque means opaque.** It is not assumed to be a UUID, an integer, or
 * anything else — Core chooses, and we carry the string. The permitted character
 * set is `[A-Za-z0-9._:-]`, which is broad enough for any identifier scheme Core
 * plausibly uses.
 *
 * That character set is also doing quiet privacy work, and it is worth naming
 * precisely — including its limit, so that nobody trusts it further than it goes.
 *
 * It excludes `@` and `+`, so an **email address** and an **E.164 phone number**
 * are structurally unable to appear here. Somebody who reaches for this field to
 * carry a recipient's contact details gets a validation error rather than a
 * privacy incident.
 *
 * It does **not** exclude a bare digit run such as `919876543210`, and it must
 * not: Core owns its identifier scheme and may legitimately use numeric ids.
 * Excluding them would be inventing a fact about a system Phase 2 has not
 * integrated with — the exact mistake this phase exists to avoid.
 *
 * **So the regex is a guardrail, not the control.** The control is that this field
 * is a *reference*: QuickFurno Core resolves the actual contact from its own
 * records, against consent it owns, at execution time. A reference that resolves
 * to nothing is refused by Core — it is not dialled
 * (docs/architecture/communication-model.md).
 */
export const entityIdSchema = z
  .string()
  .min(1)
  .max(MAX_ENTITY_ID_LENGTH)
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    'Must be an opaque Core identifier of [A-Za-z0-9._:-]. Contact details are never entity identifiers.',
  );

/**
 * An opaque reference to a Core entity.
 *
 * `{ entityType, entityId }` — and nothing else. Strict, so a caller cannot
 * quietly attach a `phoneNumber` or a `name` alongside the reference and turn a
 * pointer into a copy of Core's record.
 */
export const entityReferenceSchema = z.strictObject({
  entityType: entityTypeSchema,
  entityId: entityIdSchema,
});

export type EntityReference = z.infer<typeof entityReferenceSchema>;
