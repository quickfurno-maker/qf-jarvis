/**
 * QFJ-P08-A PR 2 — writable conversation control composed into the authoritative runtime (ADR-0075).
 *
 * The claim under test is the one the launch gate cares about: an operator command applied through
 * `createJarvisRuntime(...)` changes the state that the NEXT REAL inbound turn reads, so a human
 * takeover actually stops AI. Every case drives the real composition root; nothing calls the reducer,
 * `orchestrateInbound` or `assignAgent` directly to manufacture the result it wants to see.
 *
 * The other half is that the two new methods are DEFENSIVE. Both capabilities are structural
 * interfaces any deployment may implement, so a foreign source that throws, or that returns a
 * plausible-looking but internally inconsistent decision, must produce a closed result rather than a
 * rejected promise or a laundered object.
 */
import { describe, expect, it } from 'vitest';

import { assignAgent, createRuntimePolicy } from '@qf-jarvis/agent-runtime';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';
import type { CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import type {
  ConversationControlCommand,
  ConversationControlCommandInput,
} from '@qf-jarvis/conversation-control';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
  ConversationOperationsProjection,
} from '../contracts/authoritative-state.js';
import {
  clearControlState,
  controllableAuthoritativeState,
  scriptedAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import type { ControllableAuthoritativeState } from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

const AT = (n: number): string => `2026-08-0${String(n)}T00:00:00.000Z`;

/** Counting model + Core fakes, so "AI did not run" is an observed zero rather than an argument. */
interface Counted {
  readonly count: () => number;
}
function countingInvoker(): ModelGatewayInvoker & Counted {
  const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  const counter = { n: 0 };
  return {
    invoke: (request) => {
      counter.n += 1;
      return inner.invoke(request);
    },
    count: () => counter.n,
  };
}
function countingCore(): CoreDecisionTransport & Counted {
  const inner = scriptedCoreTransport('ACCEPTED');
  const counter = { n: 0 };
  return {
    send: (serialized) => {
      counter.n += 1;
      return inner.send(serialized);
    },
    count: () => counter.n,
  };
}

function commandInput(
  over: Partial<ConversationControlCommandInput> = {},
): ConversationControlCommandInput {
  return {
    commandId: 'ctrl.1',
    conversationId: 'conv.1',
    expectedRevision: 1,
    action: 'TAKE_OWNERSHIP',
    operatorRef: 'operator.synthetic.1',
    issuedAt: AT(1),
    ...over,
  };
}

/** One runtime over ONE controllable source, with counting model/Core fakes. */
function harness(state: Partial<ConversationControlState> = {}) {
  const source = controllableAuthoritativeState(clearControlState(state));
  const invoker = countingInvoker();
  const core = countingCore();
  const runtime = createJarvisRuntime(
    syntheticRuntimeConfig({
      authoritativeState: source,
      gatewayInvoker: invoker,
      coreTransport: core,
    }),
  );
  return { source, invoker, core, runtime };
}

// ---------------------------------------------------------------------------
// (A-C) The launch-critical sequence, through ONE runtime over ONE source.
// ---------------------------------------------------------------------------

describe('(A, B, C) take -> release -> resume, proven against real inbound turns', () => {
  it('(A) TAKE_OWNERSHIP stops the NEXT real Jarvis turn before model and Core', async () => {
    const { source, invoker, core, runtime } = harness();

    const applied = await runtime.applyConversationControlCommand(commandInput());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.decision.outcome).toBe('APPLIED');
    expect(applied.decision.nextState).toEqual({
      conversationId: 'conv.1',
      revision: 2,
      humanTakeover: true,
      aiPaused: true,
    });
    expect(source.controlApplications()).toBe(1);

    const snapshot = await runtime.readConversationOperationsSnapshot('conv.1');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.snapshot.revision).toBe(2);
    // Takeover overrides every AI assignment -- and this comes from M1's assignAgent, not from a
    // mapping table written here.
    expect(snapshot.snapshot.assignedActor).toBe('HUMAN');
    expect(snapshot.snapshot.partyType).toBe('CLIENT');
    expect(snapshot.snapshot.humanTakeover).toBe(true);
    expect(snapshot.snapshot.aiPaused).toBe(true);
    expect(snapshot.snapshot.conversationState).toBe('HUMAN_TAKEOVER');
    expect(snapshot.snapshot.auditRef).toBe('ctrl.1');
    expect(snapshot.snapshot.lastActivityAt).toBe(AT(1));

    // THE PROOF: a real inbound turn, through the same runtime and the same source.
    const modelBefore = invoker.count();
    const coreBefore = core.count();
    const result = await runtime.processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-human-takeover');
    expect(result.proposalId).toBeUndefined();
    expect(result.modelDrafted).toBe(false);
    // Human takeover stops AI -- the launch gate, as an observed zero. The TRANSPORT counters are
    // what prove it: `coreConsulted` reports only that a Core transport was wired, not that it ran.
    expect(invoker.count()).toBe(modelBefore);
    expect(core.count()).toBe(coreBefore);
  });

  it('(B) RELEASE_OWNERSHIP leaves AI paused, and the next turn is still refused', async () => {
    const { source, invoker, core, runtime } = harness();
    await runtime.applyConversationControlCommand(commandInput());

    const released = await runtime.applyConversationControlCommand(
      commandInput({
        commandId: 'ctrl.release',
        expectedRevision: 2,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(2),
      }),
    );
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.decision.nextState).toEqual({
      conversationId: 'conv.1',
      revision: 3,
      humanTakeover: false,
      // ADR-0054 E: handing the conversation back is not the same decision as declaring it safe.
      aiPaused: true,
    });

    const snapshot = await runtime.readConversationOperationsSnapshot('conv.1');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.snapshot.revision).toBe(3);
    // The actor returns to RIYA for a CLIENT party once the takeover clears...
    expect(snapshot.snapshot.assignedActor).toBe('RIYA');
    // ...but AI is still paused.
    expect(snapshot.snapshot.aiPaused).toBe(true);
    expect(snapshot.snapshot.conversationState).toBe('WAITING_EXTERNAL');
    expect(snapshot.snapshot.auditRef).toBe('ctrl.release');

    const modelBefore = invoker.count();
    const coreBefore = core.count();
    const result = await runtime.processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-ai-paused');
    expect(invoker.count()).toBe(modelBefore);
    expect(core.count()).toBe(coreBefore);
    expect(source.controlApplications()).toBe(2);
  });

  it('(C) only an explicit RESUME_AI makes the next turn model-eligible again', async () => {
    const { invoker, core, runtime } = harness();
    await runtime.applyConversationControlCommand(commandInput());
    await runtime.applyConversationControlCommand(
      commandInput({
        commandId: 'ctrl.release',
        expectedRevision: 2,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(2),
      }),
    );

    const resumed = await runtime.applyConversationControlCommand(
      commandInput({
        commandId: 'ctrl.resume',
        expectedRevision: 3,
        action: 'RESUME_AI',
        issuedAt: AT(3),
      }),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.decision.nextState).toEqual({
      conversationId: 'conv.1',
      revision: 4,
      humanTakeover: false,
      aiPaused: false,
    });

    const snapshot = await runtime.readConversationOperationsSnapshot('conv.1');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.snapshot.revision).toBe(4);
    expect(snapshot.snapshot.assignedActor).toBe('RIYA');
    expect(snapshot.snapshot.conversationState).toBe('ACTIVE_AI');
    expect(snapshot.snapshot.auditRef).toBe('ctrl.resume');

    const modelBefore = invoker.count();
    const coreBefore = core.count();
    const result = await runtime.processInbound(syntheticInboundEnvelope());
    expect(result.outcome).not.toBe('REFUSED');
    expect(result.proposalId).toBeDefined();
    // Exactly one model call and one Core decision for the resumed turn -- unchanged invariants.
    expect(invoker.count()).toBe(modelBefore + 1);
    expect(core.count()).toBe(coreBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// (D-F) Refusals and no-ops through the composition.
// ---------------------------------------------------------------------------

describe('(D, E, F) refusals and no-ops', () => {
  it('(D) RESUME_AI under an active takeover is refused, and the runtime stays blocked', async () => {
    const { source, invoker, core, runtime } = harness({ humanTakeover: true, aiPaused: true });

    const result = await runtime.applyConversationControlCommand(
      commandInput({ action: 'RESUME_AI' }),
    );
    // A refusal is a SUCCESSFUL application of the rules: ok true, decision REFUSED.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.outcome).toBe('REFUSED');
    expect(result.decision.reason).toBe('human-takeover-active');
    expect(result.decision.nextState.revision).toBe(1);
    expect(source.current().humanTakeover).toBe(true);

    const turn = await runtime.processInbound(syntheticInboundEnvelope());
    expect(turn.refusalReason).toBe('orchestration-human-takeover');
    expect(invoker.count()).toBe(0);
    expect(core.count()).toBe(0);
  });

  it('(E) a stale expectedRevision refuses and mutates nothing', async () => {
    const { source, runtime } = harness();
    await runtime.applyConversationControlCommand(commandInput());
    expect(source.current().revision).toBe(2);

    for (const expectedRevision of [1, 5]) {
      const stale = await runtime.applyConversationControlCommand(
        commandInput({ commandId: 'ctrl.stale', expectedRevision, action: 'RESUME_AI' }),
      );
      expect(stale.ok).toBe(true);
      if (!stale.ok) return;
      expect(stale.decision.outcome).toBe('REFUSED');
      expect(stale.decision.reason).toBe('revision-mismatch');
    }
    // Unchanged, and observable on the next read the inbound path would make.
    expect(source.current().revision).toBe(2);
    expect(source.current().humanTakeover).toBe(true);
    expect(source.current().aiPaused).toBe(true);
  });

  it('(F) a redundant command is NO_CHANGE and does not bump the revision', async () => {
    const { source, runtime } = harness({ humanTakeover: true, aiPaused: true });
    const result = await runtime.applyConversationControlCommand(commandInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.outcome).toBe('NO_CHANGE');
    expect(result.decision.reason).toBe('already-satisfied');
    expect(source.current().revision).toBe(1);
    expect(source.controlApplications()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (G, H) Read-only compatibility and input validation.
// ---------------------------------------------------------------------------

describe('(G, H) optional capability and input validation', () => {
  it('(G) a read-only source keeps inbound working and reports both capabilities unavailable', async () => {
    // Operator capability is OPTIONAL. Adding the surface must not make every existing deployment
    // supply a writable source before it can construct a runtime.
    const invoker = countingInvoker();
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: invoker,
      }),
    );

    const turn = await runtime.processInbound(syntheticInboundEnvelope());
    expect(turn.outcome).not.toBe('REFUSED');
    expect(invoker.count()).toBe(1);

    const control = await runtime.applyConversationControlCommand(commandInput());
    expect(control).toEqual({ ok: false, reason: 'control-unavailable' });
    const query = await runtime.readConversationOperationsSnapshot('conv.1');
    expect(query).toEqual({ ok: false, reason: 'operations-unavailable' });
  });

  it('(H) an invalid command is rejected BEFORE the source is touched', async () => {
    const { source, runtime } = harness();
    const invalid: Partial<ConversationControlCommandInput>[] = [
      { commandId: 'has space' },
      { conversationId: '*' },
      { action: 'ASSIGN' as ConversationControlCommandInput['action'] },
      { expectedRevision: -1 },
      { issuedAt: '2026-08-01T00:00:00Z' },
      { operatorRef: 'latest' },
    ];
    for (const over of invalid) {
      const result = await runtime.applyConversationControlCommand(commandInput(over));
      expect(result).toEqual({ ok: false, reason: 'control-invalid-command' });
    }
    // The whole point of validating at the composition boundary.
    expect(source.controlApplications()).toBe(0);
  });

  it('(H) a caller-supplied controlVersion is rejected before the source', async () => {
    const { source, runtime } = harness();
    const result = await runtime.applyConversationControlCommand({
      ...commandInput(),
      controlVersion: 1,
    } as unknown as ConversationControlCommandInput);
    expect(result).toEqual({ ok: false, reason: 'control-invalid-command' });
    expect(source.controlApplications()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (I, J) Foreign control sources: throwing and malformed.
// ---------------------------------------------------------------------------

const SENTINEL = 'sentinel-conversation-detail';

/** A structural writable source under full test control. */
function foreignControlSource(
  apply: (command: ConversationControlCommand) => Promise<unknown>,
): AuthoritativeConversationStatePort & { readonly applies: () => number } {
  const counter = { n: 0 };
  return {
    read: () => Promise.resolve(clearControlState()),
    applyControlCommand: (command: ConversationControlCommand) => {
      counter.n += 1;
      return apply(command);
    },
    applies: () => counter.n,
  } as AuthoritativeConversationStatePort & { readonly applies: () => number };
}

function runtimeOver(source: AuthoritativeConversationStatePort) {
  return createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: source }));
}

/** A canonical decision the composition should accept, for use as a mutation baseline. */
function goodDecision(over: Record<string, unknown> = {}): Record<string, unknown> {
  const nextState = { conversationId: 'conv.1', revision: 2, humanTakeover: true, aiPaused: true };
  return {
    outcome: 'APPLIED',
    reason: 'applied',
    nextState,
    auditRecord: {
      recordVersion: 1,
      commandId: 'ctrl.1',
      conversationId: 'conv.1',
      action: 'TAKE_OWNERSHIP',
      operatorRef: 'operator.synthetic.1',
      expectedRevision: 1,
      observedRevision: 1,
      outcome: 'APPLIED',
      reason: 'applied',
      resultingRevision: 2,
      humanTakeover: true,
      aiPaused: true,
      issuedAt: AT(1),
    },
    ...over,
  };
}

describe('(I, J) a foreign control source fails closed', () => {
  it('(I) a throwing source normalizes, leaks nothing and is called exactly once', async () => {
    const source = foreignControlSource(() => {
      throw new Error(SENTINEL);
    });
    const result = await runtimeOver(source).applyConversationControlCommand(commandInput());
    expect(result).toEqual({ ok: false, reason: 'control-source-failure' });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain('Error');
    // A throw is a refusal, not a reason to ask again.
    expect(source.applies()).toBe(1);
  });

  it('(I) a REJECTING source normalizes the same way', async () => {
    const source = foreignControlSource(() => Promise.reject(new Error(SENTINEL)));
    const result = await runtimeOver(source).applyConversationControlCommand(commandInput());
    expect(result).toEqual({ ok: false, reason: 'control-source-failure' });
    expect(source.applies()).toBe(1);
  });

  it('(J) accepts a canonical decision and returns a FRESH frozen object, not the source’s', async () => {
    const returned = goodDecision();
    const source = foreignControlSource(() => Promise.resolve(returned));
    const result = await runtimeOver(source).applyConversationControlCommand(commandInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same values...
    expect(result.decision.outcome).toBe('APPLIED');
    expect(result.decision.nextState.revision).toBe(2);
    // ...but not the same object. A foreign source could still hold and mutate its own.
    expect(result.decision).not.toBe(returned);
    expect(result.decision.nextState).not.toBe(returned['nextState']);
    expect(result.decision.auditRecord).not.toBe(returned['auditRecord']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decision)).toBe(true);
    expect(Object.isFrozen(result.decision.nextState)).toBe(true);
    expect(Object.isFrozen(result.decision.auditRecord)).toBe(true);
  });

  it('(J) accepts every legitimate outcome/reason pairing', async () => {
    const cases: readonly Record<string, unknown>[] = [
      goodDecision(),
      goodDecision({
        outcome: 'NO_CHANGE',
        reason: 'already-satisfied',
        nextState: { conversationId: 'conv.1', revision: 1, humanTakeover: true, aiPaused: true },
        auditRecord: {
          ...(goodDecision()['auditRecord'] as Record<string, unknown>),
          outcome: 'NO_CHANGE',
          reason: 'already-satisfied',
          resultingRevision: 1,
        },
      }),
      goodDecision({
        outcome: 'REFUSED',
        reason: 'revision-mismatch',
        nextState: { conversationId: 'conv.1', revision: 7, humanTakeover: false, aiPaused: false },
        auditRecord: {
          ...(goodDecision()['auditRecord'] as Record<string, unknown>),
          outcome: 'REFUSED',
          reason: 'revision-mismatch',
          observedRevision: 7,
          resultingRevision: 7,
          humanTakeover: false,
          aiPaused: false,
        },
      }),
    ];
    for (const decision of cases) {
      const source = foreignControlSource(() => Promise.resolve(decision));
      const result = await runtimeOver(source).applyConversationControlCommand(commandInput());
      expect(result.ok).toBe(true);
    }
  });

  it('(J) accepts human-takeover-active and revision-exhausted with their exact preconditions', async () => {
    const takeoverActive = {
      outcome: 'REFUSED',
      reason: 'human-takeover-active',
      nextState: { conversationId: 'conv.1', revision: 1, humanTakeover: true, aiPaused: true },
      auditRecord: {
        ...(goodDecision()['auditRecord'] as Record<string, unknown>),
        action: 'RESUME_AI',
        outcome: 'REFUSED',
        reason: 'human-takeover-active',
        resultingRevision: 1,
      },
    };
    const resumeSource = foreignControlSource(() => Promise.resolve(takeoverActive));
    const resumed = await runtimeOver(resumeSource).applyConversationControlCommand(
      commandInput({ action: 'RESUME_AI' }),
    );
    expect(resumed.ok).toBe(true);

    const MAX = Number.MAX_SAFE_INTEGER;
    const exhausted = {
      outcome: 'REFUSED',
      reason: 'revision-exhausted',
      nextState: { conversationId: 'conv.1', revision: MAX, humanTakeover: false, aiPaused: false },
      auditRecord: {
        ...(goodDecision()['auditRecord'] as Record<string, unknown>),
        expectedRevision: MAX,
        observedRevision: MAX,
        outcome: 'REFUSED',
        reason: 'revision-exhausted',
        resultingRevision: MAX,
        humanTakeover: false,
        aiPaused: false,
      },
    };
    const maxSource = foreignControlSource(() => Promise.resolve(exhausted));
    const maxed = await runtimeOver(maxSource).applyConversationControlCommand(
      commandInput({ expectedRevision: MAX }),
    );
    expect(maxed.ok).toBe(true);
  });

  it('(J) rejects every internally inconsistent decision', async () => {
    const audit = goodDecision()['auditRecord'] as Record<string, unknown>;
    const bad: readonly [string, unknown][] = [
      ['not an object', 'nope'],
      ['null', null],
      ['array', []],
      ['extra decision key', { ...goodDecision(), extra: 1 }],
      ['missing decision key', { outcome: 'APPLIED', reason: 'applied', nextState: {} }],
      ['wrong outcome', goodDecision({ outcome: 'MAYBE' })],
      ['wrong reason for outcome', goodDecision({ reason: 'already-satisfied' })],
      ['REFUSED with applied reason', goodDecision({ outcome: 'REFUSED' })],
      ['malformed nextState', goodDecision({ nextState: { conversationId: 'conv.1' } })],
      [
        'nextState for another conversation',
        goodDecision({
          nextState: {
            conversationId: 'conv.OTHER',
            revision: 2,
            humanTakeover: true,
            aiPaused: true,
          },
        }),
      ],
      ['audit not an object', goodDecision({ auditRecord: 'x' })],
      ['extra audit key', goodDecision({ auditRecord: { ...audit, smuggled: 'content' } })],
      ['missing audit key', goodDecision({ auditRecord: { ...audit, issuedAt: undefined } })],
      ['wrong recordVersion', goodDecision({ auditRecord: { ...audit, recordVersion: 2 } })],
      ['wrong commandId', goodDecision({ auditRecord: { ...audit, commandId: 'ctrl.OTHER' } })],
      [
        'wrong audit conversationId',
        goodDecision({ auditRecord: { ...audit, conversationId: 'conv.OTHER' } }),
      ],
      ['wrong action', goodDecision({ auditRecord: { ...audit, action: 'PAUSE_AI' } })],
      ['wrong operatorRef', goodDecision({ auditRecord: { ...audit, operatorRef: 'op.other' } })],
      ['unexpected reasonRef', goodDecision({ auditRecord: { ...audit, reasonRef: 'reason.x' } })],
      ['wrong issuedAt', goodDecision({ auditRecord: { ...audit, issuedAt: AT(9) } })],
      ['wrong expectedRevision', goodDecision({ auditRecord: { ...audit, expectedRevision: 5 } })],
      [
        'wrong resultingRevision',
        goodDecision({ auditRecord: { ...audit, resultingRevision: 9 } }),
      ],
      [
        'flags disagree with nextState',
        goodDecision({ auditRecord: { ...audit, aiPaused: false } }),
      ],
      [
        'negative observedRevision',
        goodDecision({ auditRecord: { ...audit, observedRevision: -1 } }),
      ],
      [
        'APPLIED without a revision bump',
        goodDecision({
          nextState: { conversationId: 'conv.1', revision: 1, humanTakeover: true, aiPaused: true },
          auditRecord: { ...audit, resultingRevision: 1 },
        }),
      ],
      [
        'revision-mismatch while revisions agree',
        goodDecision({
          outcome: 'REFUSED',
          reason: 'revision-mismatch',
          nextState: {
            conversationId: 'conv.1',
            revision: 1,
            humanTakeover: false,
            aiPaused: false,
          },
          auditRecord: {
            ...audit,
            outcome: 'REFUSED',
            reason: 'revision-mismatch',
            resultingRevision: 1,
            humanTakeover: false,
            aiPaused: false,
          },
        }),
      ],
      [
        'human-takeover-active on a non-RESUME action',
        goodDecision({
          outcome: 'REFUSED',
          reason: 'human-takeover-active',
          nextState: { conversationId: 'conv.1', revision: 1, humanTakeover: true, aiPaused: true },
          auditRecord: {
            ...audit,
            outcome: 'REFUSED',
            reason: 'human-takeover-active',
            resultingRevision: 1,
          },
        }),
      ],
      [
        'revision-exhausted below the ceiling',
        goodDecision({
          outcome: 'REFUSED',
          reason: 'revision-exhausted',
          nextState: { conversationId: 'conv.1', revision: 1, humanTakeover: true, aiPaused: true },
          auditRecord: {
            ...audit,
            outcome: 'REFUSED',
            reason: 'revision-exhausted',
            resultingRevision: 1,
          },
        }),
      ],
    ];

    for (const [label, decision] of bad) {
      const source = foreignControlSource(() => Promise.resolve(decision));
      const result = await runtimeOver(source).applyConversationControlCommand(commandInput());
      expect(result, label).toEqual({ ok: false, reason: 'control-invalid-result' });
      expect(source.applies()).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// (K, L, M, N) The operations query.
// ---------------------------------------------------------------------------

/** A structural projecting source under full test control. */
function foreignProjectionSource(
  project: (conversationId: string) => Promise<unknown>,
): AuthoritativeConversationStatePort & { readonly projections: () => number } {
  const counter = { n: 0 };
  return {
    read: () => Promise.resolve(clearControlState()),
    readOperationsProjection: (conversationId: string) => {
      counter.n += 1;
      return project(conversationId);
    },
    projections: () => counter.n,
  } as AuthoritativeConversationStatePort & { readonly projections: () => number };
}

function goodProjection(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: { ...clearControlState() },
    conversationState: 'ACTIVE_AI',
    lastActivityAt: AT(1),
    escalationStatus: 'none',
    followUpStatus: 'none',
    deliveryStatePlaceholder: 'not-implemented',
    auditRef: 'audit.1',
    ...over,
  };
}

describe('(K, L, M) the operations query fails closed', () => {
  it('(M) an invalid conversation id is rejected BEFORE the source is touched', async () => {
    const source = foreignProjectionSource(() => Promise.resolve(goodProjection()));
    const runtime = runtimeOver(source);
    for (const id of ['', 'has space', '*', 'conv.*', 'latest', 'LATEST', 'a'.repeat(129)]) {
      const result = await runtime.readConversationOperationsSnapshot(id);
      expect(result).toEqual({ ok: false, reason: 'operations-invalid-conversation' });
    }
    expect(source.projections()).toBe(0);
  });

  it('(K) a throwing projection normalizes, leaks nothing and is called exactly once', async () => {
    const source = foreignProjectionSource(() => {
      throw new Error(SENTINEL);
    });
    const result = await runtimeOver(source).readConversationOperationsSnapshot('conv.1');
    expect(result).toEqual({ ok: false, reason: 'operations-source-failure' });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(source.projections()).toBe(1);
  });

  it('(L) rejects every malformed projection without repairing it', async () => {
    const state = { ...clearControlState() };
    const bad: readonly [string, unknown][] = [
      ['not an object', 7],
      ['null', null],
      ['extra key', { ...goodProjection(), extra: 1 }],
      ['missing key', { state, conversationState: 'ACTIVE_AI', lastActivityAt: AT(1) }],
      ['wrong conversation', goodProjection({ state: { ...state, conversationId: 'conv.OTHER' } })],
      ['negative revision', goodProjection({ state: { ...state, revision: -1 } })],
      ['fractional revision', goodProjection({ state: { ...state, revision: 1.5 } })],
      ['invalid partyType', goodProjection({ state: { ...state, partyType: 'SUPPLIER' } })],
      ['invalid dataClass', goodProjection({ state: { ...state, dataClass: 'PUBLIC' } })],
      ['invalid subjectStatus', goodProjection({ state: { ...state, subjectStatus: 'fine' } })],
      ['non-boolean flag', goodProjection({ state: { ...state, humanTakeover: 'yes' } })],
      ['extra state key', goodProjection({ state: { ...state, extra: 1 } })],
      ['invalid conversationState', goodProjection({ conversationState: 'PENDING' })],
      ['non-canonical instant', goodProjection({ lastActivityAt: 'yesterday' })],
      ['free-text escalation', goodProjection({ escalationStatus: 'the client is upset' })],
      ['blank followUp', goodProjection({ followUpStatus: '' })],
      ['oversize delivery token', goodProjection({ deliveryStatePlaceholder: 'a'.repeat(129) })],
      ['invalid auditRef', goodProjection({ auditRef: 'audit ref' })],
    ];
    for (const [label, projection] of bad) {
      const source = foreignProjectionSource(() => Promise.resolve(projection));
      const result = await runtimeOver(source).readConversationOperationsSnapshot('conv.1');
      expect(result, label).toEqual({ ok: false, reason: 'operations-invalid-result' });
      expect(source.projections()).toBe(1);
    }
  });

  it('(L) returns a frozen snapshot and result on the happy path', async () => {
    const source = foreignProjectionSource(() => Promise.resolve(goodProjection()));
    const result = await runtimeOver(source).readConversationOperationsSnapshot('conv.1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.keys(result.snapshot).sort()).toEqual(
      [
        'aiPaused',
        'assignedActor',
        'auditRef',
        'conversationId',
        'conversationState',
        'deliveryStatePlaceholder',
        'escalationStatus',
        'followUpStatus',
        'humanTakeover',
        'lastActivityAt',
        'partyType',
        'revision',
      ].sort(),
    );
  });
});

describe('(N) M1 remains the sole assignment authority', () => {
  const policy = createRuntimePolicy({ policyRevision: 'policy.rev.1' });

  it('(N) the projection contract has no assignedActor field to inject', () => {
    // A structural check on the shape the composition accepts: a source that adds `assignedActor`
    // supplies an EXTRA key, which is refused -- so it cannot name the actor even by accident.
    const projection: ConversationOperationsProjection =
      goodProjection() as unknown as ConversationOperationsProjection;
    expect('assignedActor' in projection).toBe(false);
  });

  it('(N) rejects a projection that tries to supply assignedActor', async () => {
    const source = foreignProjectionSource(() =>
      Promise.resolve(goodProjection({ assignedActor: 'JARVIS' })),
    );
    const result = await runtimeOver(source).readConversationOperationsSnapshot('conv.1');
    expect(result).toEqual({ ok: false, reason: 'operations-invalid-result' });
  });

  it('(N) computes the actor through assignAgent for every party/takeover combination', async () => {
    const cases: readonly {
      readonly partyType: ConversationControlState['partyType'];
      readonly humanTakeover: boolean;
      readonly unknownRouting?: 'JARVIS' | 'HUMAN';
    }[] = [
      { partyType: 'CLIENT', humanTakeover: false },
      { partyType: 'VENDOR', humanTakeover: false },
      { partyType: 'UNKNOWN', humanTakeover: false, unknownRouting: 'JARVIS' },
      { partyType: 'UNKNOWN', humanTakeover: false, unknownRouting: 'HUMAN' },
      { partyType: 'CLIENT', humanTakeover: true },
      { partyType: 'VENDOR', humanTakeover: true },
    ];
    for (const testCase of cases) {
      const runtimePolicy =
        testCase.unknownRouting === undefined
          ? policy
          : createRuntimePolicy({
              policyRevision: 'policy.rev.1',
              unknownRouting: testCase.unknownRouting,
            });
      const source = foreignProjectionSource(() =>
        Promise.resolve(
          goodProjection({
            state: {
              ...clearControlState(),
              partyType: testCase.partyType,
              humanTakeover: testCase.humanTakeover,
            },
          }),
        ),
      );
      const runtime = createJarvisRuntime(
        syntheticRuntimeConfig({ authoritativeState: source, policy: runtimePolicy }),
      );
      const result = await runtime.readConversationOperationsSnapshot('conv.1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Compared against the imported router itself -- no mapping table is duplicated here.
      expect(result.snapshot.assignedActor).toBe(
        assignAgent(testCase.partyType, testCase.humanTakeover, runtimePolicy),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// (O, P) The concurrency token, and that all three methods use ONE object.
// ---------------------------------------------------------------------------

describe('(O, P) one source, one revision', () => {
  it('(O) the snapshot revision IS the token the next command must present', async () => {
    const { runtime } = harness();

    const first = await runtime.readConversationOperationsSnapshot('conv.1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const observed = first.snapshot.revision;

    // A command built from exactly what the operator saw succeeds.
    const applied = await runtime.applyConversationControlCommand(
      commandInput({ expectedRevision: observed, action: 'PAUSE_AI' }),
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.decision.outcome).toBe('APPLIED');

    const second = await runtime.readConversationOperationsSnapshot('conv.1');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.snapshot.revision).toBe(observed + 1);

    // A command built from the STALE snapshot now refuses. This is the whole reason the M1 snapshot
    // contract gained `revision`: without it an operator surface could not build a bound command.
    const stale = await runtime.applyConversationControlCommand(
      commandInput({ commandId: 'ctrl.stale', expectedRevision: observed, action: 'RESUME_AI' }),
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.decision.reason).toBe('revision-mismatch');
  });

  it('(P) read, applyControlCommand and readOperationsProjection all hit the configured object', async () => {
    const source: ControllableAuthoritativeState =
      controllableAuthoritativeState(clearControlState());
    const config: JarvisRuntimeConfig = syntheticRuntimeConfig({ authoritativeState: source });
    // The object identity that matters: what the config holds is what the runtime uses.
    expect(config.authoritativeState).toBe(source);
    const runtime = createJarvisRuntime(config);

    expect(source.reads()).toBe(0);
    expect(source.controlApplications()).toBe(0);
    expect(source.operationsReads()).toBe(0);

    await runtime.applyConversationControlCommand(commandInput());
    expect(source.controlApplications()).toBe(1);

    await runtime.readConversationOperationsSnapshot('conv.1');
    expect(source.operationsReads()).toBe(1);

    await runtime.processInbound(syntheticInboundEnvelope());
    // The inbound path delegated to the SAME object -- and it observed the takeover set above.
    expect(source.reads()).toBeGreaterThan(0);
    expect(source.current().humanTakeover).toBe(true);
  });

  it('(P) processInbound invokes neither operator capability', async () => {
    const { source, runtime } = harness();
    await runtime.processInbound(syntheticInboundEnvelope());
    expect(source.controlApplications()).toBe(0);
    expect(source.operationsReads()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Composition surface.
// ---------------------------------------------------------------------------

describe('the runtime surface', () => {
  it('exposes exactly three methods and nothing that sends or executes', () => {
    const runtime = createJarvisRuntime(syntheticRuntimeConfig());
    expect(Object.keys(runtime).sort()).toEqual([
      'applyConversationControlCommand',
      'processInbound',
      'readConversationOperationsSnapshot',
    ]);
    expect(Object.isFrozen(runtime)).toBe(true);
    for (const forbidden of [
      'send',
      'deliver',
      'execute',
      'persist',
      'approve',
      'authorize',
      'callN8n',
      'dispatch',
      'webhook',
      'startWorker',
      'retryJob',
    ]) {
      expect(forbidden in runtime).toBe(false);
    }
  });
});
