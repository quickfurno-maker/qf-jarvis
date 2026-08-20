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
  /**
   * POST-PR-131. A SCHEMA DIFFERENTIAL diagnostic: the text smoke, then nine schema probes, then
   * stop.
   *
   * A SEPARATE token from `REQUEST_CONTRACT_DIAGNOSTIC`, deliberately. That goal names S11's
   * historical eight-canary D1-D8 matrix, which varied a completion cap and a request shape
   * together; this one holds the completion cap fixed at the low control value and varies only the
   * SCHEMA, over real fragments of the projected production document. Reusing one token for two
   * materially different live matrices would make S11's immutable evidence unreadable — a receipt
   * could no longer say which matrix produced it.
   *
   * Strictly more conservative than `FULL_EVIDENCE` and narrower than the replication: it reaches no
   * fixture, no evaluator, no authority, no P10 and no review bundle.
   */
  'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
  /**
   * POST-SDH4. A bounded verification that the observation schema REPAIR is accepted.
   *
   * A separate token again, and for the reason the last one was: SDH4's R0-R8 matrix ran against the
   * pre-repair schema and its receipts already say what those probes meant. This goal runs V0-V4
   * against the repaired document, at the same fixed low cap, and reaches no fixture, no evaluator,
   * no authority, no P10 and no review bundle.
   */
  'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
  /**
   * POST-SRV1. The OPERATIONAL ACCEPTANCE diagnostic: the text smoke, then four probes at the REAL
   * governed Riya completion budget, then stop.
   *
   * SRV1 answered the schema question at the low control cap: the two repaired observation arrays
   * were accepted independently, while the evolution group and the exact document came back HTTP 400
   * with the provider's own `json_validate_failed` code. Every matrix so far has held the completion
   * budget at 512, which was right for isolating a schema, and which means the operational envelope
   * has never been measured.
   *
   * So this goal varies exactly that: the same real schema, at `RIYA_COMPLETION_BUDGET_TOKENS`, with
   * synthetic messages and then with the captured representative production messages. A separate
   * token again, because a receipt must always say which envelope produced it.
   */
  'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
  /**
   * POST-OAD3. The REPRESENTATIVE-ONLY acceptance gate: the text smoke, then ONE probe, then stop.
   *
   * OAD3 answered most of the question. At the repaired 4,096-token budget the minimal control
   * returned HTTP 200, and the exact current production Riya schema with synthetic messages returned
   * HTTP 200 — which closes the schema-composition doubt for that request. What it did NOT answer is
   * the representative one: `O3` came back HTTP 429, a rate limit, which is the provider declining to
   * process rather than a verdict on the request.
   *
   * So exactly one question is left, and repeating `O0`, `O1` and `O2` to ask it would spend live
   * authorization re-proving what is already proven. This goal sends the smoke and the representative
   * request, and nothing else.
   */
  'POST_OAD3_REPRESENTATIVE_ACCEPTANCE',
  /**
   * POST-RA1. The NEUTRAL ordinary client-sales acceptance gate: the smoke, ONE probe, then stop.
   *
   * RA1 used the goal above and received HTTP 400 with `JSON_VALIDATE_FAILED`. That receipt stands.
   * What it measured is narrower than its name: the captured request comes from the SAFETY fixture
   * manifest and resolves to `CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY`, an adversarial turn telling
   * Riya to treat its own answer as the final decision.
   *
   * OAD3 had already shown the exact production schema accepted at this budget with synthetic
   * messages, so the open question is specifically whether an ORDINARY client turn traverses the same
   * path. A separate goal, because a receipt must say which turn produced it.
   */
  'POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE',
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
  SCHEMA_DIFFERENTIAL_DIAGNOSTIC:
    'Smoke passed. Enter the same Groq credential again for the bounded schema differential diagnostic.',
  POST_SDH4_SCHEMA_REPAIR_VERIFICATION:
    'Smoke passed. Enter the same Groq credential again for the bounded schema repair verification.',
  POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC:
    'Smoke passed. Enter the same Groq credential again for the bounded operational acceptance diagnostic.',
  POST_OAD3_REPRESENTATIVE_ACCEPTANCE:
    'Smoke passed. Enter the same Groq credential again for the representative acceptance probe.',
  POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE:
    'Smoke passed. Enter the same Groq credential again for the neutral client acceptance probe.',
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
  SCHEMA_DIFFERENTIAL_DIAGNOSTIC:
    'Smoke passed. Reusing the credential already read for the bounded schema differential diagnostic.',
  POST_SDH4_SCHEMA_REPAIR_VERIFICATION:
    'Smoke passed. Reusing the credential already read for the bounded schema repair verification.',
  POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC:
    'Smoke passed. Reusing the credential already read for the bounded operational acceptance diagnostic.',
  POST_OAD3_REPRESENTATIVE_ACCEPTANCE:
    'Smoke passed. Reusing the credential already read for the representative acceptance probe.',
  POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE:
    'Smoke passed. Reusing the credential already read for the neutral client acceptance probe.',
});
