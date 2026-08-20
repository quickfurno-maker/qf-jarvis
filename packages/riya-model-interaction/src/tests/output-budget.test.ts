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
  LONGEST_DISCOVERY_FIELD,
  LONGEST_MODEL_NAMEABLE_PHASE,
  LONGEST_MODEL_PROVENANCE,
  deriveSingleByteRiyaCompletionBudgetTokens,
  maxRiyaStructuredOutputBytesAnyFill,
  maxRiyaStructuredOutputBytesAtFill,
  maxRiyaStructuredOutputBytesSingleByte,
  RIYA_COMPLETION_BUDGET_ASSUMED_BYTES,
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
      evolution: {
        observations: { sets: unknown[]; clears: unknown[] };
        questionPlan: { questionFields: unknown[] };
      };
    };
    // UTF-16 code units, because that is the unit the schema bounds.
    expect(largest.reply.replyBody).toHaveLength(2500);
    expect(largest.reply.reasonCode).toHaveLength(64);
    expect(largest.reply.citations).toHaveLength(64);
    // BOTH arrays at their per-array maxima. An earlier revision left `clears` empty, so the
    // function measured a subset while claiming to be the largest document the schema accepts.
    expect(largest.evolution.observations.sets).toHaveLength(7);
    expect(largest.evolution.observations.clears).toHaveLength(7);
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

describe('the maximum is the PROVIDER-schema maximum, both arrays filled', () => {
  it('the constructed maximum is accepted by the provider schema with both arrays full', () => {
    // The provider schema bounds the two observation arrays independently, so seven sets AND seven
    // clears is schema-valid and strictly larger than seven sets alone.
    const largest = riyaStructuredOutputAtFill('SINGLE_BYTE_ASCII');
    expect(riyaStructuredOutputSchema.safeParse(largest).success).toBe(true);
  });

  it('filling clears strictly increases the measured maximum', () => {
    // Guards the exact regression: dropping `clears` back to empty would shrink this number.
    const largest = riyaStructuredOutputAtFill('SINGLE_BYTE_ASCII') as {
      evolution: { observations: { clears: unknown[] } };
    };
    const withoutClears = JSON.parse(JSON.stringify(largest)) as typeof largest;
    withoutClears.evolution.observations.clears = [];
    expect(Buffer.byteLength(JSON.stringify(largest), 'utf8')).toBeGreaterThan(
      Buffer.byteLength(JSON.stringify(withoutClears), 'utf8'),
    );
  });

  it('this is a PROVIDER maximum; the canonical constructor would refuse it', () => {
    // Seven sets plus seven clears exceeds the combined canonical ceiling and repeats every field.
    // That is the cross-array invariant the schema cannot express, and budgeting to the larger
    // provider bound is the conservative direction — stated here so nobody reads the number as a
    // canonical-domain maximum.
    const largest = riyaStructuredOutputAtFill('SINGLE_BYTE_ASCII') as {
      evolution: { observations: { sets: unknown[]; clears: unknown[] } };
    };
    expect(
      largest.evolution.observations.sets.length + largest.evolution.observations.clears.length,
    ).toBeGreaterThan(7);
  });
});

describe('every closed vocabulary is filled to its LONGEST member', () => {
  interface MaxDoc {
    readonly evolution: {
      readonly observations: {
        readonly sets: readonly { readonly field: string; readonly provenance: string }[];
        readonly clears: readonly { readonly field: string; readonly provenance: string }[];
      };
      readonly questionPlan: { readonly phase: string; readonly questionFields: readonly string[] };
    };
  }
  const doc = (): MaxDoc => riyaStructuredOutputAtFill('SINGLE_BYTE_ASCII') as MaxDoc;

  it('the maximising choices are the longest members of their vocabularies', () => {
    expect(LONGEST_DISCOVERY_FIELD).toBe('consultationPreference');
    expect(LONGEST_MODEL_PROVENANCE).toBe('model_inferred');
    // A model may not name CONTACT, CONSENT or COMPLETE, so the phase is drawn from the filtered set.
    expect(LONGEST_MODEL_NAMEABLE_PHASE.length).toBe(15);
  });

  it('every SET field and provenance is maximised', () => {
    const sets = doc().evolution.observations.sets;
    expect(sets).toHaveLength(7);
    for (const one of sets) {
      expect(one.field).toBe(LONGEST_DISCOVERY_FIELD);
      expect(one.provenance).toBe(LONGEST_MODEL_PROVENANCE);
    }
  });

  it('every CLEAR field is maximised, and its provenance stays the schema literal', () => {
    const clears = doc().evolution.observations.clears;
    expect(clears).toHaveLength(7);
    for (const one of clears) {
      expect(one.field).toBe(LONGEST_DISCOVERY_FIELD);
      // Pinned by the schema — there is no longer value to choose.
      expect(one.provenance).toBe('user_stated');
    }
  });

  it('the question plan is maximised in both phase and fields', () => {
    const plan = doc().evolution.questionPlan;
    expect(plan.phase).toBe(LONGEST_MODEL_NAMEABLE_PHASE);
    expect(plan.questionFields).toHaveLength(2);
    for (const field of plan.questionFields) {
      expect(field).toBe(LONGEST_DISCOVERY_FIELD);
    }
  });

  it('repeated enum values are genuinely provider-schema-valid', () => {
    // The arrays are bounded by LENGTH only — uniqueness is a canonical rule, not a provider one.
    // If that were ever false, repeating the longest field would be measuring an invalid document.
    expect(
      riyaStructuredOutputSchema.safeParse(riyaStructuredOutputAtFill('SINGLE_BYTE_ASCII')).success,
    ).toBe(true);
  });

  it('REGRESSION — vocabulary ORDER cannot change the maximum', () => {
    // The exact defect this replaces: `[0]`, `.find(...)` and `.slice(0, n)` selected whichever
    // member happened to be declared first, so reordering a vocabulary would silently change the
    // measured maximum. Selection is by serialized length now, and the source must not reach for
    // positional access on these vocabularies again.
    const source = readFileSync(MODULE_PATH, 'utf8');
    expect(source).toContain('function longestOf');
    expect(source).not.toContain('RIYA_MODEL_PROVENANCES[0]');
    expect(source).not.toMatch(/DISCOVERY_FIELDS_FROZEN\.slice\(/u);
    expect(source).not.toMatch(/RIYA_CONVERSATION_PHASES\.find\(/u);
  });

  it('the measured maximum equals the exact serialized fixture bytes', () => {
    expect(maxRiyaStructuredOutputBytesSingleByte()).toBe(
      Buffer.byteLength(JSON.stringify(riyaStructuredOutputAtFill('SINGLE_BYTE_ASCII')), 'utf8'),
    );
  });
});

/**
 * POST-OAD2. The governed budget is CHOSEN by an owner, not computed from the schema maximum.
 *
 * The previous revision asserted `RIYA_COMPLETION_BUDGET_TOKENS === derive...()`, which made the
 * request envelope a function of whatever a validator would tolerate. OAD2 refused that envelope —
 * HTTP 413 at 14,848 on the KNOWN-GOOD MINIMAL STRICT CONTROL, with no Riya schema on the wire — so
 * the invariant is not merely inelegant, it encoded a value the provider rejected.
 *
 * These specs pin the replacement: the budget is a literal, it is decoupled from the derivation, and
 * the derivation survives as diagnostics only.
 */
describe('the governed budget is an OWNER-SELECTED launch value, pinned', () => {
  it('RIYA_COMPLETION_BUDGET_TOKENS is exactly 4_096', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBe(4_096);
  });

  it('is DECOUPLED from the maximum-schema derivation', () => {
    // The semantic half of the regression guard: the two are no longer the same number.
    expect(RIYA_COMPLETION_BUDGET_TOKENS).not.toBe(deriveSingleByteRiyaCompletionBudgetTokens());
    // And the derivation still works, because it is kept as a capacity diagnostic.
    expect(deriveSingleByteRiyaCompletionBudgetTokens()).toBeGreaterThan(0);
  });

  it('its assumed byte extent is stated in bytes, and derived from the assumption', () => {
    expect(RIYA_COMPLETION_BUDGET_ASSUMED_BYTES).toBe(
      RIYA_COMPLETION_BUDGET_TOKENS * ASSUMED_BYTES_PER_TOKEN,
    );
  });

  it('does NOT assume-cover the single-byte schema maximum, by design', () => {
    // The decoupling, stated as an executable fact rather than left to a comment. Under the previous
    // policy this relationship was inverted and that was the whole problem.
    expect(RIYA_COMPLETION_BUDGET_ASSUMED_BYTES).toBeLessThan(
      maxRiyaStructuredOutputBytesSingleByte(),
    );
  });

  it('does not assume-cover the pathological schema-valid document either', () => {
    // A byte-to-byte comparison, which is the only kind these two quantities support. It says
    // NOTHING about how many tokens either one costs.
    expect(RIYA_COMPLETION_BUDGET_ASSUMED_BYTES).toBeLessThan(
      maxRiyaStructuredOutputBytesAnyFill(),
    );
  });

  it('is far below the model capability ceiling, which is the whole point', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeLessThan(MODEL_OUTPUT_CEILING_TOKENS / 2);
  });
});

/**
 * The structural half of the regression guard.
 *
 * A semantic assertion cannot prove "this constant is a literal rather than a call", because both
 * forms yield a number — and `!== derive()` would pass even if someone wrote
 * `= derive() - 1`. So this reads the DECLARATION and requires a numeric literal.
 *
 * It is deliberately the narrowest source-text assertion that proves the property: it matches only
 * the initializer of the one exported constant, and it is self-tested below against the exact
 * expression the pre-OAD2 revision would have shipped.
 */
describe('GUARD — the governed budget may not be reconnected to the derivation', () => {
  /** The initializer text of the exported budget constant. */
  function budgetInitializer(source: string): string {
    const match = /export const RIYA_COMPLETION_BUDGET_TOKENS\s*=\s*([^;]+);/u.exec(source);
    expect(match, 'the budget constant must be declared and exported').not.toBeNull();
    return (match?.[1] ?? '').trim();
  }

  it('the declaration is a numeric literal, not a computation', () => {
    expect(budgetInitializer(readFileSync(MODULE_PATH, 'utf8'))).toMatch(/^\d[\d_]*$/u);
  });

  it('the guard actually fires on a reconnected declaration', () => {
    // A guard nobody has seen fail is a guard nobody can trust. Both the direct reconnection and the
    // arithmetic-disguised one must be caught.
    for (const offending of [
      'export const RIYA_COMPLETION_BUDGET_TOKENS = deriveSingleByteRiyaCompletionBudgetTokens();',
      'export const RIYA_COMPLETION_BUDGET_TOKENS = deriveSingleByteRiyaCompletionBudgetTokens() - 1;',
      'export const RIYA_COMPLETION_BUDGET_TOKENS = maxRiyaStructuredOutputBytesSingleByte() / 2;',
    ]) {
      expect(budgetInitializer(offending)).not.toMatch(/^\d[\d_]*$/u);
    }
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
