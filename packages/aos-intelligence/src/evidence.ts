import {
  AOS_EVIDENCE_DATA_CLASSES,
  AOS_EVIDENCE_KINDS,
  type AosCase,
  type AosEvidenceFact,
  type AosEvidencePacket,
} from './contracts.js';
import { validInstant, validRef } from './validation.js';

const PHONE_LIKE = /(?:\d[\s()+-]?){8,}/u;

function safeValue(value: AosEvidenceFact['value']): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return (
    value.length >= 1 && value.length <= 160 && !value.includes('@') && !PHONE_LIKE.test(value)
  );
}

export function validateAosEvidenceFact(fact: AosEvidenceFact): void {
  if (
    !validRef(fact.factId) ||
    !AOS_EVIDENCE_KINDS.includes(fact.kind) ||
    !AOS_EVIDENCE_DATA_CLASSES.includes(fact.dataClass) ||
    !validRef(fact.sourceRef) ||
    !validInstant(fact.observedAt) ||
    !safeValue(fact.value)
  ) {
    throw new TypeError('aos-evidence-fact-invalid');
  }
}
export interface BuildAosEvidenceInput {
  readonly case: AosCase;
  readonly facts: readonly AosEvidenceFact[];
  readonly policyRefs: readonly string[];
  readonly generatedAt: string;
  readonly maxFacts?: number;
}

export function buildAosEvidencePacket(input: BuildAosEvidenceInput): AosEvidencePacket {
  const maxFacts = input.maxFacts ?? 48;
  if (
    !Number.isInteger(maxFacts) ||
    maxFacts < 1 ||
    maxFacts > 64 ||
    input.facts.length > 256 ||
    input.policyRefs.length > 16 ||
    !validInstant(input.generatedAt)
  ) {
    throw new TypeError('aos-evidence-input-invalid');
  }
  for (const fact of input.facts) validateAosEvidenceFact(fact);
  if (input.policyRefs.some((ref) => !validRef(ref))) {
    throw new TypeError('aos-evidence-policy-invalid');
  }

  const latestByFact = new Map<string, AosEvidenceFact>();
  for (const fact of input.facts) {
    const current = latestByFact.get(fact.factId);
    if (current === undefined || current.observedAt < fact.observedAt) {
      latestByFact.set(fact.factId, fact);
    }
  }

  const facts = [...latestByFact.values()]
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    .slice(0, maxFacts)
    .sort((left, right) => left.factId.localeCompare(right.factId));

  return Object.freeze({
    protocol: 'qfj.aos.evidence.v1' as const,
    caseId: input.case.caseId,
    caseKey: input.case.caseKey,
    subjectRef: input.case.subjectRef,
    generatedAt: input.generatedAt,
    facts: Object.freeze(facts.map((fact) => Object.freeze({ ...fact }))),
    policyRefs: Object.freeze([...new Set(input.policyRefs)].sort()),
    containsDirectPii: false as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}
