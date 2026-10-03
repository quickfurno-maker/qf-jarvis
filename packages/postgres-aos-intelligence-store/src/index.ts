import { createHash } from 'node:crypto';

import { digestAosBehaviourRegistry } from '@qf-jarvis/aos-behaviour-control';
import type {
  AosBehaviourManifest,
  AosBehaviourRegistry,
  AosCase,
  AosCaseContextMemory,
  AosLearningObservation,
  AosOutcomeRecord,
  AosRecommendation,
} from '@qf-jarvis/aos-intelligence';
import type { Pool } from 'pg';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

function validInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function digest(value: unknown): string {
  return 'sha256:' + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export type AosStoreWriteResult =
  | { readonly outcome: 'STORED'; readonly digest: string }
  | { readonly outcome: 'DUPLICATE'; readonly digest: string };

export class AosStoreConflictError extends Error {
  public constructor(readonly entity: string) {
    super('aos-store-conflict');
    this.name = 'AosStoreConflictError';
  }
}

export interface AosOutcomeObservationInput {
  readonly observationId: string;
  readonly capabilityRef: string;
  readonly record: AosOutcomeRecord;
  readonly falsePositive: boolean;
  readonly observedAt: string;
  readonly storedAt: string;
}

export interface PostgresAosIntelligenceStore {
  appendCaseSnapshot(input: {
    readonly case: AosCase;
    readonly storedAt: string;
  }): Promise<AosStoreWriteResult>;
  appendCaseContextMemory(input: {
    readonly memory: AosCaseContextMemory;
    readonly storedAt: string;
  }): Promise<AosStoreWriteResult>;
  appendRecommendation(input: {
    readonly recommendation: AosRecommendation;
    readonly storedAt: string;
  }): Promise<AosStoreWriteResult>;
  appendOutcome(input: AosOutcomeObservationInput): Promise<AosStoreWriteResult>;
  appendBehaviourManifest(input: {
    readonly manifest: AosBehaviourManifest;
    readonly registry: AosBehaviourRegistry;
    readonly storedAt: string;
  }): Promise<AosStoreWriteResult>;
  readCapabilityLearning(
    capabilityRef: string,
    limit: number,
  ): Promise<readonly AosLearningObservation[]>;
}

async function classifyWrite(
  pool: Pool,
  inserted: number,
  selectSql: string,
  selectValues: readonly unknown[],
  expectedDigest: string,
  entity: string,
): Promise<AosStoreWriteResult> {
  if (inserted === 1) {
    return Object.freeze({ outcome: 'STORED' as const, digest: expectedDigest });
  }

  const existing = await pool.query<{ digest: string }>(selectSql, [...selectValues]);
  const storedDigest = existing.rows[0]?.digest;
  if (storedDigest === expectedDigest) {
    return Object.freeze({ outcome: 'DUPLICATE' as const, digest: expectedDigest });
  }
  throw new AosStoreConflictError(entity);
}

export function createPostgresAosIntelligenceStore(pool: Pool): PostgresAosIntelligenceStore {
  const store: PostgresAosIntelligenceStore = {
    async appendCaseSnapshot(input) {
      if (!validInstant(input.storedAt)) throw new TypeError('aos-store-time-invalid');
      const json = canonicalJson(input.case);
      const oneDigest = digest(input.case);
      const inserted = await pool.query(
        `INSERT INTO qf_jarvis_aos.case_snapshot
          (case_id, case_key, subject_ref, state, priority, first_observed_at,
           last_observed_at, snapshot_json, snapshot_digest, stored_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (case_id, snapshot_digest) DO NOTHING`,
        [
          input.case.caseId,
          input.case.caseKey,
          input.case.subjectRef,
          input.case.state,
          input.case.priority,
          input.case.firstObservedAt,
          input.case.lastObservedAt,
          json,
          oneDigest,
          input.storedAt,
        ],
      );
      return Object.freeze({
        outcome: inserted.rowCount === 1 ? ('STORED' as const) : ('DUPLICATE' as const),
        digest: oneDigest,
      });
    },

    async appendCaseContextMemory(input) {
      const rawMemory = input.memory as unknown as Readonly<Record<string, unknown>>;
      if (
        !validInstant(input.storedAt) ||
        rawMemory['protocol'] !== 'qfj.aos.case-context.v1' ||
        rawMemory['executionAuthority'] !== 'NONE' ||
        rawMemory['businessEffect'] !== false ||
        !Number.isInteger(input.memory.revision) ||
        input.memory.revision < 1
      ) {
        throw new TypeError('aos-case-context-store-input-invalid');
      }
      const oneDigest = digest(input.memory);
      const json = canonicalJson(input.memory);
      const inserted = await pool.query(
        `INSERT INTO qf_jarvis_aos.case_context_memory
          (case_key, subject_ref, revision, updated_at, memory_json, memory_digest, stored_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
         ON CONFLICT (case_key, revision) DO NOTHING`,
        [
          input.memory.caseKey,
          input.memory.subjectRef,
          input.memory.revision,
          input.memory.updatedAt,
          json,
          oneDigest,
          input.storedAt,
        ],
      );
      return classifyWrite(
        pool,
        inserted.rowCount ?? 0,
        `SELECT memory_digest AS digest
           FROM qf_jarvis_aos.case_context_memory
          WHERE case_key = $1 AND revision = $2`,
        [input.memory.caseKey, input.memory.revision],
        oneDigest,
        'case-context-memory',
      );
    },

    async appendRecommendation(input) {
      if (!validInstant(input.storedAt)) throw new TypeError('aos-store-time-invalid');
      const oneDigest = digest(input.recommendation);
      const json = canonicalJson(input.recommendation);
      const inserted = await pool.query(
        `INSERT INTO qf_jarvis_aos.recommendation
          (recommendation_id, case_id, action, confidence, requires_owner_review,
           recommendation_json, recommendation_digest, stored_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT (recommendation_id) DO NOTHING`,
        [
          input.recommendation.recommendationId,
          input.recommendation.caseId,
          input.recommendation.action,
          input.recommendation.confidence,
          input.recommendation.requiresOwnerReview,
          json,
          oneDigest,
          input.storedAt,
        ],
      );
      return classifyWrite(
        pool,
        inserted.rowCount ?? 0,
        'SELECT recommendation_digest AS digest FROM qf_jarvis_aos.recommendation WHERE recommendation_id = $1',
        [input.recommendation.recommendationId],
        oneDigest,
        'recommendation',
      );
    },

    async appendOutcome(input) {
      if (
        !REF.test(input.observationId) ||
        !REF.test(input.capabilityRef) ||
        !validInstant(input.observedAt) ||
        !validInstant(input.storedAt)
      ) {
        throw new TypeError('aos-outcome-store-input-invalid');
      }
      const oneDigest = digest({
        capabilityRef: input.capabilityRef,
        record: input.record,
        falsePositive: input.falsePositive,
        observedAt: input.observedAt,
      });
      const json = canonicalJson(input.record);
      const inserted = await pool.query(
        `INSERT INTO qf_jarvis_aos.outcome_observation
          (observation_id, capability_ref, case_id, recommendation_id, false_positive,
           outcome_json, outcome_digest, observed_at, stored_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT (observation_id) DO NOTHING`,
        [
          input.observationId,
          input.capabilityRef,
          input.record.caseId,
          input.record.recommendationId,
          input.falsePositive,
          json,
          oneDigest,
          input.observedAt,
          input.storedAt,
        ],
      );
      return classifyWrite(
        pool,
        inserted.rowCount ?? 0,
        'SELECT outcome_digest AS digest FROM qf_jarvis_aos.outcome_observation WHERE observation_id = $1',
        [input.observationId],
        oneDigest,
        'outcome',
      );
    },

    async appendBehaviourManifest(input) {
      if (!validInstant(input.storedAt)) throw new TypeError('aos-store-time-invalid');
      if (digestAosBehaviourRegistry(input.registry) !== input.manifest.configurationDigest) {
        throw new TypeError('aos-store-behaviour-registry-mismatch');
      }
      const oneDigest = digest(input.manifest);
      const registryJson = canonicalJson(input.registry);
      const manifestJson = canonicalJson(input.manifest);
      const inserted = await pool.query(
        `INSERT INTO qf_jarvis_aos.behaviour_manifest
          (manifest_id, manifest_version, configuration_digest, lifecycle,
           registry_json, manifest_json, manifest_digest, stored_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
         ON CONFLICT (manifest_id, manifest_version) DO NOTHING`,
        [
          input.manifest.manifestId,
          input.manifest.manifestVersion,
          input.manifest.configurationDigest,
          input.manifest.lifecycle,
          registryJson,
          manifestJson,
          oneDigest,
          input.storedAt,
        ],
      );
      return classifyWrite(
        pool,
        inserted.rowCount ?? 0,
        `SELECT manifest_digest AS digest
           FROM qf_jarvis_aos.behaviour_manifest
          WHERE manifest_id = $1 AND manifest_version = $2`,
        [input.manifest.manifestId, input.manifest.manifestVersion],
        oneDigest,
        'behaviour-manifest',
      );
    },

    async readCapabilityLearning(capabilityRef, limit) {
      if (!REF.test(capabilityRef) || !Number.isInteger(limit) || limit < 1 || limit > 100_000) {
        throw new TypeError('aos-learning-read-input-invalid');
      }
      const result = await pool.query<{
        outcome_json: AosOutcomeRecord;
        false_positive: boolean;
      }>(
        `SELECT outcome_json, false_positive
           FROM qf_jarvis_aos.outcome_observation
          WHERE capability_ref = $1
          ORDER BY observed_at DESC, observation_id DESC
          LIMIT $2`,
        [capabilityRef, limit],
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            record: Object.freeze(row.outcome_json),
            falsePositive: row.false_positive,
          }),
        ),
      );
    },
  };
  return Object.freeze(store);
}
