/**
 * Everything that must be true BEFORE a credential is requested (MVP-P2A.2).
 *
 * ### Why the order matters more than the checks
 *
 * Each check is cheap and offline. What makes them worth a module is that they all run before any
 * secret source is constructed: an owner who typed the wrong output path, or whose smoke config
 * drifted, should learn that from a terminal message rather than after entering a live key.
 *
 * ### There is no override, and that took three attempts
 *
 * The first version put an expected-digest field on `PreflightInput`. The second put a whole-preflight
 * callback on `OperatorDeps`. Both were reachable by any caller holding the public contract, which is
 * what makes a lock advisory. `runPreflight` now takes the input and nothing else, and always pins the
 * governed digest. The parameterised core lives in `internal/` and is not exported from the package
 * root; `package.json` exposes only `"."`, so no consumer can reach it by subpath either.
 *
 * ### It reaches nothing
 *
 * No network, no provider, no credential, no environment. A failure returns a closed reason; nothing
 * about the rejected value is echoed, because a config that failed validation is exactly the kind of
 * thing that might contain something it should not.
 */
import { preflightCore, WORST_CASE_REQUEST_USD } from './internal/preflight-core.js';

export { WORST_CASE_REQUEST_USD };

/**
 * The governed SEMANTIC approval digest of the secret-free smoke configuration (QFJ-S1C).
 *
 * The name is kept, because it is the governance identity and renaming it would suggest the approval
 * changed when only our understanding of it did. What it means is stated exactly here, because HF1
 * existed entirely because it had been misread:
 *
 *   - It is the SHA-256 of the approved CONFIGURATION — the values, canonically serialized with keys
 *     sorted by Unicode code point, compact, UTF-8, no BOM, no trailing newline. 709 bytes.
 *   - It EXCLUDES `release.configDigest`, because a digest cannot be an input to its own computation.
 *   - It is NOT the SHA-256 of the serialized file. The generator's own emitted file is 888
 *     pretty-printed bytes and hashes to something else; a raw serialization hash is not, and never
 *     was, the governance identity.
 *
 * Three properties follow, and preflight relies on all three:
 *
 *   - Harmless formatting differences — indentation, key order, a trailing newline — do NOT change
 *     the approved identity, because they do not change the configuration.
 *   - An added field still fails, and fails EARLIER: `parseSmokeConfig` is `.strict()` over a closed
 *     key-path allow-list, so an unapproved field never reaches approval at all.
 *   - A changed approved VALUE fails, because recomputation from the parsed config changes.
 *
 * The embedded `release.configDigest` is verified SEPARATELY against this same constant. Self-exclusion
 * means recomputation is structurally blind to it, so that second check is not redundant.
 */
export const EXPECTED_SMOKE_CONFIG_DIGEST =
  '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1';

/** Why preflight refused. Closed, content-free, and never carries a rejected value. */
export const PREFLIGHT_FAILURES = [
  'smoke-config-missing',
  'review-output-missing',
  'review-output-not-absolute',
  'review-output-inside-repository',
  'review-output-exists',
  'review-output-parent-missing',
  'smoke-config-unreadable',
  'smoke-config-digest-mismatch',
  'smoke-model-mismatch',
  'candidate-identity-mismatch',
  'candidate-config-digest-mismatch',
  'prompt-identity-mismatch',
  'prompt-digest-mismatch',
  'safety-version-mismatch',
  'quality-version-mismatch',
  'capability-ref-mismatch',
  'data-controls-not-attested',
  'strict-json-not-supported',
  'retry-or-fallback-configured',
  'ceiling-misconfigured',
  'cost-bound-not-guaranteed',
  'tty-unavailable',
] as const;
export type PreflightFailure = (typeof PREFLIGHT_FAILURES)[number];

export interface PreflightInput {
  readonly smokeConfigPath: string | undefined;
  readonly reviewOutputPath: string | undefined;
  /** The repository root the bundle must stay outside of. */
  readonly repoRoot: string;
  /** Whether a real interactive terminal exists. Injected so a spec never touches a TTY. */
  readonly interactive: boolean;
}

export type PreflightResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: PreflightFailure };

/**
 * Run every offline check against the GOVERNED digest.
 *
 * The only production entry point. It takes the input and nothing else — there is deliberately no
 * parameter, field or callback through which a caller could supply a different expected digest or a
 * different preflight implementation.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  return preflightCore(input, EXPECTED_SMOKE_CONFIG_DIGEST);
}
