import { describe, expect, it } from 'vitest';

import { prepareGovernedAgentHandoff } from '../index.js';

describe('governed agent handoff', () => {
  it('prepares an evidence-bound proposal for the Core-assigned target agent', () => {
    const result = prepareGovernedAgentHandoff({
      fromAgent: 'RIYA',
      toAgent: 'ANISHA',
      partyType: 'VENDOR',
      conversationRef: 'conversation.1',
      coreAssignmentEvidenceRef: 'core.assignment.rev.18',
      reasonCode: 'party-reclassified',
      contextSummaryRef: 'summary.1',
    });
    expect(result).toMatchObject({
      decision: 'HANDOFF_PROPOSAL_READY',
      proposal: {
        fromAgent: 'RIYA',
        toAgent: 'ANISHA',
        partyType: 'VENDOR',
        businessEffect: false,
        assignmentChanged: false,
        workflowStarted: false,
      },
    });
  });

  it('refuses a target inconsistent with the authoritative party type', () => {
    expect(
      prepareGovernedAgentHandoff({
        fromAgent: 'RIYA',
        toAgent: 'AAROHI',
        partyType: 'VENDOR',
        conversationRef: 'conversation.1',
        coreAssignmentEvidenceRef: 'core.assignment.rev.18',
        reasonCode: 'party-reclassified',
      }),
    ).toEqual({ decision: 'TARGET_MISMATCH' });
  });

  it('requires Core assignment evidence before proposing a handoff', () => {
    expect(
      prepareGovernedAgentHandoff({
        fromAgent: 'RIYA',
        toAgent: 'ANISHA',
        partyType: 'VENDOR',
        conversationRef: 'conversation.1',
        reasonCode: 'party-reclassified',
      }),
    ).toEqual({ decision: 'AUTHORITY_EVIDENCE_MISSING' });
  });

  it('does nothing when the current actor already matches Core assignment', () => {
    expect(
      prepareGovernedAgentHandoff({
        fromAgent: 'ANISHA',
        toAgent: 'ANISHA',
        partyType: 'VENDOR',
        conversationRef: 'conversation.1',
        coreAssignmentEvidenceRef: 'core.assignment.rev.18',
        reasonCode: 'assignment-check',
      }),
    ).toEqual({ decision: 'NO_HANDOFF_REQUIRED' });
  });
});
