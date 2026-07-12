/**
 * Governed parameters: bounded JSON that also refuses to carry what it must never carry.
 *
 * Bounding a JSON field stops it being *large*. It does not stop it being
 * *dangerous*. `parameters` is where somebody will eventually put an API key, a
 * recipient's phone number, a raw call transcript, `{ "approved": true }`, or a
 * quiet `{ "autoRetry": true }` — not maliciously, but because it was the field
 * that happened to be open.
 *
 * So the open field is not open. Every governed JSON container is scanned for:
 *
 * - **Authority claims.** A recommendation's action may not say it was approved.
 *   Authority comes from Core, recorded in an approval decision — never from a
 *   key in a payload (ADR-0002).
 * - **Retry permission.** An intent may not smuggle permission to try again.
 *   "One execution intent may produce at most one provider call initiation"
 *   (execution-governance.md §7); a legitimate later attempt is a *new intent*,
 *   freshly validated against consent and attempt limits — not a flag.
 * - **Credentials.** Jarvis holds none, so a contract carrying one is either a
 *   bug or a breach (system-boundary.md).
 * - **Contact details.** Recipients are opaque Core references. Core resolves the
 *   phone number, at execution time, against consent it owns.
 * - **Raw provider and model content.** Transcripts, recordings, full webhook
 *   payloads, prompts, chain-of-thought (agent-model.md, privacy-principles.md).
 *
 * ### This scan fails closed, on purpose
 *
 * Key matching is normalized (case, hyphens, underscores stripped), so `api_key`,
 * `apiKey`, and `API-KEY` are one thing. Value matching looks for anything shaped
 * like an email address or a phone number.
 *
 * It will occasionally reject a legitimate value that merely *looks* like a phone
 * number — a long numeric reference, say. That is the intended trade. A contract
 * that wrongly refuses a value produces a validation error a developer fixes in
 * minutes; a contract that wrongly accepts a phone number produces a privacy
 * incident nobody notices. When those are the two options, fail closed. The
 * correct home for anything identifying a person is an opaque Core reference.
 */

import { z } from 'zod';

import {
  DEFAULT_JSON_LIMITS,
  inspectJsonValue,
  isPlainJsonObject,
  type JsonIssue,
  type JsonLimits,
  type JsonObject,
} from './bounded-json.js';

/** Keys that would assert an authority the artifact does not have. */
export const AUTHORITY_CLAIM_KEYS = [
  'approved',
  'authorized',
  'authorised',
  'sent',
  'executed',
  'completed',
  'delivered',
  'approval',
  'authorization',
  'authorisation',
] as const;

/** Keys that would grant a second external effect without a second decision. */
export const RETRY_PERMISSION_KEYS = [
  'retry',
  'retries',
  'autoretry',
  'retrypolicy',
  'maxattempts',
  'maxretries',
  'attempts',
  'redial',
  'resend',
] as const;

/** Keys that would carry a secret. Jarvis holds none. */
export const CREDENTIAL_KEYS = [
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'password',
  'passphrase',
  'secret',
  'clientsecret',
  'webhooksecret',
  'signingkey',
  'privatekey',
  'credential',
  'credentials',
  'bearer',
  'auth',
] as const;

/** Keys that would carry personal contact details. Core owns these. */
export const CONTACT_KEYS = [
  'phone',
  'phonenumber',
  'mobile',
  'mobilenumber',
  'msisdn',
  'whatsappnumber',
  'email',
  'emailaddress',
  'address',
  'postaladdress',
  'streetaddress',
] as const;

/** Keys that would carry raw provider or recording content. */
export const RAW_CONTENT_KEYS = [
  'transcript',
  'recording',
  'recordingurl',
  'audio',
  'audiourl',
  'rawpayload',
  'rawresponse',
  'rawrequest',
  'providerpayload',
  'webhookpayload',
] as const;

/** Keys that would carry model internals. Chain-of-thought is never stored. */
export const MODEL_INTERNAL_KEYS = [
  'prompt',
  'systemprompt',
  'chainofthought',
  'reasoningtrace',
  'hiddenreasoning',
  'thoughts',
  'modelresponse',
  'rawmodeloutput',
  'completion',
] as const;

/** Never permitted anywhere in a governed container. */
const ALWAYS_FORBIDDEN: readonly string[] = [
  ...CREDENTIAL_KEYS,
  ...CONTACT_KEYS,
  ...RAW_CONTENT_KEYS,
  ...MODEL_INTERNAL_KEYS,
];

/** An email address, anywhere in a string. */
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Something shaped like a phone number.
 *
 * Two rules, both chosen to avoid firing on an RFC 3339 timestamp or a UUID:
 * an explicit `+` followed by a run of digits, or a bare run of ten or more
 * consecutive digits. `2026-07-11T09:15:00Z` has no `+` and no digit run longer
 * than four, so it passes cleanly.
 */
const E164_PATTERN = /\+\d[\d\s().-]{6,}\d/;
const LONG_DIGIT_RUN_PATTERN = /\d{10,}/;

/** Normalize a key so `api_key`, `apiKey`, and `API-KEY` are all the same key. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

function looksLikeContactDetail(value: string): boolean {
  return (
    EMAIL_PATTERN.test(value) || E164_PATTERN.test(value) || LONG_DIGIT_RUN_PATTERN.test(value)
  );
}

/**
 * Walk a JSON value and report forbidden keys and contact-shaped values.
 *
 * The offending *value* is never reported — only its path and why. This is the
 * whole point: a validator that echoes the secret it rejected has logged it.
 */
/**
 * Scan for forbidden keys and contact-shaped values.
 *
 * `extraForbiddenKeys` is **additive**. The always-forbidden set — credentials,
 * contact details, raw provider content, model internals — applies on every call
 * and cannot be opted out of. A credential check that a caller can accidentally
 * disable by passing the wrong argument is not a check.
 */
export function inspectGovernedContent(
  value: unknown,
  extraForbiddenKeys: readonly string[] = [],
): readonly JsonIssue[] {
  const issues: JsonIssue[] = [];
  const forbidden = new Set([...ALWAYS_FORBIDDEN, ...extraForbiddenKeys].map(normalizeKey));
  scan(value, [], forbidden, issues, new Set<object>());
  return issues;
}

/**
 * `ancestors` is not optional, and it is not a micro-optimization.
 *
 * This scan runs over caller-supplied data. Without cycle detection, a cyclic
 * object does not fail validation — it **overflows the stack**, and the validator
 * that was supposed to refuse hostile input becomes the thing the hostile input
 * kills. A validator may reject anything, but it may never crash.
 */
function scan(
  value: unknown,
  path: readonly (string | number)[],
  forbidden: ReadonlySet<string>,
  issues: JsonIssue[],
  ancestors: Set<object>,
): void {
  if (typeof value === 'string') {
    if (looksLikeContactDetail(value)) {
      issues.push({
        path: [...path],
        code: 'governed.contact-detail',
        message:
          'Must not contain contact details. Reference the recipient by an opaque QuickFurno Core entity reference instead.',
      });
    }
    return;
  }

  if (typeof value !== 'object' || value === null) {
    return;
  }

  if (ancestors.has(value)) {
    // The cycle itself is reported by the bounded-JSON inspector. Here we simply
    // stop, rather than recursing forever.
    return;
  }
  ancestors.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scan(item, [...path, index], forbidden, issues, ancestors);
    });
    ancestors.delete(value);
    return;
  }

  const record: Record<string, unknown> = { ...value };
  for (const key of Object.keys(record)) {
    if (forbidden.has(normalizeKey(key))) {
      issues.push({
        path: [...path, key],
        code: 'governed.forbidden-key',
        message: `The key "${key}" may not appear in a contract. See docs/contracts/privacy-and-data-minimization.md.`,
      });
    }
    scan(record[key], [...path, key], forbidden, issues, ancestors);
  }

  ancestors.delete(value);
}

/**
 * A bounded JSON object that also refuses forbidden keys and contact-shaped values.
 *
 * `extraForbiddenKeys` layers container-specific rules on top of the always-
 * forbidden set: an action rejects authority claims, an execution intent
 * additionally rejects retry permission.
 */
export function createGovernedJsonObjectSchema(
  extraForbiddenKeys: readonly string[] = [],
  limits: JsonLimits = DEFAULT_JSON_LIMITS,
) {
  return z.custom<JsonObject>().superRefine((value, ctx) => {
    // `z.custom` accepts anything at runtime, which is the point at a trust
    // boundary. The static type is a promise about what survives, not about what
    // arrives.
    if (!isPlainJsonObject(value)) {
      ctx.addIssue({ code: 'custom', message: 'Must be a plain JSON object' });
      return;
    }

    for (const issue of inspectJsonValue(value, limits)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
    }

    for (const issue of inspectGovernedContent(value, extraForbiddenKeys)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
    }
  });
}

/**
 * Parameters of a proposed action, inside an inert recommendation.
 * An action may not claim it was approved, sent, or executed.
 */
export const actionParametersSchema = createGovernedJsonObjectSchema(AUTHORITY_CLAIM_KEYS);

/**
 * Parameters of an execution intent.
 * Additionally may not smuggle permission to retry — that would be a second
 * external effect authorized by a key rather than by a decision.
 */
export const executionParametersSchema = createGovernedJsonObjectSchema([
  ...AUTHORITY_CLAIM_KEYS,
  ...RETRY_PERMISSION_KEYS,
]);

/** Bounded, governed metadata on an execution result. */
export const resultMetadataSchema = createGovernedJsonObjectSchema();

/** A bounded, governed value carried by a piece of evidence. */
export const evidenceValueSchema = createGovernedJsonObjectSchema();
