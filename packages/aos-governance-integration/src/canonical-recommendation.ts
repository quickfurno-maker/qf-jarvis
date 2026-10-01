import { createHash } from 'node:crypto';

import type { AosCase, AosRecommendation } from '@qf-jarvis/aos-intelligence';
import {
  createAosRecommendationAdapter,
  type AosRecommendationAdapter,
} from '@qf-jarvis/aos-recommendation-adapter';
import { correlationIdSchema, type EntityReference } from '@qf-jarvis/contracts';
import {
  createRecommendationRuntime,
  type RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';

const ENTITY_TYPE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u;
const ENTITY_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * Stable namespace owned by the AOS canonical-projection adapter.
 * It is not an authority token; it only makes the same AOS case resolve to the
 * same RFC 4122 v5 correlation identity across retries/replays.
 */
const AOS_CORRELATION_NAMESPACE = '7904125b-d91d-5c63-ae66-c8ec2cc34465';

export interface AosCanonicalRecommendationProjection {
  readonly protocol: 'qfj.aos.canonical-recommendation.v1';
  readonly caseId: string;
  readonly sourceRecommendationId: string;
  readonly correlationId: string;
  readonly canonical: RecommendationRuntimeResult;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export interface AosCanonicalRecommendationProjector {
  project(input: {
    readonly case: AosCase;
    readonly recommendation: AosRecommendation;
    readonly createdAt: string;
    readonly expiresAt?: string;
    readonly correlationId?: string;
  }): AosCanonicalRecommendationProjection;
}

function parseSubjectRef(subjectRef: string): EntityReference {
  const separator = subjectRef.indexOf(':');
  if (separator <= 0 || separator === subjectRef.length - 1) {
    throw new TypeError('aos-canonical-subject-ref-invalid');
  }
  const entityType = subjectRef.slice(0, separator);
  const entityId = subjectRef.slice(separator + 1);
  if (!ENTITY_TYPE.test(entityType) || !ENTITY_ID.test(entityId)) {
    throw new TypeError('aos-canonical-subject-ref-invalid');
  }
  return Object.freeze({ entityType, entityId });
}

function defaultExpiry(createdAt: string): string {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== createdAt) {
    throw new TypeError('aos-canonical-created-at-invalid');
  }
  return new Date(parsed + 24 * 60 * 60 * 1_000).toISOString();
}

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  return Uint8Array.from(
    Array.from({ length: 16 }, (_, index) =>
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
    ),
  );
}

function stableAosCorrelationId(caseId: string): string {
  const namespace = uuidBytes(AOS_CORRELATION_NAMESPACE);
  const digest = createHash('sha1').update(namespace).update(caseId, 'utf8').digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  const uuid =
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20);
  if (!correlationIdSchema.safeParse(uuid).success) {
    throw new TypeError('aos-canonical-correlation-invalid');
  }
  return uuid;
}

function correlationIdFor(caseId: string, supplied?: string): string {
  if (supplied === undefined) return stableAosCorrelationId(caseId);
  if (!correlationIdSchema.safeParse(supplied).success) {
    throw new TypeError('aos-canonical-correlation-invalid');
  }
  return supplied;
}

export function createAosCanonicalRecommendationProjector(
  adapter: AosRecommendationAdapter = createAosRecommendationAdapter(createRecommendationRuntime()),
): AosCanonicalRecommendationProjector {
  return Object.freeze({
    project(input: {
      readonly case: AosCase;
      readonly recommendation: AosRecommendation;
      readonly createdAt: string;
      readonly expiresAt?: string;
      readonly correlationId?: string;
    }) {
      const rawCase = input.case as unknown as Readonly<Record<string, unknown>>;
      const rawRecommendation = input.recommendation as unknown as Readonly<
        Record<string, unknown>
      >;
      if (
        rawCase['executionAuthority'] !== 'NONE' ||
        rawCase['businessEffect'] !== false ||
        rawRecommendation['executionAuthorized'] !== false ||
        rawRecommendation['businessEffect'] !== false
      ) {
        throw new TypeError('aos-canonical-authority-invalid');
      }

      const correlationId = correlationIdFor(input.case.caseId, input.correlationId);
      const expiresAt = input.expiresAt ?? defaultExpiry(input.createdAt);
      const canonical = adapter.create({
        recommendation: input.recommendation,
        casePriority: input.case.priority,
        subject: parseSubjectRef(input.case.subjectRef),
        createdAt: input.createdAt,
        expiresAt,
        correlationId,
      });

      return Object.freeze({
        protocol: 'qfj.aos.canonical-recommendation.v1' as const,
        caseId: input.case.caseId,
        sourceRecommendationId: input.recommendation.recommendationId,
        correlationId,
        canonical,
        executionAuthority: 'NONE' as const,
        businessEffect: false as const,
      });
    },
  });
}
