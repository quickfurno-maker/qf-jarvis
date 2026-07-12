/**
 * Who decided.
 *
 * Every authorization decision names its decider: a human, or a named and
 * versioned policy. There is no third option, and that absence is the point.
 *
 * **An agent cannot be represented here.** There is no `agent` variant and no
 * `system` variant, so a schema-valid approval decision attributed to Jarvis,
 * Kabir, Riya, Anisha, or Jitin **cannot be constructed**. This is not a rule
 * that review must remember to apply — it is a shape that does not exist. An
 * attempt to build one fails to parse, and fails to compile.
 *
 * "No agent self-approval, at any confidence, in any circumstance"
 * (docs/architecture/execution-governance.md §2) is therefore enforced by the
 * type system and by the validator, rather than by discipline.
 *
 * See docs/governance/security-principles.md §8 — auditable authorization.
 */

import { z } from 'zod';

import { entityReferenceSchema } from './entity-reference.js';
import { contractVersionSchema } from './identifiers.js';
import { machineTokenSchema } from './text.js';

/**
 * A named human, referenced opaquely through Core.
 *
 * The human is a Core entity — Core owns identity, and Core knows who is allowed
 * to decide what. Jarvis carries the reference, never the person.
 */
export const humanActorSchema = z.strictObject({
  actorType: z.literal('human'),
  actor: entityReferenceSchema,
});

/**
 * A named, versioned policy.
 *
 * A policy that authorizes automatically is attributable **exactly as a human
 * approver would be** — which policy, which version. Automation does not dilute
 * accountability; it relocates it to the person who approved the policy
 * (docs/governance/security-principles.md §8).
 *
 * The version is mandatory. "The policy allowed it" is not an audit record if
 * nobody can say which policy, as it stood when.
 */
export const policyActorSchema = z.strictObject({
  actorType: z.literal('policy'),
  policyId: machineTokenSchema,
  policyVersion: contractVersionSchema,
});

export const actorReferenceSchema = z.discriminatedUnion('actorType', [
  humanActorSchema,
  policyActorSchema,
]);

export type HumanActor = z.infer<typeof humanActorSchema>;
export type PolicyActor = z.infer<typeof policyActorSchema>;
export type ActorReference = z.infer<typeof actorReferenceSchema>;
