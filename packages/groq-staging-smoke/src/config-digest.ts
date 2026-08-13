/**
 * The SEMANTIC approval digest of a parsed smoke configuration (QFJ-S1C, repaired in MVP-P2A.2 HF1).
 *
 * ### What this digest is, and what it is emphatically not
 *
 * It is the SHA-256 of the owner-approved CONFIGURATION — the values, canonicalised — and not of the
 * file those values happened to arrive in. Two files with different indentation, different key order
 * or a different trailing newline describe the SAME approved configuration, and they produce the same
 * digest here. That is the property the approval is about: an owner approved a configuration, not a
 * byte stream.
 *
 * ### The defect this repairs
 *
 * `preflightCore` used to SHA-256 the whole serialized file and compare that to the governed approval
 * digest. Those two numbers can never be equal, and not by accident: the approved payload is 709
 * canonical bytes hashing to `4f97ef1e…`, while the generator's emitted file is 888 pretty-printed
 * bytes hashing to `60bd0fa4…`. The file is larger precisely BECAUSE it carries the digest of the
 * payload inside itself. A live run against the correct, unmodified, generator-produced configuration
 * therefore failed preflight before reaching anything real.
 *
 * ### Self-exclusion is the whole design
 *
 * `release.configDigest` is omitted from the payload, because a digest cannot be an input to its own
 * computation. That omission has a consequence worth stating plainly: this function CANNOT detect a
 * tampered `release.configDigest`, and it is not supposed to. The embedded value is a separate claim
 * and gets its own separate equality check at the preflight. Neither check subsumes the other —
 * recomputation catches drift in an approved value, the embedded comparison catches drift in the
 * claim about that value, and a caller that runs only one of them has a hole.
 *
 * ### Why the payload is reconstructed rather than reused
 *
 * The shape below is rebuilt from the PARSED `SmokeConfig`, so what gets hashed is what the closed
 * schema actually admitted. An unapproved field cannot reach this function at all — `parseSmokeConfig`
 * is `.strict()` with a closed key-path allow-list and refuses the file first — so the digest never
 * has to defend against one.
 *
 * Pure and total: no filesystem, no clock, no network, no credential, no environment. The same
 * configuration always yields the same string.
 */
import { createHash } from 'node:crypto';

import type { SmokeConfig } from './config.js';

/**
 * Order two strings by Unicode CODE POINT.
 *
 * Deliberately not `sort()`'s default, which orders by UTF-16 code unit and disagrees outside the
 * BMP. Every approved key is ASCII, where the two agree — but the canonicalisation is SPECIFIED in
 * code points, so it is implemented in code points. A rule that merely happens to hold for today's
 * inputs is not the rule, and this must stay byte-identical to
 * `scripts/generate-groq-staging-smoke-config.mjs` forever.
 */
export function compareByCodePoint(a: string, b: string): number {
  // `Array.from` iterates by CODE POINT, exactly as the spread form did, without the string-spread
  // lint trip. The ordering rule is unchanged.
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const x = left[index]?.codePointAt(0) ?? 0;
    const y = right[index]?.codePointAt(0) ?? 0;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.length - right.length;
}

/**
 * Recursively sort object keys by code point. Array ORDER is preserved — reordering an array would
 * change what the configuration means, not merely how it is written.
 *
 * There are no arrays in the approved payload today. The branch exists anyway, because a
 * canonicalisation that is only correct for the current shape is a canonicalisation that breaks
 * silently the first time the shape grows.
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalise(item));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareByCodePoint)) {
      sorted[key] = canonicalise((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * The approved digest payload, rebuilt from a parsed configuration.
 *
 * Exported so a test can assert the exact field set rather than infer it from a hash, and so a
 * reviewer can read what is committed to without running anything.
 *
 * `release.configDigest` is ABSENT, and its absence is the point.
 */
export function smokeApprovalDigestPayload(config: SmokeConfig): Record<string, unknown> {
  return {
    capabilityProfileRef: config.capabilityProfileRef,
    credentialReference: config.credentialReference,
    dataClass: config.dataClass,
    dataControlsAttestationRef: config.dataControlsAttestationRef,
    dataControlsAttested: config.dataControlsAttested,
    evaluationRef: config.evaluationRef,
    maxCompletionTokens: config.maxCompletionTokens,
    maxInputTokens: config.maxInputTokens,
    promptFamily: config.promptFamily,
    promptVersion: config.promptVersion,
    release: {
      executionClass: config.release.executionClass,
      modelId: config.release.modelId,
      modelVersion: config.release.modelVersion,
      providerId: config.release.providerId,
      releaseId: config.release.releaseId,
    },
    schemaRevision: config.schemaRevision,
    supportsStrictJsonSchema: config.supportsStrictJsonSchema,
    timeoutMs: config.timeoutMs,
  };
}

/**
 * The canonical digest input: keys sorted by code point, arrays untouched, compact `JSON.stringify`.
 * UTF-8, no BOM, no trailing newline. 709 bytes for the currently approved configuration.
 */
export function canonicalSmokeApprovalJson(config: SmokeConfig): string {
  return JSON.stringify(canonicalise(smokeApprovalDigestPayload(config)));
}

/**
 * The 64-character lowercase hex SHA-256 of the approved CONFIGURATION.
 *
 * Named for what it commits to. It is not the file digest, and anything comparing it to file bytes
 * is asking a question with no true answer.
 */
export function computeSmokeApprovalDigest(config: SmokeConfig): string {
  return createHash('sha256')
    .update(Buffer.from(canonicalSmokeApprovalJson(config), 'utf8'))
    .digest('hex');
}
