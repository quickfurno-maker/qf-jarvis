const REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export const MEMORY_CLASSES = Object.freeze([
  'CONVERSATION_EPHEMERAL',
  'DURABLE_PREFERENCE',
  'CORE_AUTHORITY_REFERENCE',
] as const);

export type MemoryClass = (typeof MEMORY_CLASSES)[number];

export const MEMORY_WRITE_DECISIONS = Object.freeze([
  'ALLOW_EPHEMERAL',
  'ALLOW_DURABLE',
  'REFUSE_DURABLE_DISABLED',
  'REFUSE_OWNER_POLICY_MISSING',
  'REFUSE_CORE_AUTHORITY',
  'REFUSE_INVALID_FACT',
] as const);

export type MemoryWriteDecision = (typeof MEMORY_WRITE_DECISIONS)[number];

export interface GovernedMemoryFactInput {
  readonly factRef: string;
  readonly subjectRef: string;
  readonly memoryClass: MemoryClass;
  readonly factType: string;
  readonly valueRef: string;
  readonly sourceRef: string;
  readonly observedAt: string;
}

export interface GovernedMemoryPolicy {
  readonly policyRef: string;
  readonly durableMemoryEnabled: boolean;
  readonly ownerApprovalRef?: string;
  readonly retentionPolicyRef?: string;
  readonly erasurePolicyRef?: string;
  readonly maxDurableRetentionDays?: number;
}

export interface GovernedMemoryWriteAssessment {
  readonly decision: MemoryWriteDecision;
  readonly policyRef: string;
  readonly factRef?: string;
  readonly expiresAfterDays?: number;
}

export const GOVERNED_MEMORY_ENGINEERING_POLICY_V1: GovernedMemoryPolicy = Object.freeze({
  policyRef: 'qfj.governed-memory.engineering.v1',
  durableMemoryEnabled: false,
});

function validRef(value: string): boolean {
  return REF.test(value);
}

function validIsoInstant(value: string): boolean {
  if (value.length < 20 || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validFact(input: GovernedMemoryFactInput): boolean {
  return (
    validRef(input.factRef) &&
    validRef(input.subjectRef) &&
    MEMORY_CLASSES.includes(input.memoryClass) &&
    validRef(input.factType) &&
    validRef(input.valueRef) &&
    validRef(input.sourceRef) &&
    validIsoInstant(input.observedAt)
  );
}

export function createGovernedMemoryPolicy(input: GovernedMemoryPolicy): GovernedMemoryPolicy {
  if (!validRef(input.policyRef)) throw new TypeError('governed-memory-policy-invalid');

  const refs = [input.ownerApprovalRef, input.retentionPolicyRef, input.erasurePolicyRef];
  if (refs.some((value) => value !== undefined && !validRef(value))) {
    throw new TypeError('governed-memory-policy-invalid');
  }
  if (
    input.maxDurableRetentionDays !== undefined &&
    (!Number.isInteger(input.maxDurableRetentionDays) ||
      input.maxDurableRetentionDays < 1 ||
      input.maxDurableRetentionDays > 3650)
  ) {
    throw new TypeError('governed-memory-policy-invalid');
  }

  if (input.durableMemoryEnabled) {
    if (
      input.ownerApprovalRef === undefined ||
      input.retentionPolicyRef === undefined ||
      input.erasurePolicyRef === undefined ||
      input.maxDurableRetentionDays === undefined
    ) {
      throw new TypeError('governed-memory-owner-policy-required');
    }
  }

  return Object.freeze({ ...input });
}

/**
 * Assess whether a STRUCTURED fact may enter a future memory store.
 *
 * This package persists nothing. It intentionally has no database, transport, model or clock.
 * CORE_AUTHORITY_REFERENCE is never writable as memory: Core references may be carried through a
 * turn, but copying business authority into Jarvis memory would create a second source of truth.
 */
export function assessGovernedMemoryWrite(
  fact: GovernedMemoryFactInput,
  policy: GovernedMemoryPolicy = GOVERNED_MEMORY_ENGINEERING_POLICY_V1,
): GovernedMemoryWriteAssessment {
  if (!validFact(fact)) {
    return Object.freeze({ decision: 'REFUSE_INVALID_FACT', policyRef: policy.policyRef });
  }

  if (fact.memoryClass === 'CORE_AUTHORITY_REFERENCE') {
    return Object.freeze({
      decision: 'REFUSE_CORE_AUTHORITY',
      policyRef: policy.policyRef,
      factRef: fact.factRef,
    });
  }

  if (fact.memoryClass === 'CONVERSATION_EPHEMERAL') {
    return Object.freeze({
      decision: 'ALLOW_EPHEMERAL',
      policyRef: policy.policyRef,
      factRef: fact.factRef,
    });
  }

  if (!policy.durableMemoryEnabled) {
    return Object.freeze({
      decision: 'REFUSE_DURABLE_DISABLED',
      policyRef: policy.policyRef,
      factRef: fact.factRef,
    });
  }

  if (
    policy.ownerApprovalRef === undefined ||
    policy.retentionPolicyRef === undefined ||
    policy.erasurePolicyRef === undefined ||
    policy.maxDurableRetentionDays === undefined
  ) {
    return Object.freeze({
      decision: 'REFUSE_OWNER_POLICY_MISSING',
      policyRef: policy.policyRef,
      factRef: fact.factRef,
    });
  }

  return Object.freeze({
    decision: 'ALLOW_DURABLE',
    policyRef: policy.policyRef,
    factRef: fact.factRef,
    expiresAfterDays: policy.maxDurableRetentionDays,
  });
}
