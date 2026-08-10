/**
 * The deterministic privacy and secret firewall (RID-F1, ADR-0107 §22).
 *
 * ### Deterministic, and deliberately so
 *
 * No named-entity model, no probabilistic classifier, no external service. Three reasons, and the
 * third is the one that decides it.
 *
 * A model would make this package invoke a model, which is the single thing RID-F1 is built not to
 * do. A probabilistic gate would be non-deterministic, so the same corpus could pass on Tuesday and
 * fail on Thursday. And a gate that is sometimes wrong in the permissive direction is a gate that
 * lets a real phone number into a training corpus — after which it is in the weights, and there is
 * no delete.
 *
 * A regex list is narrower than an NER model. It is also auditable, repeatable, and impossible to
 * argue with, and the corpus it guards is synthetic anyway: everything below should be catching an
 * accident, not a genuine customer record.
 *
 * ### It never echoes what it found
 *
 * A finding names the trajectory, the turn or fact, and a closed kind. It does NOT carry the matched
 * text. Reporting "found API key `sk-live-…`" would take the one string nobody should retain and
 * write it into a CI log, a terminal scrollback and a reviewer's clipboard.
 *
 * ### What is allowed on purpose
 *
 * Ordinary domain numbers pass: `3BHK`, `10 lakh`, `1200 sq ft`, `8x10`, a two-digit quantity, a
 * city name. An interiors corpus is full of those, and a scanner that flagged them would be turned
 * off within a week.
 */

/** The closed kinds of prohibited content. */
export const RIYA_DATASET_PRIVACY_FINDING_KINDS = [
  'EMAIL',
  'PHONE_NUMBER',
  'API_KEY',
  'BEARER_TOKEN',
  'SERVICE_ROLE_TOKEN',
  'PRIVATE_KEY',
  'UPI_HANDLE',
  'URL',
  'PRODUCTION_DOMAIN',
] as const;
export type RiyaDatasetPrivacyFindingKind = (typeof RIYA_DATASET_PRIVACY_FINDING_KINDS)[number];

/** Where a finding was. Never what it was. */
export interface RiyaDatasetPrivacyFinding {
  readonly kind: RiyaDatasetPrivacyFindingKind;
  /** A turn ref, a fact ref, or another opaque location the caller supplied. */
  readonly locationRef: string;
}

/**
 * The governed production names this repository already treats as real.
 *
 * Not domains with a TLD — the bare product names, because those are what leaks into an example
 * somebody wrote while looking at the real system.
 */
const PRODUCTION_NAMES: readonly string[] = Object.freeze(['quickfurno', 'onedecore']);

const PATTERNS: readonly (readonly [RiyaDatasetPrivacyFindingKind, RegExp])[] = Object.freeze([
  ['EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u],

  // A UPI handle is `name@provider` with NO dot-TLD, so the email pattern above misses it. Only the
  // well-known provider suffixes are matched, which is what "confidently detected" means here.
  [
    'UPI_HANDLE',
    /[A-Za-z0-9._-]{2,}@(?:upi|ybl|ibl|axl|paytm|okaxis|oksbi|okicici|okhdfcbank|apl|jupiteraxis)\b/u,
  ],

  // Indian mobile numbers, in the three shapes people actually type, plus any absurdly long digit
  // run. A five-plus-five split is included because `98765 43210` is the commonest written form.
  // `10 lakh`, `3BHK`, `1200 sq ft` and `8x10` are all far below these thresholds.
  ['PHONE_NUMBER', /\+\s?91[\s-]?\d{5}[\s-]?\d{5}/u],
  ['PHONE_NUMBER', /(?<!\d)[6-9]\d{9}(?!\d)/u],
  ['PHONE_NUMBER', /(?<!\d)\d{5}[\s-]\d{5}(?!\d)/u],
  ['PHONE_NUMBER', /(?<!\d)\d{11,}(?!\d)/u],

  ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ['BEARER_TOKEN', /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/iu],
  // A JWT: three dot-separated base64url segments beginning with the standard header prefix.
  ['BEARER_TOKEN', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u],
  ['SERVICE_ROLE_TOKEN', /\bservice[_-]?role\b/iu],
  ['SERVICE_ROLE_TOKEN', /\bSUPABASE_[A-Z_]*(?:KEY|SECRET|TOKEN)\b/u],
  ['API_KEY', /\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9]{12,}/u],
  [
    'API_KEY',
    /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]/iu,
  ],
  ['API_KEY', /\bgsk_[A-Za-z0-9]{12,}/u],

  ['URL', /https?:\/\/\S+/iu],
]);

/**
 * Scan one string. Returns the closed kinds found, sorted and deduplicated.
 *
 * The text itself is never returned, logged or attached to anything.
 */
export function scanTextForPrivacy(text: string): readonly RiyaDatasetPrivacyFindingKind[] {
  const found = new Set<RiyaDatasetPrivacyFindingKind>();
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(text)) {
      found.add(kind);
    }
  }
  const lowered = text.toLowerCase();
  for (const name of PRODUCTION_NAMES) {
    if (lowered.includes(name)) {
      found.add('PRODUCTION_DOMAIN');
    }
  }
  return Object.freeze([...found].sort());
}

/** Scan one located string and return findings bound to that location. */
export function scanLocated(
  locationRef: string,
  text: string,
): readonly RiyaDatasetPrivacyFinding[] {
  return Object.freeze(
    scanTextForPrivacy(text).map((kind) => Object.freeze({ kind, locationRef })),
  );
}
