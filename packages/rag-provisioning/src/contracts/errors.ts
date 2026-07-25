/**
 * The closed error vocabulary for RAG provisioning construction (QFJ-P04.05, ADR-0053).
 *
 * Runtime no-op OUTCOMES use {@link RagReason}; this code is raised only when a profile is built from
 * invalid input by the strict factory. A message is a fixed, repository-owned string — never caller
 * content, an endpoint, a secret, or arbitrary metadata.
 */
export const RAG_ERROR_CODES = ['invalid-profile'] as const;
export type RagErrorCode = (typeof RAG_ERROR_CODES)[number];

const RAG_ERROR_MESSAGES: Readonly<Record<RagErrorCode, string>> = Object.freeze({
  'invalid-profile': 'A RAG provisioning profile is invalid.',
});

/**
 * A bounded, content-free RAG provisioning error. It exposes only a closed `code` and a fixed
 * message; it never carries caller content, an endpoint, a secret, or arbitrary metadata.
 */
export class RagProvisioningError extends Error {
  public readonly code: RagErrorCode;

  public constructor(code: RagErrorCode) {
    super(RAG_ERROR_MESSAGES[code]);
    this.name = 'RagProvisioningError';
    this.code = code;
    Object.freeze(this);
  }
}
