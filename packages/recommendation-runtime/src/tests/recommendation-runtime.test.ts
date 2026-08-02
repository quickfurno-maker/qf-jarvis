/**
 * QFJ-P05.05 — the governed recommendation runtime (ADR-0079).
 *
 * Three claims are under test.
 *
 * First, that the runtime supplies IDENTITY and PROVENANCE and the caller supplies SEMANTICS — and
 * that a caller cannot cross that line, including by trying to state its own `recommendationId`, a
 * `producingSystem`, an `actionId`, a fingerprint, or an `approved` flag.
 *
 * Second, that every governed invariant is enforced by `recommendationV1Schema` rather than
 * reimplemented here, and that a wrong risk/approval pairing is REFUSED rather than repaired.
 *
 * Third, that the returned artifact is genuinely inert: deeply frozen, sharing no reference with the
 * caller's input, with one binding per action carrying the digest of exactly the bytes returned.
 */
import { describe, expect, it } from 'vitest';

import { RECOMMENDATION_CONTRACT_VERSION } from '@qf-jarvis/contracts';

import {
  RECOMMENDATION_RUNTIME_ERROR_CODES,
  RecommendationRuntimeError,
  createRecommendationRuntime,
  fingerprintProposedAction,
} from '../index.js';
import type { RecommendationRuntimeIdentityPort } from '../index.js';

const CREATED_AT = '2026-08-02T09:00:00Z';
const EXPIRES_AT = '2026-08-03T09:00:00Z';
const CORRELATION_ID = '11111111-2222-4333-8444-555555555555';

/** A deterministic identity port, so a spec can assert on exact identifiers. */
function sequentialIdentity(): RecommendationRuntimeIdentityPort & {
  readonly calls: () => number;
} {
  let n = 0;
  const uuid = (slot: number): string =>
    `00000000-0000-4000-8000-${String(slot).padStart(12, '0')}`;
  return {
    calls: () => n,
    nextRecommendationId: (): string => {
      n += 1;
      return uuid(n);
    },
    nextActionId: (): string => {
      n += 1;
      return uuid(n);
    },
  };
}

function actionDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Schedule a follow-up with the vendor.',
    parameters: { channel: 'whatsapp', delayHours: 48 },
    ...over,
  };
}

function input(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recommendationType: 'vendor.follow-up',
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    producingAgent: 'anisha',
    producingAgentVersion: 'anisha.v1',
    subject: { entityType: 'vendor', entityId: 'vendor.42' },
    priority: 'medium',
    confidence: 0.8,
    risk: 'client-or-vendor-facing-communication',
    requiredApproval: 'authorized-team-human',
    summary: 'The vendor has not responded about the delayed sample.',
    rationale: 'Two follow-ups have gone unanswered for six days, past the agreed sample window.',
    evidence: [
      {
        evidenceType: 'derived-signal',
        signalCode: 'vendor.unresponsive',
        description: 'No vendor reply for six days.',
      },
    ],
    proposedActions: [actionDraft()],
    composite: false,
    correlationId: CORRELATION_ID,
    ...over,
  };
}

function runtime(identity?: RecommendationRuntimeIdentityPort) {
  return createRecommendationRuntime(identity === undefined ? {} : { identity });
}

function expectCode(fn: () => unknown, code: string, label = code): void {
  try {
    fn();
  } catch (error) {
    expect(error, label).toBeInstanceOf(RecommendationRuntimeError);
    expect((error as RecommendationRuntimeError).code, label).toBe(code);
    return;
  }
  throw new Error(`Expected ${label} to throw ${code}`);
}

// ---------------------------------------------------------------------------
// The happy path, and what the runtime owns.
// ---------------------------------------------------------------------------

describe('creating a recommendation', () => {
  it('generates identities, stamps provenance, and preserves every stated semantic', () => {
    const identity = sequentialIdentity();
    const result = runtime(identity).create(input());
    const { recommendation } = result;

    // The runtime's three fields.
    expect(recommendation.recommendationId).toBe('00000000-0000-4000-8000-000000000001');
    expect(recommendation.contractVersion).toBe(RECOMMENDATION_CONTRACT_VERSION);
    expect(recommendation.producingSystem).toBe('qf-jarvis');
    expect(recommendation.proposedActions[0]?.actionId).toBe(
      '00000000-0000-4000-8000-000000000002',
    );

    // The caller's semantics, unaltered. Nothing is inferred, defaulted or rewritten.
    expect(recommendation.risk).toBe('client-or-vendor-facing-communication');
    expect(recommendation.requiredApproval).toBe('authorized-team-human');
    expect(recommendation.confidence).toBe(0.8);
    expect(recommendation.priority).toBe('medium');
    expect(recommendation.producingAgent).toBe('anisha');
    expect(recommendation.subject).toEqual({ entityType: 'vendor', entityId: 'vendor.42' });
    expect(recommendation.correlationId).toBe(CORRELATION_ID);
    expect(recommendation.evidence).toHaveLength(1);

    // Nothing that would assert authority exists on the artifact at all.
    const surface = recommendation as unknown as Record<string, unknown>;
    for (const forbidden of ['approved', 'authorized', 'sent', 'executed', 'decision']) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('returns one binding per action, in order, matching the returned bytes', () => {
    const result = runtime(sequentialIdentity()).create(
      input({
        proposedActions: [
          actionDraft({ actionType: 'schedule.follow-up' }),
          actionDraft({ actionType: 'notify.owner', summary: 'Tell the account owner.' }),
        ],
      }),
    );

    expect(result.actionBindings).toHaveLength(result.recommendation.proposedActions.length);
    result.recommendation.proposedActions.forEach((action, index) => {
      const binding = result.actionBindings[index];
      expect(binding?.recommendationId).toBe(result.recommendation.recommendationId);
      expect(binding?.proposedActionId).toBe(action.actionId);
      // The digest is of the FINALIZED action, so it describes exactly what the caller holds.
      expect(binding?.actionFingerprint).toBe(fingerprintProposedAction(action));
      expect(binding?.actionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
    // Order is positional, not incidental.
    expect(result.recommendation.proposedActions.map((a) => a.actionType)).toEqual([
      'schedule.follow-up',
      'notify.owner',
    ]);
  });

  it('accepts an informational recommendation with no actions, and returns no bindings', () => {
    const result = runtime(sequentialIdentity()).create(
      input({ risk: 'informational', requiredApproval: 'none', proposedActions: [] }),
    );
    expect(result.recommendation.proposedActions).toEqual([]);
    expect(result.actionBindings).toEqual([]);
    // Informational is exactly the case where nothing executes, so there is nothing to approve.
    expect(result.recommendation.requiredApproval).toBe('none');
  });

  it('accepts a money-related recommendation only with stronger approval or founder', () => {
    for (const requiredApproval of ['stronger-approval', 'founder']) {
      const result = runtime(sequentialIdentity()).create(
        input({ risk: 'money-related', requiredApproval }),
      );
      expect(result.recommendation.requiredApproval).toBe(requiredApproval);
    }
  });

  it('accepts a composite recommendation attributed to its specialists', () => {
    const result = runtime(sequentialIdentity()).create(
      input({ composite: true, producingAgent: 'jarvis', contributingAgents: ['riya', 'anisha'] }),
    );
    expect(result.recommendation.composite).toBe(true);
    expect(result.recommendation.contributingAgents).toEqual(['riya', 'anisha']);
  });

  it('makes no idempotency claim: two identical calls are two recommendations', () => {
    // Deduplication needs the business meaning of "the same recommendation", which this package
    // does not have. Two proposals are two proposals.
    const subject = runtime();
    const first = subject.create(input());
    const second = subject.create(input());
    expect(first.recommendation.recommendationId).not.toBe(second.recommendation.recommendationId);
    expect(first.recommendation.proposedActions[0]?.actionId).not.toBe(
      second.recommendation.proposedActions[0]?.actionId,
    );
    // Same CONTENT though -- which is precisely what the fingerprint is for.
    expect(first.actionBindings[0]?.actionFingerprint).toBe(
      second.actionBindings[0]?.actionFingerprint,
    );
  });

  it('generates real UUIDs when no identity port is supplied', () => {
    const result = runtime().create(input());
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(result.recommendation.recommendationId).toMatch(uuid);
    expect(result.recommendation.proposedActions[0]?.actionId).toMatch(uuid);
  });
});

// ---------------------------------------------------------------------------
// Governed invariants — enforced by the contract, not reimplemented here.
// ---------------------------------------------------------------------------

describe('governed invariants are enforced, never repaired', () => {
  it('refuses an informational recommendation that proposes an action', () => {
    expectCode(
      () =>
        runtime(sequentialIdentity()).create(
          input({ risk: 'informational', requiredApproval: 'none' }),
        ),
      'recommendation-invalid',
    );
  });

  it('refuses a non-informational recommendation with no actions', () => {
    expectCode(
      () => runtime(sequentialIdentity()).create(input({ proposedActions: [] })),
      'recommendation-invalid',
    );
  });

  it('refuses a non-informational recommendation requiring no approval', () => {
    expectCode(
      () => runtime(sequentialIdentity()).create(input({ requiredApproval: 'none' })),
      'recommendation-invalid',
    );
  });

  it('refuses money-related work behind a delegated approver', () => {
    // Money escalates, always. The runtime does not quietly upgrade the level -- it refuses.
    for (const requiredApproval of ['delegated-approver', 'authorized-team-human']) {
      expectCode(
        () =>
          runtime(sequentialIdentity()).create(input({ risk: 'money-related', requiredApproval })),
        'recommendation-invalid',
        requiredApproval,
      );
    }
  });

  it('refuses an expiry that does not follow creation', () => {
    for (const expiresAt of [CREATED_AT, '2026-08-01T09:00:00Z']) {
      expectCode(
        () => runtime(sequentialIdentity()).create(input({ expiresAt })),
        'recommendation-invalid',
        expiresAt,
      );
    }
  });

  it('refuses invalid composite attribution', () => {
    // A composite with no attributable contributors is a Jarvis conclusion in disguise.
    expectCode(
      () =>
        runtime(sequentialIdentity()).create(input({ composite: true, producingAgent: 'jarvis' })),
      'recommendation-invalid',
      'composite without contributors',
    );
    expectCode(
      () => runtime(sequentialIdentity()).create(input({ contributingAgents: ['riya'] })),
      'recommendation-invalid',
      'contributors without composite',
    );
    expectCode(
      () =>
        runtime(sequentialIdentity()).create(
          input({ composite: true, producingAgent: 'riya', contributingAgents: ['riya'] }),
        ),
      'recommendation-invalid',
      'composite not produced by jarvis',
    );
  });

  it('refuses missing evidence', () => {
    // "A recommendation without evidence is a defect."
    expectCode(
      () => runtime(sequentialIdentity()).create(input({ evidence: [] })),
      'invalid-input',
    );
  });

  it('refuses a confidence outside 0..1', () => {
    for (const confidence of [-0.1, 1.1, Number.NaN]) {
      expectCode(
        () => runtime(sequentialIdentity()).create(input({ confidence })),
        'invalid-input',
        String(confidence),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The identity / semantics boundary.
// ---------------------------------------------------------------------------

describe('a caller may state semantics, never identity or provenance', () => {
  it('refuses a caller-supplied recommendationId, contractVersion or producingSystem', () => {
    for (const over of [
      { recommendationId: '99999999-9999-4999-8999-999999999999' },
      { contractVersion: 1 },
      { producingSystem: 'qf-jarvis' },
    ]) {
      expectCode(
        () => runtime(sequentialIdentity()).create(input(over)),
        'invalid-input',
        JSON.stringify(over),
      );
    }
  });

  it('refuses a caller-supplied actionId or actionFingerprint on an action draft', () => {
    for (const over of [
      { actionId: '99999999-9999-4999-8999-999999999999' },
      { actionFingerprint: 'a'.repeat(64) },
    ]) {
      expectCode(
        () => runtime(sequentialIdentity()).create(input({ proposedActions: [actionDraft(over)] })),
        'invalid-input',
        JSON.stringify(over),
      );
    }
  });

  it('refuses any unknown key, at the top level or on an action', () => {
    for (const over of [
      { approved: true },
      { authorized: true },
      { decision: 'accept' },
      { execution: {} },
      { note: 'x' },
    ]) {
      expectCode(
        () => runtime(sequentialIdentity()).create(input(over)),
        'invalid-input',
        JSON.stringify(over),
      );
    }
    for (const over of [{ recipient: 'x' }, { executor: 'n8n' }, { idempotencyKey: 'k' }]) {
      expectCode(
        () => runtime(sequentialIdentity()).create(input({ proposedActions: [actionDraft(over)] })),
        'invalid-input',
        JSON.stringify(over),
      );
    }
  });

  it('refuses a non-object input', () => {
    const cases: readonly [string, unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['string', 'input'],
      ['number', 7],
      ['array', [input()]],
    ];
    for (const [label, bad] of cases) {
      expectCode(() => runtime(sequentialIdentity()).create(bad), 'invalid-input', label);
    }
  });
});

// ---------------------------------------------------------------------------
// Identity failures.
// ---------------------------------------------------------------------------

describe('identity failures', () => {
  it('refuses a generated recommendation id that is not a contract UUID', () => {
    const port: RecommendationRuntimeIdentityPort = {
      nextRecommendationId: () => 'not-a-uuid',
      nextActionId: () => '00000000-0000-4000-8000-000000000002',
    };
    expectCode(() => runtime(port).create(input()), 'identity-failure');
  });

  it('refuses a generated action id that is not a contract UUID', () => {
    const port: RecommendationRuntimeIdentityPort = {
      nextRecommendationId: () => '00000000-0000-4000-8000-000000000001',
      nextActionId: () => '',
    };
    expectCode(() => runtime(port).create(input()), 'identity-failure');
  });

  it('normalizes a throwing identity port, leaking nothing it threw', () => {
    const port: RecommendationRuntimeIdentityPort = {
      nextRecommendationId: () => {
        throw new Error('SECRET-ENTROPY-SOURCE-DETAIL');
      },
      nextActionId: () => '00000000-0000-4000-8000-000000000002',
    };
    try {
      runtime(port).create(input());
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(RecommendationRuntimeError);
      const serialized = `${(error as Error).message} ${String((error as Error).stack)}`;
      expect(serialized).not.toContain('SECRET-ENTROPY-SOURCE-DETAIL');
    }
  });

  it('surfaces duplicate generated action ids as recommendation-invalid', () => {
    // LOCKED CHOICE. Each identifier is individually a well-formed UUID, so nothing failed to
    // GENERATE; what failed is the assembled artifact's uniqueness invariant, which
    // `recommendationV1Schema` owns. Reporting it as an identity failure would point a reader at
    // the generator instead of at the rule that was actually broken.
    let issued = 0;
    const port: RecommendationRuntimeIdentityPort = {
      nextRecommendationId: () => '00000000-0000-4000-8000-000000000001',
      nextActionId: () => {
        issued += 1;
        return '00000000-0000-4000-8000-0000000000aa';
      },
    };
    expectCode(
      () => runtime(port).create(input({ proposedActions: [actionDraft(), actionDraft()] })),
      'recommendation-invalid',
    );
    expect(issued).toBe(2);
  });

  it('refuses a malformed identity port at construction', () => {
    for (const identity of [{}, { nextRecommendationId: () => 'x' }, 'port', 7]) {
      expectCode(
        () => createRecommendationRuntime({ identity } as never),
        'invalid-input',
        JSON.stringify(identity),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Inertness.
// ---------------------------------------------------------------------------

describe('the result is inert', () => {
  it('is deeply frozen, including nested parameters', () => {
    const result = runtime(sequentialIdentity()).create(input());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.recommendation)).toBe(true);
    expect(Object.isFrozen(result.recommendation.proposedActions)).toBe(true);
    expect(Object.isFrozen(result.recommendation.proposedActions[0])).toBe(true);
    expect(Object.isFrozen(result.recommendation.proposedActions[0]?.parameters)).toBe(true);
    expect(Object.isFrozen(result.recommendation.evidence)).toBe(true);
    expect(Object.isFrozen(result.actionBindings)).toBe(true);
    expect(Object.isFrozen(result.actionBindings[0])).toBe(true);
  });

  it('shares no reference with the caller, so a later mutation cannot rewrite it', () => {
    // `actionParametersSchema` is built on `z.custom`, which passes the caller's own object through.
    // Without the deep copy this assertion fails -- and the fingerprint would then attest to content
    // the artifact no longer holds.
    const parameters: Record<string, unknown> = { channel: 'whatsapp', delayHours: 48 };
    const evidence = [
      {
        evidenceType: 'derived-signal',
        signalCode: 'vendor.unresponsive',
        description: 'No vendor reply for six days.',
      },
    ];
    const supplied = input({ proposedActions: [actionDraft({ parameters })], evidence });

    const result = runtime(sequentialIdentity()).create(supplied);
    const before = result.actionBindings[0]?.actionFingerprint;

    parameters['channel'] = 'sms';
    parameters['injected'] = true;
    evidence.push({
      evidenceType: 'derived-signal',
      signalCode: 'other',
      description: 'Injected later.',
    });

    expect(result.recommendation.proposedActions[0]?.parameters).toEqual({
      channel: 'whatsapp',
      delayHours: 48,
    });
    expect(result.recommendation.evidence).toHaveLength(1);
    const finalized = result.recommendation.proposedActions[0];
    expect(finalized).toBeDefined();
    if (finalized === undefined) {
      throw new Error('unreachable');
    }
    expect(fingerprintProposedAction(finalized)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The public surface and its error vocabulary.
// ---------------------------------------------------------------------------

describe('the error contract', () => {
  it('exposes exactly four codes with fixed, content-free messages', () => {
    expect([...RECOMMENDATION_RUNTIME_ERROR_CODES].sort()).toEqual([
      'fingerprint-failure',
      'identity-failure',
      'invalid-input',
      'recommendation-invalid',
    ]);
    expect(Object.isFrozen(RECOMMENDATION_RUNTIME_ERROR_CODES)).toBe(true);
    for (const code of RECOMMENDATION_RUNTIME_ERROR_CODES) {
      const error = new RecommendationRuntimeError(code);
      expect(error.name).toBe('RecommendationRuntimeError');
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
      // The message says WHAT went wrong, never with which value.
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });

  it('exposes exactly one method on the runtime, and nothing that acts', () => {
    const subject = runtime();
    expect(Object.keys(subject)).toEqual(['create']);
    expect(Object.isFrozen(subject)).toBe(true);
    const surface = subject as unknown as Record<string, unknown>;
    for (const forbidden of [
      'createApprovalRequest',
      'approve',
      'decide',
      'execute',
      'send',
      'deliver',
      'dispatch',
      'emit',
      'persist',
      'callN8n',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });
});
