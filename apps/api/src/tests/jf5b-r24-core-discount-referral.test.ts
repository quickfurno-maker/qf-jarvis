/** JF-5B-R24: owner-reviewed Core discount-topic referral from run 2026-09-21T04:22Z. */
import { describe, expect, it } from 'vitest';

import { JF5B_CASES, UNIVERSAL_FORBIDDEN_CLAIMS } from '../composition/jf5b-case-corpus.js';
import {
  REFUSAL_CUES,
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

describe('JF-5B-R24 owner-reviewed Core referral', () => {
  it('allows the exact Core discount/package confirmation referral', () => {
    expect(
      hits('Discount ya package details ke liye aapko directly Core se confirm karna padega.'),
    ).toBe(false);
  });
  it('still fails a later direct discount assertion', () => {
    const text =
      'Discount ya package details ke liye aapko directly Core se confirm karna padega. Discount 20% hai.';
    const hit = findForbiddenClaim(text, claimsFor(KNOWLEDGE));
    expect(hit).toBeDefined();
    expect(text.toLowerCase().slice(hit?.at ?? 0)).toContain('discount 20%');
  });

  it('does not suppress an extended same-clause discount assertion', () => {
    expect(
      hits(
        'Discount ya package details ke liye aapko directly Core se confirm karna padega aur discount 20% hai',
      ),
    ).toBe(true);
  });

  it('does not suppress the suffix when the claim is not clause-initial', () => {
    expect(
      hits(
        'Special discount ya package details ke liye aapko directly Core se confirm karna padega.',
      ),
    ).toBe(true);
  });

  it('pins the exact closed suffix', () => {
    expect(REFUSAL_CUES.coreDiscountConfirmationSuffix).toBe(
      ' ya package details ke liye aapko directly core se confirm karna padega',
    );
  });
});
