import { describe, expect, it } from 'vitest';

import {
  JAO_ENGINEERING_REGISTRY_V1,
  assessJaoActionProposal,
  createJaoActionRegistry,
} from '../index.js';
import type { JaoActionDefinition } from '../index.js';

function engineeringAction(): JaoActionDefinition {
  const action = JAO_ENGINEERING_REGISTRY_V1.actions[0];
  if (action === undefined) throw new Error('engineering-action-missing');
  return action;
}

describe('JAO action registry', () => {
  it('ships all engineering actions disabled and deeply freezes their agent scopes', () => {
    expect(JAO_ENGINEERING_REGISTRY_V1.actions.every((action) => !action.enabled)).toBe(true);
    expect(JAO_ENGINEERING_REGISTRY_V1.actions.every((action) => Object.isFrozen(action))).toBe(
      true,
    );
    expect(
      JAO_ENGINEERING_REGISTRY_V1.actions.every((action) =>
        Object.isFrozen(action.allowedAgentScopes),
      ),
    ).toBe(true);
  });

  it('cannot make a disabled action proposal-eligible', () => {
    expect(
      assessJaoActionProposal({
        registry: JAO_ENGINEERING_REGISTRY_V1,
        actionId: 'propose_vendor_follow_up',
        actionVersion: 1,
        agentScope: 'JARVIS',
        maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
        authorityEvidenceRef: 'authority.evidence.1',
        approvalEvidenceRef: 'approval.evidence.1',
      }),
    ).toMatchObject({ decision: 'ACTION_DISABLED' });
  });

  it('requires maturity, authority evidence and approval evidence even for an enabled reviewed action', () => {
    const registry = createJaoActionRegistry({
      registryRef: 'registry.reviewed.1',
      actions: [{ ...engineeringAction(), enabled: true }],
    });

    expect(
      assessJaoActionProposal({
        registry,
        actionId: 'propose_vendor_follow_up',
        actionVersion: 1,
        agentScope: 'JARVIS',
        maturityDecision: 'KEEP_DEFAULT_OFF',
      }),
    ).toMatchObject({ decision: 'MATURITY_REVIEW_REQUIRED' });

    expect(
      assessJaoActionProposal({
        registry,
        actionId: 'propose_vendor_follow_up',
        actionVersion: 1,
        agentScope: 'JARVIS',
        maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
      }),
    ).toMatchObject({ decision: 'AUTHORITY_EVIDENCE_MISSING' });

    expect(
      assessJaoActionProposal({
        registry,
        actionId: 'propose_vendor_follow_up',
        actionVersion: 1,
        agentScope: 'JARVIS',
        maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
        authorityEvidenceRef: 'authority.evidence.1',
      }),
    ).toMatchObject({ decision: 'APPROVAL_EVIDENCE_MISSING' });
  });

  it('returns only proposal eligibility, never an execution result', () => {
    const registry = createJaoActionRegistry({
      registryRef: 'registry.reviewed.1',
      actions: [{ ...engineeringAction(), enabled: true }],
    });

    const result = assessJaoActionProposal({
      registry,
      actionId: 'propose_vendor_follow_up',
      actionVersion: 1,
      agentScope: 'JARVIS',
      maturityDecision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
      authorityEvidenceRef: 'authority.evidence.1',
      approvalEvidenceRef: 'approval.evidence.1',
    });
    expect(result).toEqual({
      actionId: 'propose_vendor_follow_up',
      actionVersion: 1,
      decision: 'ELIGIBLE_FOR_PROPOSAL',
      registryRef: 'registry.reviewed.1',
      effectClass: 'CORE_PROPOSAL',
      bindingRef: 'jao6.vendor-follow-up.v1',
    });
    expect('executed' in result).toBe(false);
    expect('authorized' in result).toBe(false);
  });

  it('refuses duplicate version identities', () => {
    const action = engineeringAction();
    expect(() =>
      createJaoActionRegistry({
        registryRef: 'registry.duplicate.1',
        actions: [action, action],
      }),
    ).toThrow('jao-action-registry-duplicate');
  });
});
