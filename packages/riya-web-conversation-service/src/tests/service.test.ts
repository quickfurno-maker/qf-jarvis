/**
 * RWC-P2C — the private Riya web conversation service (ADR-0094).
 *
 * These prove the turn a caller may take, what the service fixes for them, and what it refuses to
 * do with the result. The companion `containment.test.ts` proves what the package cannot do at all.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import type { JarvisRuntimeOutcome } from '@qf-jarvis/jarvis-runtime';
import { describe, expect, it } from 'vitest';

import {
  createRiyaWebConversationService,
  RIYA_WEB_CONVERSATION_DISPOSITIONS,
  RIYA_WEB_CONVERSATION_ERROR_CODES,
  RiyaWebConversationError,
} from '../index.js';
import type { RiyaWebConversationTurnV1 } from '../index.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';

const RUNTIME_ID = 'rt.web.1';

function turnInput(over: Partial<RiyaWebConversationTurnV1> = {}): RiyaWebConversationTurnV1 {
  return {
    version: 1,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    receivedAt: '2026-08-07T09:00:00Z',
    webTurnRef: 'web.turn.opaque.ref',
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  };
}

/**
 * Generic in the store so a caller keeps the CONCRETE type it passed.
 *
 * A union return would erase `calls` and `size` on the in-memory fake, and the specs that count
 * store round trips are exactly the ones that prove this service does not write.
 */
function service<
  S extends InMemoryContinuityStore | UnavailableContinuityStore = InMemoryContinuityStore,
>(
  over: { readonly runtime?: ReturnType<typeof scriptedRuntime>; readonly store?: S } = {},
): {
  runtime: ReturnType<typeof scriptedRuntime>;
  store: S;
  svc: ReturnType<typeof createRiyaWebConversationService>;
} {
  const runtime = over.runtime ?? scriptedRuntime();
  const store = over.store ?? (new InMemoryContinuityStore() as unknown as S);
  return {
    runtime,
    store,
    svc: createRiyaWebConversationService({
      runtime,
      continuityStore: store,
      runtimeId: RUNTIME_ID,
    }),
  };
}

function expectCode(run: () => Promise<unknown>, code: string, label = code): Promise<void> {
  return expect(run(), label).rejects.toMatchObject({ code });
}

// ---------------------------------------------------------------------------
// 1-13. Input and envelope.
// ---------------------------------------------------------------------------

describe('the turn a caller may take', () => {
  it('(1) accepts a valid WEB turn', async () => {
    const { svc } = service();
    const result = await svc.handleTurn(turnInput({ normalizedText: 'Hello Riya' }));
    // Version 2 since RWC-P2D (ADR-0096): the result MAY now carry a Core-authorized body.
    expect(result.version).toBe(2);
    expect(result.tenantId).toBe('tenant.a');
    expect(result.conversationId).toBe('conv.1');
    expect(result.messageId).toBe('msg.1');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('(2-5) the caller cannot choose channel, party, direction, actor, model, prompt or tools', async () => {
    // The schema is `.strict()`, so each of these is a refusal rather than a silently dropped field.
    // A browser that could set `partyType` would have Riya answer it as a vendor; one that could set
    // `dataClass` could route HUMAN_ONLY content to a hosted model.
    const { svc } = service();
    for (const field of [
      'channel',
      'partyType',
      'direction',
      'actor',
      'model',
      'prompt',
      'tools',
      'runtimeId',
      'authority',
      'consent',
      'canSubmit',
      'leadId',
      'city',
      'vendorAvailability',
    ]) {
      await expectCode(
        () => svc.handleTurn({ ...turnInput(), [field]: 'x' }),
        'invalid-input',
        field,
      );
    }
  });

  it('(6) malformed identifiers are refused', async () => {
    const { svc } = service();
    for (const bad of ['', 'has space', 'a@b.com', '+919876543210', 'x'.repeat(129)]) {
      await expectCode(
        () => svc.handleTurn(turnInput({ tenantId: bad })),
        'invalid-input',
        `tenantId=${bad.slice(0, 10)}`,
      );
      await expectCode(
        () => svc.handleTurn(turnInput({ conversationId: bad })),
        'invalid-input',
        `conversationId=${bad.slice(0, 10)}`,
      );
    }
  });

  it('(7) a non-canonical instant is refused', async () => {
    const { svc } = service();
    for (const bad of ['2026-08-07', 'now', '2026-08-07 09:00:00', '2026-08-07T09:00:00+05:30']) {
      await expectCode(() => svc.handleTurn(turnInput({ receivedAt: bad })), 'invalid-input', bad);
    }
  });

  it('(8) an unknown field is refused, not ignored', async () => {
    const { svc } = service();
    await expectCode(
      () =>
        svc.handleTurn({
          ...turnInput(),
          somethingNobodyReviewed: 1,
        } as RiyaWebConversationTurnV1),
      'invalid-input',
    );
  });

  it('(9) the message text bound is enforced', async () => {
    const { svc, runtime } = service();
    await expect(
      svc.handleTurn(turnInput({ normalizedText: 'x'.repeat(4096) })),
    ).resolves.toBeDefined();
    await expectCode(
      () => svc.handleTurn(turnInput({ normalizedText: 'x'.repeat(4097) })),
      'invalid-input',
    );
    // The oversized turn never reached the runtime.
    expect(runtime.invoked()).toBe(1);
  });

  it('(10-13) the service fixes WEB, CLIENT and INBOUND, and maps webTurnRef', async () => {
    const { svc, runtime } = service();
    await svc.handleTurn(turnInput({ subjectRef: 'subject.42', normalizedText: 'hi' }));
    const envelope = runtime.lastEnvelope();
    expect(envelope?.channel).toBe('WEB');
    expect(envelope?.partyType).toBe('CLIENT');
    expect(envelope?.direction).toBe('INBOUND');
    // The mature runtime field is reused, not renamed for the web.
    expect(envelope?.providerMessageRef).toBe('web.turn.opaque.ref');
    // `runtimeId` is configured, never caller-supplied.
    expect(envelope?.runtimeId).toBe(RUNTIME_ID);
    expect(envelope?.subjectRef).toBe('subject.42');
    expect(envelope?.normalizedText).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// 14-25. Continuity: loaded or created, and never evolved.
// ---------------------------------------------------------------------------

describe('continuity is loaded or initialized, and returned unchanged', () => {
  it('(14, 15) an absent state creates the canonical INTRO state at revision 0', async () => {
    const { svc, store } = service();
    const result = await svc.handleTurn(turnInput());
    const c = result.continuity;
    expect(c.phase).toBe('INTRO');
    expect(c.continuityRevision).toBe(0);
    expect(c.summaryConfirmed).toBe(false);
    expect(c.completionEvidenceRef).toBeUndefined();
    expect(c.fieldProvenance).toStrictEqual({});
    expect([...c.discovery.missingFields].sort()).toStrictEqual(
      [...DISCOVERY_FIELDS_FROZEN].sort(),
    );
    expect(c.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
    // Built through the REAL P2A constructor: `behaviourVersion` is stamped by it and by nothing
    // here, so a hand-assembled bypass state would not carry it.
    expect(c.discovery.behaviourVersion).toBe(1);
    expect(store.size).toBe(1);
  });

  it('(16) an existing state is reused, not recreated', async () => {
    const { svc, store } = service();
    const existing = createRiyaConversationContinuityState({
      version: 1,
      tenantId: 'tenant.a',
      conversationId: 'conv.1',
      continuityRevision: 7,
      phase: 'NEED',
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: [...DISCOVERY_FIELDS_FROZEN],
      },
      summaryConfirmed: false,
    });
    store.seed(existing);

    const result = await svc.handleTurn(turnInput());
    expect(result.continuity).toStrictEqual(existing);
    expect(result.continuity.continuityRevision).toBe(7);
    expect(store.calls.createInitialIfAbsent).toBe(0);
  });

  it('(17) tenant A and tenant B holding the same conversation id are distinct states', async () => {
    const store = new InMemoryContinuityStore();
    const { svc } = service({ store });
    await svc.handleTurn(turnInput({ tenantId: 'tenant.a', conversationId: 'conv.SAME' }));
    await svc.handleTurn(turnInput({ tenantId: 'tenant.b', conversationId: 'conv.SAME' }));
    expect(store.size).toBe(2);
  });

  it('(18, 19) two simultaneous first turns yield ONE authoritative state', async () => {
    const store = new InMemoryContinuityStore();
    const { svc } = service({ store });
    const results = await Promise.all([
      svc.handleTurn(turnInput({ messageId: 'msg.1' })),
      svc.handleTurn(turnInput({ messageId: 'msg.2' })),
      svc.handleTurn(turnInput({ messageId: 'msg.3' })),
    ]);
    // One row, and every caller received the state the STORE returned -- not its own candidate.
    expect(store.size).toBe(1);
    const [first, second, third] = results;
    expect(second.continuity).toStrictEqual(first.continuity);
    expect(third.continuity).toStrictEqual(first.continuity);
  });

  it('(20-25) one turn evolves nothing: no revision bump, phase, discovery or provenance change', async () => {
    const { svc, store } = service();
    const first = await svc.handleTurn(turnInput({ messageId: 'msg.1' }));
    const before: RiyaConversationContinuityStateV1 = first.continuity;

    const second = await svc.handleTurn(
      turnInput({
        messageId: 'msg.2',
        normalizedText: 'Kitchen for a 3BHK in Indiranagar, budget 8 lakh, next month',
      }),
    );

    // The message names a service, a location, a budget and a timeline. RWC-P4 owns extraction, so
    // a turn that read any of it would be this slice doing P4's job.
    expect(second.continuity).toStrictEqual(before);
    expect(second.continuity.continuityRevision).toBe(0);
    expect(second.continuity.phase).toBe('INTRO');
    expect(second.continuity.discovery.serviceInterestRef).toBeUndefined();
    expect(second.continuity.discovery.locationRef).toBeUndefined();
    expect(second.continuity.discovery.budgetNote).toBeUndefined();
    expect(second.continuity.discovery.timelineNote).toBeUndefined();
    expect(second.continuity.fieldProvenance).toStrictEqual({});
    expect(second.continuity.summaryConfirmed).toBe(false);
    expect(second.continuity.completionEvidenceRef).toBeUndefined();
    // And the service never wrote: no compare-and-set on a turn path.
    expect(store.calls.compareAndSet).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 26-33. Store port.
// ---------------------------------------------------------------------------

describe('the store port semantics the fake proves', () => {
  const seedState = (revision: number): RiyaConversationContinuityStateV1 =>
    createRiyaConversationContinuityState({
      version: 1,
      tenantId: 'tenant.a',
      conversationId: 'conv.1',
      continuityRevision: revision,
      phase: 'INTRO',
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: [...DISCOVERY_FIELDS_FROZEN],
      },
      summaryConfirmed: false,
    });

  it('(26, 27, 28) load, then CREATED, then EXISTING with the winner state', async () => {
    const store = new InMemoryContinuityStore();
    expect(await store.load({ tenantId: 'tenant.a', conversationId: 'conv.1' })).toBeUndefined();

    const first = await store.createInitialIfAbsent({ state: seedState(0) });
    expect(first.disposition).toBe('CREATED');

    const second = await store.createInitialIfAbsent({ state: seedState(99) });
    expect(second.disposition).toBe('EXISTING');
    // The loser gets the WINNER's state, not the candidate it offered.
    expect(second.state.continuityRevision).toBe(0);
  });

  it('(29, 30, 31) compareAndSet reports UPDATED, REVISION_CONFLICT and NOT_FOUND', async () => {
    const store = new InMemoryContinuityStore();
    expect(await store.compareAndSet({ expectedRevision: 0, nextState: seedState(1) })).toBe(
      'NOT_FOUND',
    );
    await store.createInitialIfAbsent({ state: seedState(0) });
    expect(await store.compareAndSet({ expectedRevision: 5, nextState: seedState(6) })).toBe(
      'REVISION_CONFLICT',
    );
    expect(await store.compareAndSet({ expectedRevision: 0, nextState: seedState(1) })).toBe(
      'UPDATED',
    );
  });

  it('(32) the service REQUIRES an injected store — there is no default', () => {
    const runtime = scriptedRuntime();
    for (const bad of [
      { runtime, runtimeId: RUNTIME_ID },
      { runtime, continuityStore: undefined, runtimeId: RUNTIME_ID },
      { runtime, continuityStore: {}, runtimeId: RUNTIME_ID },
      // A partial store is refused too: a "store" missing compareAndSet would silently defer the
      // problem to RWC-P4.
      { runtime, continuityStore: { load: () => undefined }, runtimeId: RUNTIME_ID },
      { continuityStore: new InMemoryContinuityStore(), runtimeId: RUNTIME_ID },
      { runtime, continuityStore: new InMemoryContinuityStore() },
      { runtime, continuityStore: new InMemoryContinuityStore(), runtimeId: '' },
    ]) {
      expect(() => createRiyaWebConversationService(bad as never)).toThrow(
        RiyaWebConversationError,
      );
    }
    // Nothing ran.
    expect(runtime.invoked()).toBe(0);
  });

  it('(33) an unavailable store fails closed and leaks nothing', async () => {
    const runtime = scriptedRuntime();
    const { svc } = service<UnavailableContinuityStore>({
      runtime,
      store: new UnavailableContinuityStore(),
    });
    let thrown: unknown;
    try {
      await svc.handleTurn(turnInput());
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RiyaWebConversationError);
    const error = thrown as RiyaWebConversationError;
    expect(error.code).toBe('continuity-unavailable');
    expect(error.message).not.toContain('abc123');
    expect(error.message).not.toContain('/srv/secrets');
    // A turn that could not establish its continuity never reached a model.
    expect(runtime.invoked()).toBe(0);
  });

  it('a store answering about a DIFFERENT conversation is a repository invariant', async () => {
    const store = new InMemoryContinuityStore();
    // Seed a state whose identity does not match the turn -- the shape a mis-keyed store would
    // produce, and serving it would attach one client's continuity to another's message.
    store.seed(
      createRiyaConversationContinuityState({
        version: 1,
        tenantId: 'tenant.a',
        conversationId: 'conv.OTHER',
        continuityRevision: 0,
        phase: 'INTRO',
        discovery: {
          completeness: 'MORE_DISCOVERY_REQUIRED',
          missingFields: [...DISCOVERY_FIELDS_FROZEN],
        },
        summaryConfirmed: false,
      }),
    );
    const mismatched = {
      load: () => Promise.resolve(seedStateOtherConversation()),
      createInitialIfAbsent: () => Promise.reject(new Error('unused')),
      compareAndSet: () => Promise.reject(new Error('unused')),
    };
    const runtime = scriptedRuntime();
    const svc = createRiyaWebConversationService({
      runtime,
      continuityStore: mismatched,
      runtimeId: RUNTIME_ID,
    });
    await expectCode(() => svc.handleTurn(turnInput()), 'repository-invariant');
    expect(runtime.invoked()).toBe(0);
  });

  function seedStateOtherConversation(): RiyaConversationContinuityStateV1 {
    return createRiyaConversationContinuityState({
      version: 1,
      tenantId: 'tenant.a',
      conversationId: 'conv.OTHER',
      continuityRevision: 0,
      phase: 'INTRO',
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: [...DISCOVERY_FIELDS_FROZEN],
      },
      summaryConfirmed: false,
    });
  }
});

// ---------------------------------------------------------------------------
// 34-40. The authoritative runtime.
// ---------------------------------------------------------------------------

describe('the authoritative runtime is reused exactly once', () => {
  it('(34) one turn is one runtime invocation', async () => {
    const { svc, runtime } = service();
    await svc.handleTurn(turnInput());
    expect(runtime.invoked()).toBe(1);
    await svc.handleTurn(turnInput({ messageId: 'msg.2' }));
    expect(runtime.invoked()).toBe(2);
  });

  it('(35) the service composes no orchestrator of its own', () => {
    // It holds ONE collaborator that can process a turn, and it is injected. There is no
    // `createOrchestrator`, no policy, no ports, no model and no Core adapter anywhere in it.
    const { svc } = service();
    expect(Object.keys(svc)).toStrictEqual(['handleTurn']);
    expect(Object.isFrozen(svc)).toBe(true);
  });

  it('(36) no ClientSalesSignals are fabricated', async () => {
    // The runtime's behaviour seam is OPTIONAL and absent here; its own contract says that when it
    // is absent "the runtime takes the legacy REPLY path unchanged and Riya behaviour is never
    // consulted". Manufacturing all-false signals to force the kernel to run would be inventing an
    // input nobody supplied.
    const { svc, runtime } = service();
    await svc.handleTurn(turnInput({ normalizedText: 'I want a modular kitchen' }));
    const envelope = runtime.lastEnvelope() as unknown as Record<string, unknown>;
    for (const forbidden of ['signals', 'clientSalesSignals', 'behaviourInput', 'discovery']) {
      expect(envelope[forbidden], forbidden).toBeUndefined();
    }
  });

  it('(37, 38) refusals stay refusals and a drafted turn is PROCESSED, never RESPONDED', async () => {
    const refused = service({
      runtime: scriptedRuntime('REFUSED', { refusalReason: 'orchestration-human-takeover' }),
    });
    const refusal = await refused.svc.handleTurn(turnInput());
    expect(refusal.disposition).toBe('REFUSED');
    expect(refusal.reason).toBe('orchestration-human-takeover');

    for (const outcome of ['MODEL_DRAFTED', 'CORE_ACCEPTED'] as const) {
      const ok = service({ runtime: scriptedRuntime(outcome) });
      const result = await ok.svc.handleTurn(turnInput());
      expect(result.disposition, outcome).toBe('PROCESSED');
      // Nothing responded, so nothing may claim it did.
      expect(Object.keys(result)).not.toContain('replyText');
      expect(Object.keys(result)).not.toContain('reply');
      expect(result.reason).toBeUndefined();
    }
  });

  it('every runtime outcome maps to a declared disposition', async () => {
    const expected: Readonly<Record<JarvisRuntimeOutcome, string>> = {
      MODEL_DRAFTED: 'PROCESSED',
      CORE_ACCEPTED: 'PROCESSED',
      REFUSED: 'REFUSED',
      CORE_REJECTED: 'REFUSED',
      HUMAN_REVIEW_REQUIRED: 'NOT_READY',
      RETRY_LATER: 'NOT_READY',
      STALE_REVISION: 'NOT_READY',
      CORE_UNAVAILABLE: 'NOT_READY',
      NO_ACTION: 'NOT_READY',
    };
    for (const [outcome, disposition] of Object.entries(expected)) {
      const { svc } = service({ runtime: scriptedRuntime(outcome as JarvisRuntimeOutcome) });
      const result = await svc.handleTurn(turnInput());
      expect(result.disposition, outcome).toBe(disposition);
      expect([...RIYA_WEB_CONVERSATION_DISPOSITIONS], outcome).toContain(result.disposition);
    }
  });

  it('(39) a throwing runtime fails closed and leaks nothing', async () => {
    const { svc } = service({ runtime: scriptedRuntime('CORE_ACCEPTED', { throws: true }) });
    let thrown: unknown;
    try {
      await svc.handleTurn(turnInput());
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RiyaWebConversationError);
    const error = thrown as RiyaWebConversationError;
    expect(error.code).toBe('runtime-unavailable');
    // Uncertainty never becomes a served turn, and the host and password do not travel.
    expect(error.message).not.toContain('10.0.0.1');
    expect(error.message).not.toContain('hunter2');
  });

  it('(40) nothing is sent: the service exposes no delivery path', async () => {
    const { svc } = service();
    const result = await svc.handleTurn(turnInput());
    const asRecord = result as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'authorize', 'sent', 'delivered']) {
      expect(asRecord[forbidden], forbidden).toBeUndefined();
    }
  });
});

describe('errors are bounded and content-free', () => {
  it('exposes exactly four codes, frozen, with no unreachable conflict code', () => {
    expect([...RIYA_WEB_CONVERSATION_ERROR_CODES]).toStrictEqual([
      'invalid-input',
      'continuity-unavailable',
      'runtime-unavailable',
      'repository-invariant',
    ]);
    expect(Object.isFrozen(RIYA_WEB_CONVERSATION_ERROR_CODES)).toBe(true);
    // The service never calls compareAndSet, so a revision conflict is unreachable from a turn.
    expect([...RIYA_WEB_CONVERSATION_ERROR_CODES]).not.toContain('continuity-conflict');
  });

  it('never quotes a client message', async () => {
    const { svc } = service();
    const secret = 'MY SECRET HOME ADDRESS';
    let message = '';
    try {
      // Oversized text: reaches the error path while carrying the content.
      await svc.handleTurn(turnInput({ normalizedText: `${secret} ${'x'.repeat(4097)}` }));
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(secret);
    for (const forbidden of ['normalizedText', 'zod', 'expected', 'received', 'path']) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
