/**
 * Target canonical events: governance, privacy, and communication authority.
 *
 * Seven events. These are the ones that make the *rules themselves* observable — which
 * policy is in force, what was erased and from where, what Core's Communication Core
 * actually decided, and when a machine handed a conversation to a person.
 *
 * ### Why an erasure needs to be an event, not just an API call
 *
 * A deletion that happens silently is a deletion nobody can prove happened. Emitting it
 * as a canonical event means the erasure lands in the same replayable, correlatable,
 * auditable stream as everything else — so "did we honour that request, and where did it
 * reach?" is answered by reading the log rather than by trusting a subsystem's word.
 *
 * It also means **Jarvis finds out**. Derived read models, recommendation evidence, and
 * agent memory all have to react to an erasure, and they can only react to something they
 * can see. An erasure delivered as a private call to Core is an erasure the derived stores
 * never hear about — which is precisely the failure mode where a deleted client's data
 * lives on inside an agent's memory forever.
 *
 * ### `qf.communication.authorization-recorded` is the consent boundary made visible
 *
 * It carries Core's decision — authorized, or rejected with a machine-readable reason,
 * including `recipient-opted-out`, `consent-withdrawn`, `do-not-contact`, `suppressed`,
 * and `stop-received`. **This is the event that proves a refusal happened**, which is what
 * turns "Core enforces consent" from an architectural assertion into an auditable fact.
 */

import { z } from 'zod';

import { communicationAuthorizationV1Schema } from '../communications/communication-authorization.js';
import { communicationResultV1Schema } from '../communications/communication-result.js';
import { defineCanonicalEvent } from './canonical-event.js';
import { erasureRecordV1Schema, erasureRequestV1Schema } from '../privacy/erasure.js';
import {
  humanHandoffRecordV1Schema,
  humanHandoffRequestV1Schema,
} from '../communications/human-handoff.js';
import { policyVersionChangeV1Schema } from '../governance/policy-version.js';

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * Somebody exercised a deletion or anonymisation right.
 *
 * The obligation starts here. Every derived store named in `scopes` must act on it.
 */
export const privacyErasureRequestedEventV1Schema = defineCanonicalEvent(
  'qf.privacy.erasure-requested',
  1,
  z.strictObject({ request: erasureRequestV1Schema }),
);
export type PrivacyErasureRequestedEventV1 = z.infer<typeof privacyErasureRequestedEventV1Schema>;

/**
 * Core recorded how far the erasure actually got.
 *
 * Note that this event can legitimately say **`partial`**. An erasure record that could
 * only say "done" would force a lie in the one situation where the truth is legally
 * material (see privacy/erasure.ts).
 */
export const privacyErasureRecordedEventV1Schema = defineCanonicalEvent(
  'qf.privacy.erasure-recorded',
  1,
  z.strictObject({ record: erasureRecordV1Schema }),
);
export type PrivacyErasureRecordedEventV1 = z.infer<typeof privacyErasureRecordedEventV1Schema>;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * A governing policy changed.
 *
 * Every `policyVersion` recorded on every other contract in this package resolves against
 * this event. Without it, "the agent observed policy v3" names nothing.
 */
export const policyVersionChangedEventV1Schema = defineCanonicalEvent(
  'qf.policy.version-changed',
  1,
  z.strictObject({ change: policyVersionChangeV1Schema }),
);
export type PolicyVersionChangedEventV1 = z.infer<typeof policyVersionChangedEventV1Schema>;

// ---------------------------------------------------------------------------
// Communication authority
// ---------------------------------------------------------------------------

/**
 * The QuickFurno Communication Core decided whether a communication may happen.
 *
 * Authorized, or rejected — and a rejection carries *why*, which is how an opt-out becomes
 * a countable, auditable, provable refusal rather than a message that simply never went.
 */
export const communicationAuthorizationRecordedEventV1Schema = defineCanonicalEvent(
  'qf.communication.authorization-recorded',
  1,
  z.strictObject({ authorization: communicationAuthorizationV1Schema }),
);
export type CommunicationAuthorizationRecordedEventV1 = z.infer<
  typeof communicationAuthorizationRecordedEventV1Schema
>;

/**
 * Core recorded what actually happened to a communication.
 *
 * `provider-accepted` is not `delivered`, and `indeterminate` is not success. Both are
 * enforced inside `CommunicationResultV1`, so neither can reach a consumer through this
 * event (see communications/communication-result.ts).
 */
export const communicationResultRecordedEventV1Schema = defineCanonicalEvent(
  'qf.communication.result-recorded',
  1,
  z.strictObject({ result: communicationResultV1Schema }),
);
export type CommunicationResultRecordedEventV1 = z.infer<
  typeof communicationResultRecordedEventV1Schema
>;

// ---------------------------------------------------------------------------
// Human handoff
// ---------------------------------------------------------------------------

/** A machine asked for a person. It has not got one yet. */
export const communicationHumanHandoffRequestedEventV1Schema = defineCanonicalEvent(
  'qf.communication.human-handoff-requested',
  1,
  z.strictObject({ request: humanHandoffRequestV1Schema }),
);
export type CommunicationHumanHandoffRequestedEventV1 = z.infer<
  typeof communicationHumanHandoffRequestedEventV1Schema
>;

/** A person actually picked it up. Only this event may render as "a human has it". */
export const communicationHumanHandoffRecordedEventV1Schema = defineCanonicalEvent(
  'qf.communication.human-handoff-recorded',
  1,
  z.strictObject({ record: humanHandoffRecordV1Schema }),
);
export type CommunicationHumanHandoffRecordedEventV1 = z.infer<
  typeof communicationHumanHandoffRecordedEventV1Schema
>;
