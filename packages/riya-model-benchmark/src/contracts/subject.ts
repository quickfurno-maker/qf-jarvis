/**
 * The benchmark SUBJECT: exactly what was measured (RMB-A).
 *
 * ### The release identity is reused, not restated
 *
 * `release` is `ProviderReleaseRef` from `@qf-jarvis/model-evaluation`, validated through that
 * package's own `createProviderReleaseRef`. This package defines no `modelId`, no `providerId`, no
 * `executionClass` of its own.
 *
 * That matters more than it looks. Benchmark evidence and safety evidence exist to be read together —
 * "this release cleared safety AND runs at this latency" — and two packages with their own idea of
 * what names a release would eventually disagree by a character, at which point neither statement can
 * be joined to the other and both become anecdotes. One grammar, one owner.
 *
 * ### What a subject also pins
 *
 * A release alone does not determine performance. The prompt bytes change how many tokens are
 * processed, the config changes decode behaviour, and the capability/knowledge/policy revisions change
 * what the system around the model does. All of them are named by DIGEST or REVISION here, never by
 * content — a benchmark artifact must be safe to commit, and prompt text is not.
 */
import { createProviderReleaseRef, isExactGovernedIdentity } from '@qf-jarvis/model-evaluation';
import type { ProviderReleaseRef } from '@qf-jarvis/model-evaluation';
import { z } from 'zod';

import { RiyaBenchmarkError } from './errors.js';

export interface RiyaBenchmarkSubjectV1 {
  readonly version: 1;
  /** Reused wholesale from the generic evaluation package. Never redefined here. */
  readonly release: ProviderReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  /** WHICH BYTES were exercised. A family and a version name a label, not a prompt. */
  readonly promptDigest: string;
  readonly capabilityProfileRef: string;
  readonly knowledgeRevision?: string;
  readonly policyContractRevision: string;
}

export type RiyaBenchmarkSubjectInput = RiyaBenchmarkSubjectV1;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** Full SHA-256, lowercase. The repo's strongest content identity; this does not weaken it. */
export const SHA256_HEX = /^[0-9a-f]{64}$/u;

const subjectSchema = z
  .object({
    version: z.literal(1),
    // Re-proved by its owning constructor below; a second schema here would be the fork this file
    // exists to avoid.
    release: z.unknown(),
    promptFamily: IDENTIFIER,
    promptVersion: z.int().min(1).max(1_000_000),
    promptDigest: z.string().regex(SHA256_HEX),
    capabilityProfileRef: IDENTIFIER,
    knowledgeRevision: IDENTIFIER.optional(),
    policyContractRevision: IDENTIFIER,
  })
  .strict();

/**
 * Validate and freeze a benchmark subject. Throws `SUBJECT_INVALID`.
 *
 * The release is re-proved through `createProviderReleaseRef`, so a malformed or wildcard release
 * fails here exactly as it would fail an evaluation binding.
 */
export function createRiyaBenchmarkSubject(
  input: RiyaBenchmarkSubjectInput,
): RiyaBenchmarkSubjectV1 {
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('SUBJECT_INVALID');
  }
  let release: ProviderReleaseRef;
  try {
    release = createProviderReleaseRef(input.release);
  } catch {
    // The evaluation package's own refusal, translated to this package's closed vocabulary. A caller
    // of the benchmark package should never have to catch an EvaluationError.
    throw new RiyaBenchmarkError('SUBJECT_INVALID');
  }
  const s = parsed.data;

  // Release exactness came free with the release constructor. The refs this contract owns needed the
  // same rule: `promptFamily: 'latest'` names a prompt that changes under the evidence, which is the
  // identical failure the release rule prevents, one field along. The predicate is IMPORTED rather
  // than restated, so there is one definition of "exact" across safety and benchmark evidence.
  for (const ref of [
    s.promptFamily,
    s.capabilityProfileRef,
    s.policyContractRevision,
    ...(s.knowledgeRevision === undefined ? [] : [s.knowledgeRevision]),
  ]) {
    if (!isExactGovernedIdentity(ref)) {
      throw new RiyaBenchmarkError('SUBJECT_INVALID');
    }
  }

  return Object.freeze({
    version: 1 as const,
    release,
    promptFamily: s.promptFamily,
    promptVersion: s.promptVersion,
    promptDigest: s.promptDigest,
    ...(s.knowledgeRevision === undefined ? {} : { knowledgeRevision: s.knowledgeRevision }),
    capabilityProfileRef: s.capabilityProfileRef,
    policyContractRevision: s.policyContractRevision,
  });
}
