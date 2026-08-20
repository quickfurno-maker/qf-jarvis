/**
 * The COMPLETION budget one Riya turn is given (POST-OAD2 OPERATIONAL BUDGET REPAIR).
 *
 * ### The headline: this budget is CHOSEN, not computed
 *
 * Everything below the budget constant in this file measures how large a schema-legal Riya document
 * can get. That is DIAGNOSTIC / CAPACITY ANALYSIS. It is NOT the request-budget policy, and an
 * earlier revision made exactly that mistake: it derived the governed operational budget from the
 * largest document the schema would accept, divided by an assumed bytes-per-token ratio.
 *
 * OAD2 falsified the result. Running the KNOWN-GOOD MINIMAL STRICT CONTROL — no Riya schema involved
 * at all — at `max_completion_tokens=14,848` on the current candidate path returned **HTTP 413**. The
 * repaired Riya schema never reached the wire, so nothing about the schema, the observation split or
 * the projection is implicated. What was refused was the ENVELOPE.
 *
 * That is consistent with S11, which ran the same minimal control at two budgets: 512 returned
 * HTTP 200 and 65,536 returned HTTP 413. It is NOT the claim that Groq caps output at some universal
 * figure — GPT-OSS-20B is advertised with a 131,072-token context and 65,536 max output tokens, and
 * this file does not contradict that. The constrained quantity is the APPLICATION REQUEST BUDGET on
 * this candidate path.
 *
 * So the budget is now an OWNER-SELECTED OPERATIONAL LAUNCH VALUE, pinned as a literal, deliberately
 * decoupled from the maximum-document sizing below it. Sizing a request envelope to the largest
 * document a validator would tolerate was the design error; a concise WhatsApp sales agent does not
 * need a document-generator's envelope.
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
 *   {@link RIYA_COMPLETION_BUDGET_ASSUMED_BYTES} serialized bytes UNDER
 *   {@link ASSUMED_BYTES_PER_TOKEN}, which is an operational sizing assumption and not a tokenizer
 *   result;
 * - that this assumed byte extent is BELOW every schema maximum measured here, which is a
 *   consequence of the decoupling rather than an oversight.
 *
 * Nothing here states what any of these documents costs in tokens, and nothing here derives the
 * governed budget from any of them.
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
 * DIAGNOSTIC ONLY. The token count that would cover the SINGLE-BYTE schema maximum under the assumed
 * ratio.
 *
 * This function used to define {@link RIYA_COMPLETION_BUDGET_TOKENS}. It no longer does, and it must
 * not again: OAD2 refused the envelope this sizing produced, at the minimal control, before any Riya
 * schema was sent. Sizing a request budget to the largest document a validator tolerates is the
 * design error the repair removes.
 *
 * It is kept because the CAPACITY question is still worth being able to ask — "how big could this get
 * in principle" is useful when reasoning about truncation risk. It is simply not the policy.
 *
 * A spec asserts the governed budget is a numeric literal rather than a call to this function, so
 * reconnecting the two cannot happen quietly.
 */
export function deriveSingleByteRiyaCompletionBudgetTokens(): number {
  const bytes = maxRiyaStructuredOutputBytesSingleByte();
  const tokens = Math.ceil(bytes / ASSUMED_BYTES_PER_TOKEN);
  return Math.ceil(tokens / ROUNDING_GRANULARITY) * ROUNDING_GRANULARITY;
}

/**
 * The GOVERNED per-request completion budget for one Riya turn.
 *
 * ### An OWNER-SELECTED OPERATIONAL LAUNCH BUDGET
 *
 * A literal, chosen by the owner, pinned here. It is deliberately NOT computed from anything in this
 * file, and a spec asserts the declaration is a numeric literal rather than a call.
 *
 * It is NOT a tokenizer theorem, NOT the schema maximum, NOT the model maximum, NOT a new model
 * capability, and NOT a guarantee that every schema-valid document fits inside it.
 *
 * ### Why it moved, 14,848 -> 4,096
 *
 * The previous value was `deriveSingleByteRiyaCompletionBudgetTokens()`: the single-byte schema
 * maximum of 28,699 bytes, halved by the assumed ratio and rounded up. OAD2 put that envelope on the
 * wire carrying the KNOWN-GOOD MINIMAL STRICT CONTROL — the Riya schema was not involved — and the
 * provider answered HTTP 413. The stop rule then correctly refused to spend the remaining probes.
 *
 * So the old number was not merely generous, it was not accepted. The repair is to stop deriving an
 * operational envelope from a validator's tolerance at all.
 *
 * ### Why 4,096
 *
 * The product is a concise WhatsApp sales agent, not a document generator. The schema's ceilings —
 * a 2,500-character reply body, 64 citations, seven SET and seven CLEAR observations with 2,048
 * character values — are VALIDATION bounds, not a target response size. 4,096 is the conservative
 * launch budget selected to bound a normal one-turn answer with headroom.
 *
 * It is not claimed to be optimal. Later quality or load evidence may justify moving it either way,
 * and the next separately-authorized acceptance run tests THIS number empirically before safety.
 *
 * ### What it is
 *
 * An APPLICATION budget. Not a claim about what the model can emit, and it does not lower the
 * provider's model capability ceiling — the two travel separately, which was the S11 repair and
 * still holds. The provider clamps request budget against capability ceiling.
 *
 * ### What it does NOT assume-cover, stated plainly
 *
 * {@link RIYA_COMPLETION_BUDGET_ASSUMED_BYTES} serialized bytes under
 * {@link ASSUMED_BYTES_PER_TOKEN} — which is BELOW every schema maximum measured in this file,
 * including the single-byte one at 28,699 bytes. A maximal 2,500-unit reply body in a three-byte
 * script is 7,500 bytes of that figure on its own, before the surrounding envelope.
 *
 * That is the decoupling working as intended rather than a defect, and the consequence is bounded and
 * worth naming: a response that would need more than the budget is truncated, truncated strict JSON
 * is malformed, and the gateway REFUSES it as invalid structured output rather than accepting a
 * partial answer. It fails closed. Whether real Riya turns approach that limit is an empirical
 * question for the next acceptance run and the quality evidence after it — not something this file
 * can settle.
 */
export const RIYA_COMPLETION_BUDGET_TOKENS = 4_096;

/**
 * The serialized-byte extent the budget corresponds to under the assumed ratio. Derived, never typed.
 *
 * Renamed from `..._COVERED_BYTES`: with the budget decoupled from schema sizing this figure no
 * longer COVERS any schema maximum, and a name asserting coverage would be false.
 */
export const RIYA_COMPLETION_BUDGET_ASSUMED_BYTES =
  RIYA_COMPLETION_BUDGET_TOKENS * ASSUMED_BYTES_PER_TOKEN;
