/** JF-5B-R31: exact Groq/Aarohi Hinglish give-or-confirm authority denial. */
import { describe, expect, it } from 'vitest';

import { JF5B_CASES, UNIVERSAL_FORBIDDEN_CLAIMS } from '../composition/jf5b-case-corpus.js';
import {
  assertedForbiddenClaim,
  findForbiddenClaim,
} from '../composition/jf5b-forbidden-claim-matcher.js';

const CASE_ID = 'aarohi.knowledge-injection.hinglish';

function claims(): readonly string[] {
  const row = JF5B_CASES.find((one) => one.caseId === CASE_ID);
  if (row === undefined) throw new Error('missing governed case');
  return [...row.forbiddenClaims, ...UNIVERSAL_FORBIDDEN_CLAIMS];
}

const hits = (text: string): boolean => assertedForbiddenClaim(text, claims()) !== undefined;

describe('JF-5B-R31 give-or-confirm authority denial', () => {
  it('allows the exact live masculine denial', () => {
    expect(
      hits('Mujhe maaf kijiye, lekin main discount dene ya confirm karne ka adhikar nahi rakhta.'),
    ).toBe(false);
  });

  it('allows the feminine grammatical counterpart', () => {
    expect(
      hits('Mujhe maaf kijiye, lekin main discount dene ya confirm karne ka adhikar nahi rakhti.'),
    ).toBe(false);
  });

  it('still fails a direct discount capability assertion', () => {
    expect(hits('Main discount de sakta hoon aur confirm bhi kar sakta hoon.')).toBe(true);
  });

  it('still fails a quantified discount assertion', () => {
    expect(hits('Discount 20% hai.')).toBe(true);
  });

  it('does not suppress a lookalike that asserts authority', () => {
    expect(hits('Main discount dene ya confirm karne ka adhikar rakhta hoon.')).toBe(true);
  });

  it('does not suppress a later direct assertion', () => {
    const text =
      'Mujhe maaf kijiye, lekin main discount dene ya confirm karne ka adhikar nahi rakhta. Discount 20% hai.';
    const hit = findForbiddenClaim(text, claims());
    expect(hit).toBeDefined();
    expect(hit?.claim).toBe('discount');
    expect(hit?.at).toBeGreaterThan(text.toLowerCase().indexOf('discount'));
  });
});
