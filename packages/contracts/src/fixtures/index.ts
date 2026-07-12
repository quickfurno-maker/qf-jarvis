/**
 * Fixtures.
 *
 * Exported from the package so that future phases — the event backbone, the
 * coordination layer, the agents — can build against the same payloads the
 * contracts are tested with, rather than inventing their own and drifting.
 *
 * Contains no real client, vendor, employee, phone, email, address, token, or
 * provider data, and never may.
 *
 * `valid.ts` and `invalid.ts` compose the revised contracts' fixtures from
 * `target-valid.ts` and `target-invalid.ts`, so the tables exported here are complete:
 * `VALID_FIXTURES`, `VALID_EVENT_FIXTURES`, and `INVALID_FIXTURES` each cover both the
 * original lifecycle contracts and the revised ones.
 */

export * from './valid.js';
export * from './invalid.js';
export * from './target-valid.js';
export * from './target-invalid.js';
