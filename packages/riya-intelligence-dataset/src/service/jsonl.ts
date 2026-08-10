/**
 * JSONL interchange for trajectories (RID-F1, ADR-0107 §27).
 *
 * One trajectory per line, canonical key order, no filesystem I/O. Reading and writing files is a
 * caller's concern; keeping it out means this package stays pure, testable and unable to touch a
 * disk it was never authorized to touch.
 *
 * ### Parsing re-proves, it does not trust
 *
 * A parsed line goes back through `createRiyaIntelligenceTrajectory`. A JSONL file is the format
 * data arrives in from somewhere else — another machine, a generation script, an editor — which
 * makes it exactly the boundary where an unvalidated record would enter. Parsing to a typed object
 * and believing it would make every contract in this package advisory.
 */
import { canonicalJson } from '../internal/canonical-json.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import {
  createRiyaIntelligenceTrajectory,
  type RiyaIntelligenceTrajectoryV1,
} from '../contracts/trajectory.js';

/**
 * Serialize one trajectory to a single canonical JSONL line.
 *
 * `JSON.stringify` escapes any newline inside a string, so a multi-line reply cannot break the
 * one-record-per-line invariant.
 */
export function serializeRiyaTrajectoryJsonlLine(trajectory: RiyaIntelligenceTrajectoryV1): string {
  return canonicalJson(trajectory);
}

/** Parse one JSONL line, re-proving it through the trajectory constructor. */
export function parseRiyaTrajectoryJsonlLine(line: string): RiyaIntelligenceTrajectoryV1 {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new RiyaDatasetError('invalid-jsonl');
  }
  // A line must be exactly ONE JSON value. `JSON.parse` refuses trailing content, so two concatenated
  // objects are rejected here rather than silently reading the first and dropping the second.
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new RiyaDatasetError('invalid-jsonl');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RiyaDatasetError('invalid-jsonl');
  }
  // The trajectory constructor's own bounded codes are deliberately allowed through: `invalid-turn`
  // or `unsupported-business-fact` tells an author far more than a blanket `invalid-jsonl`, and
  // neither carries content.
  return createRiyaIntelligenceTrajectory(parsed as never);
}
