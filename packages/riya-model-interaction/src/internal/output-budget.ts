/**
 * The COMPLETION budget one Riya turn is given (POST-S11 REQUEST-CONTRACT REPAIR).
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
 * ### This budget is OPERATIONAL, and it is not a universal schema bound
 *
 * An earlier revision of this module claimed the budget "covers every schema-legal document". That
 * claim was WRONG, and the way it was wrong is worth writing down because it is easy to repeat.
 *
 * The Riya schema bounds free text with `z.string().max(n)`, and Zod counts **UTF-16 code units**,
 * not bytes. The worst case was measured by filling those fields with ASCII `x`, where one unit is
 * one byte — so the "largest document" was the largest ASCII document, which is not the largest
 * document. Measured against the real schema, the same field limits admit:
 *
 * | free-text fill                        | schema-valid | serialized bytes |
 * | ------------------------------------- | ------------ | ---------------- |
 * | single-byte ASCII                     | yes          | ~28,000          |
 * | astral pair (e.g. emoji)              | yes          | ~45,000          |
 * | three-byte BMP (e.g. Devanagari, CJK) | yes          | ~62,000          |
 * | JSON-escaped control / lone surrogate | yes          | ~112,000         |
 *
 * A control character costs SIX bytes per unit once `JSON.stringify` escapes it, so the true schema
 * maximum is roughly four times the ASCII figure.
 *
 * ### BYTES are not TOKENS, and this module does not pretend otherwise
 *
 * An intermediate revision compared the ~112,000-byte figure against the model's 65,536-TOKEN output
 * ceiling and concluded the schema permits documents the model physically cannot emit. That
 * conclusion was invalid: it compared two different units. A token can represent several bytes, so a
 * larger byte count does not imply a larger token count, and "one token per byte" is not a bound any
 * evidence here establishes.
 *
 * No tokenizer runs in this package, and no governed GPT-OSS-20B tokenizer is present anywhere in
 * this repository or its dependency tree. The token cost of these documents is therefore simply NOT
 * MEASURED, and whether any of them exceeds the model's 65,536-token ceiling is UNRESOLVED. That is
 * an honest gap rather than a failure, and it is deliberately left open instead of being closed with
 * an approximation dressed up as a theorem.
 *
 * ### So what is actually established
 *
 * Byte facts, and one sizing assumption clearly labelled as such:
 *
 * - the measured serialized byte extent of each fill above, every one of them schema-valid;
 * - that the single-byte figure is NOT the universal maximum;
 * - that {@link RIYA_COMPLETION_BUDGET_TOKENS} corresponds to
 *   {@link RIYA_COMPLETION_BUDGET_COVERED_BYTES} serialized bytes UNDER
 *   {@link ASSUMED_BYTES_PER_TOKEN}, which is an operational sizing assumption and not a tokenizer
 *   result;
 * - that this assumed coverage is above the single-byte schema maximum, and below the pathological
 *   one.
 *
 * Nothing here states what any of these documents costs in tokens.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';

import {
  MAX_RIYA_REPLY_BODY_CHARS,
  RIYA_MODEL_PROVENANCES,
  riyaStructuredOutputSchema,
} from './output-schema.js';

/** The schema's own bounds. Everything else is imported rather than restated. */
const MAX_REASON_CODE_CHARS = 64;
const MAX_CITATIONS = 64;
const MAX_KNOWLEDGE_ID_CHARS = 128;
const MAX_CITATION_VERSION = 1_000_000;
const MAX_OBSERVATION_VALUE_CHARS = 2048;
const MAX_QUESTION_FIELDS = 2;
/** The per-array observation ceiling. One per governed discovery field, by array LENGTH only. */
const MAX_OBSERVATION_ITEMS = DISCOVERY_FIELDS_FROZEN.length;

/**
 * How a free-text field is filled when measuring.
 *
 * Not a stylistic choice. Each costs a different number of serialized bytes per UTF-16 unit, which is
 * exactly why the previous ASCII-only measurement was not a maximum.
 */
export const RIYA_FREE_TEXT_FILLS = [
  /** One byte per unit. What a Latin-script reply mostly is. */
  'SINGLE_BYTE_ASCII',
  /** Two bytes per unit. */
  'TWO_BYTE_LATIN',
  /** A surrogate pair: four bytes across two units, so two bytes per unit. */
  'ASTRAL_PAIR',
  /** Three bytes per unit. Devanagari, CJK — the realistic worst case for this product. */
  'THREE_BYTE_BMP',
  /** Six bytes per unit once JSON-escaped. The true schema maximum. */
  'JSON_ESCAPED_CONTROL',
] as const;
export type RiyaFreeTextFill = (typeof RIYA_FREE_TEXT_FILLS)[number];

const FILL_CHARACTER: Readonly<Record<RiyaFreeTextFill, string>> = Object.freeze({
  SINGLE_BYTE_ASCII: 'x',
  TWO_BYTE_LATIN: 'é',
  ASTRAL_PAIR: '\u{1F600}',
  THREE_BYTE_BMP: '一',
  JSON_ESCAPED_CONTROL: '',
});

/** Repeat to exactly `units` UTF-16 code units, which is what the schema bounds. */
function fillToUnits(character: string, units: number): string {
  return character.repeat(Math.ceil(units / character.length)).slice(0, units);
}

/**
 * The member of a closed vocabulary that serialises to the MOST bytes.
 *
 * A maximum has to be selected, not stumbled into. An earlier revision took `[0]`, `.find(...)` and
 * `.slice(0, n)` from these vocabularies, so the "maximum" document quietly carried whichever value
 * happened to be declared first — `user_stated` over `model_inferred`, `INTRO` over
 * `BUDGET_TIMELINE`, one of each discovery field rather than the longest repeated. That is a
 * measurement of an arbitrary document, not of the largest one.
 *
 * Ties break lexicographically so the choice is stable, and the whole function is independent of
 * declaration ORDER — reordering a vocabulary can no longer change what this measures.
 */
function longestOf(values: readonly string[]): string {
  const [longest] = [...values].sort(
    (left, right) =>
      Buffer.byteLength(right, 'utf8') - Buffer.byteLength(left, 'utf8') ||
      left.localeCompare(right),
  );
  if (longest === undefined) {
    throw new Error('QFJ_RIYA_EMPTY_VOCABULARY');
  }
  return longest;
}

/** The phases a MODEL may name as a next step. The schema filters the other three out. */
const MODEL_NAMEABLE_PHASES: readonly string[] = RIYA_CONVERSATION_PHASES.filter(
  (one) => one !== 'CONTACT' && one !== 'CONSENT' && one !== 'COMPLETE',
);

/** The maximising choices, each derived from its governed vocabulary rather than typed. */
export const LONGEST_DISCOVERY_FIELD = longestOf(DISCOVERY_FIELDS_FROZEN);
export const LONGEST_MODEL_PROVENANCE = longestOf(RIYA_MODEL_PROVENANCES);
export const LONGEST_MODEL_NAMEABLE_PHASE = longestOf(MODEL_NAMEABLE_PHASES);

/**
 * The largest document the schema accepts WHEN FREE TEXT USES THIS FILL.
 *
 * Every string is filled to its maximum in UTF-16 units, every array to its maximum length, and every
 * closed vocabulary to its LONGEST member — because a maximum that picked whichever enum happened to
 * be declared first would not be a maximum.
 *
 * Two fields stay ASCII whatever the fill, because their schemas carry an ASCII-only pattern: a
 * non-ASCII `reasonCode` or `knowledgeId` would make the document schema-INVALID, and measuring an
 * invalid document measures nothing. `clears[].provenance` is pinned by the schema to a literal, so
 * it has no longer value to choose.
 */
export function riyaStructuredOutputAtFill(fill: RiyaFreeTextFill): unknown {
  const character = FILL_CHARACTER[fill];
  const ascii = (units: number): string => 'x'.repeat(units);
  const free = (units: number): string => fillToUnits(character, units);
  return {
    reply: {
      kind: 'REPLY',
      replyBody: free(MAX_RIYA_REPLY_BODY_CHARS),
      // ASCII-only by schema pattern.
      reasonCode: ascii(MAX_REASON_CODE_CHARS),
      citations: Array.from({ length: MAX_CITATIONS }, () => ({
        // ASCII-only by schema pattern.
        knowledgeId: ascii(MAX_KNOWLEDGE_ID_CHARS),
        version: MAX_CITATION_VERSION,
      })),
    },
    evolution: {
      version: 1,
      // POST-SDH4: two typed arrays rather than one array of tagged unions, and BOTH are filled to
      // their per-array maxima.
      //
      // An earlier revision left `clears` empty on the reasoning that a CLEAR carries no value and so
      // contributes little. That made the function measure a SUBSET while its own contract claimed
      // "the largest document the schema accepts" — the provider schema bounds the two arrays
      // independently, so a document with both at maximum is schema-valid and strictly larger.
      //
      // Note this maximum is a PROVIDER-schema maximum. The canonical constructor would refuse it,
      // because seven sets plus seven clears exceeds the combined ceiling and repeats every field —
      // which is exactly the cross-array invariant the schema cannot express. Budgeting to the larger
      // provider bound is the conservative direction.
      observations: {
        // The provider schema bounds each array by LENGTH only — it carries no uniqueness
        // constraint, so the largest accepted array repeats the longest field enum rather than
        // naming each field once. Uniqueness is a CANONICAL rule, re-proved later by
        // `createRiyaConversationObservationBatch`, and it is deliberately not smuggled in here to
        // make this number smaller.
        sets: Array.from({ length: MAX_OBSERVATION_ITEMS }, () => ({
          field: LONGEST_DISCOVERY_FIELD,
          value: free(MAX_OBSERVATION_VALUE_CHARS),
          provenance: LONGEST_MODEL_PROVENANCE,
        })),
        clears: Array.from({ length: MAX_OBSERVATION_ITEMS }, () => ({
          field: LONGEST_DISCOVERY_FIELD,
          // Pinned by the schema to this literal, so there is no longer value to choose.
          provenance: 'user_stated',
        })),
      },
      skipProjectDetails: false,
      questionPlan: {
        phase: LONGEST_MODEL_NAMEABLE_PHASE,
        questionFields: Array.from({ length: MAX_QUESTION_FIELDS }, () => LONGEST_DISCOVERY_FIELD),
      },
    },
  };
}

/**
 * Serialized UTF-8 bytes of that document, proven schema-valid first.
 *
 * Throws rather than returning a number if the constructed document does not satisfy the schema: a
 * measurement of something Riya would refuse is not a measurement of anything.
 */
export function maxRiyaStructuredOutputBytesAtFill(fill: RiyaFreeTextFill): number {
  const document = riyaStructuredOutputAtFill(fill);
  if (!riyaStructuredOutputSchema.safeParse(document).success) {
    throw new Error(`QFJ_RIYA_WORST_CASE_OUTPUT_NOT_SCHEMA_VALID_${fill}`);
  }
  return Buffer.byteLength(JSON.stringify(document), 'utf8');
}

/** The schema maximum when free text is single-byte. The figure the budget below is sized to. */
export function maxRiyaStructuredOutputBytesSingleByte(): number {
  return maxRiyaStructuredOutputBytesAtFill('SINGLE_BYTE_ASCII');
}

/**
 * The largest serialized BYTE extent across every fill.
 *
 * Computed rather than assumed, so a fill added to the vocabulary is included automatically. It is a
 * byte measurement and nothing more: its token cost is not measured here, and no claim about the
 * model's capacity is derived from it.
 */
export function maxRiyaStructuredOutputBytesAnyFill(): number {
  return Math.max(...RIYA_FREE_TEXT_FILLS.map((fill) => maxRiyaStructuredOutputBytesAtFill(fill)));
}

/**
 * Bytes per token, ASSUMED for operational sizing.
 *
 * A SIZING ASSUMPTION for operational budgeting. It is not a tokenizer result and not a bound.
 *
 * Byte-pair encoders are commonly observed to average several bytes per token on ASCII JSON, so
 * assuming 2 is intended to be conservative for ordinary text. Nothing in this repository measures
 * it: no tokenizer runs in this process and none is available offline, so how any particular
 * document — especially an unusual Unicode one — actually tokenizes is unknown here.
 *
 * Named and exported so the assumption is reviewable rather than buried in arithmetic, and so a spec
 * can state plainly which claims depend on it and which do not.
 */
export const ASSUMED_BYTES_PER_TOKEN = 2;

/** Rounded UP to a multiple of this, so the governed number is legible rather than arbitrary. */
const ROUNDING_GRANULARITY = 512;

/**
 * The budget that covers the SINGLE-BYTE schema maximum under the assumed ratio.
 *
 * Explicitly the single-byte derivation — the name says so, because the previous name did not, and
 * that is how an ASCII measurement came to be presented as a universal one.
 */
export function deriveSingleByteRiyaCompletionBudgetTokens(): number {
  const bytes = maxRiyaStructuredOutputBytesSingleByte();
  const tokens = Math.ceil(bytes / ASSUMED_BYTES_PER_TOKEN);
  return Math.ceil(tokens / ROUNDING_GRANULARITY) * ROUNDING_GRANULARITY;
}

/**
 * The GOVERNED per-request completion budget for one Riya turn.
 *
 * Pinned as a literal rather than computed at module load, for the same reason the candidate release
 * pins its digests: a number that recomputes itself silently absorbs a schema change somebody should
 * have reviewed. A spec asserts it equals {@link deriveSingleByteRiyaCompletionBudgetTokens}.
 *
 * POST-SDH4 this MOVED, 14,336 -> 14,848, and the move is the pin doing its job. Two corrections to
 * the measurement raised the single-byte provider maximum: filling BOTH observation arrays rather
 * than only `sets`, and selecting the LONGEST member of every closed vocabulary instead of whichever
 * was declared first. The document grew to 28,699 bytes, which is 14,350 tokens at the assumed ratio
 * and rounds up to 14,848.
 *
 * It is NOT held at the old value: that number belonged to a measurement that undercounted what the
 * provider schema actually accepts. Historical S11 and SDH4 receipts keep the budgets they were
 * emitted with; this is the governed budget for post-repair execution.
 *
 * ### What it is
 *
 * An APPLICATION budget. Not a claim about what the model can emit, and it does not lower the
 * provider's model capability ceiling — the two travel separately, which is the repair.
 *
 * ### Its assumed operational coverage
 *
 * {@link RIYA_COMPLETION_BUDGET_COVERED_BYTES} serialized bytes UNDER
 * {@link ASSUMED_BYTES_PER_TOKEN}. That figure is above the schema maximum for single-byte free
 * text, and above a full-length 2,500-unit reply in a three-byte script such as Devanagari — the
 * realistic worst case for this product.
 *
 * This is a sizing statement in bytes under a stated assumption. It is NOT a guarantee that any
 * particular document fits in 14,848 tokens, because nothing here converts a document to tokens.
 *
 * ### Where the assumed coverage runs out
 *
 * The pathological schema-valid document — seven maximal observation values and a maximal reply body
 * of JSON-escaped control characters — serialises to substantially more bytes than the assumed
 * coverage above. Its TOKEN cost has not been established by this offline phase, and whether it
 * exceeds the model's 65,536-token capability ceiling is therefore UNRESOLVED without exact governed
 * tokenizer evidence.
 *
 * What follows from that is bounded: for such a document the budget may be too small, in which case a
 * truncated answer becomes malformed strict JSON and the gateway refuses it as invalid structured
 * output rather than accepting it. Narrowing that gap would mean contracting the citation and
 * observation array maxima in Riya's output contract — an owner decision about behaviour,
 * deliberately not taken here.
 */
export const RIYA_COMPLETION_BUDGET_TOKENS = 14_848;

/** The serialized-byte coverage the budget buys under the assumed ratio. Derived, never typed. */
export const RIYA_COMPLETION_BUDGET_COVERED_BYTES =
  RIYA_COMPLETION_BUDGET_TOKENS * ASSUMED_BYTES_PER_TOKEN;
