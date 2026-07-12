/**
 * Human handoff: the request, and the record.
 *
 * A governed communication reached a point where a machine should stop. The client asked
 * something nobody scripted; the vendor is angry; the conversation turned into a
 * complaint. `human-handoff-required` is one of the eighteen authoritative communication
 * states, and these two contracts are how it is asked for and how it is closed.
 *
 * ### Handoff is an escalation, not a failure
 *
 * It is worth stating plainly, because a system that treats handoff as a failure metric
 * will optimise it away — and the way you optimise away "a human was needed" is by not
 * noticing that a human was needed. The reason codes here are meant to be *counted and
 * looked at*: a rising handoff rate on a particular purpose is a signal that the
 * automation is out of its depth, which is exactly the thing we would want to know before
 * a founder finds out from a customer.
 *
 * ### A handoff request is not a handoff
 *
 * The record is what says a human actually picked it up. Until then, the conversation is
 * *waiting*, and a UI that renders "handed off" on the strength of the request is telling
 * the founder somebody is handling it when nobody is. Same disease as rendering
 * `delivered` on `provider-accepted`, and the same cure: two contracts, and the second
 * one is Core's.
 */

import { z } from 'zod';

import { communicationIdSchema, correlationIdSchema } from '../common/identifiers.js';
import { agentIdSchema, qfJarvisSchema, quickfurnoCoreSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { humanActorSchema } from '../common/actor.js';
import { prioritySchema } from '../recommendations/recommendation.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const HUMAN_HANDOFF_REQUEST_CONTRACT_VERSION = 1;
export const HUMAN_HANDOFF_RECORD_CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// The request — a machine saying "stop, get a person"
// ---------------------------------------------------------------------------

export const humanHandoffRequestV1Schema = z.strictObject({
  contractVersion: z.literal(HUMAN_HANDOFF_REQUEST_CONTRACT_VERSION),

  communicationId: communicationIdSchema,

  /** Jarvis asks for a human. It does not appoint one. */
  producingSystem: qfJarvisSchema,
  requestingAgent: agentIdSchema,
  requestingAgentVersion: machineTokenSchema,

  requestedAt: utcTimestampSchema,

  /** Why a machine should stop here. Counted, so a rising rate is visible. */
  reasonCode: reasonCodeSchema,
  priority: prioritySchema,

  summary: boundedText(TEXT_LIMITS.summary),

  correlationId: correlationIdSchema,
});

export type HumanHandoffRequestV1 = z.infer<typeof humanHandoffRequestV1Schema>;

// ---------------------------------------------------------------------------
// The record — a person actually picked it up
// ---------------------------------------------------------------------------

/** How the handoff resolved. `not-accepted` is honest and must remain expressible. */
export const HANDOFF_OUTCOMES = ['accepted', 'resolved', 'not-accepted'] as const;

export const handoffOutcomeSchema = z.enum(HANDOFF_OUTCOMES);
export type HandoffOutcome = z.infer<typeof handoffOutcomeSchema>;

export const humanHandoffRecordV1Schema = z.strictObject({
  contractVersion: z.literal(HUMAN_HANDOFF_RECORD_CONTRACT_VERSION),

  communicationId: communicationIdSchema,

  /** Core records that a human took it. Recording is what makes it true. */
  issuer: quickfurnoCoreSchema,

  /** A human. Not a policy, and not another agent — the entire point was to get a person. */
  handledBy: humanActorSchema,
  recordedAt: utcTimestampSchema,

  outcome: handoffOutcomeSchema,

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export type HumanHandoffRecordV1 = z.infer<typeof humanHandoffRecordV1Schema>;
