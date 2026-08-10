/**
 * The closed error vocabulary of the Riya intelligence dataset (RID-F1, ADR-0107).
 *
 * A message is a fixed repository-owned string chosen from the code. It never carries caller
 * content, and that matters more here than almost anywhere else in the repository: the inputs this
 * package validates are conversation text and, in the failure cases, the exact secrets and personal
 * identifiers the privacy firewall exists to reject. An error that quoted the match would take the
 * one string nobody should retain and put it in a stack trace, a CI log and a terminal scrollback.
 *
 * So a privacy finding reports WHERE (a trajectory id, a turn or fact ref) and WHAT KIND (a closed
 * code) — never the value.
 */
export const RIYA_DATASET_ERROR_CODES = [
  'invalid-trajectory',
  'invalid-turn',
  'invalid-review',
  'invalid-manifest',
  'invalid-protected-index',
  'invalid-release-policy',
  'manifest-digest-invalid',
  'duplicate-trajectory',
  'lineage-split-violation',
  'exact-cross-split-duplicate',
  'near-cross-split-duplicate',
  'p10-exact-leakage',
  'p10-near-leakage',
  'privacy-violation',
  'unsupported-business-fact',
  'insufficient-review',
  'coverage-failure',
  'release-binding-invalid',
  'dataset-not-eligible',
  'invalid-jsonl',
] as const;
export type RiyaDatasetErrorCode = (typeof RIYA_DATASET_ERROR_CODES)[number];

const RIYA_DATASET_ERROR_MESSAGES: Readonly<Record<RiyaDatasetErrorCode, string>> = Object.freeze({
  'invalid-trajectory': 'A Riya intelligence trajectory is invalid.',
  'invalid-turn': 'A Riya intelligence trajectory turn is invalid.',
  'invalid-review': 'A Riya training review is invalid.',
  'invalid-manifest': 'A Riya intelligence dataset manifest is invalid.',
  'invalid-protected-index': 'A protected evaluation text index is invalid.',
  'invalid-release-policy': 'A Riya intelligence dataset release policy is invalid.',
  'manifest-digest-invalid': 'The Riya intelligence dataset manifest digest does not validate.',
  'duplicate-trajectory': 'A duplicate trajectory id was supplied.',
  'lineage-split-violation': 'A lineage root appears in more than one dataset split.',
  'exact-cross-split-duplicate': 'An identical conversation appears in more than one split.',
  'near-cross-split-duplicate': 'A near-duplicate conversation crosses a split boundary.',
  'p10-exact-leakage': 'A trajectory reproduces protected RWC-P10 evaluation content.',
  'p10-near-leakage': 'A trajectory closely resembles protected RWC-P10 evaluation content.',
  'privacy-violation': 'A trajectory contains prohibited personal or secret content.',
  'unsupported-business-fact':
    'An assistant turn asserts a business fact with no earlier authoritative support.',
  'insufficient-review': 'A trajectory does not carry the reviews its risk class requires.',
  'coverage-failure': 'The dataset does not meet its coverage policy.',
  'release-binding-invalid':
    'The release attestation is not bound to the dataset, policy or protected corpus it claims.',
  'dataset-not-eligible': 'Release evidence is blocked because the dataset is not eligible.',
  'invalid-jsonl': 'A Riya intelligence trajectory JSONL line is invalid.',
});

/**
 * A bounded, content-free dataset error.
 *
 * It exposes only a closed `code` and a fixed message. It never carries conversation text, a
 * reviewer identity, a matched secret, a personal identifier or a digest preimage.
 */
export class RiyaDatasetError extends Error {
  public readonly code: RiyaDatasetErrorCode;

  public constructor(code: RiyaDatasetErrorCode) {
    super(RIYA_DATASET_ERROR_MESSAGES[code]);
    this.name = 'RiyaDatasetError';
    this.code = code;
    Object.freeze(this);
  }
}
