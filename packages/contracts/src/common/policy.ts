/**
 * The policy a producer observed when it acted.
 *
 * Several contracts must record *which policy, as it stood when*. An approval
 * request states the policy it believed applied; a memory record states the policy
 * under which it was derived; a training-eligibility decision states the policy
 * that permitted it.
 *
 * This is not the same thing as a `PolicyActor` (see actor.ts). A `PolicyActor` is
 * a policy **deciding** something — an authority. A `PolicyReference` is a producer
 * **observing** a policy — a citation. Conflating them is how "the policy allowed
 * it" becomes an approval nobody made.
 *
 * The version is mandatory in both cases. "The policy allowed it" is not an audit
 * record if nobody can say which policy, as it stood when
 * (docs/governance/auditability-principles.md).
 */

import { z } from 'zod';

import { contractVersionSchema } from './identifiers.js';
import { machineTokenSchema } from './text.js';

/**
 * A citation of a named, versioned policy.
 *
 * Strict: a caller cannot attach the policy's *contents* alongside the reference
 * and turn a citation into a copy. Policy text lives in Core, and Core enforces it.
 */
export const policyReferenceSchema = z.strictObject({
  policyId: machineTokenSchema,
  policyVersion: contractVersionSchema,
});

export type PolicyReference = z.infer<typeof policyReferenceSchema>;
