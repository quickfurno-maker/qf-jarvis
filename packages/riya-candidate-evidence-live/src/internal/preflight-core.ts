/**
 * The parameterised preflight core (MVP-P2A.2).
 *
 * NOT exported from the package root, and `package.json` exposes only `"."` — so no consumer can
 * reach it through a deep subpath. `runPreflight` always passes the governed constant; the only other
 * caller is a helper under `src/tests/`, which the emitting build excludes.
 *
 * Keeping the digest a parameter here rather than a field on a public input type is the whole point:
 * a seam that only test code can reach is a test seam, and one every caller can reach is a bypass.
 */
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

import { computeSmokeApprovalDigest, loadSmokeConfig } from '@qf-jarvis/groq-staging-smoke';
import { createRiyaPromptRegistryV1 } from '@qf-jarvis/riya-prompts';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';
import { RIYA_GROUNDED_REPLY_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';

import { MAX_ESTIMATED_COST_USD, MAX_PROVIDER_REQUESTS } from '../accounting.js';
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
} from '../candidate-release.js';
import { DEFAULT_CREDENTIAL_SOURCE_MODE } from '../credential-source.js';
import type { PreflightFailure, PreflightInput, PreflightResult } from '../preflight.js';

const fail = (failure: PreflightFailure): PreflightResult => ({ ok: false, failure });

/**
 * What a single request can cost at the model's own declared maxima, at the current published rates.
 *
 * This is what makes the 83-request reservation a bound rather than a hope.
 */
export const WORST_CASE_REQUEST_USD =
  (CANDIDATE_MAX_INPUT_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_INPUT_USD +
  (CANDIDATE_MAX_COMPLETION_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_OUTPUT_USD;

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

  // HF1. This used to SHA-256 the WHOLE serialized file and compare that to the governed approval
  // digest, on the reasoning that a digest over the parse would miss a field the loader ignored. Both
  // halves of that were wrong. The loader ignores nothing -- `parseSmokeConfig` is `.strict()` with a
  // closed key-path allow-list, so an extra field fails the config outright, above, before approval is
  // ever considered. And the governed digest is not a file digest at all: it commits to the approved
  // CONFIGURATION, canonically serialized WITHOUT `release.configDigest`, because a digest cannot be
  // an input to its own computation. The emitted file is necessarily larger than what was hashed,
  // precisely because it carries that hash inside itself.
  //
  // So the two numbers could never have matched, for the correct config or any other: the approved
  // payload is 709 canonical bytes hashing to the governed value, while the generator's own emitted
  // file is 888 pretty-printed bytes hashing to something else entirely. Preflight refused the
  // unmodified, correctly generated configuration.
  //
  // Two independent checks replace it, and BOTH are required because neither can see what the other
  // does:
  //
  //   1. Recomputation catches drift in an approved VALUE. Change `timeoutMs` and this fails, even if
  //      the file still claims the approved digest.
  //   2. The embedded comparison catches drift in the CLAIM about those values. Self-exclusion means
  //      recomputation is blind to `release.configDigest` by construction, so a tampered embedded
  //      digest would otherwise sail through.
  //
  // Checking only one of them is a hole. Checking the embedded value alone would be trusting the file
  // to grade itself.
  if (computeSmokeApprovalDigest(loaded.config) !== expectedDigest) {
    return fail('smoke-config-digest-mismatch');
  }
  if (loaded.config.release.configDigest !== expectedDigest) {
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
  //
  // HF4-R5: the requirement belongs to the TTY INGRESS, not to the run. Clipboard mode consumes no
  // stdin and prompts for nothing, so demanding an interactive terminal for it would gate on a fact
  // the run never uses — and would refuse a correctly-composed clipboard run for no reason. Absence
  // still means `tty`, so every pre-HF4-R5 caller reaches this check exactly as strictly as before.
  if ((input.credentialSource ?? DEFAULT_CREDENTIAL_SOURCE_MODE) === 'tty' && !input.interactive) {
    return fail('tty-unavailable');
  }
  return { ok: true };
}
