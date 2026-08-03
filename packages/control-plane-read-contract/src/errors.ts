/**
 * Normalized failure taxonomy (JOS-01B, ADR-0086).
 *
 * A read contract that throws whatever the validator produced leaks its internals to every client,
 * and — once this is served over HTTP in JOS-01C — to anyone who can reach the route. Zod's issue
 * text names paths, received values and expected types; that is excellent for a developer and
 * exactly wrong for a response body.
 *
 * So callers get a closed set of codes and a fixed message. The underlying issues are retained on
 * `issues` for a server-side log, and deliberately not part of the code or the message.
 */
export const CONTROL_PLANE_READ_CONTRACT_ERROR_CODES = [
  /** The payload is not an object, or is not parseable JSON at all. */
  'snapshot-malformed',
  /** The payload parsed but does not satisfy the V1 contract. */
  'snapshot-invalid',
  /** The payload declares a contract version this package does not speak. */
  'contract-version-unsupported',
] as const;

export type ControlPlaneReadContractErrorCode =
  (typeof CONTROL_PLANE_READ_CONTRACT_ERROR_CODES)[number];

/** One issue, reduced to a path and a stable message. Never the received value. */
export interface ControlPlaneReadContractIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * The only error this package throws.
 *
 * `message` is derived from the code alone, so it is safe to surface anywhere. Anything that could
 * describe the payload lives on `issues`, which a caller must choose to read.
 */
export class ControlPlaneReadContractError extends Error {
  public readonly code: ControlPlaneReadContractErrorCode;
  public readonly issues: readonly ControlPlaneReadContractIssue[];

  public constructor(
    code: ControlPlaneReadContractErrorCode,
    issues: readonly ControlPlaneReadContractIssue[] = [],
  ) {
    super(MESSAGES[code]);
    this.name = 'ControlPlaneReadContractError';
    this.code = code;
    this.issues = Object.freeze([...issues]);
    Object.freeze(this);
  }
}

const MESSAGES: Readonly<Record<ControlPlaneReadContractErrorCode, string>> = Object.freeze({
  'snapshot-malformed': 'control-plane snapshot is malformed',
  'snapshot-invalid': 'control-plane snapshot does not satisfy contract v1',
  'contract-version-unsupported': 'control-plane snapshot declares an unsupported contract version',
});
