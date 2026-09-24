import { describe, expect, it } from 'vitest';
import { assessAgentHandoff } from '../index.js';

const base = {
  handoffId: 'handoff.1',
  conversationRef: 'conversation.1',
  stateRevision: 7,
  sourceAgent: 'RIYA' as const,
  targetAgent: 'ANISHA' as const,
  authoritativeActor: 'ANISHA' as const,
  humanTakeover: false,
  reasonCode: 'core-role-changed',
  contextRefs: [
    {
      ref: 'context.vendor.1',
      classification: 'PERSONAL' as const,
      allowedAgents: ['RIYA' as const, 'ANISHA' as const],
    },
  ],
} as const;

describe('governed agent handoff', () => {
  it('creates only a proposal when target matches authoritative assignment', () => {
    expect(assessAgentHandoff(base)).toMatchObject({
      decision: 'ELIGIBLE_FOR_HANDOFF_PROPOSAL',
      proposal: { targetAgent: 'ANISHA', businessEffect: false, controlTransitionCreated: false },
    });
  });
  it('cannot override Core assignment', () => {
    expect(assessAgentHandoff({ ...base, targetAgent: 'AAROHI' })).toEqual({
      decision: 'BLOCKED_AUTHORITY_MISMATCH',
    });
  });
  it('human takeover forces HUMAN and still checks context scope', () => {
    expect(assessAgentHandoff({ ...base, humanTakeover: true, targetAgent: 'ANISHA' })).toEqual({
      decision: 'BLOCKED_AUTHORITY_MISMATCH',
    });
    expect(
      assessAgentHandoff({
        ...base,
        humanTakeover: true,
        targetAgent: 'HUMAN',
        contextRefs: [
          {
            ref: 'context.vendor.1',
            classification: 'PERSONAL',
            allowedAgents: ['RIYA', 'ANISHA', 'HUMAN'],
          },
        ],
      }),
    ).toMatchObject({ decision: 'ELIGIBLE_FOR_HANDOFF_PROPOSAL' });
  });
  it('blocks context not scoped to receiving agent', () => {
    expect(
      assessAgentHandoff({
        ...base,
        contextRefs: [
          { ref: 'context.riya-only.1', classification: 'PERSONAL', allowedAgents: ['RIYA'] },
        ],
      }),
    ).toEqual({ decision: 'BLOCKED_CONTEXT_SCOPE', blockedRefs: ['context.riya-only.1'] });
  });
});
