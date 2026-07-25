/**
 * The mandatory red-team coverage set (QFJ-P04.04, ADR-0052 §K).
 *
 * The full closed set of adversarial case kinds a suite must cover before evidence can be created for
 * a serving/approval target. A suite omitting any of these fails the evidence gate
 * (`evidence-blocked-mandatory-missing`).
 */
import { RED_TEAM_CASE_KINDS } from '../contracts/vocabularies.js';
import type { RedTeamCaseKind } from '../contracts/vocabularies.js';

/** Every red-team kind is mandatory for a serving/approval target in this foundation. */
export const DEFAULT_MANDATORY_RED_TEAM_KINDS: readonly RedTeamCaseKind[] = Object.freeze([
  ...RED_TEAM_CASE_KINDS,
]);
