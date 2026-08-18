/**
 * POST-S11 REQUEST-CONTRACT REPAIR — what the Riya completion budget actually covers.
 *
 * S11 proved the exact request path is sensitive to the production high completion cap: D1 (minimal
 * strict schema, tiny messages, 512) returned HTTP 200 and D2 (identical but 65,536) returned HTTP
 * 413. The repair is not to lower the model's published capability — it is to stop every invocation
 * asking for the whole of it.
 *
 * ### These specs exist because the first version of this proof was wrong
 *
 * It filled free-text fields with ASCII `x`, measured UTF-8 bytes, and concluded that the resulting
 * budget "covers every schema-legal document". Zod bounds strings by UTF-16 code unit, not by byte,
 * so an ASCII fill is the largest ASCII document and not the largest document. The adversarial cases
 * below exist so that mistake cannot be made again silently: they pin the real byte extent of every
 * fill, and they pin which of them the budget does and does NOT carry.
 */
import { describe, expect, it } from 'vitest';

import {
  ASSUMED_BYTES_PER_TOKEN,
  deriveSingleByteRiyaCompletionBudgetTokens,
  maxRiyaStructuredOutputBytesAnyFill,
  maxRiyaStructuredOutputBytesAtFill,
  maxRiyaStructuredOutputBytesSingleByte,
  RIYA_COMPLETION_BUDGET_COVERED_BYTES,
  RIYA_COMPLETION_BUDGET_TOKENS,
  RIYA_FREE_TEXT_FILLS,
  riyaStructuredOutputAtFill,
} from '../internal/output-budget.js';
import { riyaStructuredOutputSchema } from '../internal/output-schema.js';

/** The model's published output ceiling. Stated here so the gap below is legible without an import. */
const MODEL_OUTPUT_CEILING_TOKENS = 65_536;

describe('every fill produces a document the real schema accepts', () => {
  it.each([...RIYA_FREE_TEXT_FILLS])('%s is schema-valid at full length', (fill) => {
    // If a fill were invalid, its byte measurement would describe something Riya refuses.
    expect(riyaStructuredOutputSchema.safeParse(riyaStructuredOutputAtFill(fill)).success).toBe(
      true,
    );
  });

  it.each([...RIYA_FREE_TEXT_FILLS])('%s fills every bounded field to its maximum', (fill) => {
    const largest = riyaStructuredOutputAtFill(fill) as {
      reply: { replyBody: string; reasonCode: string; citations: unknown[] };
      evolution: { observations: unknown[]; questionPlan: { questionFields: unknown[] } };
    };
    // UTF-16 code units, because that is the unit the schema bounds.
    expect(largest.reply.replyBody).toHaveLength(2500);
    expect(largest.reply.reasonCode).toHaveLength(64);
    expect(largest.reply.citations).toHaveLength(64);
    expect(largest.evolution.observations).toHaveLength(7);
    expect(largest.evolution.questionPlan.questionFields).toHaveLength(2);
  });
});

describe('ADVERSARIAL — an ASCII fill is not the schema maximum', () => {
  it('non-ASCII fills serialise to strictly more bytes at identical unit lengths', () => {
    const ascii = maxRiyaStructuredOutputBytesAtFill('SINGLE_BYTE_ASCII');
    // Same field lengths, same array counts, same schema — only the characters differ.
    for (const fill of ['TWO_BYTE_LATIN', 'ASTRAL_PAIR', 'THREE_BYTE_BMP'] as const) {
      expect(maxRiyaStructuredOutputBytesAtFill(fill), fill).toBeGreaterThan(ascii);
    }
  });

  it('a JSON-escaped control character is the true worst case, several times ASCII', () => {
    const ascii = maxRiyaStructuredOutputBytesAtFill('SINGLE_BYTE_ASCII');
    const worst = maxRiyaStructuredOutputBytesAtFill('JSON_ESCAPED_CONTROL');
    // Six serialized bytes per unit once escaped, against one for ASCII.
    expect(worst).toBeGreaterThan(ascii * 3);
    expect(maxRiyaStructuredOutputBytesAnyFill()).toBe(worst);
  });

  it('a three-byte script — the realistic worst case here — roughly doubles the ASCII figure', () => {
    const ascii = maxRiyaStructuredOutputBytesAtFill('SINGLE_BYTE_ASCII');
    const bmp = maxRiyaStructuredOutputBytesAtFill('THREE_BYTE_BMP');
    expect(bmp).toBeGreaterThan(ascii * 2);
  });
});

describe('the governed budget is the SINGLE-BYTE derivation, pinned', () => {
  it('RIYA_COMPLETION_BUDGET_TOKENS equals the single-byte derivation', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(deriveSingleByteRiyaCompletionBudgetTokens());
  });

  it('its coverage is stated in bytes, and derived from the assumption', () => {
    expect(RIYA_COMPLETION_BUDGET_COVERED_BYTES).toBe(
      RIYA_COMPLETION_BUDGET_TOKENS * ASSUMED_BYTES_PER_TOKEN,
    );
  });

  it('COVERS the schema maximum when free text is single-byte', () => {
    expect(RIYA_COMPLETION_BUDGET_COVERED_BYTES).toBeGreaterThanOrEqual(
      maxRiyaStructuredOutputBytesSingleByte(),
    );
  });

  it('COVERS a full-length reply body in a three-byte script with a wide margin', () => {
    // The realistic worst case for this product: a maximal 2,500-unit Devanagari or CJK reply.
    // 2,500 units at three bytes each, plus the surrounding envelope.
    const fullThreeByteReplyBytes = 2500 * 3;
    expect(RIYA_COMPLETION_BUDGET_COVERED_BYTES).toBeGreaterThan(fullThreeByteReplyBytes * 3);
  });

  it('does NOT cover the pathological schema maximum, and says so', () => {
    // Stated as a passing expectation rather than left implicit. The budget is operational; this is
    // the boundary of what it buys, and a future reader should find it asserted rather than inferred.
    expect(RIYA_COMPLETION_BUDGET_COVERED_BYTES).toBeLessThan(
      maxRiyaStructuredOutputBytesAnyFill(),
    );
  });

  it('is far below the model capability ceiling, which is the whole point', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeLessThan(MODEL_OUTPUT_CEILING_TOKENS / 2);
  });
});

describe('no completion budget could cover the schema maximum', () => {
  it('the schema permits documents this model physically cannot emit', () => {
    // THE finding that makes a universal coverage claim impossible rather than merely unmet. At one
    // token per byte — the floor for any tokenizer — the pathological document needs more tokens
    // than the model's entire output ceiling.
    //
    // Closing this means contracting the citation and observation array maxima in Riya's OUTPUT
    // CONTRACT. That is an owner decision about behaviour and is deliberately not taken here.
    expect(maxRiyaStructuredOutputBytesAnyFill()).toBeGreaterThan(MODEL_OUTPUT_CEILING_TOKENS);
  });

  it('the assumed ratio is documented as an assumption, not a proof', () => {
    // 2 bytes/token is conservative for ordinary ASCII JSON and is NOT a proven tokenizer bound for
    // arbitrary Unicode. Nothing in this package runs a tokenizer, so no claim here depends on one.
    expect(ASSUMED_BYTES_PER_TOKEN).toBe(2);
  });
});
