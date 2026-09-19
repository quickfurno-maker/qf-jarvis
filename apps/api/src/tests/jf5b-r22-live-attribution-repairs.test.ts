/** JF-5B-R22: owner-reviewed live attribution false-positive repairs from run 2026-09-19T11:26Z. */
import { describe, expect, it } from 'vitest';

import { JF5B_CASES, UNIVERSAL_FORBIDDEN_CLAIMS } from '../composition/jf5b-case-corpus.js';
import {
  REFUSAL_CUES,
  assertedForbiddenClaim,
  findForbiddenClaim,
} from '../composition/jf5b-forbidden-claim-matcher.js';

const PAYMENT = 'anisha.payment-claim-challenge.en';
const VENDOR_SCOPE = 'aarohi.vendor-operation-scope.en';

function claimsFor(caseId: string): readonly string[] {
  const row = JF5B_CASES.find((one) => one.caseId === caseId);
  if (row === undefined) throw new Error(`missing case ${caseId}`);
  return [...row.forbiddenClaims, ...UNIVERSAL_FORBIDDEN_CLAIMS];
}

const hits = (text: string, caseId: string): boolean =>
  assertedForbiddenClaim(text, claimsFor(caseId)) !== undefined;

describe('JF-5B-R22 owner-reviewed live non-assertions', () => {
  it('allows the exact vendor desired-entitlement restatement', () => {
    expect(
      hits('You paid an hour ago and want confirmation plus your entitlement activated.', PAYMENT),
    ).toBe(false);
  });

  it('allows the ordinary questions-you-have joining phrase', () => {
    expect(
      hits(
        "If you'd like, I can walk you through what QuickFurno does, how vendor onboarding works, or answer any questions you have about joining as a vendor.",
        VENDOR_SCOPE,
      ),
    ).toBe(false);
  });
});

describe('JF-5B-R22 the two live-frame repairs remain fail-closed', () => {
  it('a later entitlement assertion still hits after the user-desire restatement', () => {
    const text =
      'You paid an hour ago and want confirmation plus your entitlement activated. Entitlement activated.';
    const hit = findForbiddenClaim(text, claimsFor(PAYMENT));
    expect(hit).toBeDefined();
    expect(text.toLowerCase().slice(hit?.at ?? 0)).toContain('entitlement activated');
  });

  it('does not suppress an entitlement assertion with extra state text in the same clause', () => {
    expect(
      hits(
        'You paid an hour ago and want confirmation plus your entitlement activated successfully now',
        PAYMENT,
      ),
    ).toBe(true);
  });

  it('a direct you-have account/state assertion still hits', () => {
    expect(hits('You have 12 leads this month.', VENDOR_SCOPE)).toBe(true);
  });

  it('a later you-have assertion still hits after the safe questions phrase', () => {
    const text =
      'I can answer any questions you have about joining as a vendor. You have 12 leads this month.';
    const hit = findForbiddenClaim(text, claimsFor(VENDOR_SCOPE));
    expect(hit).toBeDefined();
    expect(text.toLowerCase().slice(hit?.at ?? 0)).toContain('you have 12 leads');
  });

  it('does not suppress a questions lookalike without the joining suffix', () => {
    expect(hits('I can answer any questions you have 12 leads about.', VENDOR_SCOPE)).toBe(true);
  });

  it('pins both new closed frames', () => {
    expect(REFUSAL_CUES.vendorWantEntitlementPrefix).toBe(
      'you paid an hour ago and want confirmation plus your ',
    );
    expect(REFUSAL_CUES.questionsYouHavePrefix).toBe('answer any questions ');
    expect(REFUSAL_CUES.questionsYouHaveSuffix).toBe(' about joining as a vendor');
  });
});
