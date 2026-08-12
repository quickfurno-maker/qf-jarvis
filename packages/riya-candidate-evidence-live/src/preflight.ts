/**
 * Everything that must be true BEFORE a credential is requested (MVP-P2A.2).
 *
 * ### Why the order matters more than the checks
 *
 * Each item below is cheap and offline. What makes them worth a module is that they all run before
 * any secret source is constructed: an owner who typed the wrong output path, or whose smoke config
 * drifted, should learn that from a terminal message rather than after entering a live key. A check
 * that runs after the prompt has already cost the thing it was meant to protect.
 *
 * ### It reaches nothing
 *
 * No network, no provider, no credential, no environment. It reads one operator-supplied JSON file
 * through the existing loader and compares identities that are compiled in. A failure returns a
 * closed reason; nothing about the rejected value is echoed, because a config that failed validation
 * is exactly the kind of thing that might contain something it should not.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

import { loadSmokeConfig } from '@qf-jarvis/groq-staging-smoke';
import { createRiyaPromptRegistryV1 } from '@qf-jarvis/riya-prompts';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';
import { RIYA_GROUNDED_REPLY_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';

import { MAX_ESTIMATED_COST_USD, MAX_PROVIDER_REQUESTS } from './accounting.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_CONFIG_CANONICAL,
  CANDIDATE_CONFIG_DIGEST,
  CANDIDATE_DATA_CONTROLS_REF,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_PRICE_PER_M_INPUT_USD,
  CANDIDATE_PRICE_PER_M_OUTPUT_USD,
  RIYA_CLIENT_PROMPT_DIGEST,
} from './candidate-release.js';

/** The expected SHA-256 of the governed, secret-free smoke configuration. */
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

const fail = (failure: PreflightFailure): PreflightResult => ({ ok: false, failure });

/**
 * What a single request can cost at the model's own declared maxima, at the current published rates.
 *
 * This is what makes the 83-request reservation a bound rather than a hope, and it is exported so the
 * spec can assert the arithmetic instead of restating it.
 */
export const WORST_CASE_REQUEST_USD =
  (CANDIDATE_MAX_INPUT_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_INPUT_USD +
  (CANDIDATE_MAX_COMPLETION_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_OUTPUT_USD;

/**
 * Run every offline check, in order, and stop at the first failure.
 *
 * Path checks come first because they are the ones an owner most often gets wrong, and finding out
 * before a masked prompt is the entire point.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  return preflightCore(input, EXPECTED_SMOKE_CONFIG_DIGEST);
}

/**
 * The core, parameterised by the expected digest.
 *
 * NOT exported from the package root. The production entry point above always passes the governed
 * constant, so no production caller can substitute another one — an earlier version put the digest on
 * `PreflightInput`, which meant the lock was advisory for anybody holding the contract. The
 * test-only surface under `./testing` is the single other caller, and a containment spec proves no
 * production module imports it.
 */
export function preflightCore(input: PreflightInput, expectedDigest: string): PreflightResult {
  if (input.smokeConfigPath === undefined || input.smokeConfigPath.length === 0) {
    return fail('smoke-config-missing');
  }
  if (input.reviewOutputPath === undefined || input.reviewOutputPath.length === 0) {
    return fail('review-output-missing');
  }
  if (!isAbsolute(input.reviewOutputPath)) {
    return fail('review-output-not-absolute');
  }

  // Real location, not spelling. An external-looking path can be a junction that lands every
  // synthetic client turn and every candidate reply back inside version control.
  const output = resolve(input.reviewOutputPath);
  const parent = resolve(output, '..');
  if (!existsSync(parent)) {
    return fail('review-output-parent-missing');
  }
  let realParent: string;
  let realRepo: string;
  try {
    realParent = realpathSync(parent);
    realRepo = realpathSync(input.repoRoot);
  } catch {
    return fail('review-output-parent-missing');
  }
  if (realParent === realRepo || realParent.startsWith(`${realRepo}${sep}`)) {
    return fail('review-output-inside-repository');
  }
  // No overwrite by default. The bundle is the artifact two humans will read; replacing one silently
  // is how a review ends up describing a run nobody kept.
  if (existsSync(output)) {
    return fail('review-output-exists');
  }

  const loaded = loadSmokeConfig(input.smokeConfigPath);
  if (!loaded.ok) {
    return fail('smoke-config-unreadable');
  }
  // The WHOLE file, not the parsed subset: a digest over the parse would not notice a field the
  // loader ignored.
  let digest: string;
  try {
    digest = createHash('sha256').update(readFileSync(input.smokeConfigPath)).digest('hex');
  } catch {
    return fail('smoke-config-unreadable');
  }
  if (digest !== expectedDigest) {
    return fail('smoke-config-digest-mismatch');
  }
  if (loaded.config.release.modelId !== CANDIDATE_MODEL_ID) {
    return fail('smoke-model-mismatch');
  }
  // The governed data-controls posture comes from the approved configuration, never from Groq's
  // public documentation: public ZDR eligibility says what an account MAY enable, not what this one
  // HAS enabled.
  // The smoke config schema already types `dataControlsAttested` as literal `true`, so a config that
  // parsed cannot be negative -- checking it here would be checking the parser. What is NOT settled
  // by parsing is WHICH attestation it names, and that is the check worth making.
  if (loaded.config.dataControlsAttestationRef !== CANDIDATE_DATA_CONTROLS_REF) {
    return fail('data-controls-not-attested');
  }
  if (loaded.config.capabilityProfileRef !== CANDIDATE_CAPABILITY_PROFILE_REF) {
    return fail('capability-ref-mismatch');
  }

  // The candidate identity, the version locks, the ceilings and the retry/fallback posture are all
  // compile-time literals in this package. Comparing them here would be comparing a constant with
  // itself -- TypeScript already proves those, and a runtime `if` over a literal is dead code
  // pretending to be a guard. They are asserted where an assertion means something: the preflight
  // spec pins every one of them, so a drifted value fails a test rather than silently passing a
  // check that could never fire.
  //
  // What DOES vary at runtime is checked above and below: the operator's paths, the smoke config on
  // disk, the prompt bytes resolved out of the registry, and the digest recomputed from the
  // canonical object.

  // Recomputed, never trusted: a digest that is only ever read is a comment.
  const recomputed = createHash('sha256')
    .update(JSON.stringify(CANDIDATE_CONFIG_CANONICAL), 'utf8')
    .digest('hex');
  if (recomputed !== CANDIDATE_CONFIG_DIGEST) {
    return fail('candidate-config-digest-mismatch');
  }

  const registry = createRiyaPromptRegistryV1();
  const resolved = registry.resolve({
    promptId: RIYA_CLIENT_SALES_PROMPT_ID,
    promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
    agentScope: 'CLIENT',
    taskClass: RIYA_GROUNDED_REPLY_TASK_CLASS,
    resultMode: 'STRUCTURED',
  });
  if (resolved === undefined) {
    return fail('prompt-identity-mismatch');
  }
  // The bytes, re-proved against the reviewed digest before a single request is built.
  if (resolved.contentDigest !== RIYA_CLIENT_PROMPT_DIGEST) {
    return fail('prompt-digest-mismatch');
  }

  // The one arithmetic check worth running: whether the reservation bound is still a guarantee at
  // today's prices. `worstCase` is computed rather than compared to a literal, so this can genuinely
  // fail if a published rate rises.
  if (WORST_CASE_REQUEST_USD * MAX_PROVIDER_REQUESTS >= MAX_ESTIMATED_COST_USD) {
    return fail('cost-bound-not-guaranteed');
  }

  // Last, because it is the one an owner can fix by running the command differently.
  if (!input.interactive) {
    return fail('tty-unavailable');
  }
  return { ok: true };
}
