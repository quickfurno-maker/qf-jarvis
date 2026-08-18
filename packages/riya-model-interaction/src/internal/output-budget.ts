/**
 * The COMPLETION budget one Riya turn actually needs (POST-S11 REQUEST-CONTRACT REPAIR).
 *
 * ### What S11 established, and what it did not
 *
 * The S11 differential canary ran D1 and D2 against the same minimal strict schema and the same tiny
 * messages, differing only in `max_completion_tokens`. D1 at 512 returned HTTP 200; D2 at 65,536
 * returned HTTP 413. So the exact request path IS sensitive to the production high completion cap.
 *
 * That is NOT the finding "Groq never supports 65,536 output tokens" — the model-level maximum is a
 * real published capability and this file does not contradict it. It is the narrower and more useful
 * finding that a MODEL CAPABILITY CEILING and an APPLICATION REQUEST BUDGET are different numbers,
 * and that the candidate path had only the first. Every invocation therefore asked for the entire
 * model allowance regardless of how small the answer could possibly be.
 *
 * ### The number is DERIVED, not chosen
 *
 * 512 is not adopted merely because D1 happened to use it. The budget below is computed from the
 * Riya structured output schema's OWN maxima: the largest JSON document the schema can accept is
 * constructed here, validated against the real schema so it cannot drift into being invalid, measured
 * in UTF-8 bytes, and converted to tokens under a deliberately pessimistic ratio.
 *
 * If the schema gains a field or widens a bound, this number moves with it and the pinned constant's
 * spec fails — which is the point. A budget nobody can re-derive is a budget that silently rots.
 */
import {
  MAX_RIYA_REPLY_BODY_CHARS,
  RIYA_MODEL_PROVENANCES,
  riyaStructuredOutputSchema,
} from './output-schema.js';

import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';

/** The schema's own bounds, restated nowhere: every one of these is imported or read from a literal. */
const MAX_REASON_CODE_CHARS = 64;
const MAX_CITATIONS = 64;
const MAX_KNOWLEDGE_ID_CHARS = 128;
const MAX_CITATION_VERSION = 1_000_000;
const MAX_OBSERVATION_VALUE_CHARS = 2048;
const MAX_QUESTION_FIELDS = 2;

/**
 * The LARGEST document the Riya structured schema can accept.
 *
 * Every string is filled to its maximum, every array to its maximum length, and the observation union
 * uses the `SET` branch because it is the one that carries a value. Built rather than hand-measured,
 * and validated below, so "worst case" is a fact about the schema rather than an estimate about it.
 */
export function largestValidRiyaStructuredOutput(): unknown {
  const fill = (length: number, character = 'x'): string => character.repeat(length);
  const provenance = RIYA_MODEL_PROVENANCES[0];
  // A model may not name CONTACT, CONSENT or COMPLETE as a next step; the schema enforces it, so the
  // worst case is drawn from the same filtered vocabulary rather than from a literal.
  const phase = RIYA_CONVERSATION_PHASES.find(
    (one) => one !== 'CONTACT' && one !== 'CONSENT' && one !== 'COMPLETE',
  );
  return {
    reply: {
      kind: 'REPLY',
      replyBody: fill(MAX_RIYA_REPLY_BODY_CHARS),
      reasonCode: fill(MAX_REASON_CODE_CHARS),
      citations: Array.from({ length: MAX_CITATIONS }, () => ({
        knowledgeId: fill(MAX_KNOWLEDGE_ID_CHARS),
        version: MAX_CITATION_VERSION,
      })),
    },
    evolution: {
      version: 1,
      observations: DISCOVERY_FIELDS_FROZEN.map((field) => ({
        field,
        operation: 'SET',
        value: fill(MAX_OBSERVATION_VALUE_CHARS),
        provenance,
      })),
      skipProjectDetails: false,
      questionPlan: {
        phase,
        questionFields: DISCOVERY_FIELDS_FROZEN.slice(0, MAX_QUESTION_FIELDS),
      },
    },
  };
}

/**
 * The worst case, in UTF-8 bytes, proven valid against the real schema.
 *
 * Throws rather than returning a number if the constructed document does not satisfy the schema: a
 * measurement of something the schema would reject is not a measurement of the worst case.
 */
export function maxRiyaStructuredOutputBytes(): number {
  const largest = largestValidRiyaStructuredOutput();
  const parsed = riyaStructuredOutputSchema.safeParse(largest);
  if (!parsed.success) {
    throw new Error('QFJ_RIYA_WORST_CASE_OUTPUT_NOT_SCHEMA_VALID');
  }
  return Buffer.byteLength(JSON.stringify(largest), 'utf8');
}

/**
 * Bytes per token, assumed PESSIMISTICALLY.
 *
 * Byte-pair encoders average roughly 3.5-4 bytes per token on ASCII JSON. Assuming 2 therefore
 * roughly doubles the token estimate, which is the correct direction to be wrong in: a budget that is
 * too small truncates a legitimate answer, and truncation would look like a model quality failure.
 * It is stated as a named constant so the assumption is reviewable rather than buried in arithmetic.
 */
export const PESSIMISTIC_BYTES_PER_TOKEN = 2;

/**
 * Rounded UP to a multiple of this, so the governed number is legible rather than arbitrary.
 *
 * There is deliberately NO separate headroom multiplier. An earlier draft stacked a 1.5x margin on
 * top of the pessimistic ratio above, which produced roughly three times the realistic requirement
 * and is the opposite of "the smallest safe budget". The ratio already carries the safety, and the
 * one risk a multiplier was meant to cover — a schema field added between two reviews — is covered
 * better by the spec that pins the constant to this derivation and fails loudly when it moves.
 */
const ROUNDING_GRANULARITY = 512;

/** Compute the budget from the schema. Pure and deterministic. */
export function deriveRiyaCompletionBudgetTokens(): number {
  const bytes = maxRiyaStructuredOutputBytes();
  const tokens = Math.ceil(bytes / PESSIMISTIC_BYTES_PER_TOKEN);
  return Math.ceil(tokens / ROUNDING_GRANULARITY) * ROUNDING_GRANULARITY;
}

/**
 * The GOVERNED per-request completion budget for one Riya turn.
 *
 * Pinned as a literal rather than computed at module load, for the same reason the candidate release
 * pins its digests: a number that recomputes itself silently absorbs a schema change that somebody
 * should have reviewed. A spec asserts this equals {@link deriveRiyaCompletionBudgetTokens}, so a
 * schema change fails loudly here instead of quietly re-budgeting production.
 *
 * This is an APPLICATION budget. It is NOT a claim about what the model can emit, and it does not
 * replace or lower the provider's model capability ceiling — the two now travel separately, which is
 * the whole repair.
 *
 * ### What dominates it, and what would shrink it
 *
 * Roughly nine tenths of the measured worst case is two arrays the schema permits but a real turn
 * never fills: 64 citations at a 128-character identifier each, and one 2,048-character observation
 * value per governed discovery field. A realistic Riya answer is a few thousand bytes.
 *
 * Budgeting to the SCHEMA maximum rather than to the realistic case is deliberate. Truncating a
 * schema-legal answer yields malformed strict JSON, which would surface as a model quality failure
 * and would be exactly the kind of false signal this whole phase exists to remove. If this number
 * should be smaller, the honest lever is tightening those array bounds in the Riya output contract —
 * an owner decision about Riya's behaviour, not a request-contract repair, and therefore out of
 * scope here.
 */
export const RIYA_COMPLETION_BUDGET_TOKENS = 14_336;
