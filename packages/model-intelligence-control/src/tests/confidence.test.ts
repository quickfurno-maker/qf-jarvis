import { describe, expect, it } from 'vitest';

import { assessAnswerConfidence } from '../index.js';

const base = {
  evidenceScore: 0.92,
  retrievalCoverage: 0.82,
  ambiguityScore: 0.1,
  groundingSourceCount: 3,
  coreFactStatus: 'VERIFIED' as const,
  structuredOutputValid: true,
  contradictionCount: 0,
};

describe('answer confidence', () => {
  it('answers when support is strong', () => {
    expect(assessAnswerConfidence(base)).toEqual({
      band: 'HIGH',
      action: 'ANSWER',
      reason: 'SUPPORTED',
    });
  });

  it('requires Core verification for an unverified business fact', () => {
    expect(assessAnswerConfidence({ ...base, coreFactStatus: 'UNVERIFIED' })).toEqual({
      band: 'LOW',
      action: 'VERIFY_CORE',
      reason: 'CORE_VERIFICATION_REQUIRED',
    });
  });

  it('escalates contradictions and invalid structure', () => {
    expect(assessAnswerConfidence({ ...base, coreFactStatus: 'CONTRADICTED' })).toMatchObject({
      band: 'LOW',
      action: 'ESCALATE_HUMAN',
      reason: 'CONTRADICTED',
    });
    expect(assessAnswerConfidence({ ...base, structuredOutputValid: false })).toMatchObject({
      band: 'LOW',
      action: 'ESCALATE_HUMAN',
      reason: 'STRUCTURE_INVALID',
    });
  });

  it('asks instead of guessing when ambiguity or grounding is weak', () => {
    expect(assessAnswerConfidence({ ...base, ambiguityScore: 0.8 })).toMatchObject({
      band: 'LOW',
      action: 'ASK_CLARIFYING',
      reason: 'AMBIGUOUS',
    });
    expect(
      assessAnswerConfidence({ ...base, evidenceScore: 0.6, retrievalCoverage: 0.5 }),
    ).toMatchObject({
      band: 'MEDIUM',
      action: 'ASK_CLARIFYING',
      reason: 'INSUFFICIENT_GROUNDING',
    });
  });
});
