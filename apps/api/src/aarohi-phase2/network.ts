export type AarohiPhase2HttpFetch = typeof fetch;

/**
 * The single Aarohi Phase 2 direct HTTP transport.
 *
 * Callers validate/allowlist endpoints and own bounded abort deadlines. This adapter performs exactly
 * one fetch attempt and has no config, credential, retry, logging, filesystem or business authority.
 */
export const aarohiPhase2HttpFetch: AarohiPhase2HttpFetch = async (input, init) =>
  fetch(input, init);
