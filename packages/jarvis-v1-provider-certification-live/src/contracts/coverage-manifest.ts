/**
 * The sanitized JF-5B result model and the SIX-BINDING coverage manifest.
 *
 * ### Content-free by construction
 *
 * A certification receipt is read by people who are not entitled to the conversation. So a case record
 * carries identities, counts, timings and closed outcome tokens — and a DIGEST of the output rather
 * than the output. The raw model text lives only in the private external run directory.
 *
 * ### The manifest authorizes nothing, and cannot be made to
 *
 * There is no `productionApproval` field, no provider-level approved boolean and no activation token,
 * and a spec asserts their absence rather than trusting that nobody adds one. A dimension that has not
 * been human-reviewed says `REVIEW_PENDING`; it never says `PASS`. JF-5C ingests reviews, records the
 * owner acceptance of the Nara data-controls posture, and performs the seal.
 */
import { z } from 'zod';

import {
  ACTIVE_CERTIFICATION_PROVIDERS,
  CERTIFIED_AGENTS,
  CERTIFIED_PROVIDERS,
  JF5B_PROVIDER_MODE,
} from '../releases/jf5b-releases.js';

/** Whether a case needed a model at all. A pre-model case is certified with zero network calls. */
export const EXECUTION_LAYERS = ['PRE_MODEL_REQUIRED', 'MODEL_REQUIRED'] as const;
export type ExecutionLayer = (typeof EXECUTION_LAYERS)[number];

/** The language a turn was conducted in. Measured, not assumed. */
export const LANGUAGE_MODES = ['EN', 'HI', 'HINGLISH'] as const;
export type LanguageMode = (typeof LANGUAGE_MODES)[number];

/** Closed case outcomes. `REVIEW_PENDING` is a real state and is never rounded up to `PASS`. */
export const CASE_OUTCOMES = ['PASS', 'FAIL', 'INCONCLUSIVE', 'REVIEW_PENDING', 'NOT_RUN'] as const;
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:\-/]+$/);
const DIGEST = z.string().regex(/^[0-9a-f]{64}$/);

const caseSchema = z
  .object({
    runId: IDENTIFIER,
    caseId: IDENTIFIER,
    caseVersion: z.int().min(1).max(1_000_000),
    agent: z.enum(CERTIFIED_AGENTS),
    agentScope: z.enum(['CLIENT', 'VENDOR', 'PROSPECT']),
    provider: z.enum(CERTIFIED_PROVIDERS),
    releaseId: IDENTIFIER,
    modelId: z.string().min(1).max(256),
    modelVersion: IDENTIFIER,
    configDigest: IDENTIFIER,
    promptFamily: IDENTIFIER,
    promptVersion: z.int().min(1).max(1_000_000),
    promptDigest: DIGEST,
    evaluationSuiteId: IDENTIFIER,
    fixtureManifestId: IDENTIFIER,
    languageMode: z.enum(LANGUAGE_MODES),
    executionLayer: z.enum(EXECUTION_LAYERS),
    providerAttempts: z.int().min(0).max(8),
    networkCalls: z.int().min(0).max(8),
    fallbackCount: z.int().min(0).max(4),
    // Same-provider retry is ZERO everywhere in this repository. The field exists so a receipt STATES
    // it rather than leaving a reader to assume it, and the schema refuses any other value.
    retryCount: z.literal(0),
    latencyMs: z.int().min(0).max(600_000),
    promptTokens: z.int().min(0).max(10_000_000).optional(),
    completionTokens: z.int().min(0).max(10_000_000).optional(),
    totalTokens: z.int().min(0).max(10_000_000).optional(),
    structuredOutputValid: z.boolean(),
    citationsValid: z.boolean().optional(),
    outcome: z.enum(CASE_OUTCOMES),
    reason: IDENTIFIER.optional(),
    providerErrorClass: IDENTIFIER.optional(),
    /** A digest of the raw output, which lives in the private external bundle. Never the output. */
    outputDigest: DIGEST.optional(),
  })
  .strict();

export type LiveCaseRecord = z.infer<typeof caseSchema>;

/** Validate and freeze one case record. Throws rather than repairing. */
export function createLiveCaseRecord(input: unknown): LiveCaseRecord {
  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('invalid-live-case-record');
  }
  return Object.freeze({ ...parsed.data });
}

const entrySchema = z
  .object({
    provider: z.enum(CERTIFIED_PROVIDERS),
    agent: z.enum(CERTIFIED_AGENTS),
    releaseId: IDENTIFIER,
    modelId: z.string().min(1).max(256),
    modelVersion: IDENTIFIER,
    configDigest: IDENTIFIER,
    promptFamily: IDENTIFIER,
    promptVersion: z.int().min(1).max(1_000_000),
    promptDigest: DIGEST,
    evaluationSuiteId: IDENTIFIER,
    evaluationSuiteVersion: z.int().min(1).max(1_000_000),
    redTeamSuiteId: IDENTIFIER,
    fixtureManifestId: IDENTIFIER,
    /** Exact governed knowledge release when this certification exercised hybrid grounding. */
    knowledgeRevision: IDENTIFIER.optional(),
    liveRunId: IDENTIFIER,
    /** A digest over the exact case set executed, so a later reader can prove what was covered. */
    caseSetDigest: DIGEST,
    resultDigest: DIGEST,
    safety: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_RUN']),
    qualityReview: z.enum(['REVIEW_PENDING', 'REVIEW_COMPLETE', 'NOT_RUN']),
    languageCounts: z
      .object({ EN: z.int().min(0), HI: z.int().min(0), HINGLISH: z.int().min(0) })
      .strict(),
    /** A digest REFERENCE to the private bundle. Never its contents. */
    reviewBundleDigest: DIGEST.optional(),
  })
  .strict();

const manifestCommon = {
  runId: IDENTIFIER,
  /** The exact repository head the operator ran at. */
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  createdAt: z.string().min(1).max(64),
  dataControlsRefs: z.array(IDENTIFIER).min(1).max(8),
} as const;

/** Historical dual-provider manifest. Readable for audit, never newly production-authorizing. */
const manifestV1Schema = z
  .object({
    manifestVersion: z.literal(1),
    ...manifestCommon,
    entries: z.array(entrySchema).length(6),
  })
  .strict();

/** Current owner posture: Groq only, exactly three prompt-scoped bindings. */
const manifestV2Schema = z
  .object({
    manifestVersion: z.literal(2),
    providerMode: z.literal(JF5B_PROVIDER_MODE),
    ...manifestCommon,
    entries: z.array(entrySchema).length(3),
  })
  .strict();

const manifestSchema = z.discriminatedUnion('manifestVersion', [
  manifestV1Schema,
  manifestV2Schema,
]);

export type Jf5bCoverageManifest = z.infer<typeof manifestSchema>;

/**
 * Validate either historical v1 (Groq+Nara) or current v2 (Groq-only) coverage.
 *
 * The provider roster is derived from the manifest version, never from whatever entries happened to
 * arrive. v2 therefore cannot smuggle a Nara row into a Groq-only production claim.
 */
export function createJf5bCoverageManifest(input: unknown): Jf5bCoverageManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('invalid-coverage-manifest');
  }
  const providers =
    parsed.data.manifestVersion === 2 ? ACTIVE_CERTIFICATION_PROVIDERS : CERTIFIED_PROVIDERS;
  const seen = new Set<string>();
  for (const entry of parsed.data.entries) {
    if (!providers.includes(entry.provider as never)) {
      throw new Error('invalid-coverage-manifest');
    }
    const key = `${entry.provider}/${entry.agent}`;
    if (seen.has(key)) {
      throw new Error('invalid-coverage-manifest');
    }
    seen.add(key);
  }
  for (const provider of providers) {
    for (const agent of CERTIFIED_AGENTS) {
      if (!seen.has(`${provider}/${agent}`)) {
        throw new Error('invalid-coverage-manifest');
      }
    }
  }
  // If a manifest carries a knowledge revision, it is exact and consistent across every entry. Old
  // manifests may carry none; a partial/mixed/floating corpus claim is never accepted.
  const revisions = parsed.data.entries.flatMap((entry) =>
    entry.knowledgeRevision === undefined ? [] : [entry.knowledgeRevision],
  );
  if (
    revisions.some((revision) => revision.toLowerCase() === 'latest' || revision.includes('*')) ||
    (revisions.length > 0 &&
      (revisions.length !== parsed.data.entries.length || new Set(revisions).size !== 1))
  ) {
    throw new Error('invalid-coverage-manifest');
  }

  // Distinct prompt digests per provider: three agents, three reviewed bodies. A manifest whose three
  // entries for one provider shared a digest would be exactly the "one prompt stands in for three"
  // shortcut, wearing the shape of full coverage.
  for (const provider of providers) {
    const digests = parsed.data.entries
      .filter((entry) => entry.provider === provider)
      .map((entry) => entry.promptDigest);
    if (new Set(digests).size !== CERTIFIED_AGENTS.length) {
      throw new Error('invalid-coverage-manifest');
    }
  }
  return Object.freeze({
    ...parsed.data,
    entries: Object.freeze(parsed.data.entries.map((entry) => Object.freeze({ ...entry }))),
  }) as Jf5bCoverageManifest;
}

/** Is this manifest complete enough for JF-5C to seal? Reports what is missing; decides nothing. */
export function manifestReadiness(manifest: Jf5bCoverageManifest): {
  readonly allSafetyPassed: boolean;
  readonly reviewsPending: number;
} {
  return Object.freeze({
    allSafetyPassed: manifest.entries.every((entry) => entry.safety === 'PASS'),
    reviewsPending: manifest.entries.filter((entry) => entry.qualityReview === 'REVIEW_PENDING')
      .length,
  });
}
