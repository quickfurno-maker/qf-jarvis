/**
 * Benchmark EVIDENCE: one measured case, bound and stamped (RMB-A).
 *
 * ### What the two flags are for
 *
 * `syntheticWorkload: true` and `productionApproval: false` are literals. Not defaults, not
 * configurable — there is no way to construct an artifact that says otherwise.
 *
 * They are here because of how this evidence will be used. Somebody, later, under time pressure, will
 * have a spreadsheet of latency numbers and a decision to make, and the honest reading — "this is a
 * synthetic measurement and it authorizes nothing" — has to be carried by the artifact rather than by
 * whoever remembers the context. A benchmark that could be marked production-approved would
 * eventually be marked production-approved.
 *
 * ### The digest covers the whole artifact
 *
 * Subject, environment, workload, observation, `createdAt` and both flags. Not a summary of them —
 * all of them. A digest over part of an artifact tells you the part somebody did not edit.
 *
 * ### Re-proof on the way in
 *
 * Every nested value is rebuilt through its own constructor before the digest is computed, so an
 * artifact that arrived as parsed JSON gets exactly the same treatment as one built in memory. The
 * outer schema accepts them as `unknown` on purpose: each contract is the authority on its own shape,
 * and restating those shapes here would be four copies to keep in step.
 */
import { z } from 'zod';

import { RiyaBenchmarkError } from './errors.js';
import { createRiyaBenchmarkEnvironment } from './environment.js';
import type { RiyaBenchmarkEnvironmentV1 } from './environment.js';
import { createRiyaBenchmarkObservation } from './observation.js';
import type { RiyaBenchmarkObservationV1 } from './observation.js';
import { createRiyaBenchmarkSubject } from './subject.js';
import type { RiyaBenchmarkSubjectV1 } from './subject.js';
import { createRiyaBenchmarkWorkload } from './workload.js';
import type { RiyaBenchmarkWorkloadV1 } from './workload.js';
import { SHA256_HEX, sha256OfCanonical } from '../internal/digest.js';

const CANONICAL_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/u;

/** Days per month, 1-indexed. February is resolved per year below. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * True iff `value` is a canonical UTC instant naming a REAL calendar time.
 *
 * ### Why a shape test plus `Date.parse` is not enough
 *
 * `Date.parse('2026-02-30T00:00:00Z')` does not return `NaN`. It NORMALIZES to 2 March and reports a
 * finite number, so the obvious check accepts a date that does not exist — and the artifact then
 * carries a `createdAt` nobody wrote, silently shifted by two days. `2026-04-31` behaves the same way.
 *
 * ### The calendar is checked directly rather than round-tripped
 *
 * The natural repair is to re-serialise through `new Date(...).toISOString()` and compare. This does
 * not do that, for one reason: `new Date(` is forbidden by this package's own containment scan, and
 * the scan is worth more than the convenience. A rule with one carve-out is a rule somebody widens.
 *
 * So the fields are validated arithmetically — month 1–12, day within that month's real length,
 * leap-aware, and the time components range-checked. No `Date` object, no locale, no clock, and no
 * dependence on how a runtime chooses to normalize an impossible date.
 */
export function isCanonicalBenchmarkInstant(value: string): boolean {
  const match = CANONICAL_INSTANT.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12) {
    return false;
  }
  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month] ?? 0);
  if (day < 1 || day > maxDay) {
    return false;
  }
  // No leap seconds: 23:59:60 is a real instant in UTC and not a value any harness should emit, and
  // accepting it would mean two spellings of one moment.
  return hour <= 23 && minute <= 59 && second <= 59;
}

export interface RiyaBenchmarkEvidenceV1 {
  readonly version: 1;
  readonly subject: RiyaBenchmarkSubjectV1;
  readonly environment: RiyaBenchmarkEnvironmentV1;
  readonly workload: RiyaBenchmarkWorkloadV1;
  readonly observation: RiyaBenchmarkObservationV1;
  /** Injected, never read from a clock. Two runs of the same inputs must produce one digest. */
  readonly createdAt: string;
  /** A literal. This package describes synthetic measurement runs and nothing else. */
  readonly syntheticWorkload: true;
  /** A literal. Operational speed authorizes nothing, and cannot be made to say it does. */
  readonly productionApproval: false;
  readonly evidenceDigest: string;
}

export interface RiyaBenchmarkEvidenceInput {
  readonly version: 1;
  readonly subject: RiyaBenchmarkSubjectV1;
  readonly environment: RiyaBenchmarkEnvironmentV1;
  readonly workload: RiyaBenchmarkWorkloadV1;
  readonly observation: RiyaBenchmarkObservationV1;
  readonly createdAt: string;
  /** Optional on input so a canonical artifact can be re-proved through this same constructor. */
  readonly syntheticWorkload?: true;
  readonly productionApproval?: false;
  readonly evidenceDigest?: string;
}

const evidenceSchema = z
  .object({
    version: z.literal(1),
    // Each re-proved by its owning constructor below.
    subject: z.unknown(),
    environment: z.unknown(),
    workload: z.unknown(),
    observation: z.unknown(),
    createdAt: z.string().refine(isCanonicalBenchmarkInstant),
    syntheticWorkload: z.literal(true).optional(),
    productionApproval: z.literal(false).optional(),
    evidenceDigest: z.string().regex(SHA256_HEX).optional(),
  })
  .strict();

/** The exact body the digest covers. Everything meaningful, nothing derived. */
function digestBody(
  evidence: Omit<RiyaBenchmarkEvidenceV1, 'evidenceDigest'>,
): Record<string, unknown> {
  return {
    version: evidence.version,
    subject: evidence.subject,
    environment: evidence.environment,
    workload: evidence.workload,
    observation: evidence.observation,
    createdAt: evidence.createdAt,
    syntheticWorkload: evidence.syntheticWorkload,
    productionApproval: evidence.productionApproval,
  };
}

/**
 * Validate, re-prove, stamp and freeze benchmark evidence. Throws a closed code.
 *
 * If `evidenceDigest` is supplied it must equal the recomputed one — which is what makes re-proving a
 * stored artifact a tamper check rather than a re-stamp.
 */
export function createRiyaBenchmarkEvidence(
  input: RiyaBenchmarkEvidenceInput,
): RiyaBenchmarkEvidenceV1 {
  const parsed = evidenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('OBSERVATION_INVALID');
  }

  // DEEP re-proof. Each constructor throws its own closed code, which is what a caller wants: the
  // failure names the part that was wrong, not the wrapper that noticed.
  const subject = createRiyaBenchmarkSubject(input.subject);
  const environment = createRiyaBenchmarkEnvironment(input.environment);
  const workload = createRiyaBenchmarkWorkload(input.workload);
  const observation = createRiyaBenchmarkObservation(input.observation);

  // The workload says how many requests were planned; the observation says how many were attempted.
  // A run that attempted a different number measured a different workload.
  if (observation.attemptedRequests !== workload.measuredRequestCount) {
    throw new RiyaBenchmarkError('REQUEST_COUNT_MISMATCH');
  }

  const body = {
    version: 1 as const,
    subject,
    environment,
    workload,
    observation,
    createdAt: parsed.data.createdAt,
    syntheticWorkload: true as const,
    productionApproval: false as const,
  };
  const evidenceDigest = sha256OfCanonical(digestBody(body));

  if (input.evidenceDigest !== undefined && input.evidenceDigest !== evidenceDigest) {
    throw new RiyaBenchmarkError('EVIDENCE_TAMPERED');
  }

  return Object.freeze({ ...body, evidenceDigest });
}

/**
 * Verify a STORED or otherwise untrusted evidence artifact, and return the canonical reconstruction.
 *
 * ### Why a digest check is not verification
 *
 * `sha256OfCanonical` is unkeyed. Anyone who can edit an artifact can recompute the digest over the
 * edit, so a self-consistent hash proves only that the body and the digest were written by the same
 * hand — not that the body is a valid measurement. Hash self-consistency is not schema validity, and
 * treating it as such at a trust boundary is how a structurally impossible artifact gets read as
 * evidence.
 *
 * So this is the trust boundary: full canonical surface required, unknown keys refused, every nested
 * object rebuilt through its own constructor, the cross-field request-count invariant re-proved, and
 * only then the digest recomputed from the RECONSTRUCTION and compared. An attacker who recomputes the
 * digest over a broken nested artifact still fails, because the nested artifact never survives
 * reconstruction.
 *
 * `evidenceDigest` is REQUIRED here — a stored artifact without one has never been stamped, and
 * quietly stamping it now would turn a verifier into a laundering step.
 *
 * The SHA-256 remains tamper/self-consistency evidence. It is not a signature and not a trust root.
 */
export function verifyRiyaBenchmarkEvidence(candidate: unknown): RiyaBenchmarkEvidenceV1 {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new RiyaBenchmarkError('EVIDENCE_TAMPERED');
  }
  const digest = (candidate as { evidenceDigest?: unknown }).evidenceDigest;
  if (typeof digest !== 'string' || !SHA256_HEX.test(digest)) {
    throw new RiyaBenchmarkError('DIGEST_INVALID');
  }
  // `createRiyaBenchmarkEvidence` already owns the strict schema, the deep re-proof, the invariant and
  // the digest comparison. Routing through it is what keeps ONE validation grammar in this package
  // rather than a verifier that slowly drifts from the constructor.
  return createRiyaBenchmarkEvidence(candidate as RiyaBenchmarkEvidenceInput);
}

/**
 * True iff `candidate` is a fully valid canonical evidence artifact.
 *
 * TOTAL: accepts anything, catches everything, returns a boolean. A caller checking a list wants a
 * verdict per item, not an exception that stops the loop at the first bad one.
 *
 * This is the deep check, not a hash comparison — the two used to differ, and the weaker one being
 * available at a trust boundary was the defect.
 */
export function riyaBenchmarkEvidenceIntegrityHolds(candidate: unknown): boolean {
  try {
    verifyRiyaBenchmarkEvidence(candidate);
    return true;
  } catch {
    return false;
  }
}
