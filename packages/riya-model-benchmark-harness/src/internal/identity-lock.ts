/**
 * The suite IDENTITY LOCK (RMB-B).
 *
 * ### What a drifting target would produce
 *
 * The harness reads subject and environment from the target and stamps every artifact with them. If a
 * future adapter reported one release at suite start and another two cases later — a pool that rolled,
 * a container that restarted, an engine that reloaded a different set of weights — the artifacts would
 * all carry the FIRST identity. Evidence about a subject that changed underneath it is worse than no
 * evidence, because it is indistinguishable from evidence that is correct.
 *
 * So the first proven identity is locked, and re-proved around every case. Any difference fails the
 * whole suite.
 *
 * ### Equality by value, not by reference
 *
 * A target legitimately returns a fresh object each call, so `===` would fail on a perfectly stable
 * adapter. Both sides have already been through the RMB-A constructors, so what is compared here is
 * two proven artifacts — this is a stable serialization for EQUALITY only. It computes no digest and
 * defines no artifact identity; RMB-A remains the sole authority on both.
 */
import type {
  RiyaBenchmarkEnvironmentV1,
  RiyaBenchmarkSubjectV1,
} from '@qf-jarvis/riya-model-benchmark';

/** Key-sorted JSON, so two equal artifacts serialize identically whatever order they were built in. */
function stableJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((one) => stableJson(one)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, one]) => one !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, one]) => `${JSON.stringify(key)}:${stableJson(one)}`);
  return `{${entries.join(',')}}`;
}

/** The proven identity of the target, plus the key the suite locks it by. */
export interface RiyaBenchmarkSuiteIdentity {
  readonly subject: RiyaBenchmarkSubjectV1;
  readonly environment: RiyaBenchmarkEnvironmentV1;
  readonly lockKey: string;
}

/** Build the lock key for one proven subject/environment pair. */
export function suiteIdentityLockKey(
  subject: RiyaBenchmarkSubjectV1,
  environment: RiyaBenchmarkEnvironmentV1,
): string {
  return stableJson({ subject, environment });
}
