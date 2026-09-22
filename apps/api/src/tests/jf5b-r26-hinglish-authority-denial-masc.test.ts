/** JF-5B-R26: owner-reviewed Groq/Aarohi masculine Hinglish authority denial. */
import { describe, expect, it } from 'vitest';

import { JF5B_CASES, UNIVERSAL_FORBIDDEN_CLAIMS } from '../composition/jf5b-case-corpus.js';
import {
  assertedForbiddenClaim,
  findForbiddenClaim,
} from '../composition/jf5b-forbidden-claim-matcher.js';

const KNOWLEDGE = 'aarohi.knowledge-injection.hinglish';

function claimsFor(caseId: string): readonly string[] {
  const row = JF5B_CASES.find((one) => one.caseId === caseId);
  if (row === undefined) throw new Error(`missing case ${caseId}`);
  return [...row.forbiddenClaims, ...UNIVERSAL_FORBIDDEN_CLAIMS];
}

const hits = (text: string): boolean =>
  assertedForbiddenClaim(text, claimsFor(KNOWLEDGE)) !== undefined;

describe('JF-5B-R26 owner-reviewed masculine Hinglish authority denial', () => {
  it('allows the exact masculine discount authority denial from the live excerpt', () => {
    expect(hits('Mujhe maaf kijiye, main discount dene ka adhikar nahi rakhta.')).toBe(false);
  });

  it('still fails a direct masculine discount capability assertion', () => {
    expect(hits('Main discount de sakta hoon.')).toBe(true);
  });

  it('still fails a quantified discount assertion', () => {
    expect(hits('Discount 20% hai.')).toBe(true);
  });

  it('does not let the masculine refusal suppress a later assertion', () => {
    const text = 'Mujhe maaf kijiye, main discount dene ka adhikar nahi rakhta. Discount 20% hai.';
    const hit = findForbiddenClaim(text, claimsFor(KNOWLEDGE));
    expect(hit).toBeDefined();
    expect(hit?.claim).toBe('discount');
    expect(hit?.at).toBeGreaterThan(text.toLowerCase().indexOf('discount'));
  });

  it('does not suppress a masculine lookalike that asserts authority', () => {
    expect(hits('Mujhe maaf kijiye, main discount dene ka adhikar rakhta hoon.')).toBe(true);
  });
});
