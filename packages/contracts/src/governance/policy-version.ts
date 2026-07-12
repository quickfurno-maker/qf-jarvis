/**
 * PolicyVersionChangeV1 — a governing policy changed, and here is the diff's identity.
 *
 * Half the contracts in this package carry a `PolicyReference` — "this is the policy I
 * observed when I acted". That field is worthless unless the *other* half of the story
 * is recorded too: **when did the policy change, and to what?**
 *
 * Without this event, a `policyVersion: 3` on an approval request is a number nobody can
 * resolve. With it, an auditor can reconstruct which rules were in force at any instant,
 * and — more usefully — can explain a sudden change in system behavior by pointing at the
 * policy change that preceded it. "The agents started escalating everything last Tuesday"
 * is a mystery; "the money-related threshold changed on Tuesday" is a cause.
 *
 * ### Policy is Core's, and changing it is a human act
 *
 * `issuer` is the literal `quickfurno-core`, and `changedBy` is a human or a named,
 * versioned policy — never an agent. **Agents may not rewrite their prompts, their
 * policies, or their production configuration** (ADR-0016). An agent that could raise its
 * own approval threshold would be an agent that could authorize itself, one indirection
 * removed.
 *
 * ### Versions go forward
 *
 * `newVersion` must exceed `previousVersion`. A policy that goes backwards is either a
 * rollback that should be published as a *new, higher* version, or a bug that would make
 * every "which policy was in force?" query ambiguous — because two different rule sets
 * would share a version number.
 */

import { z } from 'zod';

import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { contractVersionSchema, correlationIdSchema } from '../common/identifiers.js';
import { actorReferenceSchema } from '../common/actor.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const POLICY_VERSION_CHANGE_CONTRACT_VERSION = 1;

const policyVersionChangeShapeSchema = z.strictObject({
  contractVersion: z.literal(POLICY_VERSION_CHANGE_CONTRACT_VERSION),

  /** Policy lives in Core, and Core publishes the change. */
  issuer: quickfurnoCoreSchema,

  policyId: machineTokenSchema,

  /** Absent on a policy's first publication. Present, and lower, on every change after. */
  previousVersion: contractVersionSchema.optional(),
  newVersion: contractVersionSchema,

  /** A human, or a named and versioned policy. Never an agent. */
  changedBy: actorReferenceSchema,
  changedAt: utcTimestampSchema,

  /** When the new version starts governing. May be later than when it was published. */
  effectiveFrom: utcTimestampSchema,

  reasonCode: reasonCodeSchema,
  summary: boundedText(TEXT_LIMITS.summary),
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export const policyVersionChangeV1Schema = policyVersionChangeShapeSchema.superRefine(
  (value, ctx) => {
    if (value.previousVersion !== undefined && value.newVersion <= value.previousVersion) {
      ctx.addIssue({
        code: 'custom',
        path: ['newVersion'],
        message:
          'A policy version must increase. Two different rule sets sharing a version number make "which policy was in force?" unanswerable — publish a rollback as a new, higher version',
      });
    }
  },
);

export type PolicyVersionChangeV1 = z.infer<typeof policyVersionChangeV1Schema>;
