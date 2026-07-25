/**
 * The closed error vocabulary for reply-plan/request construction (QFJ-M4, ADR-0057).
 *
 * Runtime drafting OUTCOMES use {@link ModelReplyAdapterReason}; this error is raised only when a plan
 * or a derived gateway request is structurally invalid at construction. A message is a fixed,
 * repository-owned string — never caller content, a subject reference, a secret, or a raw error.
 */
export const MODEL_REPLY_ADAPTER_ERROR_CODES = ['invalid-plan', 'invalid-request'] as const;
export type ModelReplyAdapterErrorCode = (typeof MODEL_REPLY_ADAPTER_ERROR_CODES)[number];

const MESSAGES: Readonly<Record<ModelReplyAdapterErrorCode, string>> = Object.freeze({
  'invalid-plan': 'A model reply plan is invalid.',
  'invalid-request': 'A derived model gateway request is invalid.',
});

/** A bounded, content-free model-reply-adapter construction error. */
export class ModelReplyAdapterError extends Error {
  public readonly code: ModelReplyAdapterErrorCode;

  public constructor(code: ModelReplyAdapterErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ModelReplyAdapterError';
    this.code = code;
    Object.freeze(this);
  }
}
