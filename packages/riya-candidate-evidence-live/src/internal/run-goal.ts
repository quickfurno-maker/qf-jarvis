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
  /**
   * POST-NRA1. The GPT-OSS-120B strict MODEL DIFFERENTIAL: the smoke, ONE probe, then stop.
   *
   * NRA1 sent the NEUTRAL production-built request to `openai/gpt-oss-20b` and received HTTP 400 with
   * `JSON_VALIDATE_FAILED` — the same failure class RA1 met on the safety-derived turn. So the strict
   * failure is not confined to adversarial content, while OAD3's `O2` had already shown the same exact
   * schema accepted at this budget with synthetic tiny messages.
   *
   * This goal changes exactly ONE thing: the model id on the wire. Same captured request, same prompt
   * bytes, same projected schema, same 4,096 budget, same strict mode, same timeout and retry posture.
   *
   * It is a DIAGNOSTIC, not a rollout decision. Production candidate identity stays 20B.
   */
  'POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL',
  /**
   * POST-MD120B3. The Groq RESPONSES API strict ENDPOINT differential: the smoke, ONE probe, stop.
   *
   * MD120B3 used the goal above and received HTTP 400 with `JSON_VALIDATE_FAILED` — the same failure
   * class NRA1 met on 20B. So the strict Chat Completions failure reproduces across BOTH governed
   * GPT-OSS models, and the model is no longer the open axis.
   *
   * Groq documents a second output contract for the same models — the Responses API, currently beta,
   * with structured-output support — so this goal changes exactly ONE thing: the provider endpoint and
   * the envelope it requires. Same captured request, same prompt bytes, same projected schema, same
   * 4,096 output bound, same strict mode, same PRODUCTION 20B model, same timeout and retry posture.
   *
   * A separate token again, because a receipt must say which output contract produced it. It is a
   * DIAGNOSTIC, not a migration: production routing stays Chat Completions.
   */
  'POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL',
  /**
   * POST-RSP20B2. The `reasoning_effort='low'` differential: the smoke, ONE probe, then stop.
   *
   * RSP20B2 used the goal above and reproduced the strict failure over the Responses API, as MD120B3
   * had on 120B and NRA1 on 20B. Model and endpoint are both closed as axes.
   *
   * What every one of those requests shares is that it carried NO reasoning field at all. GPT-OSS
   * reasoning tokens are drawn from the same completion budget the structured answer needs, so a
   * model reasoning at the documented default has less of that budget left for the JSON it was asked
   * to produce. This goal changes exactly ONE thing: it sends `reasoning_effort='low'`.
   *
   * Everything else is held -- same captured request, same prompt bytes, same projected schema, same
   * 4,096 budget, same strict mode, same PRODUCTION 20B model, same Chat Completions endpoint, same
   * timeout and zero-retry posture. Holding the budget matters more here than anywhere else: it is
   * the quantity the effort setting competes for.
   *
   * A separate token again, because a receipt must say which effort produced it. It is a DIAGNOSTIC:
   * production sends no reasoning field, and changing that is a separate owner decision this goal
   * does not make.
   */
  'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL',
  /**
   * POST-RLD1. The low-reasoning OUTPUT-BUDGET differential: the smoke, ONE probe, then stop.
   *
   * RLD1 used the goal above and received HTTP 400 with `json_validate_failed` --
   * `REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID`. Explicit low reasoning effort did NOT repair
   * the exact neutral path at 4,096.
   *
   * What that closes is the explicit-low-at-4096 REPAIR ATTEMPT, and only that. Other
   * reasoning-effort values remain UNTESTED -- `high` has never been sent -- and nothing here claims
   * reasoning effort is generally irrelevant. The next selected one-variable diagnostic therefore
   * HOLDS the effort at low rather than treating the axis as finished with.
   *
   * This goal holds three things -- same model, same endpoint, same `reasoning_effort='low'`, same
   * captured messages, same projected schema, same strict mode, same timeout and zero-retry posture
   * -- and changes exactly ONE thing: `max_completion_tokens`, from 4,096 to 8,192.
   *
   * It is a BUDGET differential and not a second reasoning one, and it does NOT replay RLD1's 4,096
   * request: that answer is recorded and spending a live request to re-prove it would answer nothing.
   *
   * A separate token again, because a receipt must say which budget produced it. It is a DIAGNOSTIC:
   * `RIYA_COMPLETION_BUDGET_TOKENS` stays 4,096, and moving production is a separate owner decision
   * this goal does not make.
   */
  'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL',
  /**
   * POST-RBD1. The best-effort json_schema STRICT-POSTURE differential: smoke, ONE probe, stop.
   *
   * RLD1 met json_validate_failed at 4,096 and RBD1 met it again at 8,192, both under
   * json_schema.strict: true. Neither the effort attempt nor the budget attempt repaired the exact
   * neutral path, and what every one of those requests shares is CONSTRAINED DECODING.
   *
   * This goal holds the model, the endpoint, the captured messages, the projected schema, the schema
   * name, reasoning_effort='low' and the 8,192 budget, and changes exactly ONE nested wire leaf:
   * response_format.json_schema.strict, true -> false.
   *
   * It is NOT production's non-strict path. buildResponseFormat(schema, false) returns json_object,
   * which would drop the schema name and the schema body along with the flag and answer a different,
   * weaker question. This keeps json_schema mode and the schema exactly.
   *
   * A separate token again, because a receipt must say which strict posture produced it. It is a
   * DIAGNOSTIC: production still sends strict: true for a strict-capable projected schema, and
   * changing that is a separate owner decision this goal does not make.
   */
  'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL',
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
  POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL:
    'Smoke passed. Enter the same Groq credential again for the 120B strict model differential probe.',
  POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL:
    'Smoke passed. Enter the same Groq credential again for the Responses API strict endpoint differential probe.',
  POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL:
    'Smoke passed. Enter the same Groq credential again for the low reasoning-effort differential probe.',
  POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL:
    'Smoke passed. Enter the same Groq credential again for the low-reasoning 8192 output-budget differential probe.',
  POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL:
    'Smoke passed. Enter the same Groq credential again for the best-effort strict-false JSON-schema differential probe.',
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
  POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL:
    'Smoke passed. Reusing the credential already read for the 120B strict model differential probe.',
  POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL:
    'Smoke passed. Reusing the credential already read for the Responses API strict endpoint differential probe.',
  POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL:
    'Smoke passed. Reusing the credential already read for the low reasoning-effort differential probe.',
  POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL:
    'Smoke passed. Reusing the credential already read for the low-reasoning 8192 output-budget differential probe.',
  POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL:
    'Smoke passed. Reusing the credential already read for the best-effort strict-false JSON-schema differential probe.',
});
