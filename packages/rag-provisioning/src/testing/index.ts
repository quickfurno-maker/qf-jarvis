/**
 * `@qf-jarvis/rag-provisioning/testing` — synthetic fixtures (QFJ-P04.05, ADR-0053).
 *
 * A SEPARATE subpath so synthetic profile inputs can never be mistaken for production config. No
 * endpoint, secret, key, token, or content.
 */
export { disabledProfileInput, provisionedNoOpProfileInput } from './fixtures.js';
