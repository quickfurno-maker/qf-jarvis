/**
 * Role output schemas, and the boundary where model output stops being untrusted (AS2, ADR-0143).
 *
 * ### `JSON.parse` is not authority
 *
 * A payload that parses is a payload that is syntactically JSON. It is not a customer turn. Between
 * "this parsed" and "this is a turn" sit: unknown keys, missing keys, wrong enum members, a teacher
 * that wrote the customer's line, an assistant reply carrying a reasoning trace. Each of those is a
 * corpus defect that no downstream gate is guaranteed to catch, because by then it looks like data
 * somebody meant to write.
 *
 * So every schema here is `.strict()` — an unknown key FAILS rather than being dropped. A model that
 * invented a field was doing something the contract did not ask for, and silently discarding it hides
 * the fact that the instruction and the schema have drifted apart.
 *
 * ### Bounded before parsed
 *
 * The payload has a length ceiling checked before `JSON.parse` runs. A model that returns megabytes
 * is a failure, not an input, and finding that out after allocating it is finding out too late.
 */
import { z } from 'zod';

import {
  RIYA_DATASET_ASSISTANT_DECISIONS,
  RIYA_DATASET_DISCOVERY_FIELDS,
  RIYA_DATASET_QUALITY_DIMENSIONS,
  RIYA_DATASET_RESPONSE_OBJECTIVES,
} from '@qf-jarvis/riya-intelligence-dataset';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';

import { RiyaSyntheticGenerationError } from './errors.js';

/** A model response larger than this is a failure, not an input. */
export const RIYA_SYNTHETIC_MAX_PAYLOAD_CHARS = 32_000;

const TURN_TEXT = z.string().min(1).max(4_000);
const DISCOVERY = z.enum(RIYA_DATASET_DISCOVERY_FIELDS as readonly [string, ...string[]]);

/**
 * What the customer simulator returns. USER side only.
 *
 * There is no `assistantText` field, and there cannot be one: the schema is strict, so a simulator
 * that tried to write Riya's reply fails the parse instead of quietly contributing half a
 * conversation it was never asked for.
 */
export const customerTurnOutputSchema = z
  .object({
    userText: TURN_TEXT,
    revealedFields: z.array(DISCOVERY).max(RIYA_DATASET_DISCOVERY_FIELDS.length),
    behaviorEvents: z.array(z.string().min(1).max(64)).max(8),
    wantsHuman: z.boolean().optional(),
    endsConversation: z.boolean().optional(),
  })
  .strict();
export type RiyaSyntheticCustomerTurnOutput = z.infer<typeof customerTurnOutputSchema>;

/**
 * What the Riya teacher returns. ASSISTANT side only, one turn.
 *
 * No `userText`, and no reasoning field. ADR-0107 §10 refused a hidden reasoning field in the corpus
 * for a reason that applies just as hard here: a trace nobody reviews is a confidently wrong
 * explanation that looks exactly like a good one.
 */
export const teacherTurnOutputSchema = z
  .object({
    assistantText: TURN_TEXT,
    annotation: z
      .object({
        decision: z.enum(RIYA_DATASET_ASSISTANT_DECISIONS),
        responseObjective: z.enum(RIYA_DATASET_RESPONSE_OBJECTIVES),
        askedDiscoveryFields: z.array(DISCOVERY).max(RIYA_DATASET_DISCOVERY_FIELDS.length),
        supportedFactRefs: z
          .array(
            z
              .string()
              .min(1)
              .max(128)
              .regex(/^[A-Za-z0-9._:-]+$/),
          )
          .max(32),
        expectedPhaseAfter: z.enum(RIYA_CONVERSATION_PHASES).optional(),
      })
      .strict(),
  })
  .strict();
export type RiyaSyntheticTeacherTurnOutput = z.infer<typeof teacherTurnOutputSchema>;

/** What the annotation verifier returns. Closed codes, no prose. */
export const verifierOutputSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED']),
    failedChecks: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export type RiyaSyntheticVerifierOutput = z.infer<typeof verifierOutputSchema>;

/**
 * What a critic returns.
 *
 * No rationale, no score, no confidence. AS1 §10: with no number there is nothing to average, so a
 * failed hard gate cannot be smoothed away by three cheerful opinions.
 */
export const criticOutputSchema = z
  .object({
    decision: z.enum(['ACCEPTED', 'REJECTED']),
    satisfiedQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length),
    failedQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length)
      .optional(),
  })
  .strict();
export type RiyaSyntheticCriticOutput = z.infer<typeof criticOutputSchema>;

/**
 * Parse one untrusted payload against one strict schema. Fails CLOSED.
 *
 * Throws `invalid-model-output` when the bytes are not usable JSON at all — the repairable case —
 * and `output-schema-mismatch` when they parsed but were not the shape asked for. The two are
 * separated because only the first is worth one bounded repair attempt: a model that returned a
 * well-formed object with the wrong enum member is not going to be fixed by being asked again in the
 * same words.
 */
export function parseRiyaSyntheticModelOutput<T>(payload: string, schema: z.ZodType<T>): T {
  if (payload.length === 0 || payload.length > RIYA_SYNTHETIC_MAX_PAYLOAD_CHARS) {
    throw new RiyaSyntheticGenerationError('invalid-model-output');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new RiyaSyntheticGenerationError('invalid-model-output');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('output-schema-mismatch');
  }
  return parsed.data;
}
