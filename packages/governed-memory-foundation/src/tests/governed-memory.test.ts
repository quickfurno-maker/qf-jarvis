import { describe, expect, it } from 'vitest';

import {
  GOVERNED_MEMORY_ENGINEERING_POLICY_V1,
  assessGovernedMemoryWrite,
  createGovernedMemoryPolicy,
} from '../index.js';

const fact = {
  factRef: 'memory.fact.1',
  subjectRef: 'subject.1',
  memoryClass: 'DURABLE_PREFERENCE' as const,
  factType: 'preferred_language',
  valueRef: 'language.hinglish',
  sourceRef: 'conversation.turn.1',
  observedAt: '2026-09-23T10:00:00.000Z',
};

describe('governed memory foundation', () => {
  it('keeps durable memory disabled by default', () => {
    expect(assessGovernedMemoryWrite(fact)).toEqual({
      decision: 'REFUSE_DURABLE_DISABLED',
      policyRef: GOVERNED_MEMORY_ENGINEERING_POLICY_V1.policyRef,
      factRef: fact.factRef,
    });
  });

  it('allows ephemeral structured facts without turning them into durable memory', () => {
    expect(
      assessGovernedMemoryWrite({ ...fact, memoryClass: 'CONVERSATION_EPHEMERAL' }),
    ).toMatchObject({ decision: 'ALLOW_EPHEMERAL', factRef: fact.factRef });
  });

  it('never lets memory become a copy of Core authority', () => {
    expect(
      assessGovernedMemoryWrite({ ...fact, memoryClass: 'CORE_AUTHORITY_REFERENCE' }),
    ).toMatchObject({ decision: 'REFUSE_CORE_AUTHORITY' });
  });

  it('requires owner, retention and erasure refs before durable memory can be enabled', () => {
    expect(() =>
      createGovernedMemoryPolicy({
        policyRef: 'policy.memory.1',
        durableMemoryEnabled: true,
      }),
    ).toThrow('governed-memory-owner-policy-required');
  });

  it('permits a durable preference only under an explicit bounded lifecycle policy', () => {
    const policy = createGovernedMemoryPolicy({
      policyRef: 'policy.memory.1',
      durableMemoryEnabled: true,
      ownerApprovalRef: 'owner.memory.approval.1',
      retentionPolicyRef: 'policy.retention.1',
      erasurePolicyRef: 'policy.erasure.1',
      maxDurableRetentionDays: 90,
    });

    expect(assessGovernedMemoryWrite(fact, policy)).toEqual({
      decision: 'ALLOW_DURABLE',
      policyRef: 'policy.memory.1',
      factRef: 'memory.fact.1',
      expiresAfterDays: 90,
    });
  });

  it('refuses malformed or free-form-shaped fact identifiers', () => {
    expect(assessGovernedMemoryWrite({ ...fact, valueRef: 'call me after dinner please!' })).toEqual({
      decision: 'REFUSE_INVALID_FACT',
      policyRef: GOVERNED_MEMORY_ENGINEERING_POLICY_V1.policyRef,
    });
  });
});
