/**
 * The closed error vocabulary for Core-command construction (QFJ-M3, ADR-0056).
 *
 * Runtime decision OUTCOMES use the closed Core outcomes + {@link CoreAdapterReason}; this code is
 * raised only when building a command from an invalid request. A message is a fixed, repository-owned
 * string — never caller content, a subject reference, a secret, or a raw error.
 */
export const CORE_ADAPTER_ERROR_CODES = ['invalid-command'] as const;
export type CoreAdapterErrorCode = (typeof CORE_ADAPTER_ERROR_CODES)[number];

const MESSAGES: Readonly<Record<CoreAdapterErrorCode, string>> = Object.freeze({
  'invalid-command': 'A Core decision command is invalid.',
});

/** A bounded, content-free Core-adapter construction error. */
export class CoreAdapterError extends Error {
  public readonly code: CoreAdapterErrorCode;

  public constructor(code: CoreAdapterErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CoreAdapterError';
    this.code = code;
    Object.freeze(this);
  }
}
