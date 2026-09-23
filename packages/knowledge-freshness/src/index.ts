const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export const KNOWLEDGE_SOURCE_DRIFT = Object.freeze([
  'UNCHANGED',
  'CHANGED',
  'NEW',
  'MISSING',
] as const);

export type KnowledgeSourceDrift = (typeof KNOWLEDGE_SOURCE_DRIFT)[number];

export interface KnowledgeSourceFingerprint {
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly contentDigest: string;
  readonly ownerRef: string;
  readonly approvedForProduction: boolean;
  readonly approvalRef?: string;
}

export interface KnowledgeSourceDriftRecord {
  readonly sourceRef: string;
  readonly drift: KnowledgeSourceDrift;
  readonly previousRevision?: string;
  readonly observedRevision?: string;
}

export interface KnowledgeFreshnessReport {
  readonly records: readonly KnowledgeSourceDriftRecord[];
  readonly changedCount: number;
  readonly newCount: number;
  readonly missingCount: number;
  readonly requiresCandidateRelease: boolean;
}

export const KNOWLEDGE_CANDIDATE_DECISIONS = Object.freeze([
  'NO_CHANGE',
  'BLOCKED_UNAPPROVED_SOURCE',
  'BLOCKED_MISSING_SOURCE',
  'BLOCKED_EVALUATION',
  'ELIGIBLE_FOR_STAGING_BUILD',
] as const);

export type KnowledgeCandidateDecision = (typeof KNOWLEDGE_CANDIDATE_DECISIONS)[number];

export interface KnowledgeCandidateAssessment {
  readonly decision: KnowledgeCandidateDecision;
  readonly sourceCount: number;
}

function validFingerprint(value: KnowledgeSourceFingerprint): boolean {
  return (
    REF.test(value.sourceRef) &&
    REF.test(value.sourceRevision) &&
    SHA256.test(value.contentDigest) &&
    REF.test(value.ownerRef) &&
    (value.approvedForProduction
      ? value.approvalRef !== undefined && REF.test(value.approvalRef)
      : value.approvalRef === undefined)
  );
}

function bySource(
  values: readonly KnowledgeSourceFingerprint[],
): ReadonlyMap<string, KnowledgeSourceFingerprint> {
  const map = new Map<string, KnowledgeSourceFingerprint>();
  for (const value of values) {
    if (!validFingerprint(value) || map.has(value.sourceRef)) {
      throw new TypeError('knowledge-source-fingerprint-invalid');
    }
    map.set(value.sourceRef, value);
  }
  return map;
}

export function assessKnowledgeFreshness(
  accepted: readonly KnowledgeSourceFingerprint[],
  observed: readonly KnowledgeSourceFingerprint[],
): KnowledgeFreshnessReport {
  const before = bySource(accepted);
  const now = bySource(observed);
  const refs = [...new Set([...before.keys(), ...now.keys()])].sort();
  const records: KnowledgeSourceDriftRecord[] = refs.map((sourceRef) => {
    const previous = before.get(sourceRef);
    const current = now.get(sourceRef);
    if (previous === undefined && current !== undefined) {
      return Object.freeze({
        sourceRef,
        drift: 'NEW' as const,
        observedRevision: current.sourceRevision,
      });
    }
    if (previous !== undefined && current === undefined) {
      return Object.freeze({
        sourceRef,
        drift: 'MISSING' as const,
        previousRevision: previous.sourceRevision,
      });
    }
    if (previous === undefined || current === undefined) {
      throw new TypeError('knowledge-freshness-unreachable');
    }
    if (
      previous.sourceRevision === current.sourceRevision &&
      previous.contentDigest === current.contentDigest &&
      previous.ownerRef === current.ownerRef &&
      previous.approvedForProduction === current.approvedForProduction &&
      previous.approvalRef === current.approvalRef
    ) {
      return Object.freeze({
        sourceRef,
        drift: 'UNCHANGED' as const,
        previousRevision: previous.sourceRevision,
        observedRevision: current.sourceRevision,
      });
    }
    return Object.freeze({
      sourceRef,
      drift: 'CHANGED' as const,
      previousRevision: previous.sourceRevision,
      observedRevision: current.sourceRevision,
    });
  });

  const changedCount = records.filter((item) => item.drift === 'CHANGED').length;
  const newCount = records.filter((item) => item.drift === 'NEW').length;
  const missingCount = records.filter((item) => item.drift === 'MISSING').length;

  return Object.freeze({
    records: Object.freeze(records),
    changedCount,
    newCount,
    missingCount,
    requiresCandidateRelease: changedCount + newCount + missingCount > 0,
  });
}

/**
 * Decides only whether a new STAGING build may be prepared. It cannot seal or activate anything.
 */
export function assessKnowledgeCandidate(input: {
  readonly freshness: KnowledgeFreshnessReport;
  readonly observedSources: readonly KnowledgeSourceFingerprint[];
  readonly evaluationPassed: boolean;
}): KnowledgeCandidateAssessment {
  if (!input.freshness.requiresCandidateRelease) {
    return Object.freeze({ decision: 'NO_CHANGE', sourceCount: input.observedSources.length });
  }
  if (input.freshness.missingCount > 0) {
    return Object.freeze({
      decision: 'BLOCKED_MISSING_SOURCE',
      sourceCount: input.observedSources.length,
    });
  }
  if (
    input.observedSources.some(
      (source) => !source.approvedForProduction || source.approvalRef === undefined,
    )
  ) {
    return Object.freeze({
      decision: 'BLOCKED_UNAPPROVED_SOURCE',
      sourceCount: input.observedSources.length,
    });
  }
  if (!input.evaluationPassed) {
    return Object.freeze({
      decision: 'BLOCKED_EVALUATION',
      sourceCount: input.observedSources.length,
    });
  }
  return Object.freeze({
    decision: 'ELIGIBLE_FOR_STAGING_BUILD',
    sourceCount: input.observedSources.length,
  });
}


export interface KnowledgeSourceFingerprintReader {
  readCurrent(): Promise<readonly KnowledgeSourceFingerprint[]>;
}

export interface KnowledgeFreshnessEngineResult {
  readonly freshness: KnowledgeFreshnessReport;
  readonly candidate: KnowledgeCandidateAssessment;
}

/**
 * Execute one observation pass through an injected source reader.
 *
 * The reader is the only I/O seam. This engine performs no polling, scheduling, ingestion, sealing
 * or activation; callers may run it from a reviewed scheduler later.
 */
export async function runKnowledgeFreshnessCheck(input: {
  readonly acceptedSources: readonly KnowledgeSourceFingerprint[];
  readonly reader: KnowledgeSourceFingerprintReader;
  readonly evaluationPassed: boolean;
}): Promise<KnowledgeFreshnessEngineResult> {
  const observedSources = await input.reader.readCurrent();
  const freshness = assessKnowledgeFreshness(input.acceptedSources, observedSources);
  const candidate = assessKnowledgeCandidate({
    freshness,
    observedSources,
    evaluationPassed: input.evaluationPassed,
  });
  return Object.freeze({ freshness, candidate });
}
