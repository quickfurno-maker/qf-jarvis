/**
 * **Payload primitives for canonical event version 2 — the privacy-hardened payloads.**
 *
 * ### What was wrong with version 1
 *
 * Two holes, both found by reading QuickFurno rather than by imagining an attacker (ADR-0026):
 *
 * **One — `detail`.** Every v1 observation payload carried `detail: boundedText(500)`: an
 * **arbitrary 500-character string**. It was bounded, and it was free text, and free text is
 * where Core's record arrives one convenient copy at a time. Core stores precise client
 * coordinates *inside* `leads.message`, so `detail` was a 500-character door onto somebody's home.
 *
 * **Two — `signals`.** It was `z.custom<JsonObject>()`: a **generic key/value bag**. Bounded,
 * key-filtered, and structurally an open dictionary — which is exactly the
 * `Record<string, unknown>` freedom a canonical payload may not have. A schema that accepts any
 * key has not decided what the event means; it has deferred the decision to whoever fills it in.
 *
 * ### The v2 rule: if there is no field for it, it cannot arrive
 *
 * **The primary control is the schema, not the detector.** Every v2 payload is a strict object
 * of explicitly declared, individually bounded fields. There is no free text, no open
 * dictionary, and no unknown key. **A payload with nowhere to put a coordinate does not need to
 * be searched for one.**
 *
 * The prohibited-content scan runs anyway, over the whole payload, because the schema cannot see
 * *inside* a string — and because the next person to add a field will not read this comment.
 * That is defence in depth, and it is the second lock, never the first.
 */

import { z } from 'zod';

import { entityReferenceSchema } from '../common/entity-reference.js';
import {
  inspectProhibitedContent,
  isFreeOfProhibitedContent,
} from '../common/prohibited-content.js';
import { boundedText, machineTokenSchema, reasonCodeSchema } from '../common/text.js';

/**
 * Attach the prohibited-content scan to any schema.
 *
 * Applied to **whole payloads**, not to individual fields, so that it also reaches the free text
 * inside embedded governance contracts — a recommendation's `rationale` must exist and must be
 * challengeable, and it must still not be able to carry somebody's coordinates.
 */
/**
 * Every schema that has actually been through the guard.
 *
 * This is a **structural** record, not a convention. "All payloads are guarded" is a claim, and a
 * claim about 52 hand-written registry entries is a claim that will be false the first time
 * somebody adds the 53rd without thinking. `isGuardedPayloadSchema` turns it into something a test
 * can check, and `canonical-payload-privacy.test.ts` checks it for **every registered payload** —
 * so a payload that skipped the guard fails the build rather than the audit.
 */
const GUARDED_SCHEMAS = new WeakSet<object>();

/** Has this schema been wrapped in the deep prohibited-content guard? */
export function isGuardedPayloadSchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && GUARDED_SCHEMAS.has(schema);
}

export function withProhibitedContentGuard<T extends z.ZodType>(schema: T): T {
  const guarded = schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    // The scan is DEEP: it walks the whole payload, including every field of every embedded
    // governance contract. That is why the fifteen embedded contracts did not need re-versioning —
    // their shapes were never the problem, and the guard reaches inside them from here.
    for (const issue of inspectProhibitedContent(value)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
    }
  });

  GUARDED_SCHEMAS.add(guarded);

  return guarded;
}

/** A qualitative band. Used wherever a number would imply a precision nobody has. */
export const QUALITATIVE_BANDS = ['low', 'medium', 'high', 'critical'] as const;
export const qualitativeBandSchema = z.enum(QUALITATIVE_BANDS);
export type QualitativeBand = z.infer<typeof qualitativeBandSchema>;

/** Bounds for the numeric fields a payload may carry. Finite, and never a coordinate. */
export const PAYLOAD_NUMERIC_BOUNDS = {
  /** A normalised score or confidence. */
  unitInterval: { min: 0, max: 1 },
  /** A 0-100 score, as Core's lead quality engine produces. */
  score: { min: 0, max: 100 },
  /** Any count of things. Never negative, and bounded so it cannot be a payload in disguise. */
  count: { min: 0, max: 10_000 },
} as const;

/** A finite, bounded, non-negative count. */
export const boundedCountSchema = z
  .number()
  .int()
  .min(PAYLOAD_NUMERIC_BOUNDS.count.min)
  .max(PAYLOAD_NUMERIC_BOUNDS.count.max);

/** A 0..1 confidence or completeness. */
export const unitIntervalSchema = z
  .number()
  .min(PAYLOAD_NUMERIC_BOUNDS.unitInterval.min)
  .max(PAYLOAD_NUMERIC_BOUNDS.unitInterval.max);

/** A 0..100 score. */
export const scoreSchema = z
  .number()
  .min(PAYLOAD_NUMERIC_BOUNDS.score.min)
  .max(PAYLOAD_NUMERIC_BOUNDS.score.max);

/**
 * **A derived signal, explicitly shaped.** This replaces the v1 open dictionary.
 *
 * A signal is a **code** and, optionally, exactly one way of quantifying it — a band, a unit
 * value, a score, a count, or a boolean. It cannot carry a sentence, because it has no field
 * that holds one.
 *
 * That constraint is the point. "Let the producer put whatever it likes in `signals`" is how the
 * whole of Core's record ends up on the other side of the boundary, field by defensible field.
 */
export const derivedSignalSchema = z.strictObject({
  /** What the signal is. A stable machine token, so it can be counted and switched on. */
  code: machineTokenSchema,
  band: qualitativeBandSchema.optional(),
  value: unitIntervalSchema.optional(),
  score: scoreSchema.optional(),
  count: boundedCountSchema.optional(),
  present: z.boolean().optional(),
});

export type DerivedSignal = z.infer<typeof derivedSignalSchema>;

/** At most this many signals on one event. An event is an observation, not a dataset. */
export const MAX_SIGNALS = 20;

export const derivedSignalListSchema = z.array(derivedSignalSchema).max(MAX_SIGNALS);

/**
 * The base every v2 observation payload shares.
 *
 * **`reasonCode` and nothing else that a human writes.** _Why_ this event exists is a stable,
 * countable token — which is what lets an auditor ask "how often did Core reject a lead for
 * missing consent?" and get an answer. A free-text reason cannot be counted, so it cannot be
 * governed; and a free-text reason is where the coordinates were.
 */
export const observationBaseShapeV2 = {
  reasonCode: reasonCodeSchema,
  signals: derivedSignalListSchema.optional(),
} as const;

/**
 * Build a v2 observation payload with event-specific fields.
 *
 * Every v2 payload goes through here, so the guard and the strict base cannot be forgotten by
 * whoever adds the next event — the same reason `defineCanonicalEvent` exists for envelopes.
 */
export function observationPayloadV2<T extends z.ZodRawShape>(extra: T) {
  return withProhibitedContentGuard(z.strictObject({ ...observationBaseShapeV2, ...extra }));
}

/** A payload that is only an observation about the envelope's subject. */
export const observationPayloadV2Schema = observationPayloadV2({});
export type ObservationPayloadV2 = z.infer<typeof observationPayloadV2Schema>;

/**
 * Wrap a payload that embeds a governance contract.
 *
 * The contract shapes (a recommendation, an approval decision, an assignment batch) are **not**
 * re-versioned by this stage — they were never the problem. What they lacked was a guard over
 * the human-authored text inside them, and this is it.
 */
export function contractPayloadV2<T extends z.ZodRawShape>(shape: T) {
  return withProhibitedContentGuard(z.strictObject(shape));
}

/** The lead-category pair, which is the unit the vendor cap is scoped to. */
export const leadCategoryShape = {
  lead: entityReferenceSchema,
  category: entityReferenceSchema,
} as const;

/**
 * A short, human-readable taxonomy label — `Pune`, `Interior Designers`, `Civil Work`.
 *
 * **This is the one human-readable string a v2 payload may carry, and it is not free text.** It
 * is bounded to 64 characters and restricted to letters, digits, spaces and a handful of joining
 * characters. There is no room for a sentence, and the prohibited-content scan runs over it
 * regardless.
 *
 * **Labels are for display. Logic uses the ID and the taxonomy version** — a label is renamed by
 * an admin on a Tuesday, and every rule keyed on it silently changes meaning.
 */
export const MAX_TAXONOMY_LABEL_LENGTH = 64;

/**
 * ### A word count was tried, and it was the wrong control
 *
 * An earlier version of this schema capped a label at **five words**, reasoning that a sentence
 * cannot fit in five words. It was rejected, and the reason is worth keeping:
 *
 * **A word count is not a privacy boundary.** It stops nothing that matters — `Kothrud 9876543210`
 * is two words and is a phone number — and it **rejects valid names**. Hindi and Hinglish service
 * names are routinely longer: *"Modular Kitchen aur Wardrobe Designers"*, *"Ghar ka Interior Design
 * aur Renovation"*, *"रसोई और अलमारी डिज़ाइनर"*. A rule that refuses a legitimate business category
 * because it has six words is a rule the business will route around, and it buys **no** safety in
 * exchange.
 *
 * **So the boundary is content, not length-of-prose.** What may not appear in a label is what may
 * not appear anywhere: a URL, an email, a phone number, a coordinate, a map link, a newline, a
 * control character. Those are enforced — by the charset below and by the deep prohibited-content
 * scan that runs over every payload — and they are enforced regardless of how many words the label
 * has.
 *
 * **A word-count *recommendation* belongs in a UI.** It must never invalidate a canonical event.
 *
 * ### The honest residual
 *
 * A benign English sentence under 64 characters, carrying no contact data and no coordinates,
 * **will still be accepted as a label.** That is a deliberate trade, and it is stated plainly
 * rather than papered over: it is untidy, and it leaks nothing. **The thing being defended is the
 * client's phone number and front door — not the taxonomy's prose style.**
 */
const TAXONOMY_LABEL_CHARSET = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'&()/+-]*$/u;

/**
 * Message punctuation. A service category does not ask a question, does not exclaim, and does not
 * quote anybody — so these are the cheap, high-signal marks of prose that is not a name.
 *
 * Note what is *not* here: the comma and the full stop. `Pvt. Ltd.` and `Sofas, Chairs & Beds` are
 * real names, and refusing them would be the word-count mistake in a different costume.
 */
const MESSAGE_PUNCTUATION = /[?!;:"`<>{}[\]|\\]/u;

/** A URL, in any of the shapes somebody actually pastes. */
const URL_SHAPE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|in|co|io)\b)/i;

export const taxonomyLabelSchema = boundedText(MAX_TAXONOMY_LABEL_LENGTH)
  // `boundedText` already refuses control characters (and therefore newlines and tabs), refuses a
  // blank value, and refuses leading or trailing whitespace.
  .refine((value) => !/\s{2,}/.test(value), {
    message: 'A taxonomy label must not contain repeated whitespace',
  })
  .refine((value) => TAXONOMY_LABEL_CHARSET.test(value), {
    message:
      'A taxonomy label carries letters (any script), digits, spaces and simple joining characters',
  })
  .refine((value) => !MESSAGE_PUNCTUATION.test(value), {
    message: 'A taxonomy label is a name, not a message: no question marks, quotes or brackets',
  })
  .refine((value) => !URL_SHAPE.test(value), {
    message: 'A taxonomy label must not contain a URL',
  })
  // Contacts, coordinates, map links and credentials — the boundary that actually matters. Applied
  // here as well as at payload level so that the label is safe wherever it is reused.
  .refine((value) => isFreeOfProhibitedContent({ taxonomyLabelValue: value }), {
    message:
      'A taxonomy label must not contain contact details, coordinates, a map link, or a credential',
  });

export type TaxonomyLabel = z.infer<typeof taxonomyLabelSchema>;
