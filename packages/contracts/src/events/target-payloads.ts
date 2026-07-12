/**
 * Payload primitives for the **target** event catalogue.
 *
 * ### Read this before adding an event
 *
 * These are **target contracts**. They describe the shape QuickFurno Core's events will
 * take *when Core emits them*. **No claim is made that Core emits any of them today.**
 * We have not integrated with Core; establishing these emitters is Phase 11's work, and
 * where Core's actual shapes differ, **an adapter absorbs the difference and the contract
 * does not bend** (phased-roadmap.md, Phase 11).
 *
 * That is a deliberate reversal of the Phase 2 position that preceded it, and the reason
 * is recorded in docs/architecture/quickfurno-compatibility-directive.md. The earlier
 * argument — *do not invent a payload for a system nobody has looked at* — was sound, and
 * it is answered not by looking at Core but by **making the payloads carry almost
 * nothing**.
 *
 * ### The design rule that makes this safe: reference, never reproduce
 *
 * A target payload names **which** entity and **what happened**. It does not reproduce
 * Core's record of that entity.
 *
 * There is no `leadPayload` with a budget, a city, a phone number, and a requirement
 * description — because *that* is the thing we cannot invent, and it is also the thing
 * that would rot the instant Core's schema differed by one field. What we can commit to
 * without having seen Core is far narrower and far more durable:
 *
 * - an **opaque reference** to the entity (Core owns what a lead *is*),
 * - a **stable reason code** (why this event exists),
 * - a small, **governed** bag of derived signals (bounded, and refusing credentials,
 *   contacts, raw provider content, and model internals by key and by value shape).
 *
 * An adapter that has to map Core's real lead record onto *that* has an easy job. An
 * adapter that had to map it onto our invented forty-field lead schema would have an
 * impossible one — and would end up bending the contract, which is the failure the whole
 * arrangement exists to prevent.
 *
 * ### Bands, not amounts
 *
 * Several vendor events are money-adjacent — recharge opportunity, package readiness.
 * They carry **bands**, never amounts, never balances, and never currency. Jarvis's view
 * of a wallet is derived and non-authoritative (data-ownership.md), and a contract that
 * carried a balance would be a contract inviting somebody to reason from a stale number
 * about somebody else's money.
 */

import { z } from 'zod';

import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { createGovernedJsonObjectSchema } from '../common/governed-parameters.js';
import { entityReferenceSchema } from '../common/entity-reference.js';

/**
 * Bounded, governed derived signals.
 *
 * The always-forbidden set applies and cannot be opted out of. `body`, `notes`, and
 * `description` are additionally refused: a free-text blob here would become the place
 * where Core's whole record gets copied, one convenient field at a time.
 */
export const derivedObservationSchema = createGovernedJsonObjectSchema([
  'body',
  'notes',
  'freetext',
  'raw',
]);

/**
 * The base every target payload shares: **why**, and optionally **what we derived**.
 *
 * The *what it is about* lives on the envelope's `subject`, so it is not repeated here.
 */
export const observationBaseShape = {
  reasonCode: reasonCodeSchema,
  detail: boundedText(TEXT_LIMITS.description).optional(),
  signals: derivedObservationSchema.optional(),
} as const;

/** A payload that is only an observation about the envelope's subject. */
export const observationPayloadSchema = z.strictObject({ ...observationBaseShape });

export type ObservationPayload = z.infer<typeof observationPayloadSchema>;

/**
 * Build an observation payload with extra, event-specific fields.
 *
 * Every target payload goes through here, so the governed base cannot be forgotten by the
 * next event somebody adds — the same reason `defineCanonicalEvent` exists for envelopes.
 */
export function observationPayload<T extends z.ZodRawShape>(extra: T) {
  return z.strictObject({ ...observationBaseShape, ...extra });
}

/**
 * A qualitative band.
 *
 * Used wherever a number would be a lie: a "churn risk of 0.73" implies a precision
 * nobody has, and it invites a threshold to be set on it. A band is honest about being a
 * judgment, and it is countable.
 */
export const QUALITATIVE_BANDS = ['low', 'medium', 'high', 'critical'] as const;

export const qualitativeBandSchema = z.enum(QUALITATIVE_BANDS);
export type QualitativeBand = z.infer<typeof qualitativeBandSchema>;

/** The lead-category pair, which is the unit the vendor cap is scoped to. */
export const leadCategoryShape = {
  lead: entityReferenceSchema,
  category: entityReferenceSchema,
} as const;
