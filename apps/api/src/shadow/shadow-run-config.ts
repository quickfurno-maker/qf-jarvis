/**
 * The closed, versioned non-secret SHADOW run configuration (QFJ-S2-E-B, ADR-0065 §5, §6).
 *
 * Everything an operator supplies for a controlled run, and nothing else. It carries NO credential, NO
 * prompt text, NO endpoint, NO header, NO retry count, NO fallback list, and NO tool. The model
 * identity lives here rather than in source, so `apps/api` hard-codes no live model id.
 *
 * Validation is strict and total: an unknown field is a refusal, not an ignored extra. Every check runs
 * BEFORE any credential read, so a misconfigured run never touches the secret.
 */
import { z } from 'zod';

/** Identifier grammar shared with the gateway's release/reference fields. */
const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** A provider model id may be namespaced (`vendor/model`); only this field uses the slash grammar. */
const MODEL_ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/);

/** A config digest is lowercase hex, wide enough to be a real digest. */
const DIGEST = z.string().regex(/^[0-9a-f]{8,128}$/);

/** The bounded per-attempt timeout an owner may authorise. */
export const MIN_SHADOW_TIMEOUT_MS = 1_000;
export const MAX_SHADOW_TIMEOUT_MS = 30_000;

/** Added to twice the per-attempt timeout to bound the whole run (ADR-0065 §13). */
export const HARD_DEADLINE_MARGIN_MS = 10_000;
export const MAX_HARD_DEADLINE_MS = 70_000;

/** Tokens that may never bind a release, a provider, or a reference. */
const WILDCARDS: ReadonlySet<string> = new Set(['*', 'latest']);

const releaseSchema = z
  .object({
    providerId: IDENTIFIER,
    releaseId: IDENTIFIER,
    configDigest: DIGEST,
  })
  .strict();

/**
 * The owner attestations. Every one must be literally `true`.
 *
 * These are claims a machine cannot verify offline — whether ZDR is enabled in the Groq console, whether
 * the key's permissions are scoped. Requiring the literal makes the operator state them, and makes a
 * missing attestation a refusal rather than a default.
 */
const attestationsSchema = z
  .object({
    zdrEnabled: z.literal(true),
    modelPermissionScoped: z.literal(true),
    syntheticPromptConfirmed: z.literal(true),
    outputDiscardConfirmed: z.literal(true),
    oneShotAuthorizationConfirmed: z.literal(true),
  })
  .strict();

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerAuthorizationRef: IDENTIFIER,
    runId: IDENTIFIER,
    rolloutId: IDENTIFIER,
    credentialReference: IDENTIFIER,
    stable: releaseSchema,
    candidate: releaseSchema,
    modelId: MODEL_ID,
    modelVersion: IDENTIFIER,
    capabilityProfileRef: IDENTIFIER,
    dataControlsAttestationRef: IDENTIFIER,
    executionClass: z.literal('HOSTED'),
    dataClass: z.literal('HOSTED_ALLOWED'),
    agentScope: z.literal('SYSTEM'),
    /** Must equal the source constant. Declared, never used as the source of the prompt. */
    promptId: IDENTIFIER,
    evidenceRef: IDENTIFIER,
    evidenceDigest: DIGEST,
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(1_000_000),
    timeoutMs: z.int().min(MIN_SHADOW_TIMEOUT_MS).max(MAX_SHADOW_TIMEOUT_MS),
    attestations: attestationsSchema,
  })
  .strict();

/** The validated, frozen run configuration. */
export type ShadowRunConfig = z.infer<typeof configSchema>;

/** Why a configuration was refused. Closed; never a path, a digest, or a field value. */
export type ShadowConfigRefusal =
  /** A field is missing, malformed, out of bounds, or unknown. */
  | 'config-schema-invalid'
  /** A release, provider, or reference identity is a wildcard or `latest`. */
  | 'config-wildcard-identity'
  /** Stable and candidate must differ in provider, release and config digest. */
  | 'config-identity-not-distinct'
  /** Stable and candidate must share model id, model version and capability profile. */
  | 'config-identity-not-shared'
  /** The declared prompt id is not the source constant. */
  | 'config-prompt-id-mismatch'
  /** The recomputed config digest does not match the digest the operator asserted. */
  | 'config-digest-mismatch';

export type ShadowConfigResult =
  | { readonly ok: true; readonly config: ShadowRunConfig }
  | { readonly ok: false; readonly reason: ShadowConfigRefusal };

function hasWildcard(value: string): boolean {
  return WILDCARDS.has(value.toLowerCase()) || value.includes('*');
}

/**
 * Canonicalise for digesting: recursive key sort, arrays in order.
 *
 * The same shape the repository already uses for `contentDigest`, restated locally so the config digest
 * does not depend on an evaluation-package internal.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

/** The canonical byte string a config digest is taken over. Exposed so a generator can reuse it. */
export function canonicalConfigPayload(config: ShadowRunConfig): string {
  return JSON.stringify(canonicalize(config));
}

/**
 * Validate a candidate configuration, then optionally match a caller-asserted digest.
 *
 * `expectedDigest` is a CLAIM: the digest is recomputed from the parsed config and compared. It is
 * never trusted, and a mismatch refuses before anything else happens.
 */
export function validateShadowRunConfig(
  candidate: unknown,
  options: {
    readonly expectedPromptId: string;
    readonly expectedDigest?: string;
    readonly digest: (canonical: string) => string;
  },
): ShadowConfigResult {
  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: 'config-schema-invalid' };
  }
  const config = parsed.data;

  const identities = [
    config.ownerAuthorizationRef,
    config.runId,
    config.rolloutId,
    config.credentialReference,
    config.stable.providerId,
    config.stable.releaseId,
    config.candidate.providerId,
    config.candidate.releaseId,
    config.modelId,
    config.modelVersion,
    config.capabilityProfileRef,
    config.dataControlsAttestationRef,
    config.evidenceRef,
  ];
  if (identities.some(hasWildcard)) {
    return { ok: false, reason: 'config-wildcard-identity' };
  }

  // Two distinct releases: the whole point of a shadow is that the candidate is not the stable one.
  if (
    config.stable.providerId === config.candidate.providerId ||
    config.stable.releaseId === config.candidate.releaseId ||
    config.stable.configDigest === config.candidate.configDigest
  ) {
    return { ok: false, reason: 'config-identity-not-distinct' };
  }
  // …but the same model, so the shadow compares configuration, not two different models.
  if (config.modelId.length === 0 || config.modelVersion.length === 0) {
    return { ok: false, reason: 'config-identity-not-shared' };
  }
  if (config.promptId !== options.expectedPromptId) {
    return { ok: false, reason: 'config-prompt-id-mismatch' };
  }
  if (config.maxCompletionTokens > config.maxInputTokens) {
    return { ok: false, reason: 'config-schema-invalid' };
  }

  if (options.expectedDigest !== undefined) {
    const recomputed = options.digest(canonicalConfigPayload(config));
    if (recomputed !== options.expectedDigest) {
      return { ok: false, reason: 'config-digest-mismatch' };
    }
  }

  return { ok: true, config: Object.freeze(config) };
}

/** The hard process deadline for a run: bounded, derived, and never operator-supplied (ADR-0065 §13). */
export function hardDeadlineMs(timeoutMs: number): number {
  return Math.min(2 * timeoutMs + HARD_DEADLINE_MARGIN_MS, MAX_HARD_DEADLINE_MS);
}
