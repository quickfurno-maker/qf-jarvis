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
export const OPERATOR_RUN_GOALS = [
  'FULL_EVIDENCE',
  'SAFETY_REPLICATION',
  /**
   * MVP-P2A.2 HF4-R8. A REQUEST-CONTRACT diagnostic: the text smoke, then eight synthetic canaries,
   * then stop.
   *
   * It exists because S9 and S10 each spent a live authorization re-observing the same nine HTTP 400s
   * without isolating which dimension the provider rejected. This goal reaches NO safety authority, NO
   * P10 and NO review bundle, and it evaluates no fixture — it asks only whether the provider accepts a
   * request, one varied axis at a time. A separate goal rather than a flag on `SAFETY_REPLICATION`,
   * because a run that evaluates nothing must not be able to produce something a reader could mistake
   * for a safety result.
   */
  'REQUEST_CONTRACT_DIAGNOSTIC',
] as const;
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
  REQUEST_CONTRACT_DIAGNOSTIC:
    'Smoke passed. Enter the same Groq credential again for the bounded request-contract diagnostic.',
});

/**
 * The same notice for an ingress that will NOT ask again (MVP-P2A.2 HF4-R5).
 *
 * Clipboard mode read the credential once and cleared the clipboard doing it. Printing "enter the same
 * credential again" there would be a plain untruth at the exact moment an owner is deciding whether to
 * let the run continue — they would reach for a clipboard that no longer holds anything, and the run
 * would meanwhile proceed without them. The wording states what is actually about to happen.
 *
 * Both tables are per-goal for the same reason the first one is: an owner is told which bounded run
 * their credential is about to fund, not merely that one is starting.
 */
export const REUSED_CREDENTIAL_NOTICES: Readonly<Record<OperatorRunGoal, string>> = Object.freeze({
  FULL_EVIDENCE:
    'Smoke passed. Reusing the credential already read for the bounded candidate evidence run.',
  SAFETY_REPLICATION:
    'Smoke passed. Reusing the credential already read for the bounded safety diagnostic replication.',
  REQUEST_CONTRACT_DIAGNOSTIC:
    'Smoke passed. Reusing the credential already read for the bounded request-contract diagnostic.',
});
