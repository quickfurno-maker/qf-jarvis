/**
 * POST-OAD3 — the classifier repair, and the representative-only vocabulary.
 *
 * ### The defect these specs exist to prevent
 *
 * OAD3 ran a full O0-O3 matrix at the repaired 4,096-token budget. `O0` and `O2` returned HTTP 200.
 * `O1` and `O3` returned **HTTP 429**. The harness of the day counted every non-2xx response with a
 * status as a rejection, so it emitted `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED`
 * — a token that names the message shape — on evidence that was a rate limit.
 *
 * A 429 means the provider DECLINED TO PROCESS. It is not a verdict on the schema, the messages or
 * the budget. Reading it as one would have retired a question that is still open.
 *
 * So the first block replays OAD3's exact matrix and asserts the repaired analysis reaches
 * `MIXED_OR_INCONCLUSIVE` instead, and the second block pins the one-probe vocabulary in which the
 * rate limit has a token of its own and cannot fall through into a contract verdict.
 *
 * The historical OAD3 receipt is not touched by any of this.
 */
import { describe, expect, it } from 'vitest';

import {
  analyseOperationalAcceptance,
  OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS,
} from '../internal/operational-acceptance-classification.js';
import type { OperationalAcceptanceOutcome } from '../internal/operational-acceptance-classification.js';
import type { OperationalAcceptanceStepId } from '../internal/operational-acceptance-plan.js';
import { CANDIDATE_PROVIDER_HTTP_CLASSES } from '../candidate-transport-observation.js';
import type { CandidateProviderHttpClass } from '../candidate-transport-observation.js';
import {
  isProviderAccepted,
  isProviderContractRejected,
  isProviderOutcomeInconclusive,
  NON_VERDICT_HTTP_CLASSES,
  PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES,
  PROVIDER_OUTCOME_ROLE,
} from '../internal/provider-outcome-classes.js';
import {
  analyseRepresentativeAcceptance,
  REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS,
} from '../internal/representative-acceptance-classification.js';
import type { RepresentativeAcceptanceOutcome } from '../internal/representative-acceptance-classification.js';

/** An accepted row: the provider TOOK the request. */
function ok(stepId: OperationalAcceptanceStepId): OperationalAcceptanceOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 200,
    providerHttpClass: 'SUCCESS_2XX',
    providerErrorType: 'NONE',
    providerErrorCode: 'NONE',
    providerCompleted: true,
  };
}

/** OAD3's actual 429 row, field for field. */
function rateLimited(stepId: OperationalAcceptanceStepId): OperationalAcceptanceOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 429,
    providerHttpClass: 'RATE_LIMITED_429',
    providerErrorType: 'OTHER_OR_ABSENT',
    providerErrorCode: 'OTHER_OR_ABSENT',
    providerCompleted: false,
  };
}

/** A real provider verdict: it read the request and refused it. */
function refused(stepId: OperationalAcceptanceStepId): OperationalAcceptanceOutcome {
  return {
    stepId,
    providerTransportStarted: true,
    providerHttpStatus: 400,
    providerHttpClass: 'BAD_REQUEST_400',
    providerErrorType: 'INVALID_REQUEST_ERROR',
    providerErrorCode: 'JSON_VALIDATE_FAILED',
    providerCompleted: false,
  };
}

/**
 * The role of EVERY governed transport class, reviewed one by one.
 *
 * This table is the point of the whole guard. The first repair listed the classes that were not
 * evidence and treated the leftovers as provider rejections — which quietly swept in
 * `UNAUTHORIZED_401`, `FORBIDDEN_403`, `NOT_FOUND_404` and `OTHER_HTTP`. A mistyped SECOND candidate
 * credential (smoke passes on the first entry) would then have been filed as evidence about Riya's
 * schema.
 *
 * So the expectation is written out here per class. A new `CandidateProviderHttpClass` fails this
 * spec until somebody adds it, and fails the compiler until somebody gives it a role — there is no
 * path by which it inherits "rejection" through a fallback.
 */
const EXPECTED_ROLE: Readonly<Record<CandidateProviderHttpClass, string>> = {
  SUCCESS_2XX: 'ACCEPTED',

  // The contract-rejection allowlist. Exactly three.
  BAD_REQUEST_400: 'CONTRACT_REJECTION',
  PAYLOAD_TOO_LARGE_413: 'CONTRACT_REJECTION',
  UNPROCESSABLE_422: 'CONTRACT_REJECTION',

  RATE_LIMITED_429: 'RATE_LIMITED',

  CAPACITY_498: 'EXECUTION_INTERRUPTED',
  CANCELLED_499: 'EXECUTION_INTERRUPTED',
  SERVER_5XX: 'EXECUTION_INTERRUPTED',
  TRANSPORT_THROW: 'EXECUTION_INTERRUPTED',
  NOT_REACHED: 'EXECUTION_INTERRUPTED',

  // Credential, permission, configuration, ungoverned. NEVER contract evidence.
  UNAUTHORIZED_401: 'NON_VERDICT_OTHER',
  FORBIDDEN_403: 'NON_VERDICT_OTHER',
  NOT_FOUND_404: 'NON_VERDICT_OTHER',
  OTHER_HTTP: 'NON_VERDICT_OTHER',
  NONE: 'NON_VERDICT_OTHER',
};

describe('GUARD — every governed HTTP class has an explicitly reviewed role', () => {
  it('assigns the reviewed role to every declared class, with none left over', () => {
    // Both directions: no class without a decision, and no decision without a class.
    expect([...CANDIDATE_PROVIDER_HTTP_CLASSES].sort()).toEqual(Object.keys(EXPECTED_ROLE).sort());
    for (const providerHttpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      expect(PROVIDER_OUTCOME_ROLE[providerHttpClass], providerHttpClass).toBe(
        EXPECTED_ROLE[providerHttpClass],
      );
    }
  });

  it('contract-rejection evidence is EXACTLY 400, 413 and 422', () => {
    expect([...PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES].sort()).toEqual([
      'BAD_REQUEST_400',
      'PAYLOAD_TOO_LARGE_413',
      'UNPROCESSABLE_422',
    ]);
    // The four classes the previous revision let through by fallback.
    for (const notEvidence of [
      'UNAUTHORIZED_401',
      'FORBIDDEN_403',
      'NOT_FOUND_404',
      'OTHER_HTTP',
    ] as const) {
      expect(PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES, notEvidence).not.toContain(notEvidence);
      expect(NON_VERDICT_HTTP_CLASSES, notEvidence).toContain(notEvidence);
    }
    expect(NON_VERDICT_HTTP_CLASSES).toContain('RATE_LIMITED_429');
  });

  it('every class lands in exactly one of accepted / contract-rejected / inconclusive', () => {
    for (const providerHttpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      // Driven with a REAL response so a class can reach the rejection branch if it is allowed to.
      const outcome = {
        providerCompleted: providerHttpClass === 'SUCCESS_2XX',
        providerTransportStarted: true,
        providerHttpStatus: 400,
        providerHttpClass,
      };
      const roles = [
        isProviderAccepted(outcome),
        isProviderContractRejected(outcome),
        isProviderOutcomeInconclusive(outcome),
      ].filter(Boolean);
      expect(roles, providerHttpClass).toHaveLength(1);
      // And rejection is reachable ONLY from the allowlist.
      expect(isProviderContractRejected(outcome), providerHttpClass).toBe(
        PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES.includes(providerHttpClass),
      );
    }
  });

  it('a credential, permission or configuration failure is NOT contract evidence', () => {
    for (const providerHttpClass of [
      'UNAUTHORIZED_401',
      'FORBIDDEN_403',
      'NOT_FOUND_404',
      'OTHER_HTTP',
    ] as const) {
      const outcome = {
        providerCompleted: false,
        providerTransportStarted: true,
        providerHttpStatus: 401,
        providerHttpClass,
      };
      // A wrong SECOND candidate credential lands on 401. It must not become evidence about Riya.
      expect(isProviderContractRejected(outcome), providerHttpClass).toBe(false);
      expect(isProviderOutcomeInconclusive(outcome), providerHttpClass).toBe(true);
    }
  });

  it('a rate limit is not a verdict, and a 400 still is', () => {
    const limited = rateLimited('O3_EXACT_REPRESENTATIVE_OPERATIONAL');
    expect(isProviderAccepted(limited)).toBe(false);
    expect(isProviderContractRejected(limited)).toBe(false);
    expect(isProviderOutcomeInconclusive(limited)).toBe(true);

    const verdict = refused('O2_EXACT_SYNTHETIC_OPERATIONAL');
    expect(isProviderContractRejected(verdict)).toBe(true);
    expect(isProviderOutcomeInconclusive(verdict)).toBe(false);
  });
});

describe("OAD3's exact matrix no longer supports a message-shape claim", () => {
  /** OAD3, field for field: O0 200, O1 429, O2 200, O3 429. */
  const OAD3_MATRIX: readonly OperationalAcceptanceOutcome[] = [
    ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
    rateLimited('O1_EVOLUTION_GROUP_OPERATIONAL'),
    ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
    rateLimited('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
  ];

  it('reads as MIXED_OR_INCONCLUSIVE, not as a representative rejection', () => {
    const analysis = analyseOperationalAcceptance(OAD3_MATRIX);
    expect(analysis.classification).toBe('MIXED_OR_INCONCLUSIVE');
    // The withdrawn reading, pinned as unreachable from this evidence.
    expect(analysis.classification).not.toBe(
      'OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED',
    );
  });

  it('files both rate-limited probes as inconclusive and REJECTS nothing', () => {
    const analysis = analyseOperationalAcceptance(OAD3_MATRIX);
    expect(analysis.acceptedStepIds).toEqual([
      'O0_MINIMAL_CONTROL_OPERATIONAL',
      'O2_EXACT_SYNTHETIC_OPERATIONAL',
    ]);
    expect(analysis.inconclusiveStepIds).toEqual([
      'O1_EVOLUTION_GROUP_OPERATIONAL',
      'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
    ]);
    // Nothing was refused BY the provider, so nothing may be reported as refused.
    expect(analysis.rejectedStepIds).toEqual([]);
    expect(analysis.rejectedErrorCodes).toEqual([]);
  });

  it('a REAL provider verdict on O3 still reads as the sequence token', () => {
    // The repair must not disarm the classifier: a 400 is still a verdict, and the bounded
    // sequence token is still what an O2-accepted / O3-refused matrix produces.
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      refused('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    expect(analysis.classification).toBe(
      'OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED',
    );
    expect(analysis.rejectedStepIds).toEqual(['O3_EXACT_REPRESENTATIVE_OPERATIONAL']);
    expect(analysis.rejectedErrorCodes).toEqual([
      {
        stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
        providerErrorCode: 'JSON_VALIDATE_FAILED',
      },
    ]);
  });

  it.each([
    ['UNAUTHORIZED_401', 401],
    ['FORBIDDEN_403', 403],
    ['NOT_FOUND_404', 404],
    ['OTHER_HTTP', 418],
  ] as const)(
    'O0/O1/O2 accepted with O3 %s reads as MIXED_OR_INCONCLUSIVE',
    (providerHttpClass, providerHttpStatus) => {
      // The exact scenario the fallback would have mis-filed: three green probes and a credential,
      // permission, configuration or ungoverned failure on the representative one.
      const analysis = analyseOperationalAcceptance([
        ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
        ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
        ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
        {
          stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
          providerTransportStarted: true,
          providerHttpStatus,
          providerHttpClass,
          providerErrorType: 'OTHER_OR_ABSENT',
          providerErrorCode: 'OTHER_OR_ABSENT',
          providerCompleted: false,
        },
      ]);
      expect(analysis.classification).toBe('MIXED_OR_INCONCLUSIVE');
      expect(analysis.classification).not.toBe(
        'OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED',
      );
      expect(analysis.rejectedStepIds).toEqual([]);
      expect(analysis.inconclusiveStepIds).toEqual(['O3_EXACT_REPRESENTATIVE_OPERATIONAL']);
    },
  );

  it('a 413 on O3 IS contract evidence, as OAD2 read its own 413', () => {
    const analysis = analyseOperationalAcceptance([
      ok('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      {
        stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
        providerTransportStarted: true,
        providerHttpStatus: 413,
        providerHttpClass: 'PAYLOAD_TOO_LARGE_413',
        providerErrorType: 'OTHER_OR_ABSENT',
        providerErrorCode: 'OTHER_OR_ABSENT',
        providerCompleted: false,
      },
    ]);
    expect(analysis.classification).toBe(
      'OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED',
    );
    expect(analysis.rejectedStepIds).toEqual(['O3_EXACT_REPRESENTATIVE_OPERATIONAL']);
  });

  it('the matrix vocabulary itself is unchanged', () => {
    // No token was added or removed by the repair — only which evidence reaches which token.
    expect([...OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS]).toEqual([
      'OPERATIONAL_CONTROL_INVALID',
      'OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED',
      'OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED',
      'OPERATIONAL_FULL_SCHEMA_REJECTED',
      'OPERATIONAL_EVOLUTION_GROUP_REJECTED',
      'MIXED_OR_INCONCLUSIVE',
    ]);
  });

  it('a rate-limited CONTROL still invalidates the run', () => {
    // Precedence is untouched: an unusable control is unusable however it failed.
    const analysis = analyseOperationalAcceptance([
      rateLimited('O0_MINIMAL_CONTROL_OPERATIONAL'),
      ok('O1_EVOLUTION_GROUP_OPERATIONAL'),
      ok('O2_EXACT_SYNTHETIC_OPERATIONAL'),
      ok('O3_EXACT_REPRESENTATIVE_OPERATIONAL'),
    ]);
    expect(analysis.classification).toBe('OPERATIONAL_CONTROL_INVALID');
  });
});

/** One representative row, at the fields that matter. */
function probe(fields: Partial<RepresentativeAcceptanceOutcome>): RepresentativeAcceptanceOutcome {
  return {
    stepId: 'O3_EXACT_REPRESENTATIVE_OPERATIONAL',
    providerTransportStarted: true,
    providerHttpStatus: 200,
    providerHttpClass: 'SUCCESS_2XX',
    providerErrorType: 'NONE',
    providerErrorCode: 'NONE',
    providerCompleted: true,
    ...fields,
  };
}

describe('the representative-only vocabulary keeps the rate limit separate', () => {
  it('publishes exactly the five governed outcomes', () => {
    expect([...REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS]).toEqual([
      'REPRESENTATIVE_ACCEPTED',
      'REPRESENTATIVE_PROVIDER_REJECTED',
      'REPRESENTATIVE_RATE_LIMITED',
      'REPRESENTATIVE_INFRA_INTERRUPTED',
      'REPRESENTATIVE_INCONCLUSIVE',
    ]);
  });

  it('HTTP 200 with a completed provider is ACCEPTED', () => {
    const analysis = analyseRepresentativeAcceptance(probe({}));
    expect(analysis.classification).toBe('REPRESENTATIVE_ACCEPTED');
    expect(analysis.providerHttpStatus).toBe(200);
  });

  it('HTTP 429 is RATE_LIMITED and never a rejection', () => {
    const analysis = analyseRepresentativeAcceptance(
      probe({
        providerHttpStatus: 429,
        providerHttpClass: 'RATE_LIMITED_429',
        providerErrorType: 'OTHER_OR_ABSENT',
        providerErrorCode: 'OTHER_OR_ABSENT',
        providerCompleted: false,
      }),
    );
    // The exact reading OAD3 needed and could not produce.
    expect(analysis.classification).toBe('REPRESENTATIVE_RATE_LIMITED');
    expect(analysis.classification).not.toBe('REPRESENTATIVE_PROVIDER_REJECTED');
    expect(analysis.providerHttpStatus).toBe(429);
  });

  it('HTTP 400 is a provider REJECTION and preserves its literal codes', () => {
    const analysis = analyseRepresentativeAcceptance(
      probe({
        providerHttpStatus: 400,
        providerHttpClass: 'BAD_REQUEST_400',
        providerErrorType: 'INVALID_REQUEST_ERROR',
        providerErrorCode: 'JSON_VALIDATE_FAILED',
        providerCompleted: false,
      }),
    );
    expect(analysis.classification).toBe('REPRESENTATIVE_PROVIDER_REJECTED');
    // Preserved, not interpreted: the token names a refusal, never a cause.
    expect(analysis.providerErrorType).toBe('INVALID_REQUEST_ERROR');
    expect(analysis.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
  });

  it.each(['UNAUTHORIZED_401', 'FORBIDDEN_403', 'NOT_FOUND_404', 'OTHER_HTTP'] as const)(
    '%s is INCONCLUSIVE and never a provider rejection',
    (providerHttpClass) => {
      const analysis = analyseRepresentativeAcceptance(
        probe({ providerHttpClass, providerHttpStatus: 401, providerCompleted: false }),
      );
      // A mistyped candidate credential must never read as a verdict on the request.
      expect(analysis.classification).not.toBe('REPRESENTATIVE_PROVIDER_REJECTED');
      expect(analysis.classification).toBe('REPRESENTATIVE_INCONCLUSIVE');
    },
  );

  it.each(['PAYLOAD_TOO_LARGE_413', 'UNPROCESSABLE_422'] as const)(
    '%s IS a provider contract rejection',
    (providerHttpClass) => {
      const analysis = analyseRepresentativeAcceptance(
        probe({ providerHttpClass, providerHttpStatus: 413, providerCompleted: false }),
      );
      expect(analysis.classification).toBe('REPRESENTATIVE_PROVIDER_REJECTED');
    },
  );

  it('transport and availability failures are INFRA_INTERRUPTED', () => {
    for (const providerHttpClass of [
      'TRANSPORT_THROW',
      'SERVER_5XX',
      'CAPACITY_498',
      'CANCELLED_499',
      'NOT_REACHED',
    ] as const) {
      // Separated from the credential/config cases above: an execution failure says try again.
      const analysis = analyseRepresentativeAcceptance(
        probe({ providerHttpClass, providerHttpStatus: 0, providerCompleted: false }),
      );
      expect(analysis.classification, providerHttpClass).toBe('REPRESENTATIVE_INFRA_INTERRUPTED');
    }
  });

  it('a probe that never ran is INCONCLUSIVE', () => {
    const analysis = analyseRepresentativeAcceptance(undefined);
    expect(analysis.classification).toBe('REPRESENTATIVE_INCONCLUSIVE');
    expect(analysis.providerHttpClass).toBe('NOT_REACHED');
    expect(analysis.providerHttpStatus).toBe(0);
  });

  it('EVERY governed class produces a published token, and only 400/413/422 reject', () => {
    expect(
      REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS.includes(
        analyseRepresentativeAcceptance(undefined).classification,
      ),
    ).toBe(true);
    for (const providerHttpClass of CANDIDATE_PROVIDER_HTTP_CLASSES) {
      const analysis = analyseRepresentativeAcceptance(
        probe({
          providerHttpClass,
          providerHttpStatus: 400,
          providerCompleted: providerHttpClass === 'SUCCESS_2XX',
        }),
      );
      expect(REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS, providerHttpClass).toContain(
        analysis.classification,
      );
      // The boundary, asserted over the WHOLE vocabulary rather than a sample.
      expect(
        analysis.classification === 'REPRESENTATIVE_PROVIDER_REJECTED',
        providerHttpClass,
      ).toBe(PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES.includes(providerHttpClass));
    }
  });
});
