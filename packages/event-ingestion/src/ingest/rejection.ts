/**
 * The stable reasons validated-event **preparation** refuses an already-authentic raw body
 * (ADR-0030), and a genuinely **safe** internal representation of *why* the contract layer
 * refused it.
 *
 * ### Only three reasons, and they are pinned
 *
 * ADR-0020 §11 and ADR-0027 pin exactly three ingestion-stage rejection identifiers for this
 * slice — `contract-validation-failed`, `unknown-event-type`, `unknown-event-version`. They are
 * the whole set. Preparation never invents a fourth: a byte sequence that is not valid UTF-8,
 * carries a byte-order mark, or is not JSON is reported as `contract-validation-failed` (the
 * authentic bytes are not a decodable canonical event), **not** as a new reason code.
 * `duplicate-conflict` is deliberately absent — it belongs to a later, persistence-touching slice.
 *
 * ### Issues are OWNED here, not copied from the validator
 *
 * A `@qf-jarvis/contracts` (Zod) `ContractIssue` is **not** safe to forward. Its `message` may
 * embed the submitted `eventType@version` or a sender-controlled key name, and its `path` may
 * contain arbitrary sender-controlled key names (for example inside a governed-parameters
 * object). So this module never returns a validator-native message or an arbitrary path. Instead:
 *
 * - the **code** is mapped into a closed {@link SafeValidationIssueCode} vocabulary;
 * - the **message** is a fixed, repository-owned string chosen *only* from that code
 *   ({@link SAFE_VALIDATION_MESSAGES}) — never the validator's message;
 * - the **path** is rebuilt from validated segments ({@link safeStructuralPath}): only fixed
 *   canonical-envelope names from a closed allowlist survive, bounded numeric indexes remain, and
 *   every other segment becomes the opaque token `[field]`. A raw unknown key never appears, and
 *   depth and length are bounded.
 *
 * The mapped issues are then deterministically **sorted**, **deduplicated**, **capped** at
 * {@link MAX_REJECTION_ISSUES}, and **frozen** — with `issuesTruncated` recording whether unique
 * issues were dropped. *The validator that refuses a value must not then record it*
 * (ADR-0026, security-principles §5). This module performs no I/O and logs nothing.
 */

import type { ContractIssue } from '@qf-jarvis/contracts';

/**
 * The closed set of reasons validated-event preparation refuses an authentic raw body.
 * Stable, countable, and pinned by ADR-0020 §11 / ADR-0027 / ADR-0030.
 */
export const VALIDATED_EVENT_REJECTIONS = [
  'contract-validation-failed',
  'unknown-event-type',
  'unknown-event-version',
] as const;

/** One stable reason validated-event preparation refused an authentic raw body. */
export type ValidatedEventRejectionReason = (typeof VALIDATED_EVENT_REJECTIONS)[number];

/**
 * The closed vocabulary of safe issue codes. A rejection issue carries exactly one of these and
 * nothing validator-native. Stable and repository-owned.
 */
export const SAFE_VALIDATION_ISSUE_CODES = [
  'required',
  'invalid-type',
  'invalid-format',
  'invalid-value',
  'unknown-field',
  'constraint-violation',
  'malformed-body',
] as const;

/** One safe, repository-owned issue code. */
export type SafeValidationIssueCode = (typeof SAFE_VALIDATION_ISSUE_CODES)[number];

/** The one fixed, repository-owned message per safe code. Never a validator-native message. */
export const SAFE_VALIDATION_MESSAGES: Readonly<Record<SafeValidationIssueCode, string>> = {
  required: 'A required field is missing.',
  'invalid-type': 'A field has the wrong type.',
  'invalid-format': 'A field does not match its required format.',
  'invalid-value': 'A field has an unrecognised or invalid value.',
  'unknown-field': 'An unrecognised field is present.',
  'constraint-violation': 'A field violates a contract constraint.',
  'malformed-body': 'The authenticated body is not a decodable JSON canonical event.',
};

/**
 * A safe validation issue: a bounded, redacted structural path, a closed-vocabulary code, and a
 * fixed message derived from that code. It carries nothing sender-controlled.
 */
export interface SafeValidationIssue {
  readonly path: string;
  readonly code: SafeValidationIssueCode;
  readonly message: string;
}

/** At most this many unique issues survive into a rejection; the rest set `issuesTruncated`. */
export const MAX_REJECTION_ISSUES = 16;

/** Maximum number of path segments retained; deeper segments are dropped with a `…` marker. */
export const MAX_PATH_DEPTH = 8;

/** Each rebuilt path is truncated to this many characters (a `…` marks truncation). */
export const MAX_ISSUE_PATH_LENGTH = 100;

/** A numeric index with more digits than this is treated as opaque, not retained as an index. */
const MAX_INDEX_DIGITS = 6;

/**
 * The only path segments retained verbatim: the fixed canonical-envelope field names, and only at
 * the envelope's top level. Everything else — payload internals, and any sender-controlled key —
 * is opaque. Derived from ADR-0013's canonical envelope.
 */
const CANONICAL_ENVELOPE_FIELDS: ReadonlySet<string> = new Set([
  'eventId',
  'eventType',
  'eventVersion',
  'occurredAt',
  'emittedAt',
  'source',
  'subject',
  'correlationId',
  'causationEventId',
  'payload',
]);

/** The opaque token that stands in for any sender-controlled or non-envelope path segment. */
const OPAQUE_SEGMENT = '[field]';

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** A canonical non-negative integer index within the digit bound (no leading zeros beyond `0`). */
function isBoundedIndex(segment: string): boolean {
  if (segment.length === 0 || segment.length > MAX_INDEX_DIGITS) {
    return false;
  }
  return /^\d+$/.test(segment) && String(Number(segment)) === segment;
}

/**
 * Rebuild a safe structural path from a validator path string. Only a top-level canonical-envelope
 * name is retained verbatim; a bounded numeric index is kept as `[n]`; every other segment becomes
 * `[field]`. Depth and length are bounded, and a raw unknown key can never appear.
 */
export function safeStructuralPath(rawPath: string): string {
  if (rawPath === '') {
    return '';
  }
  const rawSegments = rawPath.split('.');
  const out: string[] = [];
  const depth = Math.min(rawSegments.length, MAX_PATH_DEPTH);
  for (let index = 0; index < depth; index += 1) {
    const segment = rawSegments[index];
    if (segment === undefined) {
      break;
    }
    if (index === 0 && CANONICAL_ENVELOPE_FIELDS.has(segment)) {
      out.push(segment);
    } else if (isBoundedIndex(segment)) {
      out.push(`[${segment}]`);
    } else {
      out.push(OPAQUE_SEGMENT);
    }
  }
  let path = out.join('.');
  if (rawSegments.length > MAX_PATH_DEPTH) {
    path += '.…';
  }
  return truncate(path, MAX_ISSUE_PATH_LENGTH);
}

/**
 * Map a validator-native issue code onto the closed safe vocabulary. Unrecognised codes fall
 * through to `invalid-value`, so the output is always from the closed set regardless of which
 * validator version produced the input.
 */
export function toSafeValidationCode(rawCode: string): SafeValidationIssueCode {
  switch (rawCode) {
    case 'invalid_type':
      return 'invalid-type';
    case 'unrecognized_keys':
    case 'unrecognized_key':
      return 'unknown-field';
    case 'invalid_format':
    case 'invalid_string':
      return 'invalid-format';
    case 'too_big':
    case 'too_small':
    case 'not_multiple_of':
    case 'size':
      return 'constraint-violation';
    case 'invalid_value':
    case 'invalid_enum_value':
    case 'invalid_literal':
    case 'invalid_union':
    case 'invalid_union_discriminator':
    case 'invalid_key':
    case 'invalid_element':
      return 'invalid-value';
    case 'custom':
      return 'constraint-violation';
    default:
      return 'invalid-value';
  }
}

/** Build one safe issue from a code and an already-safe path. Frozen. */
function safeIssue(code: SafeValidationIssueCode, path: string): SafeValidationIssue {
  return Object.freeze({ path, code, message: SAFE_VALIDATION_MESSAGES[code] });
}

/** Map one validator-native issue onto a safe issue: safe code, safe path, fixed message. */
function toSafeIssue(issue: ContractIssue): SafeValidationIssue {
  return safeIssue(toSafeValidationCode(issue.code), safeStructuralPath(issue.path));
}

function compareIssues(a: SafeValidationIssue, b: SafeValidationIssue): number {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.code !== b.code) {
    return a.code < b.code ? -1 : 1;
  }
  return 0;
}

/** A frozen list of safe issues, plus whether unique issues were dropped by the cap. */
export interface SafeValidationIssues {
  readonly issues: readonly SafeValidationIssue[];
  readonly issuesTruncated: boolean;
}

function freezeIssues(issues: readonly SafeValidationIssue[]): SafeValidationIssues {
  const frozen = Object.freeze(issues.map((issue) => Object.freeze(issue)));
  return Object.freeze({ issues: frozen, issuesTruncated: false });
}

/**
 * Map validator-native issues onto safe issues, then deterministically sort, deduplicate, cap at
 * {@link MAX_REJECTION_ISSUES}, and freeze. `issuesTruncated` is true iff more than the cap of
 * *unique* issues existed. A malicious `message`/`path` in the input cannot escape: the message is
 * dropped entirely and the path is rebuilt from an allowlist.
 */
export function mapSafeValidationIssues(issues: readonly ContractIssue[]): SafeValidationIssues {
  const unique = new Map<string, SafeValidationIssue>();
  for (const issue of issues) {
    const safe = toSafeIssue(issue);
    unique.set(`${safe.path} ${safe.code}`, safe);
  }
  const sorted = [...unique.values()].sort(compareIssues);
  const capped = sorted.slice(0, MAX_REJECTION_ISSUES);
  const frozen = Object.freeze(capped.map((issue) => Object.freeze(issue)));
  return Object.freeze({ issues: frozen, issuesTruncated: sorted.length > MAX_REJECTION_ISSUES });
}

/** The fixed, safe issue list for a body that could not be decoded to a JSON value. */
export function malformedBodyIssues(): SafeValidationIssues {
  return freezeIssues([safeIssue('malformed-body', '')]);
}

/**
 * The fixed, safe issue list for a body whose JSON contains a duplicate object member name at any
 * depth (Stage 3.3.5, ADR-0033). Exactly one `invalid-format` issue with an EMPTY path — the
 * duplicated name is sender-controlled and is never recorded, and neither is a field path or any
 * parser text. Reused through the existing `contract-validation-failed` reason, so no new reason
 * code and no migration are introduced.
 */
export function duplicateObjectKeyIssues(): SafeValidationIssues {
  return freezeIssues([safeIssue('invalid-format', '')]);
}

/**
 * The fixed, generic safe issue list for an unrecognised discriminant (unknown event type or
 * version). It names only the canonical-envelope field (`eventType` / `eventVersion`) and never
 * the submitted value.
 */
export function unrecognisedDiscriminantIssues(
  field: 'eventType' | 'eventVersion',
): SafeValidationIssues {
  return freezeIssues([safeIssue('invalid-value', field)]);
}
