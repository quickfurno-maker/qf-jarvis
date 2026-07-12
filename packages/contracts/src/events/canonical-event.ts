/**
 * The canonical event envelope.
 *
 * Every fact that reaches QF Jarvis arrives in this shape. The envelope is the
 * same for every event type; only the payload differs.
 *
 * ### Source is always QuickFurno Core, and that is not a detail
 *
 * `source` is the literal `quickfurno-core`. Every canonical event is emitted by
 * Core, because **a fact is only a fact once Core has recorded it** (ADR-0001).
 *
 * This holds even when the underlying thing happened elsewhere. A provider
 * delivered a message; n8n observed it; n8n reported it; Core recorded it; *Core*
 * emitted the canonical event. The provider's own view of the delivery appears
 * inside an execution-result payload as **reported evidence**, and it is not
 * authoritative until Core has recorded it. So the payload may say "n8n reported
 * this", while the envelope always says "Core is telling you".
 *
 * Those two claims are different, and this package refuses to blur them.
 *
 * ### Identity, ordering, and causation
 *
 * - `eventId` is the **idempotency identity**. The same event processed twice must
 *   have the effect of once, and this is the value that makes that decidable.
 *   At-least-once delivery is the only kind that exists (engineering-principles.md §8).
 * - `occurredAt` is when the thing happened. `emittedAt` is when Core said so.
 *   **`emittedAt` may not precede `occurredAt`** — an event announced before it
 *   happened is a clock fault or a forgery, and either way it is not processed.
 * - `causationEventId` is the event that caused this one. **An event may not cause
 *   itself.** A self-causing event turns the audit walk into an infinite loop, and
 *   the backward walk is the thing that makes an incident recoverable.
 * - `correlationId` survives the whole chain: source events, recommendation,
 *   approval decision, execution intent, execution result, closure.
 *
 * ### Parsing executes nothing
 *
 * Validation is a pure function of its input. It reads no clock, opens no socket,
 * touches no environment variable, and logs nothing. In particular, timestamp
 * rules are checked *against each other*, never against `now` — an event that was
 * valid when it was emitted must not become invalid because it was replayed
 * tomorrow. Replay is a first-class feature, not a recovery hack (ADR-0003).
 */

import { z } from 'zod';

import { correlationIdSchema, eventIdSchema } from '../common/identifiers.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { isAtOrBefore, utcTimestampSchema } from '../common/timestamp.js';
import { quickfurnoCoreSchema } from '../common/systems.js';

/**
 * Build a strict, versioned canonical event schema.
 *
 * Every registered event is created through this factory, so the envelope rules —
 * the Core source literal, the timestamp ordering, the self-causation ban, strict
 * unknown-key rejection — are written once and cannot be forgotten by the next
 * event somebody adds.
 */
export function defineCanonicalEvent<TType extends string, TVersion extends number, TPayload>(
  eventType: TType,
  eventVersion: TVersion,
  payloadSchema: z.ZodType<TPayload>,
) {
  return z
    .strictObject({
      /** Idempotency identity. */
      eventId: eventIdSchema,

      /** Type and version together identify exactly one contract. */
      eventType: z.literal(eventType),
      eventVersion: z.literal(eventVersion),

      /** When it happened. */
      occurredAt: utcTimestampSchema,
      /** When QuickFurno Core said it happened. Never before it happened. */
      emittedAt: utcTimestampSchema,

      /** Always QuickFurno Core. The literal is the boundary. */
      source: quickfurnoCoreSchema,

      /** What it is about, by opaque Core reference. */
      subject: entityReferenceSchema,

      correlationId: correlationIdSchema,
      causationEventId: eventIdSchema.optional(),

      payload: payloadSchema,
    })
    .superRefine((value, ctx) => {
      if (!isAtOrBefore(value.occurredAt, value.emittedAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['emittedAt'],
          message: 'emittedAt must not precede occurredAt',
        });
      }

      if (value.causationEventId !== undefined && value.causationEventId === value.eventId) {
        ctx.addIssue({
          code: 'custom',
          path: ['causationEventId'],
          message: 'An event may not causally reference itself',
        });
      }
    });
}
