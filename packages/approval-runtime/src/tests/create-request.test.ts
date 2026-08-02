/**
 * QFJ-P08 — constructing a powerless approval request (ADR-0080).
 *
 * Two claims dominate.
 *
 * First, that the request is a FAITHFUL ask about an already-governed recommendation. Every
 * governance-shaped field is derived, so a caller holding a `money-related` + `founder`
 * recommendation cannot ask about it as `delegated-approver` — the laundering path that would put an
 * approval in front of somebody who should never have seen it.
 *
 * Second, that a supplied `RecommendationRuntimeResult` is treated as untrusted structural input.
 * Its fingerprints are RECOMPUTED, not read, so a binding that merely looks like a digest does not
 * pass.
 */
import { describe, expect, it } from 'vitest';

import { APPROVAL_REQUEST_CONTRACT_VERSION } from '@qf-jarvis/contracts';
import { fingerprintProposedAction } from '@qf-jarvis/recommendation-runtime';

import { ApprovalRuntimeError, createApprovalRuntime } from '../index.js';
import type { ApprovalRuntimeIdentityPort } from '../index.js';
import {
  POLICY,
  REC_CREATED_AT,
  REC_EXPIRES_AT,
  REQ_CREATED_AT,
  REQ_EXPIRES_AT,
  fixedApprovalIdentity,
  informationalSource,
  recommendationSource,
  twoActionSource,
} from './fixtures.js';

function runtime(identity?: ApprovalRuntimeIdentityPort) {
  return createApprovalRuntime(identity === undefined ? {} : { identity });
}

function requestInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  const source = recommendationSource();
  return {
    source,
    proposedActionId: source.recommendation.proposedActions[0]?.actionId,
    createdAt: REQ_CREATED_AT,
    expiresAt: REQ_EXPIRES_AT,
    policy: POLICY,
    ...over,
  };
}

function expectCode(fn: () => unknown, code: string, label = code): void {
  try {
    fn();
  } catch (error) {
    expect(error, label).toBeInstanceOf(ApprovalRuntimeError);
    expect((error as ApprovalRuntimeError).code, label).toBe(code);
    return;
  }
  throw new Error(`Expected ${label} to throw ${code}`);
}

// ---------------------------------------------------------------------------
// The happy path, and what is derived.
// ---------------------------------------------------------------------------

describe('createRequest derives its governance from the recommendation', () => {
  it('builds a request whose every governed field comes from the source', () => {
    const source = recommendationSource();
    const action = source.recommendation.proposedActions[0];
    expect(action).toBeDefined();
    if (action === undefined) {
      throw new Error('unreachable');
    }

    const request = runtime(fixedApprovalIdentity()).createRequest({
      source,
      proposedActionId: action.actionId,
      createdAt: REQ_CREATED_AT,
      expiresAt: REQ_EXPIRES_AT,
      policy: POLICY,
      causationEventId: '44444444-5555-4666-8777-888888888888',
    });

    expect(request.approvalRequestId).toBe('cccccccc-0000-4000-8000-000000000001');
    expect(request.contractVersion).toBe(APPROVAL_REQUEST_CONTRACT_VERSION);
    expect(request.producingSystem).toBe('qf-jarvis');

    // Bound to one exact action, by identity AND by content.
    expect(request.recommendationId).toBe(source.recommendation.recommendationId);
    expect(request.proposedActionId).toBe(action.actionId);
    expect(request.actionFingerprint).toBe(source.actionBindings[0]?.actionFingerprint);
    expect(request.actionFingerprint).toBe(fingerprintProposedAction(action));

    // DERIVED, not restated. This is what stops an ask being weaker than its recommendation.
    expect(request.risk).toBe(source.recommendation.risk);
    expect(request.requestedAuthority).toBe(source.recommendation.requiredApproval);
    expect(request.requestingAgent).toBe(source.recommendation.producingAgent);
    expect(request.requestingAgentVersion).toBe(source.recommendation.producingAgentVersion);
    expect(request.correlationId).toBe(source.recommendation.correlationId);
    // Worded by the action itself: no new approval prose is invented here.
    expect(request.summary).toBe(action.summary);

    // Caller-stated, and preserved exactly.
    expect(request.createdAt).toBe(REQ_CREATED_AT);
    expect(request.expiresAt).toBe(REQ_EXPIRES_AT);
    expect(request.policy).toEqual(POLICY);
    expect(request.causationEventId).toBe('44444444-5555-4666-8777-888888888888');

    // Powerless by construction: the contract has no field in which a grant could be expressed.
    const surface = request as unknown as Record<string, unknown>;
    for (const forbidden of ['outcome', 'decision', 'approved', 'decidedBy', 'validUntil']) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('omits causationEventId entirely when it is not supplied', () => {
    const request = runtime(fixedApprovalIdentity()).createRequest(requestInput());
    expect('causationEventId' in request).toBe(false);
  });

  it('carries money-related escalation through unchanged', () => {
    const source = recommendationSource({
      risk: 'money-related',
      requiredApproval: 'founder',
    });
    const request = runtime(fixedApprovalIdentity()).createRequest({
      source,
      proposedActionId: source.recommendation.proposedActions[0]?.actionId,
      createdAt: REQ_CREATED_AT,
      expiresAt: REQ_EXPIRES_AT,
      policy: POLICY,
    });
    expect(request.risk).toBe('money-related');
    expect(request.requestedAuthority).toBe('founder');
  });

  it('selects the exact action asked for, out of several', () => {
    const source = twoActionSource();
    const second = source.recommendation.proposedActions[1];
    expect(second).toBeDefined();
    if (second === undefined) {
      throw new Error('unreachable');
    }
    const request = runtime(fixedApprovalIdentity()).createRequest({
      source,
      proposedActionId: second.actionId,
      createdAt: REQ_CREATED_AT,
      expiresAt: REQ_EXPIRES_AT,
      policy: POLICY,
    });
    expect(request.proposedActionId).toBe(second.actionId);
    expect(request.summary).toBe(second.summary);
    expect(request.actionFingerprint).toBe(source.actionBindings[1]?.actionFingerprint);
  });

  it('returns a deeply frozen request that a later mutation cannot rewrite', () => {
    const source = recommendationSource();
    const request = runtime(fixedApprovalIdentity()).createRequest({
      source,
      proposedActionId: source.recommendation.proposedActions[0]?.actionId,
      createdAt: REQ_CREATED_AT,
      expiresAt: REQ_EXPIRES_AT,
      // A mutable policy object, deliberately.
      policy: { policyId: 'approval.policy', policyVersion: 3 },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.policy)).toBe(true);
    expect(() => {
      (request as unknown as Record<string, unknown>)['approved'] = true;
    }).toThrow();
    expect((request as unknown as Record<string, unknown>)['approved']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Identity.
// ---------------------------------------------------------------------------

describe('approval request identity', () => {
  it('generates a real UUID at call time when no port is supplied', () => {
    const request = runtime().createRequest(requestInput());
    expect(request.approvalRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('makes no idempotency claim: two asks are two requests', () => {
    // Deduplication belongs to a durable queue that does not exist yet. Two calls are two asks.
    const subject = runtime();
    const first = subject.createRequest(requestInput());
    const second = subject.createRequest(requestInput());
    expect(first.approvalRequestId).not.toBe(second.approvalRequestId);
  });

  it('refuses an identifier that is not an approval-request UUID', () => {
    for (const id of ['not-a-uuid', '', 'cccccccc-0000-4000-8000']) {
      expectCode(
        () => runtime(fixedApprovalIdentity(id)).createRequest(requestInput()),
        'identity-failure',
        id,
      );
    }
  });

  it('normalizes a throwing identity port, leaking nothing it threw', () => {
    const port: ApprovalRuntimeIdentityPort = {
      nextApprovalRequestId: () => {
        throw new Error('SECRET-ENTROPY-DETAIL');
      },
    };
    try {
      runtime(port).createRequest(requestInput());
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalRuntimeError);
      const serialized = `${(error as Error).message} ${String((error as Error).stack)}`;
      expect(serialized).not.toContain('SECRET-ENTROPY-DETAIL');
    }
  });

  it('refuses a malformed identity port at construction', () => {
    for (const identity of [{}, { next: () => 'x' }, 'port', 7]) {
      expectCode(
        () => createApprovalRuntime({ identity } as never),
        'invalid-input',
        JSON.stringify(identity),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The caller may not restate governance.
// ---------------------------------------------------------------------------

describe('a caller may not supply anything the runtime derives', () => {
  it('refuses every derived or forbidden key', () => {
    for (const over of [
      { approvalRequestId: 'cccccccc-0000-4000-8000-000000000009' },
      { recommendationId: 'aaaaaaaa-0000-4000-8000-000000000001' },
      { actionFingerprint: 'a'.repeat(64) },
      // The laundering attempt: a weaker authority than the recommendation was governed with.
      { requestedAuthority: 'delegated-approver' },
      { risk: 'low-risk-reversible' },
      { producingSystem: 'qf-jarvis' },
      { requestingAgent: 'jarvis' },
      { requestingAgentVersion: 'other.v9' },
      { correlationId: '11111111-2222-4333-8444-555555555555' },
      { summary: 'A different description of the same action.' },
      { contractVersion: 1 },
      { outcome: 'approved' },
      { approved: true },
      { decision: 'approved' },
      { decidedBy: { actorType: 'human', humanId: 'human.1' } },
      { issuer: 'quickfurno-core' },
      { note: 'x' },
    ]) {
      expectCode(
        () => runtime(fixedApprovalIdentity()).createRequest(requestInput(over)),
        'invalid-input',
        JSON.stringify(over),
      );
    }
  });

  it('refuses a malformed policy, causation id or timestamp', () => {
    for (const over of [
      { policy: { policyId: 'approval.policy' } },
      { policy: { policyId: 'approval.policy', policyVersion: 0 } },
      { policy: { policyId: 'approval.policy', policyVersion: 3, contents: 'the text' } },
      { causationEventId: 'not-a-uuid' },
      { createdAt: 'yesterday' },
      { expiresAt: '' },
    ]) {
      expectCode(
        () => runtime(fixedApprovalIdentity()).createRequest(requestInput(over)),
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
      ['array', []],
    ];
    for (const [label, bad] of cases) {
      expectCode(() => runtime(fixedApprovalIdentity()).createRequest(bad), 'invalid-input', label);
    }
  });
});

// ---------------------------------------------------------------------------
// The source is untrusted: bindings are recomputed, not read.
// ---------------------------------------------------------------------------

describe('the supplied source is re-proved, never believed', () => {
  it('refuses an action that is not in the recommendation', () => {
    expectCode(
      () =>
        runtime(fixedApprovalIdentity()).createRequest(
          requestInput({ proposedActionId: '99999999-8888-4777-8666-555555555555' }),
        ),
      'binding-mismatch',
    );
  });

  it('refuses a missing, extra or duplicated binding', () => {
    const base = recommendationSource();
    const binding = base.actionBindings[0];
    expect(binding).toBeDefined();
    if (binding === undefined) {
      throw new Error('unreachable');
    }
    for (const actionBindings of [[], [binding, binding], [binding, { ...binding }]]) {
      expectCode(
        () =>
          runtime(fixedApprovalIdentity()).createRequest(
            requestInput({
              source: { recommendation: base.recommendation, actionBindings },
              proposedActionId: base.recommendation.proposedActions[0]?.actionId,
            }),
          ),
        'binding-mismatch',
        `bindings:${String(actionBindings.length)}`,
      );
    }
  });

  it('refuses a binding whose ids or digest shape are wrong', () => {
    const base = recommendationSource();
    const binding = base.actionBindings[0];
    expect(binding).toBeDefined();
    if (binding === undefined) {
      throw new Error('unreachable');
    }
    for (const over of [
      { recommendationId: 'aaaaaaaa-0000-4000-8000-000000000099' },
      { proposedActionId: '99999999-8888-4777-8666-555555555555' },
      { actionFingerprint: 'NOTHEX' },
      { actionFingerprint: 'A'.repeat(64) },
      { actionFingerprint: 'a'.repeat(63) },
    ]) {
      expectCode(
        () =>
          runtime(fixedApprovalIdentity()).createRequest(
            requestInput({
              source: {
                recommendation: base.recommendation,
                actionBindings: [{ ...binding, ...over }],
              },
              proposedActionId: base.recommendation.proposedActions[0]?.actionId,
            }),
          ),
        'binding-mismatch',
        JSON.stringify(over),
      );
    }
  });

  it('refuses a well-formed digest that is not the digest of THIS action', () => {
    // The check that makes the fingerprint mean something: 64 lowercase hex characters are trivial
    // to produce, so the value is recomputed from the content actually supplied.
    const base = recommendationSource();
    const binding = base.actionBindings[0];
    expect(binding).toBeDefined();
    if (binding === undefined) {
      throw new Error('unreachable');
    }
    expectCode(
      () =>
        runtime(fixedApprovalIdentity()).createRequest(
          requestInput({
            source: {
              recommendation: base.recommendation,
              actionBindings: [{ ...binding, actionFingerprint: 'f'.repeat(64) }],
            },
            proposedActionId: base.recommendation.proposedActions[0]?.actionId,
          }),
        ),
      'binding-mismatch',
    );
  });

  it('refuses a source whose recommendation is not a valid RecommendationV1', () => {
    const base = recommendationSource();
    for (const source of [
      undefined,
      null,
      {},
      { recommendation: {}, actionBindings: [] },
      { recommendation: base.recommendation },
      { recommendation: base.recommendation, actionBindings: 'not-an-array' },
      { recommendation: { ...base.recommendation, producingSystem: 'other' }, actionBindings: [] },
    ]) {
      expectCode(
        () => runtime(fixedApprovalIdentity()).createRequest(requestInput({ source })),
        'binding-mismatch',
        JSON.stringify(source),
      );
    }
  });

  it('refuses an informational recommendation: there is nothing to approve', () => {
    // Zero actions means nothing can be selected. No synthetic action is invented, and no
    // "approve informational" path exists.
    const source = informationalSource();
    expect(source.recommendation.proposedActions).toEqual([]);
    expect(source.actionBindings).toEqual([]);
    expectCode(
      () =>
        runtime(fixedApprovalIdentity()).createRequest(
          requestInput({ source, proposedActionId: '99999999-8888-4777-8666-555555555555' }),
        ),
      'binding-mismatch',
    );
  });
});

// ---------------------------------------------------------------------------
// A request may not outlive the recommendation it asks about.
// ---------------------------------------------------------------------------

describe('request timing is bounded by the recommendation lifetime', () => {
  it('accepts a window exactly equal to the recommendation lifetime', () => {
    const request = runtime(fixedApprovalIdentity()).createRequest(
      requestInput({ createdAt: REC_CREATED_AT, expiresAt: REC_EXPIRES_AT }),
    );
    expect(request.createdAt).toBe(REC_CREATED_AT);
    expect(request.expiresAt).toBe(REC_EXPIRES_AT);
  });

  it('refuses a window that starts before, or reaches past, the recommendation', () => {
    for (const over of [
      // Before the recommendation existed.
      { createdAt: '2026-08-01T09:00:00Z' },
      // At or after the recommendation already expired.
      { createdAt: REC_EXPIRES_AT, expiresAt: '2026-08-05T09:00:00Z' },
      { createdAt: '2026-08-05T09:00:00Z', expiresAt: '2026-08-06T09:00:00Z' },
      // Zero-length or inverted.
      { createdAt: REQ_CREATED_AT, expiresAt: REQ_CREATED_AT },
      { createdAt: REQ_EXPIRES_AT, expiresAt: REQ_CREATED_AT },
      // Outliving the recommendation: an approval could then be granted for a stale conclusion.
      { expiresAt: '2026-08-05T09:00:00Z' },
    ]) {
      expectCode(
        () => runtime(fixedApprovalIdentity()).createRequest(requestInput(over)),
        'request-invalid',
        JSON.stringify(over),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The contract's own refusals are not reimplemented here.
// ---------------------------------------------------------------------------

describe('the governed approval-request contract does the refusing', () => {
  it('refuses an outbound voice call that the recommendation under-asked for', () => {
    // A recommendation may legitimately pair `outbound-voice-call` with
    // `authorized-team-human` -- `recommendationV1Schema` only escalates money. The APPROVAL
    // REQUEST contract escalates voice as well, and this runtime surfaces that refusal rather than
    // silently upgrading the authority to make the request pass.
    const source = recommendationSource({
      risk: 'outbound-voice-call',
      requiredApproval: 'authorized-team-human',
    });
    expectCode(
      () =>
        runtime(fixedApprovalIdentity()).createRequest({
          source,
          proposedActionId: source.recommendation.proposedActions[0]?.actionId,
          createdAt: REQ_CREATED_AT,
          expiresAt: REQ_EXPIRES_AT,
          policy: POLICY,
        }),
      'request-invalid',
    );
  });

  it('accepts an outbound voice call escalated to founder', () => {
    const source = recommendationSource({
      risk: 'outbound-voice-call',
      requiredApproval: 'founder',
    });
    const request = runtime(fixedApprovalIdentity()).createRequest({
      source,
      proposedActionId: source.recommendation.proposedActions[0]?.actionId,
      createdAt: REQ_CREATED_AT,
      expiresAt: REQ_EXPIRES_AT,
      policy: POLICY,
    });
    expect(request.requestedAuthority).toBe('founder');
  });
});
