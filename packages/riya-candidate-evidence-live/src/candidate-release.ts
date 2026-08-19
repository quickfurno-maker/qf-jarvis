/**
 * The EXACT candidate release identity, and the digest that makes it checkable (MVP-P2A.2).
 *
 * ### One release, no wildcards
 *
 * Evidence is only ever evidence about a named thing. `latest`, a range or a floating alias would let
 * a suite pass against one model and a rollout consume it against another, so every field below is an
 * exact literal and a spec asserts there is no `*`, no `latest` and no range anywhere in the set.
 *
 * ### `modelVersion` is a CATALOG SNAPSHOT LABEL, not a weight hash
 *
 * Groq does not publish an immutable per-weights version for `openai/gpt-oss-20b`. Inventing one —
 * `v1`, a date pretending to be a build, a made-up hash — would be a fabricated governance identity
 * that later reads as a guarantee nobody can honour. `groq-catalog-snapshot-2026-08-12` says exactly
 * what it is: the day the catalogue was read and the facts below were revalidated against official
 * documentation. If Groq silently reships the weights, this label does NOT prove they are the same;
 * it proves when we last looked, which is the strongest true statement available.
 *
 * ### The digest covers execution identity and nothing situational
 *
 * SHA-256 over one canonical, secret-free object: who serves it, what model, which catalogue snapshot,
 * which execution class, which capability and data-controls governance refs, which prompt bytes, and
 * the retry/fallback posture. Deliberately excluded: any credential, any local path, any timestamp,
 * any run id, the review output location. Those change per run and per machine; a digest that moved
 * with them could never be pinned, and a pin nobody can reproduce is decoration.
 */
import { createHash } from 'node:crypto';

import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';

/**
 * The exact Riya CLIENT prompt bytes this candidate is evaluated behind (MVP-P2A.2-P, PR #117).
 *
 * POST-SDH4: this digest MOVED, and that is an owner-visible governance event rather than a routine
 * edit. The observation repair removed the `operation` property from the provider payload, and the
 * prompt still instructed the model to record `"SET"` and `"CLEAR"` — strings the schema no longer
 * has anywhere. One paragraph was rewritten to name the two arrays instead.
 *
 * Nothing else about the prompt changed: no personality, no sales strategy, no safety instruction, no
 * knowledge policy, no business authority. Every RWC-P4A rule the old wording carried is still
 * stated — a set carries a value, `user_stated` versus `model_inferred`, a clear only on an explicit
 * withdrawal and only `user_stated`.
 *
 * The consequence is that this candidate's prompt identity is no longer byte-identical to the one S11
 * and SDH4 ran behind, so evidence from those runs is comparable on the request contract but not on
 * prompt bytes.
 */
export const RIYA_CLIENT_PROMPT_DIGEST =
  'd0c2da57f53c2541274e090b8dec997c885f65f60c6bd8467e98d0be684b71fb';

export const CANDIDATE_RELEASE_ID = 'rel.groq.qfj.riya-candidate.gpt-oss-20b.v1';
export const CANDIDATE_PROVIDER_ID = 'groq';
export const CANDIDATE_MODEL_ID = 'openai/gpt-oss-20b';
/** The day the catalogue was read, not a claim about immutable weights. See the note above. */
export const CANDIDATE_CATALOG_SNAPSHOT = 'groq-catalog-snapshot-2026-08-12';
export const CANDIDATE_EXECUTION_CLASS = 'HOSTED';

/**
 * Provider bounds, revalidated from official Groq documentation on 2026-08-12.
 *
 * These are the model's advertised ceilings, not the request budgets — the operator sends far smaller
 * requests. They exist here because the provider config refuses to be built without them and because
 * a change in either is a change in execution identity, which is why they are in the digest.
 */
export const CANDIDATE_MAX_INPUT_TOKENS = 131_072;
export const CANDIDATE_MAX_COMPLETION_TOKENS = 65_536;
export const CANDIDATE_SUPPORTS_STRICT_JSON = true;

/**
 * Official Groq pricing per 1M tokens, revalidated 2026-08-12. Used ONLY to estimate spend against
 * the operator's own ceiling — nothing here is billed, and a provider-reported usage figure always
 * wins over an estimate.
 */
export const CANDIDATE_PRICE_PER_M_INPUT_USD = 0.075;
export const CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD = 0.037;
export const CANDIDATE_PRICE_PER_M_OUTPUT_USD = 0.3;

/**
 * The governed references this candidate runs under.
 *
 * Both are reused rather than reinvented: they are the refs the existing approved Groq staging path
 * already carries, and the preflight re-proves the smoke configuration still names the same
 * data-controls attestation before a candidate credential is ever requested. A positive ZDR posture
 * is NEVER inferred from Groq's public documentation — public eligibility says what an account MAY
 * enable, not what this account HAS enabled, and the difference is the whole point of an attestation.
 */
export const CANDIDATE_CAPABILITY_PROFILE_REF =
  'cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28';
export const CANDIDATE_DATA_CONTROLS_REF = 'att.groq.qfj-staging.global-zdr.2026-07-28';

/** The operator revision. Bump when the composition changes in a way that changes what was measured. */
export const CANDIDATE_OPERATOR_REVISION = 'qfj.riya-candidate-evidence-live.v1';

/** Posture, restated INSIDE the digest so a retry or a fallback cannot be added invisibly. */
export const CANDIDATE_RETRY_BUDGET = 0;
export const CANDIDATE_ALLOW_FALLBACK = false;

/** The canonical, secret-free object the digest is taken over. Key order is fixed by authorship. */
export const CANDIDATE_CONFIG_CANONICAL = Object.freeze({
  domain: 'qfj.riya.candidate-evidence.release.v1',
  releaseId: CANDIDATE_RELEASE_ID,
  providerId: CANDIDATE_PROVIDER_ID,
  modelId: CANDIDATE_MODEL_ID,
  catalogSnapshot: CANDIDATE_CATALOG_SNAPSHOT,
  executionClass: CANDIDATE_EXECUTION_CLASS,
  supportsStrictJsonSchema: CANDIDATE_SUPPORTS_STRICT_JSON,
  maxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
  maxCompletionTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
  capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
  dataControlsAttestationRef: CANDIDATE_DATA_CONTROLS_REF,
  promptFamily: RIYA_CLIENT_SALES_PROMPT_ID,
  promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
  promptDigest: RIYA_CLIENT_PROMPT_DIGEST,
  retryBudget: CANDIDATE_RETRY_BUDGET,
  allowFallback: CANDIDATE_ALLOW_FALLBACK,
  operatorRevision: CANDIDATE_OPERATOR_REVISION,
});

/** SHA-256, lowercase hex, over the canonical object as UTF-8 JSON. Computed, never typed in. */
export const CANDIDATE_CONFIG_DIGEST: string = createHash('sha256')
  .update(JSON.stringify(CANDIDATE_CONFIG_CANONICAL), 'utf8')
  .digest('hex');

/** The exact `ModelReleaseRef` every plan, provider config and adapter in this run must agree on. */
export const CANDIDATE_RELEASE = Object.freeze({
  releaseId: CANDIDATE_RELEASE_ID,
  providerId: CANDIDATE_PROVIDER_ID,
  modelId: CANDIDATE_MODEL_ID,
  modelVersion: CANDIDATE_CATALOG_SNAPSHOT,
  configDigest: CANDIDATE_CONFIG_DIGEST,
  executionClass: CANDIDATE_EXECUTION_CLASS,
} as const);

/**
 * The governed policy revision the evaluation turns run under.
 *
 * An EVALUATION revision, named as one. Borrowing a production policy revision would make an
 * evaluation turn indistinguishable from a served turn in anything that later reads the plan.
 */
export const CANDIDATE_POLICY_REVISION = 'policy.qfj.riya-candidate-evidence.v1';
