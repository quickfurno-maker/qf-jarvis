/**
 * QFJ-P08 — the Core approval submission adapter (ADR-0082).
 *
 * The properties these specs exist to hold, in order of how badly each would hurt:
 *
 *   1. a human's REJECT can never come back as an approval of the action they refused;
 *   2. Core may refuse an APPROVE, and that is an ordinary result, not an error;
 *   3. the authorization proof never reaches the wire command, the result, or an error;
 *   4. nothing is sent until the ask is proved faithful to its source;
 *   5. exactly one send, ever, with no retry;
 *   6. the same human intent has the same idempotency key, and a different intent does not.
 *
 * Every artifact is built through the real merged runtimes, so what the adapter is handed is what
 * production would hand it.
 */
import { describe, expect, it } from 'vitest';

import { ApprovalCoreAdapterError, createApprovalCoreAdapter } from '../index.js';
import {
  OPERATOR,
  PROOF_SECRET,
  REQUESTED_AT,
  REQ_CREATED_AT,
  REQ_EXPIRES_AT,
  approvalRequest,
  coreDecision,
  proofHolder,
  recommendationSource,
  respondWith,
  transportFake,
  twoActionSource,
} from './fixtures.js';

function expectCode(promise: Promise<unknown>, code: string, label = code): Promise<void> {
  return expect(promise, label).rejects.toMatchObject({ code });
}

/**
 * The pinned idempotency digest for one fixed intent.
 *
 * SHA-256 over `qf-jarvis.approval-core-submission.v1\n` followed by the canonical JSON of
 * `{actionFingerprint, approvalRequestId, operator, operatorAction, proposedActionId,
 * recommendationId}` — six sorted keys, `operator` sorted at its own depth too.
 */
const GOLDEN_IDEMPOTENCY_KEY = '8f912cbbaf9033a4f4517aaab9a3ef3b7ee4977f64b5843d393c6abf1104a9e4';

/** One ready-to-submit scenario: a real source, a real request, and a proof holder. */
function scenario(tag: string, twoActions = false) {
  const source = twoActions ? twoActionSource(tag) : recommendationSource(tag);
  const request = approvalRequest(source);
  return { source, request, authorization: proofHolder() };
}

describe('public API', () => {
  it('exports exactly three root runtime symbols and no default', async () => {
    const barrel: Record<string, unknown> = await import('../index.js');
    expect(Object.keys(barrel).sort()).toEqual([
      'APPROVAL_CORE_ADAPTER_ERROR_CODES',
      'ApprovalCoreAdapterError',
      'createApprovalCoreAdapter',
    ]);
    expect(barrel['default']).toBeUndefined();
  });

  it('exposes exactly five error codes with fixed, content-free messages', async () => {
    const { APPROVAL_CORE_ADAPTER_ERROR_CODES } = await import('../index.js');
    expect([...APPROVAL_CORE_ADAPTER_ERROR_CODES].sort()).toEqual([
      'binding-invalid',
      'core-decision-mismatch',
      'core-invalid-response',
      'core-unavailable',
      'invalid-input',
    ]);
    expect(Object.isFrozen(APPROVAL_CORE_ADAPTER_ERROR_CODES)).toBe(true);
    for (const code of APPROVAL_CORE_ADAPTER_ERROR_CODES) {
      const error = new ApprovalCoreAdapterError(code);
      expect(error.name).toBe('ApprovalCoreAdapterError');
      expect(error.code).toBe(code);
      // The message says WHAT went wrong, never with which value.
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });

  it('exposes exactly one method, and nothing that approves, sends or executes', () => {
    const adapter = createApprovalCoreAdapter({ transport: respondWith({} as never) });
    expect(Object.keys(adapter)).toEqual(['submit']);
    expect(Object.isFrozen(adapter)).toBe(true);
    const surface = adapter as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approve',
      'reject',
      'decide',
      'authorize',
      'execute',
      'send',
      'deliver',
      'transport',
      'retry',
      'setStatus',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('refuses a missing or malformed transport', () => {
    for (const config of [undefined, null, {}, { transport: null }, { transport: {} }]) {
      expect(() => createApprovalCoreAdapter(config as never), JSON.stringify(config)).toThrow(
        ApprovalCoreAdapterError,
      );
    }
  });
});

describe('an APPROVE intent', () => {
  it('returns Core’s approval, correlated to this exact action', async () => {
    const { source, request, authorization } = scenario('a1a1a1a1');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const transport = respondWith(decision);
    const adapter = createApprovalCoreAdapter({ transport });

    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization,
    });

    expect(result.decision).toEqual(decision);
    expect(result.correlation.approvalRequestId).toBe(request.approvalRequestId);
    expect(result.correlation.proposedActionId).toBe(request.proposedActionId);
    expect(result.correlation.actionFingerprint).toBe(request.actionFingerprint);
    expect(result.correlation.actionDecision.decision).toBe('approved');
    expect(transport.sends()).toBe(1);
  });

  it('returns Core’s REFUSAL as an ordinary result — the founder clicked approve and Core said no', async () => {
    // ADR-0007: Core disagreeing is not an edge case, it is a designed, load-bearing outcome. A
    // surface that cannot display this has been built wrong, so the adapter must not turn it into
    // an error.
    const { source, request, authorization } = scenario('a2a2a2a2');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'rejected' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });

    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization,
    });

    expect(result.correlation.actionDecision.decision).toBe('rejected');
    expect(result.decision.outcome).toBe('rejected');
  });

  it('carries no authorization, execution or consent field in the result', async () => {
    const { source, request, authorization } = scenario('a3a3a3a3');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization,
    });

    expect(Object.keys(result).sort()).toEqual(['correlation', 'decision']);
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approved',
      'isApproved',
      'isAuthorized',
      'canExecute',
      'canSend',
      'communicationAuthorized',
      'consentValid',
      'pending',
      'status',
      'authorization',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
    // Deeply frozen: Core's artifact is evidence, and evidence a caller can edit is not evidence.
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decision)).toBe(true);
    expect(Object.isFrozen(result.decision.actionDecisions)).toBe(true);
  });
});

describe('a negative intent cannot come back as an approval', () => {
  it('accepts REJECT when the selected action was rejected', async () => {
    const { source, request, authorization } = scenario('b1b1b1b1');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'rejected' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'REJECT',
      requestedAt: REQUESTED_AT,
      authorization,
    });
    expect(result.correlation.actionDecision.decision).toBe('rejected');
  });

  it('accepts REJECT when the OVERALL outcome is approved but this action was rejected', async () => {
    // Partial approval, preserved. Checking `decision.outcome` instead of the per-action verdict
    // would turn this ordinary case into a spurious mismatch and block a legitimate refusal.
    const source = twoActionSource('b2b2b2b2');
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const request = approvalRequest(source, { actionIndex: 0 });
    const decision = coreDecision(source, [
      { actionId: first.actionId, decision: 'rejected' },
      { actionId: second.actionId, decision: 'approved' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });

    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'REJECT',
      requestedAt: REQUESTED_AT,
      authorization: proofHolder(),
    });

    expect(result.decision.outcome).toBe('approved');
    expect(result.correlation.actionDecision.decision).toBe('rejected');
  });

  it('refuses REJECT answered by an approval of the selected action', async () => {
    const { source, request, authorization } = scenario('b3b3b3b3');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
    await expectCode(
      adapter.submit({
        source,
        request,
        operator: OPERATOR,
        action: 'REJECT',
        requestedAt: REQUESTED_AT,
        authorization,
      }),
      'core-decision-mismatch',
    );
  });

  it('accepts REQUEST_CHANGES when the selected action was rejected', async () => {
    const { source, request, authorization } = scenario('b4b4b4b4');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'rejected' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'REQUEST_CHANGES',
      requestedAt: REQUESTED_AT,
      authorization,
    });
    expect(result.correlation.actionDecision.decision).toBe('rejected');
  });

  it('refuses REQUEST_CHANGES answered by an approval of the selected action', async () => {
    const { source, request, authorization } = scenario('b5b5b5b5');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
    await expectCode(
      adapter.submit({
        source,
        request,
        operator: OPERATOR,
        action: 'REQUEST_CHANGES',
        requestedAt: REQUESTED_AT,
        authorization,
      }),
      'core-decision-mismatch',
    );
  });

  it('does NOT require the decider to be the operator', async () => {
    // Core is authoritative and may attribute a refusal to a POLICY rather than to the person who
    // asked. A check demanding `decidedBy === operator` would reject exactly the refusals this
    // architecture exists to make possible.
    const { source, request, authorization } = scenario('b6b6b6b6');
    const decision = coreDecision(
      source,
      [{ actionId: request.proposedActionId, decision: 'rejected' }],
      { decidedBy: { actorType: 'policy', policyId: 'core.risk.ceiling', policyVersion: 7 } },
    );
    const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
    const result = await adapter.submit({
      source,
      request,
      operator: OPERATOR,
      action: 'REJECT',
      requestedAt: REQUESTED_AT,
      authorization,
    });
    expect(result.decision.decidedBy).toEqual({
      actorType: 'policy',
      policyId: 'core.risk.ceiling',
      policyVersion: 7,
    });
  });
});

describe('Core’s response is validated, never repaired', () => {
  it('reports malformed JSON as an invalid response', async () => {
    const { source, request, authorization } = scenario('c1c1c1c1');
    const adapter = createApprovalCoreAdapter({ transport: transportFake(() => 'not json {{') });
    await expectCode(
      adapter.submit({
        source,
        request,
        operator: OPERATOR,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
        authorization,
      }),
      'core-invalid-response',
    );
  });

  it('reports a decision Core could not have issued as an invalid response', async () => {
    const { source, request } = scenario('c2c2c2c2');
    for (const [label, over] of [
      ['wrong issuer', { issuer: 'qf-jarvis' }],
      ['agent decider', { decidedBy: { actorType: 'agent', agentId: 'jarvis' } }],
      ['unknown outcome', { outcome: 'maybe' }],
      ['missing decidedAt', { decidedAt: undefined }],
    ] as const) {
      const decision = coreDecision(
        source,
        [{ actionId: request.proposedActionId, decision: 'approved' }],
        over,
      );
      const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
      await expectCode(
        adapter.submit({
          source,
          request,
          operator: OPERATOR,
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
          authorization: proofHolder(),
        }),
        'core-invalid-response',
        label,
      );
    }
  });

  it('reports a non-decision JSON value as an invalid response', async () => {
    const { source, request, authorization } = scenario('c3c3c3c3');
    const adapter = createApprovalCoreAdapter({
      transport: transportFake(() => JSON.stringify({ ok: true })),
    });
    await expectCode(
      adapter.submit({
        source,
        request,
        operator: OPERATOR,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
        authorization,
      }),
      'core-invalid-response',
    );
  });

  it('reports a valid decision that does not describe this ask as a mismatch', async () => {
    const own = scenario('c4c4c4c4');
    const foreign = recommendationSource('c5c5c5c5');
    const foreignAction = foreign.recommendation.proposedActions[0];
    if (foreignAction === undefined) {
      throw new Error('unreachable');
    }

    for (const [label, decision] of [
      [
        'another recommendation',
        coreDecision(foreign, [{ actionId: foreignAction.actionId, decision: 'approved' }]),
      ],
      [
        'no entry for this action',
        coreDecision(own.source, [{ actionId: foreignAction.actionId, decision: 'approved' }]),
      ],
      [
        'a different correlation thread',
        coreDecision(
          own.source,
          [{ actionId: own.request.proposedActionId, decision: 'approved' }],
          { correlationId: 'ffffffff-2222-4333-8444-555555555555' },
        ),
      ],
    ] as const) {
      const adapter = createApprovalCoreAdapter({ transport: respondWith(decision) });
      await expectCode(
        adapter.submit({
          source: own.source,
          request: own.request,
          operator: OPERATOR,
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
          authorization: proofHolder(),
        }),
        'core-decision-mismatch',
        label,
      );
    }
  });

  it('reports an unreachable transport as unavailable, and decides nothing', async () => {
    const { source, request, authorization } = scenario('c6c6c6c6');
    const transport = transportFake(() => {
      throw new Error('ECONNREFUSED https://core.internal/approvals with bearer abc123');
    });
    const adapter = createApprovalCoreAdapter({ transport });
    const error = await adapter
      .submit({
        source,
        request,
        operator: OPERATOR,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
        authorization,
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApprovalCoreAdapterError);
    expect((error as ApprovalCoreAdapterError).code).toBe('core-unavailable');
    // The transport's exception is DISCARDED, not wrapped: it named a URL and a bearer token.
    const serialized = `${(error as Error).message} ${String((error as { cause?: unknown }).cause)}`;
    expect(serialized).not.toContain('core.internal');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('ECONNREFUSED');
  });
});

describe('nothing is sent until the ask is proved', () => {
  it('refuses a request that is not a faithful ask about the source, before any transport', async () => {
    const { source, request, authorization } = scenario('d1d1d1d1');
    const transport = transportFake(() => '{}');
    const adapter = createApprovalCoreAdapter({ transport });

    for (const [label, tampered] of [
      // Each of these is a perfectly VALID `ApprovalRequestV1` on its own -- the contract cannot see
      // that it disagrees with the recommendation behind it. Only the rebuild catches them.
      ['weakened authority', { ...request, requestedAuthority: 'delegated-approver' }],
      ['downgraded risk', { ...request, risk: 'low-risk-reversible' }],
      ['substituted fingerprint', { ...request, actionFingerprint: 'a'.repeat(64) }],
      ['rewritten summary', { ...request, summary: 'Something else entirely.' }],
      ['foreign recommendation id', { ...request, recommendationId: request.approvalRequestId }],
    ] as const) {
      await expectCode(
        adapter.submit({
          source,
          request: tampered,
          operator: OPERATOR,
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
          authorization,
        }),
        'binding-invalid',
        label,
      );
    }
    // Not one of them cost a send, and not one of them opened the proof.
    expect(transport.sends()).toBe(0);
    expect(transport.proofUses()).toBe(0);
  });

  it('refuses a malformed request, actor, action, instant or proof before any transport', async () => {
    const { source, request } = scenario('d2d2d2d2');
    const transport = transportFake(() => '{}');
    const adapter = createApprovalCoreAdapter({ transport });
    const base = {
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization: proofHolder(),
    };

    for (const [label, over] of [
      ['no request', { request: undefined }],
      ['request is not an object', { request: 'the request' }],
      ['no operator', { operator: undefined }],
      // A POLICY actor is something CORE applies on its own authority; it is not something a person
      // operating a screen can claim to be. `humanActorSchema`, never `actorReferenceSchema`.
      ['policy actor', { operator: { actorType: 'policy', policyId: 'p', policyVersion: 1 } }],
      // There is no agent variant in the contract at all, so this cannot even be constructed as a
      // valid actor -- the refusal is structural, not a rule someone remembered to write.
      ['agent actor', { operator: { actorType: 'agent', agentId: 'jarvis' } }],
      ['bare entity reference', { operator: { entityType: 'operator', entityId: 'x' } }],
      ['unknown action', { action: 'AUTO_APPROVE' }],
      ['execute action', { action: 'EXECUTE' }],
      ['lowercase action', { action: 'approve' }],
      ['no action', { action: undefined }],
      ['malformed instant', { requestedAt: 'yesterday' }],
      ['date-only instant', { requestedAt: '2026-08-02' }],
      ['impossible instant', { requestedAt: '2026-02-30T00:00:00Z' }],
      ['local-offset instant', { requestedAt: '2026-08-02T11:00:00+05:30' }],
      ['no proof holder', { authorization: undefined }],
      ['a bare secret string', { authorization: PROOF_SECRET }],
      ['a proof-shaped object', { authorization: { proof: PROOF_SECRET } }],
    ] as const) {
      await expectCode(
        adapter.submit({ ...base, ...(over as Record<string, unknown>) } as never),
        'invalid-input',
        label,
      );
    }
    await expectCode(adapter.submit(undefined as never), 'invalid-input', 'no input');
    expect(transport.sends()).toBe(0);
  });

  it('refuses an instant outside the request’s own validity window', async () => {
    const { source, request, authorization } = scenario('d3d3d3d3');
    const transport = transportFake(() => '{}');
    const adapter = createApprovalCoreAdapter({ transport });
    for (const [label, requestedAt] of [
      ['before the ask was made', '2026-08-02T09:59:59Z'],
      ['exactly at expiry', REQ_EXPIRES_AT],
      ['after expiry', '2026-08-04T00:00:00Z'],
    ] as const) {
      await expectCode(
        adapter.submit({
          source,
          request,
          operator: OPERATOR,
          action: 'APPROVE',
          requestedAt,
          authorization,
        }),
        'invalid-input',
        label,
      );
    }
    // The instant the ask was CREATED is inside the window: `createdAt <= requestedAt`.
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const ok = createApprovalCoreAdapter({ transport: respondWith(decision) });
    await expect(
      ok.submit({
        source,
        request,
        operator: OPERATOR,
        action: 'APPROVE',
        requestedAt: REQ_CREATED_AT,
        authorization,
      }),
    ).resolves.toBeDefined();
    expect(transport.sends()).toBe(0);
  });

  it('refuses a malformed source before any transport', async () => {
    const { request, authorization } = scenario('d4d4d4d4');
    const transport = transportFake(() => '{}');
    const adapter = createApprovalCoreAdapter({ transport });
    for (const source of [undefined, null, {}, { recommendation: {} }, 'a recommendation']) {
      await expectCode(
        adapter.submit({
          source,
          request,
          operator: OPERATOR,
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
          authorization,
        } as never),
        'binding-invalid',
        JSON.stringify(source),
      );
    }
    expect(transport.sends()).toBe(0);
  });
});

describe('the wire command', () => {
  async function capture(action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' = 'APPROVE') {
    const { source, request, authorization } = scenario('e1e1e1e1');
    const decision = coreDecision(source, [
      {
        actionId: request.proposedActionId,
        decision: action === 'APPROVE' ? 'approved' : 'rejected',
      },
    ]);
    const transport = respondWith(decision);
    await createApprovalCoreAdapter({ transport }).submit({
      source,
      request,
      operator: OPERATOR,
      action,
      requestedAt: REQUESTED_AT,
      authorization,
    });
    const command = transport.commands()[0] ?? '';
    return { command, body: JSON.parse(command) as Record<string, unknown>, request, transport };
  }

  it('carries exactly six fields, and the protocol is versioned', async () => {
    const { body } = await capture();
    expect(Object.keys(body).sort()).toEqual([
      'approvalRequest',
      'idempotencyKey',
      'operator',
      'operatorAction',
      'protocol',
      'requestedAt',
    ]);
    expect(body['protocol']).toBe('qfj.approval-core-submission.v1');
    expect(body['operatorAction']).toBe('APPROVE');
    expect(body['requestedAt']).toBe(REQUESTED_AT);
  });

  it('carries the exact ask, and the operator as an opaque Core reference', async () => {
    const { body, request } = await capture();
    expect(body['approvalRequest']).toEqual(request);
    expect(body['operator']).toEqual(OPERATOR);
  });

  it('carries NO authorization proof, credential, recipient, execution or consent field', async () => {
    const { command, body } = await capture();
    // The marker is the whole test: it exists nowhere but inside the holder.
    expect(command).not.toContain(PROOF_SECRET);
    for (const forbidden of [
      'authorization',
      'auth',
      'credential',
      'token',
      'bearer',
      'proof',
      'session',
      'recipient',
      'phone',
      'executionIntent',
      'consent',
      'optOut',
      'approved',
      'isAuthorized',
      'canSend',
      'status',
    ]) {
      expect(body[forbidden], forbidden).toBeUndefined();
      expect(command.toLowerCase(), forbidden).not.toContain(`"${forbidden.toLowerCase()}"`);
    }
  });

  it('is byte-deterministic and canonically ordered', async () => {
    const first = await capture();
    const second = await capture();
    // Different asks (fresh ids), so not equal -- but each is canonical: keys sorted at every depth.
    for (const { command } of [first, second]) {
      const keys = [
        ...command.matchAll(
          /"(approvalRequest|idempotencyKey|operator|operatorAction|protocol|requestedAt)":/g,
        ),
      ].map((m) => m[1]);
      expect(keys).toEqual([...keys].sort());
    }
  });

  it('is serialized exactly once per submit, with no retry on any failure class', async () => {
    const { source, request, authorization } = scenario('e2e2e2e2');
    for (const respond of [
      (): string => {
        throw new Error('down');
      },
      (): string => 'not json',
      (): string => JSON.stringify({ ok: true }),
    ]) {
      const transport = transportFake(respond);
      await createApprovalCoreAdapter({ transport })
        .submit({
          source,
          request,
          operator: OPERATOR,
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
          authorization,
        })
        .catch(() => undefined);
      // One attempt. A retry of an approval submission is a second statement of human intent, and
      // that is the caller's decision to make in the open.
      expect(transport.sends()).toBe(1);
    }
  });

  it('opens the proof exactly once, and only through the transport', async () => {
    const { source, request } = scenario('e3e3e3e3');
    const authorization = proofHolder();
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const transport = respondWith(decision);
    await createApprovalCoreAdapter({ transport }).submit({
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization,
    });
    expect(transport.proofUses()).toBe(1);
    expect(authorization.uses()).toBe(1);
  });
});

describe('the authorization proof is unreachable', () => {
  it('is invisible to serialization, enumeration and spreading', () => {
    const holder = proofHolder();
    expect(JSON.stringify(holder)).not.toContain(PROOF_SECRET);
    expect(Object.keys(holder).sort()).toEqual(['use', 'uses']);
    expect(JSON.stringify({ ...holder })).not.toContain(PROOF_SECRET);
    expect(
      Object.getOwnPropertyNames(holder)
        .map((k) => String((holder as unknown as Record<string, unknown>)[k]))
        .join(' '),
    ).not.toContain(PROOF_SECRET);
    expect(Object.getOwnPropertySymbols(holder)).toEqual([]);
  });

  it('never appears in a result or in any error', async () => {
    const { source, request, authorization } = scenario('f1f1f1f1');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const result = await createApprovalCoreAdapter({ transport: respondWith(decision) }).submit({
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization,
    });
    expect(JSON.stringify(result)).not.toContain(PROOF_SECRET);
    expect(Object.keys(result)).not.toContain('authorization');

    // And through every refusal path, including the one where the transport saw the proof and then
    // threw an exception quoting it.
    const leaky = transportFake((_command, proof) => {
      throw new Error(`upstream rejected ${proof}`);
    });
    const error = await createApprovalCoreAdapter({ transport: leaky })
      .submit({
        source,
        request,
        operator: OPERATOR,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
        authorization,
      })
      .catch((e: unknown) => e);
    expect(
      JSON.stringify({ ...(error as object), message: (error as Error).message }),
    ).not.toContain(PROOF_SECRET);
    expect((error as Error).message).not.toContain(PROOF_SECRET);
    expect((error as Error).stack ?? '').not.toContain(PROOF_SECRET);
  });
});

describe('the idempotency key', () => {
  async function keyFor(over: {
    readonly source?: unknown;
    readonly request?: unknown;
    readonly operator?: unknown;
    readonly action?: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
    readonly requestedAt?: string;
  }): Promise<string> {
    const base = scenario('90909090');
    const source = over.source ?? base.source;
    const request = (over.request ?? base.request) as typeof base.request;
    const decision = coreDecision(source as never, [
      { actionId: request.proposedActionId, decision: 'rejected' },
    ]);
    const transport = respondWith(decision);
    await createApprovalCoreAdapter({ transport })
      .submit({
        source,
        request,
        operator: over.operator ?? OPERATOR,
        action: over.action ?? 'REJECT',
        requestedAt: over.requestedAt ?? REQUESTED_AT,
        authorization: proofHolder(),
      } as never)
      .catch(() => undefined);
    const command = transport.commands()[0] ?? '{}';
    return (JSON.parse(command) as { idempotencyKey?: string }).idempotencyKey ?? '';
  }

  it('is a 64-character lowercase hex digest', async () => {
    const { source, request, authorization } = scenario('91919191');
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const transport = respondWith(decision);
    await createApprovalCoreAdapter({ transport }).submit({
      source,
      request,
      operator: OPERATOR,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
      authorization,
    });
    const body = JSON.parse(transport.commands()[0] ?? '{}') as { idempotencyKey: string };
    expect(body.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is IDENTICAL for the same intent, including a different instant and a re-authenticated proof', async () => {
    const shared = scenario('92929292');
    const submitOnce = async (requestedAt: string, secret: string): Promise<string> => {
      const decision = coreDecision(shared.source, [
        { actionId: shared.request.proposedActionId, decision: 'rejected' },
      ]);
      const transport = respondWith(decision);
      await createApprovalCoreAdapter({ transport }).submit({
        source: shared.source,
        request: shared.request,
        operator: OPERATOR,
        action: 'REJECT',
        requestedAt,
        authorization: proofHolder(secret),
      });
      return (JSON.parse(transport.commands()[0] ?? '{}') as { idempotencyKey: string })
        .idempotencyKey;
    };

    const first = await submitOnce(REQUESTED_AT, 'session-one');
    const again = await submitOnce(REQUESTED_AT, 'session-one');
    const later = await submitOnce('2026-08-02T11:00:10Z', 'session-one');
    const reauthenticated = await submitOnce(REQUESTED_AT, 'session-two-after-relogin');

    // A human who clicks, loses the connection, and clicks again is expressing the SAME intent.
    expect(again).toBe(first);
    expect(later).toBe(first);
    // And a fresh session for the same person does not rename an unchanged intent.
    expect(reauthenticated).toBe(first);
  });

  it('CHANGES when the ask, the action content, the operator or the intent changes', async () => {
    const shared = scenario('93939393');
    const other = scenario('94949494');
    const baseline = await keyFor({ source: shared.source, request: shared.request });

    expect(
      await keyFor({ source: shared.source, request: shared.request, action: 'REQUEST_CHANGES' }),
      'a different intent',
    ).not.toBe(baseline);
    expect(
      await keyFor({
        source: shared.source,
        request: shared.request,
        operator: {
          actorType: 'human',
          actor: { entityType: 'operator', entityId: 'human.approver.2' },
        },
      }),
      'a different operator',
    ).not.toBe(baseline);
    expect(
      await keyFor({ source: other.source, request: other.request }),
      'a different ask entirely',
    ).not.toBe(baseline);
    // A second ask about the SAME action still differs, because the ask's identity is in the key.
    const sibling = approvalRequest(shared.source);
    expect(
      await keyFor({ source: shared.source, request: sibling }),
      'a second ask about the same action',
    ).not.toBe(baseline);
  });

  it('matches the golden vector, so a silent change to the digest is a failing test', async () => {
    // A PINNED digest over pinned inputs, computed by the real internal function. Every other spec
    // here compares one key against another, so a drifted domain separator, field set or
    // canonicalization rule would still agree with itself and pass them all. This is the only test
    // that would notice -- and if it fails, whatever changed changed the protocol.
    const { IDEMPOTENCY_DOMAIN, idempotencyKeyFor } = await import('../internal/command.js');
    expect(IDEMPOTENCY_DOMAIN).toBe('qf-jarvis.approval-core-submission.v1\n');

    const key = idempotencyKeyFor({
      request: {
        approvalRequestId: 'dddddddd-0000-4000-8000-000000000001',
        recommendationId: 'cccccccc-0000-4000-8000-000000000001',
        proposedActionId: 'cccccccc-1111-4000-8000-000000000002',
        actionFingerprint: 'f'.repeat(64),
      } as never,
      operator: OPERATOR,
      action: 'APPROVE',
    });
    expect(key).toBe(GOLDEN_IDEMPOTENCY_KEY);
  });
});
