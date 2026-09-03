/**
 * The candidate acceptance state machine (AS1, ADR-0143 §19).
 *
 * ### Forward-only, and QUARANTINED is a wall
 *
 * The rule worth stating plainly: **there is no automated transition out of `QUARANTINED`.**
 *
 * In the human lane, protected near-leakage is a quarantine somebody adjudicates — a person reads
 * the candidate and the matched exam case and decides whether it is a real overlap. This lane has no
 * person. If a quarantined candidate could be re-examined by a critic and released, the protected
 * exam firewall would be enforced by a model whose judgement is exactly what the exam exists to
 * measure, and the P10 number would stop meaning anything.
 *
 * So a quarantined candidate is discarded. AS3 generates a different one. That is cheap, and it is
 * the only answer that keeps the firewall real.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import {
  RIYA_AI_SYNTHETIC_ACCEPTANCE_STATES,
  RIYA_AI_SYNTHETIC_PROGRESSION,
  RIYA_AI_SYNTHETIC_TERMINAL_STATES,
} from './vocabularies.js';
import type { RiyaAiSyntheticAcceptanceState } from './vocabularies.js';

export interface RiyaAiSyntheticCandidateStateV1 {
  readonly version: 1;
  readonly candidateRef: string;
  readonly scenarioRef: string;
  readonly state: RiyaAiSyntheticAcceptanceState;
}

export type RiyaAiSyntheticCandidateStateInput = Omit<
  RiyaAiSyntheticCandidateStateV1,
  'version'
> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const stateSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added. Round-tripping is a real path: evidence deep-
    // re-proves verdicts that are themselves already constructed.
    version: z.literal(1).optional(),
    candidateRef: REF,
    scenarioRef: REF,
    state: z.enum(RIYA_AI_SYNTHETIC_ACCEPTANCE_STATES),
  })
  .strict();

/** Validate and freeze a candidate state record. Throws `invalid-ai-synthetic-state`. */
export function createRiyaAiSyntheticCandidateState(
  input: RiyaAiSyntheticCandidateStateInput,
): RiyaAiSyntheticCandidateStateV1 {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-state');
  }
  const { version: _supplied, ...fields } = parsed.data;
  return Object.freeze({ version: 1 as const, ...fields });
}

/** A candidate begins here, always. */
export const RIYA_AI_SYNTHETIC_INITIAL_STATE: RiyaAiSyntheticAcceptanceState = 'PLANNED';

/**
 * May a candidate move from `from` to `to`?
 *
 * Legal moves are exactly three shapes: one step forward along the progression, an exit to
 * `REJECTED` from any non-terminal state, and an exit to `QUARANTINED` from any non-terminal state.
 * Skipping a step is refused — a candidate that reached `ACCEPTED` without passing through
 * `DIVERSITY_VALIDATED` was never diversity-checked, and the state record would say otherwise.
 */
export function riyaAiSyntheticTransitionAllowed(
  from: RiyaAiSyntheticAcceptanceState,
  to: RiyaAiSyntheticAcceptanceState,
): boolean {
  if (RIYA_AI_SYNTHETIC_TERMINAL_STATES.has(from)) {
    return false;
  }
  if (to === 'REJECTED' || to === 'QUARANTINED') {
    return true;
  }
  const fromIndex = RIYA_AI_SYNTHETIC_PROGRESSION.indexOf(from);
  const toIndex = RIYA_AI_SYNTHETIC_PROGRESSION.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) {
    return false;
  }
  return toIndex === fromIndex + 1;
}

/**
 * Apply a transition. Throws `invalid-ai-synthetic-state` when it is not allowed.
 *
 * Throwing rather than returning the unchanged record on purpose: a caller that silently kept its
 * old state would report a candidate as still progressing while the pipeline believed it had moved.
 */
export function advanceRiyaAiSyntheticCandidate(
  candidate: RiyaAiSyntheticCandidateStateV1,
  to: RiyaAiSyntheticAcceptanceState,
): RiyaAiSyntheticCandidateStateV1 {
  if (!riyaAiSyntheticTransitionAllowed(candidate.state, to)) {
    throw new RiyaDatasetError('invalid-ai-synthetic-state');
  }
  return Object.freeze({ ...candidate, state: to });
}
