/**
 * QFJ-P08 — the authenticated operator approval boundary (ADR-0082).
 *
 * Six properties, and each of them is a way the system could quietly become unsafe:
 *
 *   1. an UNAUTHENTICATED call reaches neither the queue nor Core — zero reads, zero sends;
 *   2. an authentication OUTAGE fails closed, because an outage is not an admission;
 *   3. between the click and Core's answer, NOTHING durable changes (ADR-0007 rejects optimistic
 *      state explicitly, and this service is where that rejection has to hold);
 *   4. Core may refuse what the human asked for, and the REFUSAL is what gets stored;
 *   5. an authoritative decision that already exists is returned, never overwritten;
 *   6. the authorization proof reaches the transport and nothing else — not the queue, not the
 *      durable rows, not a result, not an error.
 *
 * The queue and the transport are fakes that COUNT their calls, because "it didn't read the
 * database" is a claim about something that did not happen, and the only way to assert one is to
 * make the thing that must not happen observable.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';
import { createApprovalCoreAdapter } from '@qf-jarvis/approval-core-adapter';
import type {
  ApprovalCoreAuthorizationProof,
  ApprovalCoreTransport,
} from '@qf-jarvis/approval-core-adapter';
import type {
  ApprovalQueueActiveEntry,
  ApprovalQueueRecordDecisionResult,
  ApprovalQueueRequestRecord,
} from '@qf-jarvis/postgres-approval-queue';

import {
  APPROVAL_OPERATOR_SERVICE_ERROR_CODES,
  ApprovalOperatorServiceError,
  createApprovalOperatorService,
} from '../runtime/approval-operator-service.js';
import type {
  ApprovalOperatorService,
  ApprovalQueueReader,
  AuthenticatedApprovalOperator,
  OperatorAuthenticationPort,
} from '../runtime/approval-operator-service.js';

const REC_CREATED_AT = '2026-08-02T09:00:00Z';
const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';
const REQUESTED_AT = '2026-08-02T11:00:00Z';

/** One unmistakable marker, carried only inside the proof holder. */
const PROOF_SECRET = 'QFJ-P08-OPERATOR-PROOF-c0ffee-DO-NOT-LEAK';

const CREDENTIAL = { session: 'opaque-to-this-service' };

/** An error carrying a bounded code, exactly as the real queue and auth port raise one. */
function coded(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

let counter = 0;
function nextSuffix(): string {
  counter += 1;
  return String(counter).padStart(12, '0');
}

function source(tag: string, actions = 1): RecommendationRuntimeResult {
  let n = 0;
  const draft = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Schedule a follow-up with the vendor.',
    // A neutral channel token on purpose: `apps/api` forbids naming a delivery fabric ANYWHERE,
    // including in a fixture, and an approval fixture has no business implying one.
    parameters: { channel: 'vendor-portal', delayHours: 48 },
    ...over,
  });
  return createRecommendationRuntime({
    identity: {
      nextRecommendationId: (): string => {
        n += 1;
        return `${tag}-0000-4000-8000-${String(n).padStart(12, '0')}`;
      },
      nextActionId: (): string => {
        n += 1;
        return `${tag}-1111-4000-8000-${String(n).padStart(12, '0')}`;
      },
    },
  }).create({
    recommendationType: 'vendor.follow-up',
    createdAt: REC_CREATED_AT,
    expiresAt: REC_EXPIRES_AT,
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
    proposedActions:
      actions === 2
        ? [draft(), draft({ actionType: 'notify.owner', summary: 'Tell the owner.' })]
        : [draft()],
    composite: false,
    correlationId: `${tag}-2222-4333-8444-555555555555`,
  });
}

function approvalRequest(
  from: RecommendationRuntimeResult,
  over: { readonly actionIndex?: number; readonly expiresAt?: string } = {},
): ApprovalRequestV1 {
  const action = from.recommendation.proposedActions[over.actionIndex ?? 0];
  if (action === undefined) {
    throw new Error('fixture: no such action');
  }
  const id = `dddddddd-0000-4000-8000-${nextSuffix()}`;
  return createApprovalRuntime({
    identity: { nextApprovalRequestId: (): string => id },
  }).createRequest({
    source: from,
    proposedActionId: action.actionId,
    createdAt: REQ_CREATED_AT,
    expiresAt: over.expiresAt ?? REQ_EXPIRES_AT,
    policy: { policyId: 'approval.policy', policyVersion: 3 },
  });
}

function coreDecision(
  from: RecommendationRuntimeResult,
  actionDecisions: readonly {
    readonly actionId: string;
    readonly decision: 'approved' | 'rejected';
  }[],
): ApprovalDecisionV1 {
  return {
    decisionId: `eeeeeeee-0000-4000-8000-${nextSuffix()}`,
    recommendationId: from.recommendation.recommendationId,
    contractVersion: 1,
    issuer: 'quickfurno-core',
    decidedBy: {
      actorType: 'human',
      actor: { entityType: 'operator', entityId: 'human.approver.1' },
    },
    decidedAt: '2026-08-02T12:00:00Z',
    outcome: actionDecisions.some((a) => a.decision === 'approved') ? 'approved' : 'rejected',
    actionDecisions: [...actionDecisions],
    reasonCode: 'core.decided',
    correlationId: from.recommendation.correlationId,
  } as unknown as ApprovalDecisionV1;
}

const OPERATOR = Object.freeze({
  actorType: 'human' as const,
  actor: Object.freeze({ entityType: 'operator' as const, entityId: 'human.approver.1' }),
});

/** A proof holder whose secret lives in a closure. Nothing can read it but a `use` caller. */
function proofHolder(): ApprovalCoreAuthorizationProof {
  return Object.freeze({
    use: async <T>(operation: (proof: string) => Promise<T>): Promise<T> => operation(PROOF_SECRET),
  });
}

/**
 * A COUNTING queue fake.
 *
 * Every method records that it was reached, because the strongest assertions in this suite are
 * about calls that must NOT happen.
 */
interface QueueFake extends ApprovalQueueReader {
  readonly calls: () => readonly string[];
  /** Everything the service handed the queue, so a durable-store leak scan has something to read. */
  readonly written: () => readonly unknown[];
}

function queueFake(behaviour: {
  readonly record?: ApprovalQueueRequestRecord;
  readonly active?: readonly ApprovalQueueActiveEntry[];
  readonly existingDecision?: unknown;
  readonly onRecord?: (input: unknown) => ApprovalQueueRecordDecisionResult;
  readonly failReadWith?: string;
}): QueueFake {
  const calls: string[] = [];
  const written: unknown[] = [];
  const notFound = (): Promise<never> => Promise.reject(coded('request-not-found'));
  return {
    calls: (): readonly string[] => [...calls],
    written: (): readonly unknown[] => [...written],
    // Non-async on purpose: these resolve or reject immediately, and an `async` body with nothing to
    // await would only hide that there is no I/O here at all.
    readRequest: (id: string): Promise<ApprovalQueueRequestRecord> => {
      calls.push('readRequest');
      written.push(id);
      if (behaviour.failReadWith !== undefined) {
        return Promise.reject(coded(behaviour.failReadWith));
      }
      if (behaviour.record === undefined) {
        return notFound();
      }
      return Promise.resolve(behaviour.record);
    },
    readDecisionForRequest: (id: string): Promise<never> => {
      calls.push('readDecisionForRequest');
      written.push(id);
      if (behaviour.existingDecision === undefined) {
        return notFound();
      }
      return Promise.resolve(behaviour.existingDecision as never);
    },
    listActiveRequests: (input): Promise<readonly ApprovalQueueActiveEntry[]> => {
      calls.push('listActiveRequests');
      written.push(input);
      return Promise.resolve(behaviour.active ?? []);
    },
    recordDecision: (input): Promise<ApprovalQueueRecordDecisionResult> => {
      calls.push('recordDecision');
      written.push(input);
      if (behaviour.onRecord === undefined) {
        return Promise.reject(new Error('unexpected recordDecision'));
      }
      return Promise.resolve(behaviour.onRecord(input));
    },
  };
}

/** An authentication port that resolves, refuses, or fails. */
function authFake(
  mode: 'ok' | 'refuse' | 'outage' | 'malformed' | 'policy-actor' = 'ok',
): OperatorAuthenticationPort & { readonly calls: () => number } {
  let calls = 0;
  return {
    calls: (): number => calls,
    authenticate: (): Promise<AuthenticatedApprovalOperator> => {
      calls += 1;
      if (mode === 'refuse') {
        return Promise.reject(new Error('no session'));
      }
      if (mode === 'outage') {
        return Promise.reject(coded('auth-unavailable'));
      }
      if (mode === 'malformed') {
        return Promise.resolve({ actor: OPERATOR } as never);
      }
      if (mode === 'policy-actor') {
        return Promise.resolve({
          actor: { actorType: 'policy', policyId: 'p', policyVersion: 1 },
          coreAuthorization: proofHolder(),
        } as never);
      }
      return Promise.resolve({ actor: OPERATOR, coreAuthorization: proofHolder() });
    },
  };
}

/** A counting transport, so "Core was never contacted" is observable. */
interface TransportFake extends ApprovalCoreTransport {
  readonly sends: () => number;
  readonly commands: () => readonly string[];
}

function transportFake(respond: (command: string) => string): TransportFake {
  const commands: string[] = [];
  return {
    sends: (): number => commands.length,
    commands: (): readonly string[] => [...commands],
    send: (input): Promise<string> => {
      commands.push(input.serializedCommand);
      return input.authorization.use((): Promise<string> => {
        return Promise.resolve(respond(input.serializedCommand));
      });
    },
  };
}

function serviceWith(parts: {
  readonly auth: OperatorAuthenticationPort;
  readonly queue: ApprovalQueueReader;
  readonly transport: ApprovalCoreTransport;
}): ApprovalOperatorService {
  return createApprovalOperatorService({
    auth: parts.auth,
    queue: parts.queue,
    core: createApprovalCoreAdapter({ transport: parts.transport }),
  });
}

function expectCode(promise: Promise<unknown>, code: string, label = code): Promise<void> {
  return expect(promise, label).rejects.toMatchObject({ code });
}

describe('authentication gates access, and it is not authority', () => {
  it('performs ZERO queue and ZERO Core calls when the caller is not authenticated', async () => {
    const auth = authFake('refuse');
    const queue = queueFake({});
    const transport = transportFake(() => '{}');
    const service = serviceWith({ auth, queue, transport });

    await expectCode(
      service.listActive({ credential: CREDENTIAL, observedAt: REQUESTED_AT, limit: 10 }),
      'unauthenticated',
      'listActive',
    );
    await expectCode(
      service.submit({
        credential: CREDENTIAL,
        approvalRequestId: 'dddddddd-0000-4000-8000-000000000001',
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
      }),
      'unauthenticated',
      'submit',
    );

    // The durable queue is a record of what the business is considering doing to real clients and
    // vendors. "Reject after fetching" would still have fetched it.
    expect(queue.calls()).toEqual([]);
    expect(transport.sends()).toBe(0);
    expect(auth.calls()).toBe(2);
  });

  it('fails CLOSED when the authentication boundary itself is unavailable', async () => {
    const queue = queueFake({});
    const transport = transportFake(() => '{}');
    for (const mode of ['outage', 'malformed', 'policy-actor'] as const) {
      const service = serviceWith({ auth: authFake(mode), queue, transport });
      await expectCode(
        service.submit({
          credential: CREDENTIAL,
          approvalRequestId: 'dddddddd-0000-4000-8000-000000000001',
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
        }),
        'auth-unavailable',
        mode,
      );
    }
    // An authentication outage that let calls through would be the worst failure mode this boundary
    // has. A POLICY actor arriving from the port is the same thing wearing a different hat: a policy
    // is something Core applies, not a person who can be sitting at a screen.
    expect(queue.calls()).toEqual([]);
    expect(transport.sends()).toBe(0);
  });

  it('holds no role store, RBAC table, founder list or authority cache', () => {
    // Asserted against the SOURCE, because this is the single easiest thing to add to an operator
    // boundary and it is exactly the authorization state ADR-0002 puts in Core.
    const service = createApprovalOperatorService({
      auth: authFake(),
      queue: queueFake({}),
      core: createApprovalCoreAdapter({ transport: transportFake(() => '{}') }),
    });
    expect(Object.keys(service).sort()).toEqual(['listActive', 'submit']);
    expect(Object.isFrozen(service)).toBe(true);
    const surface = service as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approve',
      'reject',
      'authorize',
      'grant',
      'roles',
      'permissions',
      'isFounder',
      'setRole',
      'execute',
      'send',
      'queue',
      'core',
      'auth',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('exposes ten bounded, content-free error codes', () => {
    expect([...APPROVAL_OPERATOR_SERVICE_ERROR_CODES].sort()).toEqual([
      'auth-unavailable',
      'core-decision-mismatch',
      'core-invalid-response',
      'core-unavailable',
      'invalid-input',
      'persistence-unavailable',
      'repository-invariant',
      'request-expired',
      'request-not-found',
      'unauthenticated',
    ]);
    for (const code of APPROVAL_OPERATOR_SERVICE_ERROR_CODES) {
      const error = new ApprovalOperatorServiceError(code);
      expect(error.name).toBe('ApprovalOperatorServiceError');
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });
});

describe('listActive', () => {
  it('returns the queue’s minimal projection once authenticated', async () => {
    const active: readonly ApprovalQueueActiveEntry[] = [
      {
        approvalRequestId: 'dddddddd-0000-4000-8000-000000000099',
        recommendationId: 'cccccccc-0000-4000-8000-000000000001',
        proposedActionId: 'cccccccc-1111-4000-8000-000000000002',
        createdAt: REQ_CREATED_AT,
        expiresAt: REQ_EXPIRES_AT,
        requestedAuthority: 'authorized-team-human',
        risk: 'client-or-vendor-facing-communication',
        requestingAgent: 'anisha',
        requestingAgentVersion: 'anisha.v1',
        summary: 'The vendor has not responded about the delayed sample.',
        policy: { policyId: 'approval.policy', policyVersion: 3 },
        correlationId: 'cccccccc-2222-4333-8444-555555555555',
      },
    ];
    const queue = queueFake({ active });
    const service = serviceWith({ auth: authFake(), queue, transport: transportFake(() => '{}') });

    const result = await service.listActive({
      credential: CREDENTIAL,
      observedAt: REQUESTED_AT,
      limit: 10,
    });
    expect(result).toEqual(active);
    expect(Object.isFrozen(result)).toBe(true);
    // The instant is the CALLER's; nothing here reads a clock.
    expect(queue.written()[0]).toEqual({ observedAt: REQUESTED_AT, limit: 10 });
  });

  it('refuses a malformed instant or an unbounded limit, after authenticating', async () => {
    const queue = queueFake({ active: [] });
    const service = serviceWith({ auth: authFake(), queue, transport: transportFake(() => '{}') });
    for (const input of [
      { observedAt: 'not-a-time', limit: 10 },
      { observedAt: '2026-08-02', limit: 10 },
      { observedAt: '2026-02-30T00:00:00Z', limit: 10 },
      { observedAt: REQUESTED_AT, limit: 0 },
      { observedAt: REQUESTED_AT, limit: 1000 },
      { observedAt: REQUESTED_AT, limit: 1.5 },
    ]) {
      await expectCode(
        service.listActive({ credential: CREDENTIAL, ...input }),
        'invalid-input',
        JSON.stringify(input),
      );
    }
    expect(queue.calls()).toEqual([]);
  });
});

describe('submit', () => {
  function ready(actions = 1) {
    const from = source('ab1ab1ab', actions);
    const request = approvalRequest(from);
    const record: ApprovalQueueRequestRecord = { request, source: from };
    return { from, request, record };
  }

  it('stores Core’s APPROVAL when the human approved and Core agreed', async () => {
    const { from, request, record } = ready();
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const recorded: unknown[] = [];
    const queue = queueFake({
      record,
      onRecord: (input) => {
        recorded.push(input);
        return {
          outcome: 'CREATED',
          correlation: { actionDecision: { decision: 'approved' } } as never,
        };
      },
    });
    const transport = transportFake(() => JSON.stringify(decision));
    const service = serviceWith({ auth: authFake(), queue, transport });

    const result = await service.submit({
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });

    expect(result.outcome).toBe('DECIDED');
    expect(result.correlation.actionDecision.decision).toBe('approved');
    expect(transport.sends()).toBe(1);
    expect(recorded).toEqual([{ approvalRequestId: request.approvalRequestId, decision }]);
  });

  it('stores Core’s REFUSAL of an approval the human asked for', async () => {
    // ADR-0007: Core validates identity, authority, current state, risk and expiry against its own
    // truth, and may say no. The refusal is the authoritative artifact and it is what gets stored.
    const { from, request, record } = ready();
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'rejected' },
    ]);
    const recorded: unknown[] = [];
    const queue = queueFake({
      record,
      onRecord: (input) => {
        recorded.push(input);
        return {
          outcome: 'CREATED',
          correlation: { actionDecision: { decision: 'rejected' } } as never,
        };
      },
    });
    const service = serviceWith({
      auth: authFake(),
      queue,
      transport: transportFake(() => JSON.stringify(decision)),
    });

    const result = await service.submit({
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });
    expect(result.outcome).toBe('DECIDED');
    expect(result.correlation.actionDecision.decision).toBe('rejected');
    expect((recorded[0] as { decision: ApprovalDecisionV1 }).decision.outcome).toBe('rejected');
  });

  it('refuses to store an approval of an action the human asked to REJECT', async () => {
    const { from, request, record } = ready();
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const queue = queueFake({ record });
    const service = serviceWith({
      auth: authFake(),
      queue,
      transport: transportFake(() => JSON.stringify(decision)),
    });

    await expectCode(
      service.submit({
        credential: CREDENTIAL,
        approvalRequestId: request.approvalRequestId,
        action: 'REJECT',
        requestedAt: REQUESTED_AT,
      }),
      'core-decision-mismatch',
    );
    // Nothing was written. A contradiction between what was asked and what came back is not a
    // decision to record.
    expect(queue.calls()).not.toContain('recordDecision');
  });

  it('leaves the ask UNANSWERED when Core cannot be reached', async () => {
    const { request, record } = ready();
    const queue = queueFake({ record });
    const service = serviceWith({
      auth: authFake(),
      queue,
      transport: transportFake(() => {
        throw new Error('ECONNREFUSED https://core.internal/approvals');
      }),
    });

    await expectCode(
      service.submit({
        credential: CREDENTIAL,
        approvalRequestId: request.approvalRequestId,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
      }),
      'core-unavailable',
    );
    // THE branch ADR-0007's rejection of optimistic state lives in: no local approved flag, no
    // pending row, nothing durable at all. The ask is simply still outstanding.
    expect(queue.calls()).not.toContain('recordDecision');
  });

  it('leaves the ask UNANSWERED when Core answers with something malformed', async () => {
    const { request, record } = ready();
    for (const [label, body] of [
      ['not json', 'nonsense {{'],
      ['not a decision', JSON.stringify({ ok: true })],
      ['issued by jarvis', JSON.stringify({ issuer: 'qf-jarvis', outcome: 'approved' })],
    ] as const) {
      const queue = queueFake({ record });
      const service = serviceWith({
        auth: authFake(),
        queue,
        transport: transportFake(() => body),
      });
      await expectCode(
        service.submit({
          credential: CREDENTIAL,
          approvalRequestId: request.approvalRequestId,
          action: 'APPROVE',
          requestedAt: REQUESTED_AT,
        }),
        'core-invalid-response',
        label,
      );
      expect(queue.calls(), label).not.toContain('recordDecision');
    }
  });

  it('refuses an EXPIRED ask before contacting Core at all', async () => {
    const from = source('ab2ab2ab');
    const request = approvalRequest(from, { expiresAt: '2026-08-02T10:30:00Z' });
    const queue = queueFake({ record: { request, source: from } });
    const transport = transportFake(() => '{}');
    const service = serviceWith({ auth: authFake(), queue, transport });

    await expectCode(
      service.submit({
        credential: CREDENTIAL,
        approvalRequestId: request.approvalRequestId,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
      }),
      'request-expired',
    );
    // Submitting a dead ask would spend an operator's authorization proof on a question that has no
    // valid answer.
    expect(transport.sends()).toBe(0);
    expect(queue.calls()).not.toContain('recordDecision');
  });

  it('returns the STORED decision and contacts Core zero times when the ask is already answered', async () => {
    const { request, record } = ready();
    const queue = queueFake({
      record,
      existingDecision: { actionDecision: { decision: 'rejected' } },
    });
    const transport = transportFake(() => '{}');
    const service = serviceWith({ auth: authFake(), queue, transport });

    const result = await service.submit({
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });

    expect(result.outcome).toBe('ALREADY_DECIDED');
    expect(result.correlation.actionDecision.decision).toBe('rejected');
    // Core has spoken about this ask. Asking again could only produce a second answer to a settled
    // question -- and a human clicking APPROVE must not be able to re-open a refusal.
    expect(transport.sends()).toBe(0);
    expect(queue.calls()).not.toContain('recordDecision');
  });

  it('yields to the decision another process stored first, and never overwrites it', async () => {
    const { from, request, record } = ready();
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    // The queue looked unanswered at step 4 and reports `request-already-decided` at step 7: another
    // process won the race while this submission was in flight with Core.
    let answered = false;
    const queue: QueueFake = queueFake({
      record,
      onRecord: () => {
        answered = true;
        const error = new Error('answered') as Error & { code: string };
        error.code = 'request-already-decided';
        throw error;
      },
    });
    const readDecision = queue.readDecisionForRequest.bind(queue);
    const racing: ApprovalQueueReader = {
      ...queue,
      readDecisionForRequest: async (id: string) => {
        if (!answered) {
          return readDecision(id);
        }
        return { actionDecision: { decision: 'rejected' } } as never;
      },
    };
    const service = serviceWith({
      auth: authFake(),
      queue: racing,
      transport: transportFake(() => JSON.stringify(decision)),
    });

    const result = await service.submit({
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });

    // Whichever Core decision became durable is the one that happened. This caller is told what that
    // is; it is not merged, not preferred against, and not overwritten -- and note that the stored
    // artifact REJECTS while this submission's own answer approved.
    expect(result.outcome).toBe('ALREADY_DECIDED');
    expect(result.correlation.actionDecision.decision).toBe('rejected');
  });

  it('refuses a malformed identifier, action or instant', async () => {
    const { request, record } = ready();
    const queue = queueFake({ record });
    const transport = transportFake(() => '{}');
    const service = serviceWith({ auth: authFake(), queue, transport });
    const base = {
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE' as const,
      requestedAt: REQUESTED_AT,
    };
    for (const [label, over] of [
      ['not a uuid', { approvalRequestId: 'latest' }],
      ['empty id', { approvalRequestId: '' }],
      ['no id', { approvalRequestId: undefined }],
      ['unknown action', { action: 'AUTO_APPROVE' }],
      ['execute action', { action: 'EXECUTE' }],
      ['lowercase action', { action: 'approve' }],
      ['malformed instant', { requestedAt: 'now' }],
      ['impossible instant', { requestedAt: '2026-02-30T00:00:00Z' }],
    ] as const) {
      await expectCode(service.submit({ ...base, ...over } as never), 'invalid-input', label);
    }
    expect(queue.calls()).toEqual([]);
    expect(transport.sends()).toBe(0);
  });

  it('maps a missing ask and a database outage to distinct bounded codes', async () => {
    const transport = transportFake(() => '{}');
    const missing = queueFake({});
    await expectCode(
      serviceWith({ auth: authFake(), queue: missing, transport }).submit({
        credential: CREDENTIAL,
        approvalRequestId: 'dddddddd-0000-4000-8000-000000000777',
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
      }),
      'request-not-found',
    );

    const down = queueFake({ failReadWith: 'database-unavailable' });
    await expectCode(
      serviceWith({ auth: authFake(), queue: down, transport }).submit({
        credential: CREDENTIAL,
        approvalRequestId: 'dddddddd-0000-4000-8000-000000000778',
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
      }),
      'persistence-unavailable',
    );
    expect(transport.sends()).toBe(0);
  });
});

describe('the authorization proof never leaves the transport', () => {
  it('is absent from the durable store, the audit path, the result and every error', async () => {
    const from = source('ab3ab3ab');
    const request = approvalRequest(from);
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const queue = queueFake({
      record: { request, source: from },
      onRecord: () => ({
        outcome: 'CREATED',
        correlation: { actionDecision: { decision: 'approved' } } as never,
      }),
    });
    const transport = transportFake(() => JSON.stringify(decision));
    const service = serviceWith({ auth: authFake(), queue, transport });

    const result = await service.submit({
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });

    // Everything the service ever handed the queue -- ids, list inputs, the decision it recorded.
    expect(JSON.stringify(queue.written())).not.toContain(PROOF_SECRET);
    // The serialized wire command, which is the thing most likely to be logged by a real transport.
    expect(JSON.stringify(transport.commands())).not.toContain(PROOF_SECRET);
    expect(JSON.stringify(result)).not.toContain(PROOF_SECRET);

    // And through a refusal, including one raised by a transport that had the proof in hand.
    const leaky = transportFake(() => {
      throw new Error(`upstream rejected ${PROOF_SECRET}`);
    });
    const error = await serviceWith({ auth: authFake(), queue, transport: leaky })
      .submit({
        credential: CREDENTIAL,
        approvalRequestId: request.approvalRequestId,
        action: 'APPROVE',
        requestedAt: REQUESTED_AT,
      })
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(PROOF_SECRET);
    expect((error as Error).stack ?? '').not.toContain(PROOF_SECRET);
    expect(JSON.stringify({ ...(error as object) })).not.toContain(PROOF_SECRET);
  });

  it('never carries the caller’s credential into the queue, Core or a result', async () => {
    const from = source('ab4ab4ab');
    const request = approvalRequest(from);
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const queue = queueFake({
      record: { request, source: from },
      onRecord: () => ({
        outcome: 'CREATED',
        correlation: { actionDecision: { decision: 'approved' } } as never,
      }),
    });
    const transport = transportFake(() => JSON.stringify(decision));
    const marker = 'CREDENTIAL-MARKER-c0ffee';
    const result = await serviceWith({ auth: authFake(), queue, transport }).submit({
      credential: { session: marker },
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });

    // The credential is consumed by the authentication port and goes no further. What travels
    // onward is the opaque Core actor reference and the proof holder -- never the raw session.
    expect(JSON.stringify(queue.written())).not.toContain(marker);
    expect(JSON.stringify(transport.commands())).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain(marker);
  });
});

describe('there is no optimistic or local approval state', () => {
  it('returns only DECIDED or ALREADY_DECIDED, and no result carries an authority flag', async () => {
    const from = source('ab5ab5ab');
    const request = approvalRequest(from);
    const decision = coreDecision(from, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const queue = queueFake({
      record: { request, source: from },
      onRecord: () => ({
        outcome: 'CREATED',
        correlation: { actionDecision: { decision: 'approved' } } as never,
      }),
    });
    const result = await serviceWith({
      auth: authFake(),
      queue,
      transport: transportFake(() => JSON.stringify(decision)),
    }).submit({
      credential: CREDENTIAL,
      approvalRequestId: request.approvalRequestId,
      action: 'APPROVE',
      requestedAt: REQUESTED_AT,
    });

    expect(['DECIDED', 'ALREADY_DECIDED']).toContain(result.outcome);
    expect(Object.keys(result).sort()).toEqual(['correlation', 'outcome']);
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
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('names no PENDING outcome anywhere in the service source', () => {
    // `PENDING` is something a screen renders while a promise is outstanding. It is not a state this
    // service returns and not a row anything writes.
    const source_ = readSource();
    expect(source_).not.toMatch(/'PENDING'|"PENDING"/);
    for (const forbidden of [
      'isApproved',
      'isAuthorized',
      'canExecute',
      'canSend',
      'communicationAuthorized',
      'consentValid',
      'FOUNDER_IDS',
      'ADMIN_IDS',
      'roleLookup',
      'authorityCache',
      'optimistic',
    ]) {
      expect(source_, forbidden).not.toContain(forbidden);
    }
  });

  it('constructs nothing: no pool, no server, no environment read, no credential store', () => {
    const source_ = readSource();
    expect(source_).not.toMatch(/process\s*\.\s*env/);
    expect(source_).not.toMatch(/\bnew\s+Pool\b|createDatabasePool|connectionString/);
    expect(source_).not.toMatch(/createServer|express|fastify|hono|\.listen\(/);
    expect(source_).not.toMatch(/from ['"]node:(fs|net|http|https|crypto)['"]/);
    expect(source_).not.toMatch(/\bfetch\s*\(|https?:\/\//);
    expect(source_).not.toMatch(/console\s*\./);
    expect(source_).not.toMatch(/setTimeout|setInterval/);
    // No clock: both instants come from the caller, and the queue derives "active" from one of them.
    expect(source_).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
    // The durable queue and the Core adapter are named as TYPES only -- both are injected.
    expect(source_).toMatch(/import type \{[\s\S]*?\} from '@qf-jarvis\/postgres-approval-queue';/);
    expect(source_).toMatch(/import type \{[\s\S]*?\} from '@qf-jarvis\/approval-core-adapter';/);
    expect(source_).not.toMatch(
      /^import \{[^}]*\} from '@qf-jarvis\/(postgres-approval-queue|approval-core-adapter)'/m,
    );
  });
});

/**
 * The service's own source, with documentation stripped.
 *
 * This module explains at length what it refuses to do, and scanning the explanation would flag the
 * prohibition as the violation — the recurring false positive in this repository's suites.
 */
function readSource(): string {
  return readFileSync(
    fileURLToPath(new URL('../runtime/approval-operator-service.ts', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}
