/**
 * The DEFAULT structured-output profile: one strict-projectable model-wire shape for every agent that
 * does not configure its own (JF-5B-R2, ADR-0152 amendment; the seam is ADR-0099's).
 *
 * ### The defect this closes
 *
 * `structuredReplySchema` is the SEMANTIC contract, and it is right: `REPLY` requires a body, every
 * other kind must omit one, `reasonCode` is optional, extra keys are refused. Until now it was also
 * used verbatim as the model-wire schema — and there the optionality is fatal. A provider-native
 * strict JSON Schema endpoint has no concept of an absent property: every key of every object must
 * appear in `required`. Two of these four did not, so the Groq projector refused the whole document as
 * `malformed-object` BEFORE any transport call, and Anisha and Aarohi could not reach Groq at all.
 *
 * That was discovered by running the real thing rather than a fixture, which is the only way it could
 * have been: every earlier spec exercised this path against a fake invoker that never projected
 * anything.
 *
 * ### The fix, and why it is an encoding change and not a semantic one
 *
 * Semantic optionality is expressed at the WIRE as REQUIRED + NULLABLE, and projected back to ordinary
 * absence. `null` means "no value this turn", which is what an absent key meant; the difference is
 * that the model can now SAY it, and a strict endpoint can express it.
 *
 * Riya's reviewed profile already does exactly this for `reasonCode`, and has since the earlier live
 * lane taught it the same lesson against a real endpoint. This is that pattern, generalised — not a
 * second structured-output framework, not a second reply contract, and not an agent-specific schema.
 * There is ONE wire shape here and every base-profile agent uses it.
 *
 * ### What projection REFUSES rather than repairs
 *
 * A non-`REPLY` that carries a non-null body is REFUSED. Normalising it to absence would let a model
 * attach a reply to an escalation and have the adapter quietly drop it — the caller would see a clean
 * `ESCALATE_TO_HUMAN` and never learn that the model tried to answer. A `REPLY` whose body is `null`
 * is refused for the mirror reason. Both are also refused by the base schema on re-proof; refusing
 * here keeps the wire contract self-describing rather than leaning on a later gate.
 *
 * Nothing else is normalised. Citations cross verbatim and are authorised downstream exactly as
 * before, and a malformed or out-of-bounds value is a refusal, never a repair.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

import { STRUCTURED_REPLY_KINDS } from './reply-schema.js';
import type { ModelReplyStructuredOutputProfile } from './structured-output-profile.js';

/**
 * The bounds, restated from the semantic schema deliberately.
 *
 * They are the SAME numbers, and they must stay the same numbers: a wire that accepted a longer body
 * than the semantic schema allows would produce answers the re-proof then threw away, which is a
 * wasted call and a confusing failure. A spec asserts both sides agree.
 */
const MAX_REPLY_BODY_CHARS = 8192;
const MAX_REASON_CODE_CHARS = 64;
const MAX_CITATIONS = 64;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);

/**
 * The model-facing shape. Every property REQUIRED; the two semantically-optional ones NULLABLE.
 *
 * `.strict()` is load-bearing here exactly as it is on the semantic schema: it renders to
 * `additionalProperties: false`, which is what a strict endpoint needs, and it is what makes a
 * chain-of-thought field or a smuggled instruction a refusal rather than a dropped key.
 */
export const genericReplyWireSchema = z
  .object({
    kind: z.enum(STRUCTURED_REPLY_KINDS),
    // REQUIRED and nullable, not optional. `null` is how this wire says "no body this turn".
    replyBody: z.string().min(1).max(MAX_REPLY_BODY_CHARS).nullable(),
    reasonCode: z
      .string()
      .min(1)
      .max(MAX_REASON_CODE_CHARS)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .nullable(),
    citations: z
      .array(z.object({ knowledgeId: IDENTIFIER, version: VERSION }).strict())
      .max(MAX_CITATIONS),
  })
  .strict();

/** The wire value, for a caller that needs to name the shape. Never the semantic reply. */
export type GenericReplyWire = z.infer<typeof genericReplyWireSchema>;

/**
 * The profile every agent without a configured one uses.
 *
 * `buildUserContent` is byte-for-byte what the no-profile path always sent — the plan's normalized
 * text, or an empty string. The system message is untouched, as a profile may never touch it.
 */
export const DEFAULT_STRUCTURED_OUTPUT_PROFILE: ModelReplyStructuredOutputProfile = Object.freeze({
  structuredSchema: genericReplyWireSchema,

  buildUserContent(plan: ReplyPlan): string {
    return plan.normalizedText ?? '';
  },

  projectStructuredResult(value: unknown) {
    const parsed = genericReplyWireSchema.safeParse(value);
    if (!parsed.success) {
      return undefined;
    }
    const wire = parsed.data;
    // REFUSED, not normalised. See the header: a dropped body is a body nobody is told about.
    if (wire.kind !== 'REPLY' && wire.replyBody !== null) {
      return undefined;
    }
    if (wire.kind === 'REPLY' && wire.replyBody === null) {
      return undefined;
    }
    return {
      reply: Object.freeze({
        kind: wire.kind,
        // null -> ABSENT. The provider-neutral `StructuredReply` is byte-for-byte what it was.
        ...(wire.replyBody === null ? {} : { replyBody: wire.replyBody }),
        ...(wire.reasonCode === null ? {} : { reasonCode: wire.reasonCode }),
        citations: Object.freeze(wire.citations.map((one) => Object.freeze({ ...one }))),
      }),
    };
  },
});
