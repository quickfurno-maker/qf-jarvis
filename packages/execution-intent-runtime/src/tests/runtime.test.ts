/**
 * QFJ-P09.01 — the execution intent correlation runtime (ADR-0084).
 *
 * The property this exists for:
 *
 *   **A Core-issued execution intent must faithfully name and reproduce the approved action.**
 *
 * ADR-0083 §12 forbade P09 from inferring execution action identity out of a communication
 * authorization, and required it to start from `ExecutionIntentV1` instead. These specs are that
 * lock, exercised: identity by four exact ids, content by exact type, version and structurally
 * identical governed parameters, timing by relationships between artifacts and never a clock.
 *
 * And the negative property, which matters just as much: passing all of that still does not mean
 * "execute it now". There is no freshness claim, no permission flag, and no consent answer anywhere
 * in the result.
 */
import { describe, expect, it } from 'vitest';

import {
  EXECUTION_INTENT_RUNTIME_ERROR_CODES,
  ExecutionIntentRuntimeError,
  createExecutionIntentRuntime,
} from '../index.js';
import {
  DECIDED_AT,
  INTENT_EXPIRES_AT,
  ISSUED_AT,
  OTHER_CORRELATION_ID,
  REC_EXPIRES_AT,
  executionIntent,
  partiallyApprovedScenario,
  scenario,
  substitutingEvidence,
  withSubstitutedExpiry,
  withSubstitutedParameters,
} from './fixtures.js';

const runtime = createExecutionIntentRuntime();

function expectCode(call: () => unknown, code: string, label = code): void {
  expect(call, label).toThrow(expect.objectContaining({ code }));
}

describe('public API', () => {
  it('exports exactly three root runtime symbols and no default', async () => {
    const barrel: Record<string, unknown> = await import('../index.js');
    expect(Object.keys(barrel).sort()).toEqual([
      'EXECUTION_INTENT_RUNTIME_ERROR_CODES',
      'ExecutionIntentRuntimeError',
      'createExecutionIntentRuntime',
    ]);
    expect(barrel['default']).toBeUndefined();
  });

  it('exposes exactly ONE method, and nothing that issues, dispatches or executes', () => {
    expect(Object.keys(runtime)).toEqual(['validate']);
    expect(Object.isFrozen(runtime)).toBe(true);
    const surface = runtime as unknown as Record<string, unknown>;
    for (const forbidden of [
      'issue',
      'createIntent',
      'authorize',
      'approve',
      'execute',
      'dispatch',
      'send',
      'deliver',
      'retry',
      'submit',
      'enqueue',
      'publish',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('exposes exactly seven error codes with fixed, content-free messages', () => {
    expect([...EXECUTION_INTENT_RUNTIME_ERROR_CODES].sort()).toEqual([
      'action-mismatch',
      'approval-invalid',
      'approval-not-approved',
      'binding-mismatch',
      'intent-invalid',
      'invalid-input',
      'timing-mismatch',
    ]);
    expect(Object.isFrozen(EXECUTION_INTENT_RUNTIME_ERROR_CODES)).toBe(true);
    for (const code of EXECUTION_INTENT_RUNTIME_ERROR_CODES) {
      const error = new ExecutionIntentRuntimeError(code);
      expect(error.name).toBe('ExecutionIntentRuntimeError');
      expect(error.code).toBe(code);
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });

  it('refuses input that is not a validation request at all', () => {
    for (const input of [undefined, null, 'execute it', 7, []]) {
      expectCode(() => runtime.validate(input as never), 'invalid-input', String(input));
    }
  });
});

describe('a faithful Core intent', () => {
  it('is observed when it names and reproduces the approved action exactly', () => {
    const s = scenario('a1a1a1a1');
    const intent = executionIntent(s);

    const observation = runtime.validate({ intent, approval: s.evidence } as never);

    expect(observation.intent).toEqual(intent);
    expect(observation.approvalCorrelation.proposedActionId).toBe(s.actionId);
    expect(observation.approvalCorrelation.actionDecision.decision).toBe('approved');
    expect(observation.approvedAction.actionId).toBe(s.actionId);
    expect(observation.approvedAction.actionType).toBe(s.actionType);
    expect(observation.approvedAction.parameters).toEqual(s.parameters);
  });

  it('accepts governed parameters whose KEY ORDER differs from the approved action', () => {
    // Same semantic JSON, different insertion order. `JSON.stringify` comparison would reject this
    // for no reason a human could see, and a false negative here blocks a legitimate effect.
    const s = scenario('a2a2a2a2');
    const reordered = {
      window: { end: '18:00', start: '09:00' },
      tags: ['sample', 'overdue'],
      escalate: false,
      delayHours: 48,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(s.parameters));

    const observation = runtime.validate({
      intent: executionIntent(s, { parameters: reordered }),
      approval: s.evidence,
    } as never);
    expect(observation.intent.parameters).toEqual(s.parameters);
  });

  it('accepts an intent issued at the exact instant of the decision', () => {
    const s = scenario('a3a3a3a3');
    const observation = runtime.validate({
      intent: executionIntent(s, { issuedAt: DECIDED_AT }),
      approval: s.evidence,
    } as never);
    expect(observation.intent.issuedAt).toBe(DECIDED_AT);
  });

  it('accepts an intent expiring at the exact instant the recommendation does', () => {
    // Expiring together is coherent. Expiring LATER is the window this rule closes.
    const s = scenario('a4a4a4a4');
    const observation = runtime.validate({
      intent: executionIntent(s, { expiresAt: REC_EXPIRES_AT }),
      approval: s.evidence,
    } as never);
    expect(observation.intent.expiresAt).toBe(REC_EXPIRES_AT);
  });
});

describe('the approval must actually approve THIS action', () => {
  it('refuses when the selected action was rejected, though the decision is approved overall', () => {
    // The partial-approval trap. `decision.outcome` is `approved` because a DIFFERENT action was;
    // an intent that ran on the overall outcome would execute an action a human refused.
    const s = partiallyApprovedScenario('b1b1b1b1');
    expect(s.evidence.decision.outcome).toBe('approved');

    expectCode(
      () => runtime.validate({ intent: executionIntent(s), approval: s.evidence } as never),
      'approval-not-approved',
    );
  });

  it('refuses malformed approval evidence, and a caller-supplied conclusion', () => {
    const s = scenario('b2b2b2b2');
    for (const [label, approval] of [
      ['not an object', 'the approval'],
      ['empty', {}],
      ['no decision', { source: s.evidence.source, request: s.evidence.request }],
      ['no source', { request: s.evidence.request, decision: s.evidence.decision }],
      [
        'a decision Core could not have issued',
        { ...s.evidence, decision: { ...s.evidence.decision, issuer: 'qf-jarvis' } },
      ],
      // A correlation is a CONCLUSION. Accepting one would let the caller assert the very thing
      // this runtime exists to prove.
      [
        'a caller-supplied correlation conclusion',
        {
          recommendationId: s.recommendationId,
          proposedActionId: s.actionId,
          actionDecision: { actionId: s.actionId, decision: 'approved' },
          decision: s.evidence.decision,
        },
      ],
      ['a bare boolean', { approved: true }],
    ] as const) {
      expectCode(
        () => runtime.validate({ intent: executionIntent(s), approval } as never),
        'approval-invalid',
        label,
      );
    }
  });
});

describe('exact identity binding — what P08 could not prove', () => {
  it('refuses a foreign recommendation, decision, action or correlation thread', () => {
    const s = scenario('c1c1c1c1');
    const other = scenario('c2c2c2c2');
    for (const [label, over] of [
      ['foreign recommendation id', { recommendationId: other.recommendationId }],
      ['foreign approval decision id', { approvalDecisionId: other.decisionId }],
      ['foreign approved action id', { approvedActionId: other.actionId }],
      ['foreign correlation thread', { correlationId: OTHER_CORRELATION_ID }],
    ] as const) {
      expectCode(
        () => runtime.validate({ intent: executionIntent(s, over), approval: s.evidence } as never),
        'binding-mismatch',
        label,
      );
    }
  });

  it('has no fallback that matches on anything but the ids', () => {
    // A different recommendation whose action carries IDENTICAL type, version and parameters. If
    // anything here matched on content when the ids disagree, this would pass -- and that is exactly
    // the heuristic ADR-0083 §11 forbids.
    const s = scenario('c3c3c3c3');
    const twin = scenario('c4c4c4c4');
    expect(twin.actionType).toBe(s.actionType);
    expect(twin.parameters).toEqual(s.parameters);
    expect(twin.actionId).not.toBe(s.actionId);

    expectCode(
      () =>
        runtime.validate({
          intent: executionIntent(s, { approvedActionId: twin.actionId }),
          approval: s.evidence,
        } as never),
      'binding-mismatch',
    );
  });
});

describe('exact action content binding', () => {
  it('refuses an altered action type or contract version', () => {
    const s = scenario('d1d1d1d1');
    for (const [label, over] of [
      ['altered action type', { actionType: 'notify.owner' }],
      ['altered contract version', { actionContractVersion: 2 }],
    ] as const) {
      expectCode(
        () => runtime.validate({ intent: executionIntent(s, over), approval: s.evidence } as never),
        'action-mismatch',
        label,
      );
    }
  });

  it('refuses altered, extra, missing or reordered parameters', () => {
    const s = scenario('d2d2d2d2');
    for (const [label, parameters] of [
      ['a changed value', { ...s.parameters, delayHours: 24 }],
      ['a changed nested value', { ...s.parameters, window: { start: '09:00', end: '23:00' } }],
      ['an extra key', { ...s.parameters, escalateTo: 'owner' }],
      [
        'an extra nested key',
        { ...s.parameters, window: { start: '09:00', end: '18:00', tz: 'IST' } },
      ],
      ['a missing key', { delayHours: 48, escalate: false, tags: ['sample', 'overdue'] }],
      // An ordered list is part of the value: a reordered one is a different instruction.
      ['a reordered array', { ...s.parameters, tags: ['overdue', 'sample'] }],
      ['a shortened array', { ...s.parameters, tags: ['sample'] }],
      // No coercion, ever.
      ['a stringified number', { ...s.parameters, delayHours: '48' }],
      ['a stringified boolean', { ...s.parameters, escalate: 'false' }],
      ['a case-changed value', { ...s.parameters, tags: ['Sample', 'overdue'] }],
      ['a whitespace-padded value', { ...s.parameters, window: { start: ' 09:00', end: '18:00' } }],
      ['empty parameters', {}],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            intent: executionIntent(s, { parameters }),
            approval: s.evidence,
          } as never),
        'action-mismatch',
        label,
      );
    }
  });
});

describe('temporal relationships between artifacts — and no clock', () => {
  it('refuses an intent that predates the Core decision it cites', () => {
    const s = scenario('e1e1e1e1');
    expectCode(
      () =>
        runtime.validate({
          intent: executionIntent(s, { issuedAt: '2026-08-02T10:59:59Z' }),
          approval: s.evidence,
        } as never),
      'timing-mismatch',
    );
  });

  it('refuses an intent issued at or after the recommendation expires', () => {
    const s = scenario('e2e2e2e2');
    for (const [label, issuedAt] of [
      ['exactly at expiry', REC_EXPIRES_AT],
      ['after expiry', '2026-08-05T00:00:00Z'],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            intent: executionIntent(s, { issuedAt, expiresAt: '2026-08-06T00:00:00Z' }),
            approval: s.evidence,
          } as never),
        'timing-mismatch',
        label,
      );
    }
  });

  it('refuses an intent that would OUTLIVE the recommendation whose action it runs', () => {
    // The reasoning behind the action has lapsed; the permission must not still be live.
    const s = scenario('e3e3e3e3');
    expectCode(
      () =>
        runtime.validate({
          intent: executionIntent(s, { expiresAt: '2026-08-04T09:00:01Z' }),
          approval: s.evidence,
        } as never),
      'timing-mismatch',
    );
  });

  it('compares instants through the contract, not as strings', () => {
    // RFC 3339 admits fractional seconds, and `...:00.5Z` sorts BEFORE `...:00Z` lexicographically
    // while being after it in time. A string comparison would call this intent premature.
    const s = scenario('e4e4e4e4');
    const observation = runtime.validate({
      intent: executionIntent(s, { issuedAt: '2026-08-02T11:00:00.5Z' }),
      approval: s.evidence,
    } as never);
    expect(observation.intent.issuedAt).toBe('2026-08-02T11:00:00.5Z');
  });

  it('makes no claim that the intent is live NOW', () => {
    // Every rule above is a relationship BETWEEN artifacts, so the observation is true whenever it
    // is evaluated -- including long after both instants have passed. Dispatch-time freshness is a
    // later execution-side check against a trusted execution-side clock.
    const s = scenario('e5e5e5e5');
    const observation = runtime.validate({
      intent: executionIntent(s),
      approval: s.evidence,
    } as never);
    const surface = observation as unknown as Record<string, unknown>;
    for (const forbidden of ['isFresh', 'fresh', 'currentlyValid', 'freshUntil', 'expired']) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
    // The intent's own window is reported verbatim; nothing derived from it is.
    expect(observation.intent.issuedAt).toBe(ISSUED_AT);
    expect(observation.intent.expiresAt).toBe(INTENT_EXPIRES_AT);
  });
});

describe('the intent contract is what proves issuer, executor and semantics', () => {
  it('refuses a wrong issuer, executor or delivery semantics', () => {
    // Structural, from `executionIntentV1Schema`. Only Core issues; only n8n executes; at-most-once
    // is a literal, so at-least-once cannot be expressed at all.
    const s = scenario('f1f1f1f1');
    for (const [label, over] of [
      ['issued by Jarvis', { issuer: 'qf-jarvis' }],
      ['issued by n8n', { issuer: 'n8n' }],
      ['executed by Core', { executor: 'quickfurno-core' }],
      ['executed by Jarvis', { executor: 'qf-jarvis' }],
      ['at-least-once', { deliverySemantics: 'at-least-once' }],
      ['exactly-once', { deliverySemantics: 'exactly-once' }],
    ] as const) {
      expectCode(
        () => runtime.validate({ intent: executionIntent(s, over), approval: s.evidence } as never),
        'intent-invalid',
        label,
      );
    }
  });

  it('refuses a missing or malformed idempotency key', () => {
    const s = scenario('f2f2f2f2');
    for (const [label, idempotencyKey] of [
      ['absent', undefined],
      ['empty', ''],
      ['not a string', 12345],
      ['illegal characters', 'intent key/with spaces'],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            intent: executionIntent(s, { idempotencyKey }),
            approval: s.evidence,
          } as never),
        'intent-invalid',
        label,
      );
    }
  });

  it('refuses retry permission, contact details or credentials smuggled into parameters', () => {
    // The governed parameter schema refuses these structurally. A key that granted a second external
    // effect, or carried a recipient or a secret, would be authority arriving as data.
    const s = scenario('f3f3f3f3');
    for (const [label, extra] of [
      ['retry', { retry: true }],
      ['maxAttempts', { maxAttempts: 3 }],
      ['resend', { resend: true }],
      ['redial', { redial: true }],
      ['approved', { approved: true }],
      ['authorized', { authorized: true }],
      ['apiKey', { apiKey: 'sk-live-abc123' }],
      ['phoneNumber', { phoneNumber: '+919876543210' }],
      ['email', { email: 'vendor@example.com' }],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            intent: executionIntent(s, { parameters: { ...s.parameters, ...extra } }),
            approval: s.evidence,
          } as never),
        'intent-invalid',
        label,
      );
    }
  });

  it('refuses an intent whose expiry does not follow its issuance', () => {
    const s = scenario('f4f4f4f4');
    expectCode(
      () =>
        runtime.validate({
          intent: executionIntent(s, { expiresAt: ISSUED_AT }),
          approval: s.evidence,
        } as never),
      'intent-invalid',
    );
  });
});

describe('approval evidence is snapshotted, so it cannot change under validation', () => {
  it('refuses SUBSTITUTED action content shown only to the second read', () => {
    // The TOCTOU this snapshot closes. `source` is caller-controlled and `source: z.unknown()` in
    // the approval runtime's input, so a hostile object can expose `recommendation` as an accessor:
    // the approval proof is shown the ORIGINAL content its fingerprint actually covers, and any
    // LATER read is shown a different, individually schema-valid recommendation with the same
    // recommendationId, actionId and correlationId but different parameters. An intent built on the
    // substituted content would then validate against content nobody approved.
    const s = scenario('7a7a7a7a');
    expect(s.parameters['delayHours']).toBe(48);

    const substituted = withSubstitutedParameters(s, { ...s.parameters, delayHours: 96 });
    const hostile = substitutingEvidence(s, substituted);

    // The intent claims the SUBSTITUTED content.
    const intent = executionIntent(s, { parameters: { ...s.parameters, delayHours: 96 } });

    // There must be no successful observation for substituted content. `action-mismatch` is the
    // deterministic outcome once one stable snapshot feeds both phases: the recovered action still
    // says 48, and the intent says 96.
    expectCode(
      () => runtime.validate({ intent, approval: hostile.evidence } as never),
      'action-mismatch',
    );

    // And the accessor could not serve two different values to two phases: the snapshot reads it
    // ONCE, before the proof, and everything downstream works from that detached copy.
    expect(hostile.reads()).toBe(1);
  });

  it('refuses a SUBSTITUTED, later recommendation expiry shown only to the second read', () => {
    // The same gap reaches the timing bounds. A later `expiresAt` presented after the proof would
    // make a stale intent look like it sits inside the recommendation's window.
    const s = scenario('7b7b7b7b');
    const substituted = withSubstitutedExpiry(s, '2026-08-10T09:00:00Z');
    const hostile = substitutingEvidence(s, substituted);

    // Issued and expiring AFTER the original recommendation expired (2026-08-04T09:00:00Z), but
    // comfortably inside the substituted window.
    const intent = executionIntent(s, {
      issuedAt: '2026-08-05T00:00:00Z',
      expiresAt: '2026-08-06T00:00:00Z',
    });

    expectCode(
      () => runtime.validate({ intent, approval: hostile.evidence } as never),
      'timing-mismatch',
    );
    expect(hostile.reads()).toBe(1);
  });

  it('is unaffected by the caller mutating its own evidence afterwards', () => {
    // The ordinary half of the same property: the observation is built from validated, detached
    // artifacts, so a caller holding a reference to the nested source cannot edit what was proved.
    const s = scenario('7c7c7c7c');
    const mutable = {
      source: {
        recommendation: JSON.parse(JSON.stringify(s.source.recommendation)) as Record<
          string,
          unknown
        >,
        actionBindings: s.source.actionBindings,
      },
      request: s.evidence.request,
      decision: s.evidence.decision,
    };
    const observation = runtime.validate({
      intent: executionIntent(s),
      approval: mutable,
    } as never);
    expect(observation.approvedAction.parameters['delayHours']).toBe(48);

    // Edit the caller's own object after the fact.
    const actions = mutable.source.recommendation['proposedActions'] as Record<string, unknown>[];
    const first = actions[0];
    if (first === undefined) {
      throw new Error('unreachable');
    }
    (first['parameters'] as Record<string, unknown>)['delayHours'] = 96;

    // The observation is unchanged, and still frozen.
    expect(observation.approvedAction.parameters['delayHours']).toBe(48);
    expect(Object.isFrozen(observation.approvedAction)).toBe(true);
  });
});

describe('the observation confers nothing', () => {
  it('carries exactly three fields and no authority, freshness or consent flag', () => {
    const s = scenario('1a1a1a1a');
    const observation = runtime.validate({
      intent: executionIntent(s),
      approval: s.evidence,
    } as never);

    expect(Object.keys(observation).sort()).toEqual([
      'approvalCorrelation',
      'approvedAction',
      'intent',
    ]);
    const surface = observation as unknown as Record<string, unknown>;
    for (const forbidden of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'approved',
      'authorized',
      'valid',
      'fresh',
      'isFresh',
      'consentValid',
      'communicationAllowed',
      'retryAllowed',
      'isIdempotent',
      'used',
      'consumed',
      'status',
      'pending',
      'executed',
      'delivered',
      'recipient',
      'provider',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('observes the idempotency key without deriving anything from it', () => {
    // P09.01 does not generate, reserve, consume or deduplicate keys, and makes no
    // duplicate-prevention claim. One-effect semantics belong to the execution side.
    const s = scenario('2b2b2b2b');
    const intent = executionIntent(s);
    const first = runtime.validate({ intent, approval: s.evidence } as never);
    const second = runtime.validate({ intent, approval: s.evidence } as never);

    // Validating twice is not "using" anything: a pure function has no memory to consume.
    expect(second.intent.idempotencyKey).toBe(first.intent.idempotencyKey);
    expect(second.intent.idempotencyKey).toBe(intent['idempotencyKey']);
    expect(second.intent.deliverySemantics).toBe('at-most-once');
    const surface = second as unknown as Record<string, unknown>;
    for (const forbidden of ['isIdempotent', 'canRetry', 'retryAllowed', 'used', 'consumed']) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('is deeply frozen, so a validated intent cannot be edited afterwards', () => {
    const s = scenario('3c3c3c3c');
    const observation = runtime.validate({
      intent: executionIntent(s),
      approval: s.evidence,
    } as never);

    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.intent)).toBe(true);
    expect(Object.isFrozen(observation.intent.parameters)).toBe(true);
    expect(Object.isFrozen(observation.approvedAction)).toBe(true);
    expect(Object.isFrozen(observation.approvalCorrelation)).toBe(true);
    // The forgery this prevents: an intent that passed a check it no longer satisfies.
    expect(() => {
      (observation.intent.parameters as Record<string, unknown>)['delayHours'] = 1;
    }).toThrow();
    expect(observation.intent.parameters['delayHours']).toBe(48);
  });
});
