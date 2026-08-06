/**
 * The injected atomic replay / idempotency guard (QFJ-P09.02, ADR-0090).
 *
 * ### Why this is an interface and not an implementation
 *
 * P09.01 could OBSERVE an idempotency key without owning it. This is the execution boundary, where
 * ownership begins — and ownership means atomicity. Two dispatches of the same intent arriving
 * concurrently must not both be told "first seen"; only a store that can claim-or-report in one
 * atomic step can promise that, and this slice adds no database.
 *
 * So the guard is REQUIRED and injected. There is deliberately no default:
 *
 * - an in-memory default would silently work in tests and lose its state on every restart, which
 *   is exactly the failure mode that produces a duplicate provider effect;
 * - a permissive default would turn "unknown" into "first seen", which is the one answer this
 *   boundary must never guess.
 *
 * A deterministic in-memory fake exists under `src/tests/` and is excluded from the emitting build.
 *
 * ### What a claim binds
 *
 * All three of `executionIntentId`, `idempotencyKey` and the verifier-computed body digest. Binding
 * only the id would let the same intent be re-sent under a fresh key; binding only the key would
 * let one key be reused for a different intent; binding neither to the digest would let the SAME id
 * and key carry different bytes. Each of those is a distinct way to smuggle a second effect past a
 * boundary that checked the obvious field.
 */

/** The exact facts a claim is bound to. Every field comes from an ALREADY-VERIFIED dispatch. */
export interface ReplayClaimInput {
  /** From the parsed, contract-valid intent. */
  readonly executionIntentId: string;
  /** From the parsed, contract-valid intent. */
  readonly idempotencyKey: string;
  /** The VERIFIER-COMPUTED `hex(sha256(rawBody))`. Never the envelope's claimed digest. */
  readonly bodyDigestHex: string;
}

/**
 * The closed set of answers an atomic guard may give.
 *
 * - `first-seen`  — this exact triple has not crossed the boundary before.
 * - `exact-replay` — the identical intent, key and bytes have crossed before. Suppress, do not act.
 * - `conflict`    — the store holds something that contradicts this claim. Fail closed.
 *
 * There is no fourth answer, and in particular no "probably fine".
 */
export const REPLAY_CLAIM_OUTCOMES = ['first-seen', 'exact-replay', 'conflict'] as const;

export type ReplayClaimOutcome = (typeof REPLAY_CLAIM_OUTCOMES)[number];

/**
 * An atomic claim-or-report store.
 *
 * `claim` must be atomic with respect to concurrent callers: for one triple exactly one caller may
 * receive `first-seen`. It may be async — a real implementation will be a single conditional write.
 *
 * If it cannot answer, it should THROW or reject. The boundary converts that into
 * `replay-guard-unavailable` and refuses; it never retries, because a retry inside a boundary that
 * has already authenticated an instruction is how one instruction becomes two effects.
 */
export interface ExecutionReplayGuard {
  claim: (input: ReplayClaimInput) => ReplayClaimOutcome | Promise<ReplayClaimOutcome>;
}
