/**
 * Event schema versions.
 *
 * **A schema version is not a package version.** They are different numbers that
 * change for different reasons, and treating them as one is how a consumer ends up
 * rejecting a payload because a dependency was bumped.
 *
 * - The **package version** describes this library.
 * - The **event version** describes a wire contract. It changes only when the
 *   contract changes, and `eventType` + `eventVersion` together identify exactly
 *   one shape, forever.
 *
 * See docs/contracts/versioning-and-compatibility.md and ADR-0013.
 */

import { contractVersionSchema } from '../common/identifiers.js';

/** A positive integer. Never zero, never a semver string, never a date. */
export const eventVersionSchema = contractVersionSchema;

export type EventVersion = number;
