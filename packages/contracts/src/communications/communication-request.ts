/**
 * CommunicationRequestV1 — asking for a communication. Not authorizing one, and
 * certainly not sending one.
 *
 * **This object cannot reach a person.** It names no phone number, no email
 * address, no provider, and no destination of any kind. It carries a *reference* to
 * a Core entity and a *reference* to an approved template, and Core resolves both —
 * against consent Core owns — at execution time, if it ever authorizes the request
 * at all.
 *
 * ### The three things it deliberately cannot say
 *
 * 1. **"This is allowed."** There is no consent field. No `hasConsent`, no
 *    `optedIn`, no `withinQuietHours`, no `suppressed`. Copying Core's consent state
 *    into a Jarvis contract turns a *courtesy check* into an *apparent permission* —
 *    and a stale copy of a permission is the most dangerous field in any system that
 *    reaches real people. **Unknown or stale consent is not permission.** The
 *    QuickFurno Communication Core decides, and the runtime re-validates at
 *    execution time (docs/architecture/communication-model.md).
 *
 * 2. **"This was sent."** There is no status, no `delivered`, no `sentAt`. A request
 *    is not a delivery, and `execution submitted` is not `provider accepted`, and
 *    neither is `delivered`. What happened is a `CommunicationResultV1`, recorded by
 *    Core (see communication-result.ts).
 *
 * 3. **"Send it to this number."** `recipient` is an opaque Core entity reference,
 *    and the entity-id character set excludes `@` and `+`, so an email address and
 *    an E.164 number will not parse. This is what degrades prompt injection from
 *    *"make the system call me"* to *"make the system suggest something odd to a
 *    human who can see the evidence"* (docs/governance/security-principles.md).
 *
 * ### Content is a reference, never a body
 *
 * `content` names an approved template or script and its version. There is **no
 * message body field**, because a free-text body is where a compromised agent — or
 * a careless one — writes something nobody approved, and where personal data
 * arrives by accident. Template variables are carried in a governed container that
 * refuses credentials, contact details, raw provider content, and model internals
 * by key *and* by value shape.
 *
 * The template registry itself lives in the QF Communications Runtime, on the far
 * side of the boundary. Phase 2 carries the reference; Phase 10 tests the runtime
 * that resolves it; Phase 11A is the first time one is ever resolved for a real
 * person.
 */

import { z } from 'zod';

import {
  communicationIdSchema,
  communicationRequestIdSchema,
  contractVersionSchema,
  correlationIdSchema,
  eventIdSchema,
} from '../common/identifiers.js';
import { agentIdSchema, qfJarvisSchema } from '../common/systems.js';
import { approvalLevelSchema, prioritySchema } from '../recommendations/recommendation.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { communicationChannelSchema, VOICE_CHANNEL } from './communication-channel.js';
import { createGovernedJsonObjectSchema } from '../common/governed-parameters.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { policyReferenceSchema } from '../common/policy.js';

export const COMMUNICATION_REQUEST_CONTRACT_VERSION = 1;

/** Approval levels that constitute explicit human approval. */
const HUMAN_APPROVAL_LEVELS = ['stronger-approval', 'founder'] as const;

/**
 * Template variables.
 *
 * Governed, so the "just put it in the variables" escape hatch is closed: a
 * recipient's name is Core's to substitute, not Jarvis's to supply. The always-
 * forbidden set (credentials, contacts, raw content, model internals) applies and
 * cannot be opted out of. `body`, `message`, and `text` are additionally refused,
 * because a message body smuggled in as a variable is still a message body.
 */
export const templateVariablesSchema = createGovernedJsonObjectSchema([
  'body',
  'messagebody',
  'message',
  'text',
  'content',
  'script',
]);

/**
 * What will be said, by reference to something already approved.
 *
 * A template for messaging, a script for voice. Both are versioned, because "the
 * template allowed it" is not an audit record if nobody can say which template, as
 * it stood when.
 */
export const contentReferenceSchema = z.strictObject({
  contentType: z.enum(['template', 'script']),
  templateId: machineTokenSchema,
  templateVersion: contractVersionSchema,
  variables: templateVariablesSchema.optional(),
});

export type ContentReference = z.infer<typeof contentReferenceSchema>;

/**
 * When the requester would like this to happen.
 *
 * A *request*, not a schedule. Core decides whether it happens at all, and quiet
 * hours are Core's to enforce — a requested time is not permission to use it.
 *
 * Note that a scheduled communication whose recipient withdraws consent before the
 * scheduled moment is **not sent**. That is enforced by re-validation at execution
 * time, not by anything in this record, and it is why this record may not carry a
 * consent snapshot: a snapshot taken now would be exactly the stale permission that
 * lets a withdrawn consent be ignored.
 */
export const requestedTimingSchema = z.discriminatedUnion('timingType', [
  z.strictObject({ timingType: z.literal('immediate') }),
  z.strictObject({
    timingType: z.literal('scheduled'),
    requestedAt: utcTimestampSchema,
  }),
  z.strictObject({
    timingType: z.literal('window'),
    notBefore: utcTimestampSchema,
    notAfter: utcTimestampSchema,
  }),
]);

export type RequestedTiming = z.infer<typeof requestedTimingSchema>;

const communicationRequestShapeSchema = z.strictObject({
  communicationRequestId: communicationRequestIdSchema,
  contractVersion: z.literal(COMMUNICATION_REQUEST_CONTRACT_VERSION),

  /** The governed communication this request opens. Its lifecycle is tracked separately. */
  communicationId: communicationIdSchema,

  /** Only QF Jarvis requests. It does not authorize, and it does not send. */
  producingSystem: qfJarvisSchema,
  requestingAgent: agentIdSchema,
  requestingAgentVersion: machineTokenSchema,

  /** Opaque Core reference. Never a phone number, never an email address. */
  recipient: entityReferenceSchema,

  /** The approved purpose this communication serves. Core validates it against policy. */
  purposeCode: reasonCodeSchema,

  /** Proposed, not chosen. Core may refuse the channel, or the whole request. */
  proposedChannel: communicationChannelSchema,

  content: contentReferenceSchema,
  requestedTiming: requestedTimingSchema,

  createdAt: utcTimestampSchema,
  /** Mandatory. An unanswered request expires; it is never sent late and never auto-approved. */
  expiresAt: utcTimestampSchema,

  priority: prioritySchema,

  /** The approval this would need. Never "none" — a communication always reaches a person. */
  requiredApproval: approvalLevelSchema,

  /** The policy Jarvis observed. A citation, never an authority. */
  policy: policyReferenceSchema,

  summary: boundedText(TEXT_LIMITS.summary),

  correlationId: correlationIdSchema,
  causationEventId: eventIdSchema.optional(),
});

export const communicationRequestV1Schema = communicationRequestShapeSchema.superRefine(
  (value, ctx) => {
    if (!isStrictlyBefore(value.createdAt, value.expiresAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be strictly after createdAt',
      });
    }

    // A communication reaches a real person. There is no such thing as one that
    // needs no approval — "never 'none' for anything that reaches a client, vendor,
    // or ad account" (agent-model.md).
    if (value.requiredApproval === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredApproval'],
        message:
          'A communication request reaches a real person, so requiredApproval must never be "none"',
      });
    }

    // "Production outbound voice requires explicit human approval on every call"
    // (docs/governance/automation-levels.md). Not a delegated approver, and never a
    // policy acting alone.
    if (
      value.proposedChannel === VOICE_CHANNEL &&
      !HUMAN_APPROVAL_LEVELS.some((level) => level === value.requiredApproval)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiredApproval'],
        message:
          'An outbound voice call requires explicit human approval on every call, so requiredApproval must be "stronger-approval" or "founder"',
      });
    }

    // A voice call is spoken from a script; a message is rendered from a template.
    // Crossing them means the thing that reaches the person is not the thing that
    // was reviewed.
    if (value.proposedChannel === VOICE_CHANNEL && value.content.contentType !== 'script') {
      ctx.addIssue({
        code: 'custom',
        path: ['content', 'contentType'],
        message: 'A voice communication must reference an approved script, not a message template',
      });
    }

    if (value.proposedChannel !== VOICE_CHANNEL && value.content.contentType !== 'template') {
      ctx.addIssue({
        code: 'custom',
        path: ['content', 'contentType'],
        message:
          'A messaging communication must reference an approved template, not a voice script',
      });
    }

    // A request that asks to be sent after it has expired asks for nothing.
    if (
      value.requestedTiming.timingType === 'scheduled' &&
      !isStrictlyBefore(value.requestedTiming.requestedAt, value.expiresAt)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['requestedTiming', 'requestedAt'],
        message: 'A scheduled time must fall strictly before the request expires',
      });
    }

    if (value.requestedTiming.timingType === 'window') {
      if (!isStrictlyBefore(value.requestedTiming.notBefore, value.requestedTiming.notAfter)) {
        ctx.addIssue({
          code: 'custom',
          path: ['requestedTiming', 'notAfter'],
          message: 'notAfter must be strictly after notBefore',
        });
      }

      if (!isStrictlyBefore(value.requestedTiming.notBefore, value.expiresAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['requestedTiming', 'notBefore'],
          message: 'A requested window must open strictly before the request expires',
        });
      }
    }
  },
);

export type CommunicationRequestV1 = z.infer<typeof communicationRequestV1Schema>;
