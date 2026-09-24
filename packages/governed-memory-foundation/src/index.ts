import {
  parseAgentMemoryRecord,
  parseMemoryInvalidationRequest,
  type AgentMemoryRecordV1,
  type MemoryInvalidationRequestV1,
} from '@qf-jarvis/contracts';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MEMORY_WRITE_DECISIONS = Object.freeze([
  'ALLOW_DURABLE',
  'REFUSE_DURABLE_DISABLED',
  'REFUSE_OWNER_POLICY_MISSING',
  'REFUSE_EXPIRY_MISSING',
  'REFUSE_RETENTION_EXCEEDED',
  'REFUSE_ERASURE_STATE',
  'REFUSE_INVALID_RECORD',
] as const);

export type MemoryWriteDecision = (typeof MEMORY_WRITE_DECISIONS)[number];

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
  readonly memoryRecordId?: string;
  readonly retentionDays?: number;
}

export interface GovernedMemoryReadQuery {
  readonly ownerAgent: AgentMemoryRecordV1['ownerAgent'];
  readonly subjectReference?: AgentMemoryRecordV1['subjectReferences'][number];
  readonly asOf: string;
  readonly limit: number;
}

export interface GovernedMemoryInvalidationResult {
  readonly invalidatedCount: number;
  readonly sampledMemoryRecordIds: readonly string[];
  readonly truncated: boolean;
}

export interface GovernedMemoryStorePort {
  readActive(query: GovernedMemoryReadQuery): Promise<readonly unknown[]>;
  write(record: AgentMemoryRecordV1): Promise<void>;
  invalidate(request: MemoryInvalidationRequestV1): Promise<GovernedMemoryInvalidationResult>;
}

export interface GovernedMemoryRuntime {
  readActive(query: GovernedMemoryReadQuery): Promise<readonly AgentMemoryRecordV1[]>;
  write(record: unknown): Promise<GovernedMemoryWriteAssessment>;
  invalidate(request: unknown): Promise<GovernedMemoryInvalidationResult>;
}

export const GOVERNED_MEMORY_ENGINEERING_POLICY_V1: GovernedMemoryPolicy = Object.freeze({
  policyRef: 'qfj.governed-memory.engineering.v1',
  durableMemoryEnabled: false,
});

function validRef(value: string): boolean {
  return REF.test(value);
}

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
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
  if (
    input.durableMemoryEnabled &&
    (input.ownerApprovalRef === undefined ||
      input.retentionPolicyRef === undefined ||
      input.erasurePolicyRef === undefined ||
      input.maxDurableRetentionDays === undefined)
  ) {
    throw new TypeError('governed-memory-owner-policy-required');
  }
  return Object.freeze({ ...input });
}

export function assessGovernedMemoryWrite(
  input: unknown,
  policy: GovernedMemoryPolicy = GOVERNED_MEMORY_ENGINEERING_POLICY_V1,
): GovernedMemoryWriteAssessment {
  let record: AgentMemoryRecordV1;
  try {
    record = parseAgentMemoryRecord(input);
  } catch {
    return Object.freeze({ decision: 'REFUSE_INVALID_RECORD', policyRef: policy.policyRef });
  }

  if (!policy.durableMemoryEnabled) {
    return Object.freeze({
      decision: 'REFUSE_DURABLE_DISABLED',
      policyRef: policy.policyRef,
      memoryRecordId: record.memoryRecordId,
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
      memoryRecordId: record.memoryRecordId,
    });
  }
  if (record.erasureState !== 'none') {
    return Object.freeze({
      decision: 'REFUSE_ERASURE_STATE',
      policyRef: policy.policyRef,
      memoryRecordId: record.memoryRecordId,
    });
  }
  if (record.expiresAt === undefined) {
    return Object.freeze({
      decision: 'REFUSE_EXPIRY_MISSING',
      policyRef: policy.policyRef,
      memoryRecordId: record.memoryRecordId,
    });
  }
  const created = parseInstant(record.createdAt);
  const expires = parseInstant(record.expiresAt);
  if (created === null || expires === null) {
    return Object.freeze({ decision: 'REFUSE_INVALID_RECORD', policyRef: policy.policyRef });
  }
  const retentionDays = (expires - created) / DAY_MS;
  if (retentionDays <= 0 || retentionDays > policy.maxDurableRetentionDays) {
    return Object.freeze({
      decision: 'REFUSE_RETENTION_EXCEEDED',
      policyRef: policy.policyRef,
      memoryRecordId: record.memoryRecordId,
      retentionDays,
    });
  }
  return Object.freeze({
    decision: 'ALLOW_DURABLE',
    policyRef: policy.policyRef,
    memoryRecordId: record.memoryRecordId,
    retentionDays,
  });
}

function validReadQuery(query: GovernedMemoryReadQuery): boolean {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) return false;
  if (parseInstant(query.asOf) === null) return false;
  if (query.subjectReference !== undefined) {
    const { entityType, entityId } = query.subjectReference;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entityType) || !REF.test(entityId)) return false;
  }
  return true;
}

function recordMatchesQuery(record: AgentMemoryRecordV1, query: GovernedMemoryReadQuery): boolean {
  if (record.ownerAgent !== query.ownerAgent || record.erasureState !== 'none') return false;
  const asOf = parseInstant(query.asOf);
  const expires = record.expiresAt === undefined ? null : parseInstant(record.expiresAt);
  if (asOf === null || expires === null || expires <= asOf) return false;
  if (query.subjectReference === undefined) return true;
  return record.subjectReferences.some(
    (subject) =>
      subject.entityType === query.subjectReference?.entityType &&
      subject.entityId === query.subjectReference.entityId,
  );
}

export function createGovernedMemoryRuntime(input: {
  readonly policy?: GovernedMemoryPolicy;
  readonly store?: GovernedMemoryStorePort;
}): GovernedMemoryRuntime {
  const policy = createGovernedMemoryPolicy(input.policy ?? GOVERNED_MEMORY_ENGINEERING_POLICY_V1);
  if (policy.durableMemoryEnabled && input.store === undefined) {
    throw new TypeError('governed-memory-store-required');
  }

  return Object.freeze({
    async readActive(query: GovernedMemoryReadQuery): Promise<readonly AgentMemoryRecordV1[]> {
      if (!validReadQuery(query)) throw new TypeError('governed-memory-read-invalid');
      if (!policy.durableMemoryEnabled) return Object.freeze([]);
      const store = input.store;
      if (store === undefined) throw new TypeError('governed-memory-store-required');
      const raw = await store.readActive(query);
      let records: readonly AgentMemoryRecordV1[];
      try {
        records = raw.map((value) => parseAgentMemoryRecord(value));
      } catch {
        throw new TypeError('governed-memory-store-result-invalid');
      }
      if (records.some((record) => !recordMatchesQuery(record, query))) {
        throw new TypeError('governed-memory-store-result-invalid');
      }
      return Object.freeze(records.slice(0, query.limit));
    },

    async write(value: unknown): Promise<GovernedMemoryWriteAssessment> {
      const assessment = assessGovernedMemoryWrite(value, policy);
      if (assessment.decision !== 'ALLOW_DURABLE') return assessment;
      const store = input.store;
      if (store === undefined) throw new TypeError('governed-memory-store-required');
      const record = parseAgentMemoryRecord(value);
      await store.write(record);
      return assessment;
    },

    async invalidate(value: unknown): Promise<GovernedMemoryInvalidationResult> {
      const request = parseMemoryInvalidationRequest(value);
      const store = input.store;
      if (store === undefined)
        throw new TypeError('governed-memory-store-required-for-invalidation');
      return store.invalidate(request);
    },
  });
}
