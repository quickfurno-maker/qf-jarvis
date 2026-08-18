/**
 * POST-S11 REQUEST-CONTRACT REPAIR — what the Riya completion budget actually covers.
 *
 * S11 proved the exact request path is sensitive to the production high completion cap: D1 (minimal
 * strict schema, tiny messages, 512) returned HTTP 200 and D2 (identical but 65,536) returned HTTP
 * 413. The repair is not to lower the model's published capability — it is to stop every invocation
 * asking for the whole of it.
 *
 * ### These specs exist because this proof has been wrong twice
 *
 * The FIRST version filled free-text fields with ASCII `x`, measured UTF-8 bytes, and concluded the
 * budget "covers every schema-legal document". Zod bounds strings by UTF-16 code unit, not by byte,
 * so an ASCII fill is the largest ASCII document and not the largest document.
 *
 * The SECOND version fixed that and then compared a serialized BYTE count against the model's
 * 65,536-TOKEN ceiling, concluding the schema permits documents the model cannot emit. That compared
 * two different units: a token can represent several bytes, so a bigger byte count implies nothing
 * about token count.
 *
 * Both mistakes are the same shape — a measurement quietly promoted into a guarantee it does not
 * support. So these specs assert byte facts as byte facts, label the one sizing assumption as an
 * assumption, and include a structural guard that fails if a future edit compares a byte quantity
 * against a token quantity again.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/**
 * The model's published output ceiling, in TOKENS.
 *
 * It may only ever be compared against another TOKEN quantity. Comparing it against a serialized byte
 * count is the exact error the guard at the bottom of this file exists to prevent.
 */
const MODEL_OUTPUT_CEILING_TOKENS = 65_536;

/** The module under test, and this spec, read as text by the unit guard at the bottom of the file. */
const MODULE_PATH = fileURLToPath(new URL('../internal/output-budget.ts', import.meta.url));
const SPEC_PATH = fileURLToPath(import.meta.url);

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

  it('its assumed byte coverage runs out before the pathological schema-valid document', () => {
    // A byte-to-byte comparison, which is the only kind these two quantities support. It says the
    // assumed coverage is smaller than that document's serialized size; it says NOTHING about how
    // many tokens either one costs.
    expect(RIYA_COMPLETION_BUDGET_COVERED_BYTES).toBeLessThan(
      maxRiyaStructuredOutputBytesAnyFill(),
    );
  });

  it('is far below the model capability ceiling, which is the whole point', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeLessThan(MODEL_OUTPUT_CEILING_TOKENS / 2);
  });
});

describe('the byte-to-token relationship is UNRESOLVED, and stays that way', () => {
  it('no governed tokenizer is available to this package', () => {
    // Stated as an executable fact rather than a comment. Nothing in this module imports a tokenizer,
    // and a search of the repository and its dependency tree found no GPT-OSS-20B tokenizer package,
    // manifest entry, or vocab/merges artifact. So the token cost of every fixture above is simply
    // not measured here.
    const source = readFileSync(MODULE_PATH, 'utf8');
    for (const forbidden of ['tiktoken', 'sentencepiece', 'AutoTokenizer', 'encode(']) {
      expect(source, `output-budget must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the assumed ratio is labelled an assumption, not a bound', () => {
    // 2 bytes/token is used ONLY for operational sizing. No claim in this file depends on it being
    // a tokenizer result, and the module comment says so in those words.
    expect(ASSUMED_BYTES_PER_TOKEN).toBe(2);
    const source = readFileSync(MODULE_PATH, 'utf8');
    expect(source).toContain('SIZING ASSUMPTION');
    expect(source).toContain('UNRESOLVED');
  });

  it('makes no claim that the model cannot emit any schema-valid document', () => {
    // The retracted claim, pinned as absent. The module may DESCRIBE having withdrawn it — that text
    // is the record of the correction — but it must not assert it as a present-tense finding.
    const source = readFileSync(MODULE_PATH, 'utf8');
    expect(source).not.toContain('no budget can carry');
    expect(source).not.toContain('floor for any tokenizer');
    expect(source).not.toContain('and none could be');
  });

  it('token-quantity comparisons stay token-to-token', () => {
    // The one legitimate use of the ceiling: budget and ceiling are both token counts.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeLessThan(MODEL_OUTPUT_CEILING_TOKENS);
  });
});

describe('GUARD — a byte quantity may never be ORDER-COMPARED against a token quantity', () => {
  /**
   * The regression this whole review round exists to prevent.
   *
   * A future edit could reintroduce `expect(someBytes).toBeGreaterThan(SOMETHING_TOKENS)` and present
   * it as proof of model incapacity. This scans both the budget module and this spec file for an
   * ORDERING comparison whose two sides are named in different units.
   *
   * Equality and multiplication are deliberately NOT flagged: `COVERED_BYTES === TOKENS * RATIO` is a
   * unit CONVERSION through the declared assumption, which is exactly how the two are allowed to meet.
   */
  const ORDERING_MATCHERS = [
    'toBeGreaterThan',
    'toBeGreaterThanOrEqual',
    'toBeLessThan',
    'toBeLessThanOrEqual',
  ];

  const withoutComments = (text: string): string =>
    text
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//u.test(line))
      .join('\n');

  /** Collapse to one line so a prettier-wrapped assertion is still one searchable expression. */
  const flatten = (text: string): string => withoutComments(text).replace(/\s+/gu, ' ');

  const BYTES = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:BYTES|Bytes)[A-Za-z0-9_]*`;
  const TOKENS = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:TOKENS|Tokens)[A-Za-z0-9_]*`;

  it.each([
    ['the budget module', MODULE_PATH],
    ['this spec file', SPEC_PATH],
  ])('%s order-compares no byte quantity against a token quantity', (_label, path) => {
    const flat = flatten(readFileSync(path, 'utf8'));
    for (const matcher of ORDERING_MATCHERS) {
      // expect(<...Bytes...>).toBeGreaterThan(<...TOKENS...>) and the mirror image.
      const bytesThenTokens = new RegExp(
        String.raw`expect\(\s*${BYTES}[^;]*?\.${matcher}\(\s*${TOKENS}`,
        'u',
      );
      const tokensThenBytes = new RegExp(
        String.raw`expect\(\s*${TOKENS}[^;]*?\.${matcher}\(\s*${BYTES}`,
        'u',
      );
      expect(bytesThenTokens.test(flat), `${matcher}: bytes compared against tokens`).toBe(false);
      expect(tokensThenBytes.test(flat), `${matcher}: tokens compared against bytes`).toBe(false);
    }
    // And the bare-operator form, e.g. `someBytes > SOMETHING_TOKENS`.
    for (const [left, right] of [
      [BYTES, TOKENS],
      [TOKENS, BYTES],
    ]) {
      const bare = new RegExp(String.raw`${left}(?:\(\))?\s*[<>]=?\s*${right}`, 'u');
      expect(bare.test(flat), 'bare operator compared across units').toBe(false);
    }
  });

  it('the guard actually fires on the retracted assertion', () => {
    // A guard nobody has seen fail is a guard nobody can trust. This is the exact expression the
    // previous revision shipped.
    // Assembled from fragments rather than written out, so the fixture does not trip the guard
    // scanning THIS file. That the guard would otherwise flag it is the point being demonstrated.
    const bytesSide = ['maxRiyaStructuredOutputBytes', 'AnyFill()'].join('');
    const tokensSide = ['MODEL_OUTPUT_CEILING_', 'TOKENS'].join('');
    const offending = `expect(${bytesSide}).toBeGreaterThan(${tokensSide});`;
    const pattern = new RegExp(
      String.raw`expect\(\s*${BYTES}[^;]*?\.toBeGreaterThan\(\s*${TOKENS}`,
      'u',
    );
    expect(pattern.test(offending.replace(/\s+/gu, ' '))).toBe(true);
  });
});
