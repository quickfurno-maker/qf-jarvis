/**
 * RWC-P7 — nine-phase text routing, and the post-summary turn that changes nothing (ADR-0103 §17).
 *
 * One property carries this whole file: **a post-summary text turn cannot move the conversation.**
 * A client who has confirmed their summary may still type "yes", "actually make it next year", or
 * "how long does installation take?", and none of those may become an RWC-P6 structured action, a
 * phase change or a compare-and-set. The routing branch is where that guarantee is either kept or
 * quietly lost, so almost everything below counts calls and compares stored state.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
} from '@qf-jarvis/riya-conversation-continuity';
import { describe, expect, it } from 'vitest';

import { createRiyaWebConversationService } from '../service/create-service.js';
import { InMemoryContinuityStore } from './fakes/in-memory-continuity-store.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';
import { scriptedTurnCoordinator } from './fakes/scripted-turn-coordinator.js';

const PRE_SUMMARY: readonly RiyaConversationPhase[] = [
  'INTRO',
  'NEED',
  'LOCATION',
  'PROJECT_DETAILS',
  'BUDGET_TIMELINE',
  'SUMMARY',
];
const POST_SUMMARY: readonly RiyaConversationPhase[] = ['CONTACT', 'CONSENT', 'COMPLETE'];

function continuityAt(phase: RiyaConversationPhase): RiyaConversationContinuityStateV1 {
  const confirmed = POST_SUMMARY.includes(phase);
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    continuityRevision: 4,
    phase,
    discovery: {
      serviceInterestRef: 'svc.one',
      locationRef: 'city.alpha',
      budgetNote: 'around 8 lakh',
      timelineNote: 'next month',
      completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
    },
    fieldProvenance: {
      serviceInterest: 'user_stated',
      location: 'user_stated',
      budget: 'user_stated',
      timeline: 'user_stated',
    },
    summaryConfirmed: confirmed,
    ...(phase === 'COMPLETE' ? { completionEvidenceRef: 'core.intake.evidence.1' } : {}),
  });
}

const TURN = {
  version: 1 as const,
  tenantId: 'tenant.a',
  conversationId: 'conv.1',
  messageId: 'msg.1',
  receivedAt: '2026-07-25T00:00:00Z',
  webTurnRef: 'web.turn.opaque.ref',
  dataClass: 'HOSTED_ALLOWED' as const,
  subjectRef: 'subject.1',
  normalizedText: 'how long does installation take?',
};

function build(phase: RiyaConversationPhase) {
  const continuityStore = new InMemoryContinuityStore();
  continuityStore.seed(continuityAt(phase));
  const runtime = scriptedRuntime('CORE_ACCEPTED');
  const availabilityReader = scriptedAvailabilityReader();
  const service = createRiyaWebConversationService({
    // RWC-P9 (ADR-0105): capacity is REQUIRED configuration, with no default. A generous
    // cap here keeps these suites about what they were about; the admission behaviour has
    // its own specs.
    maxConcurrentTextTurns: 64,
    // RWC-P8 (ADR-0104): the coordinator is REQUIRED. A fresh one per construction, because a
    // shared instance would let one spec's claims decide another spec's outcome.
    turnCoordinator: scriptedTurnCoordinator(),
    runtime,
    continuityStore,
    availabilityReader,
    runtimeId: 'rt.1',
  });
  return { service, continuityStore, runtime, availabilityReader };
}

describe('exactly one runtime method per text turn, chosen by phase', () => {
  for (const phase of PRE_SUMMARY) {
    it(`${phase} goes to the RWC-P4B evolution capability, and only that one`, async () => {
      const { service, runtime, availabilityReader } = build(phase);
      await service.handleTurn(TURN);
      expect(runtime.invoked()).toBe(1);
      expect(runtime.groundedInvoked()).toBe(0);
      // Never the ordinary or P2D paths either: those would be a second orchestration run.
      expect(runtime.ordinaryInvoked()).toBe(0);
      expect(runtime.coreAuthorizedInvoked()).toBe(0);
      // Still exactly ONE availability read per turn.
      expect(availabilityReader.calls()).toBe(1);
    });
  }

  for (const phase of POST_SUMMARY) {
    it(`${phase} goes to the RWC-P7 grounded reply capability, and only that one`, async () => {
      const { service, runtime, availabilityReader } = build(phase);
      await service.handleTurn(TURN);
      expect(runtime.groundedInvoked()).toBe(1);
      expect(runtime.invoked()).toBe(0);
      expect(runtime.ordinaryInvoked()).toBe(0);
      expect(runtime.coreAuthorizedInvoked()).toBe(0);
      expect(availabilityReader.calls()).toBe(1);
    });
  }

  it('the SAME single snapshot reaches whichever method was selected', async () => {
    for (const phase of ['SUMMARY', 'CONSENT'] as const) {
      const { service, availabilityReader } = build(phase);
      await service.handleTurn(TURN);
      expect(availabilityReader.calls(), phase).toBe(1);
      expect(availabilityReader.lastInput()).toStrictEqual({ tenantId: 'tenant.a' });
    }
  });
});

describe('a post-summary text turn changes NOTHING', () => {
  for (const phase of POST_SUMMARY) {
    it(`${phase} performs no compare-and-set and returns the loaded continuity unchanged`, async () => {
      const { service, continuityStore } = build(phase);
      const before = continuityStore.peek('tenant.a', 'conv.1');
      const result = await service.handleTurn(TURN);

      expect(continuityStore.calls.compareAndSet).toBe(0);
      expect(continuityStore.calls.createInitialIfAbsent).toBe(0);
      // Byte-for-byte the state that was loaded. Not a rebuilt equivalent -- an equivalent would
      // still mean something reconstructed it, and the next thing to reconstruct it might not agree.
      expect(result.continuity).toStrictEqual(before);
      expect(continuityStore.peek('tenant.a', 'conv.1')).toStrictEqual(before);
      expect(result.continuity.continuityRevision).toBe(4);
      expect(result.continuity.phase).toBe(phase);
    });
  }

  it('a client typing "yes" at CONSENT cannot become a structured P6 action', async () => {
    // The RWC-P6 structured actions make ZERO model calls. A text turn reaching one would be a
    // sentence deciding a submission, which is the single thing this whole phase split prevents.
    const { service, continuityStore } = build('CONSENT');
    const result = await service.handleTurn({ ...TURN, normalizedText: 'yes' });
    expect(result.continuity.phase).toBe('CONSENT');
    expect(result.continuity.summaryConfirmed).toBe(true);
    expect(result.continuity.completionEvidenceRef).toBeUndefined();
    expect(continuityStore.calls.compareAndSet).toBe(0);
  });

  it('COMPLETE may be answered, and keeps its completion evidence untouched', async () => {
    const { service, continuityStore } = build('COMPLETE');
    const result = await service.handleTurn(TURN);
    expect(result.disposition).toBe('PROCESSED');
    expect(result.continuity.phase).toBe('COMPLETE');
    expect(result.continuity.completionEvidenceRef).toBe('core.intake.evidence.1');
    // No second intake, no restarted discovery, no revision.
    expect(continuityStore.calls.compareAndSet).toBe(0);
    expect(continuityStore.size).toBe(1);
    expect(result.continuity.discovery.completeness).toBe('SUFFICIENT_FOR_CORE_REVIEW');
  });

  it('the Core-authorized body is still the ONLY client-facing text', async () => {
    const { service } = build('CONSENT');
    const result = await service.handleTurn(TURN);
    // `authorizedReply` remains the single text capability; the result gains no citation list, no
    // record content and no knowledge field.
    expect(Object.keys(result).sort()).toStrictEqual([
      'authorizedReply',
      'continuity',
      'conversationId',
      'disposition',
      'messageId',
      'reason',
      'tenantId',
      'version',
    ]);
    expect(JSON.stringify(result)).not.toContain('citation');
    expect(JSON.stringify(result)).not.toContain('knowledgeId');
    expect(JSON.stringify(result)).not.toContain('groundedKnowledge');
  });
});

describe('the pre-summary path is unchanged', () => {
  it('a refused post-summary turn is NOT retried on the evolution capability', async () => {
    const { service, runtime } = build('CONTACT');
    // A throwing runtime is the sharpest version of the question: one refusal must not become a
    // second attempt through the other door.
    const throwing = scriptedRuntime('CORE_ACCEPTED', { throws: true });
    const store = new InMemoryContinuityStore();
    store.seed(continuityAt('CONTACT'));
    const s2 = createRiyaWebConversationService({
      // RWC-P9 (ADR-0105): capacity is REQUIRED configuration, with no default. A generous
      // cap here keeps these suites about what they were about; the admission behaviour has
      // its own specs.
      maxConcurrentTextTurns: 64,
      // RWC-P8 (ADR-0104): the coordinator is REQUIRED. A fresh one per construction, because a
      // shared instance would let one spec's claims decide another spec's outcome.
      turnCoordinator: scriptedTurnCoordinator(),
      runtime: throwing,
      continuityStore: store,
      availabilityReader: scriptedAvailabilityReader(),
      runtimeId: 'rt.1',
    });
    await expect(s2.handleTurn(TURN)).rejects.toMatchObject({ code: 'runtime-unavailable' });
    expect(throwing.groundedInvoked()).toBe(1);
    expect(throwing.invoked()).toBe(0);
    void service;
    void runtime;
  });

  it('a runtime without the RWC-P7 capability fails at CONSTRUCTION, not mid-conversation', () => {
    const complete = scriptedRuntime('CORE_ACCEPTED');
    const partialRuntime = Object.fromEntries(
      Object.entries(complete).filter(([name]) => name !== 'processInboundForRiyaGroundedReply'),
    ) as never;
    expect(() =>
      createRiyaWebConversationService({
        // RWC-P9 (ADR-0105): capacity is REQUIRED configuration, with no default. A generous
        // cap here keeps these suites about what they were about; the admission behaviour has
        // its own specs.
        maxConcurrentTextTurns: 64,
        // RWC-P8 (ADR-0104): the coordinator is REQUIRED. A fresh one per construction, because a
        // shared instance would let one spec's claims decide another spec's outcome.
        turnCoordinator: scriptedTurnCoordinator(),
        runtime: partialRuntime,
        continuityStore: new InMemoryContinuityStore(),
        availabilityReader: scriptedAvailabilityReader(),
        runtimeId: 'rt.1',
      }),
    ).toThrow();
  });
});
