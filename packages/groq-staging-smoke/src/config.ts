/**
 * The strict, closed, NON-SECRET smoke configuration (QFJ-S1A, ADR-0061 §D).
 *
 * The configuration file names the exact approved release, bounds, approval references, prompt identity,
 * schema revision, and timeout — and nothing else. It carries the credential REFERENCE IDENTIFIER only;
 * it can never carry a key, because a key-shaped field is rejected outright rather than ignored.
 *
 * Two rejection layers, in this order:
 *   1. a FORBIDDEN-FIELD scan over every key present in the raw document. Any key outside the closed
 *      allow-list is a failure; a key whose normalized name looks like a secret, a prompt/output body,
 *      or a URL/header/provider option is the more specific `smoke-config-secret-field-forbidden`. The
 *      offending value is NEVER read, echoed, or included in the outcome.
 *   2. a strict zod parse that pins every remaining value: exact identifiers with no wildcard/`latest`,
 *      `HOSTED` execution, `HOSTED_ALLOWED` data class, literal `true` for strict-schema support and the
 *      data-controls attestation, bounded token budgets, a bounded timeout, and a prompt family/version/
 *      schema revision that must equal the constants compiled into `synthetic-prompt.ts`.
 *
 * Reading the file is the only filesystem access in this package, and it is read-only.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import {
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from './synthetic-prompt.js';

/** The bounded timeout window a single synthetic request may be given. */
export const MIN_SMOKE_TIMEOUT_MS = 1_000;
export const MAX_SMOKE_TIMEOUT_MS = 120_000;

const WILDCARDS: ReadonlySet<string> = new Set(['*', 'latest']);

const EXACT_REFERENCE = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => !WILDCARDS.has(value.toLowerCase()), {
    message: 'A wildcard or `latest` reference is not an exact reference.',
  });

const DIGEST_REFERENCE = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => !WILDCARDS.has(value.toLowerCase()), {
    message: 'A wildcard or `latest` digest is not an exact digest.',
  });

const smokeReleaseSchema = z
  .object({
    releaseId: EXACT_REFERENCE,
    providerId: EXACT_REFERENCE,
    modelId: EXACT_REFERENCE,
    modelVersion: EXACT_REFERENCE,
    executionClass: z.literal('HOSTED'),
    configDigest: DIGEST_REFERENCE,
  })
  .strict();

const smokeConfigSchema = z
  .object({
    /** The OPAQUE credential reference — a secret NAME/VERSION identifier, never the key value. */
    credentialReference: EXACT_REFERENCE,
    release: smokeReleaseSchema,
    dataClass: z.literal('HOSTED_ALLOWED'),
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(4_096),
    /** Strict structured output is mandatory on the smoke path — it is never downgraded. */
    supportsStrictJsonSchema: z.literal(true),
    capabilityProfileRef: EXACT_REFERENCE,
    evaluationRef: EXACT_REFERENCE,
    dataControlsAttestationRef: EXACT_REFERENCE,
    /** The ZDR/data-controls attestation must be positive, or the gateway binding fails closed. */
    dataControlsAttested: z.literal(true),
    /** Must equal the compiled-in prompt identity — a configuration cannot point at another prompt. */
    promptFamily: z.literal(SMOKE_PROMPT_FAMILY),
    promptVersion: z.literal(SMOKE_PROMPT_VERSION),
    schemaRevision: z.literal(SMOKE_SCHEMA_REVISION),
    timeoutMs: z.int().min(MIN_SMOKE_TIMEOUT_MS).max(MAX_SMOKE_TIMEOUT_MS),
  })
  .strict();

/** The validated, frozen smoke configuration. */
export type SmokeConfig = z.infer<typeof smokeConfigSchema>;

/**
 * The closed allow-list of key paths. Anything else present in the document is rejected; nothing is
 * silently dropped. `release.*` is the only nesting the configuration has.
 */
const ALLOWED_KEY_PATHS: ReadonlySet<string> = new Set([
  'credentialReference',
  'release',
  'release.releaseId',
  'release.providerId',
  'release.modelId',
  'release.modelVersion',
  'release.executionClass',
  'release.configDigest',
  'dataClass',
  'maxInputTokens',
  'maxCompletionTokens',
  'supportsStrictJsonSchema',
  'capabilityProfileRef',
  'evaluationRef',
  'dataControlsAttestationRef',
  'dataControlsAttested',
  'promptFamily',
  'promptVersion',
  'schemaRevision',
  'timeoutMs',
]);

/**
 * Normalized fragments that mark a key as belonging to a FORBIDDEN field class. Checked ONLY against
 * keys that already failed the allow-list, so legitimate names such as `credentialReference` and
 * `promptFamily` can never trip them.
 *
 * Three classes, one code: material that must never sit in a configuration file — a credential, a
 * prompt/message/output body, or anything that could redirect or reshape the request.
 */
const FORBIDDEN_KEY_FRAGMENTS: readonly string[] = [
  // Credential material.
  'key',
  'secret',
  'token',
  'password',
  'passphrase',
  'auth',
  'bearer',
  'credential',
  'signature',
  // Prompt / message / output bodies.
  'prompt',
  'message',
  'content',
  'text',
  'system',
  'instruction',
  'output',
  'completion',
  'response',
  'transcript',
  'history',
  // Endpoint / header / arbitrary provider options.
  'url',
  'uri',
  'endpoint',
  'origin',
  'host',
  'header',
  'proxy',
  'basepath',
  'temperature',
  'topp',
  'topk',
  'seed',
  'tool',
  'logprob',
  'logitbias',
  'stream',
  'penalty',
  'stop',
  // Subject / client / vendor identity.
  'phone',
  'subject',
  'client',
  'vendor',
  'email',
  'msisdn',
  'whatsapp',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The result of validating a configuration. Carries no value from the rejected document. */
export type SmokeConfigResult =
  | { readonly ok: true; readonly config: SmokeConfig }
  | {
      readonly ok: false;
      readonly reason: 'smoke-config-invalid' | 'smoke-config-secret-field-forbidden';
    };

const MAX_CONFIG_BYTES = 64 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk every key in the raw document and classify it. Returns `undefined` when every key is allowed.
 * Values are never inspected here — only key names — so nothing sensitive is read on the reject path.
 */
function findForbiddenKey(
  raw: Record<string, unknown>,
  prefix = '',
  depth = 0,
): 'smoke-config-invalid' | 'smoke-config-secret-field-forbidden' | undefined {
  if (depth > 1) {
    return 'smoke-config-invalid';
  }
  for (const key of Object.keys(raw)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (!ALLOWED_KEY_PATHS.has(path)) {
      const normalized = normalizeKey(key);
      return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
        ? 'smoke-config-secret-field-forbidden'
        : 'smoke-config-invalid';
    }
    const child = raw[key];
    if (isPlainObject(child)) {
      const nested = findForbiddenKey(child, path, depth + 1);
      if (nested !== undefined) {
        return nested;
      }
    }
  }
  return undefined;
}

/** Validate an already-parsed configuration document. Pure — no filesystem, no clock, no network. */
export function parseSmokeConfig(raw: unknown): SmokeConfigResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  const forbidden = findForbiddenKey(raw);
  if (forbidden !== undefined) {
    return { ok: false, reason: forbidden };
  }
  const parsed = smokeConfigSchema.safeParse(raw);
  if (!parsed.success) {
    // The zod issue list can quote offending VALUES, so it is deliberately discarded.
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  return { ok: true, config: Object.freeze(parsed.data) };
}

/**
 * Read and validate the configuration file. The ONLY filesystem access in this package, and read-only.
 * A missing/unreadable/oversized/non-JSON file is `smoke-config-invalid` — the underlying cause is never
 * surfaced, because a filesystem error message can quote a path an operator did not intend to publish.
 */
export function loadSmokeConfig(configPath: string): SmokeConfigResult {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  if (text.length > MAX_CONFIG_BYTES) {
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'smoke-config-invalid' };
  }
  return parseSmokeConfig(raw);
}
