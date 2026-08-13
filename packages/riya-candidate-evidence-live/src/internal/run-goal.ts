/**
 * The closed operator run-goal vocabulary (MVP-P2A.2 HF3).
 *
 * ### Why a goal and not a flag
 *
 * RUN S1 reached the safety authority and stopped INELIGIBLE. The governed reading of a replication
 * is locked: if a later run comes back ELIGIBLE, that disagreement is run-to-run variability and an
 * owner must interpret it BEFORE any quality evidence is collected. The full operator cannot serve
 * that purpose, because an ELIGIBLE result there falls straight into 72 P10 calls and a written
 * bundle — spending the interpretation decision before anyone makes it.
 *
 * So this names a pre-reviewed PURPOSE, not a bypass. `SAFETY_REPLICATION` is strictly MORE
 * conservative than the default: it runs the same preflight, the same single smoke, the same second
 * masked credential, the same seventeen cases and the same authority, and then stops. There is
 * deliberately no goal that skips a gate, forces a verdict, or widens a ceiling — every value here
 * removes work rather than authorising more of it.
 *
 * ### The default is load-bearing
 *
 * Absence means `FULL_EVIDENCE`. Every existing caller that never heard of a run goal keeps exactly
 * its pre-HF3 behaviour, and a spec asserts the standard operator still performs all 83 requests. A
 * new mode that silently narrowed the old command would be the worst possible outcome of this change.
 *
 * Internal: not exported from the package root, because nothing outside this package selects a goal.
 */
export const OPERATOR_RUN_GOALS = ['FULL_EVIDENCE', 'SAFETY_REPLICATION'] as const;
export type OperatorRunGoal = (typeof OPERATOR_RUN_GOALS)[number];

/** The goal a run has when nobody said. Full evidence, exactly as before HF3. */
export const DEFAULT_RUN_GOAL: OperatorRunGoal = 'FULL_EVIDENCE';

/**
 * The second-prompt notice, per goal.
 *
 * The full-evidence wording is unchanged. The replication wording exists because telling an owner
 * they are about to fund "the bounded candidate evidence run" — when the run will stop after safety
 * and write nothing — would be a small lie at the exact moment they are typing a credential.
 */
export const SECOND_CREDENTIAL_NOTICES: Readonly<Record<OperatorRunGoal, string>> = Object.freeze({
  FULL_EVIDENCE:
    'Smoke passed. Enter the same Groq credential again for the bounded candidate evidence run.',
  SAFETY_REPLICATION:
    'Smoke passed. Enter the same Groq credential again for the bounded safety diagnostic replication.',
});
