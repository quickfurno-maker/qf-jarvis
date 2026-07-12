/**
 * Target canonical events: the vendor journey.
 *
 * Eleven events covering the complete vendor lifecycle that Anisha advises on —
 * registration, profile completion, verification, activation, performance, package
 * readiness, recharge opportunity, complaints, retention risk, and win-back.
 *
 * **These are target contracts. QuickFurno Core does not emit them today.**
 *
 * ### Anisha advises. She controls nothing.
 *
 * Every event here is a **fact Core recorded**, and every one of them is something Anisha
 * may *reason about* and *recommend on*. Not one of them is something she may cause.
 *
 * `qf.vendor.verification-requested` is Core recording that a verification was asked for.
 * It is not Anisha verifying a vendor. `qf.vendor.activated` is Core recording an
 * activation. It is not Anisha activating one. The distinction is invisible in the event
 * names and absolute in the architecture: **Anisha never controls verification,
 * activation, eligibility, ranking, packages, wallets, credits, money, or assignments**
 * (docs/architecture/responsibility-matrix.md).
 *
 * ### Money-adjacent events carry bands, never amounts
 *
 * `qf.vendor.recharge-opportunity-detected` and `qf.vendor.package-readiness-changed` are
 * the two events that sit closest to a vendor's money, and they are the two most likely
 * to be quietly widened later — "it would be so much more useful with the balance on it".
 *
 * They carry a **band**. No balance, no amount, no currency, no credit count.
 *
 * The reason is not squeamishness. Jarvis's view of a wallet is derived and
 * **non-authoritative** (data-ownership.md). A balance on this event would be a number
 * that is *wrong by construction* — stale the instant it is emitted — and its presence
 * would invite exactly one thing: somebody reasoning about how much money a real vendor
 * has, from a copy that nobody reconciles. Core owns the wallet. Anisha recommends a
 * recharge *conversation*; she never touches money.
 */

import { z } from 'zod';

import { defineCanonicalEvent } from './canonical-event.js';
import { observationPayload, qualitativeBandSchema } from './target-payloads.js';
import { machineTokenSchema } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';

/** A vendor began registering. Subject: the vendor. */
export const vendorRegistrationStartedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.registration-started',
  1,
  observationPayload({ registrationChannelCode: machineTokenSchema.optional() }),
);
export type VendorRegistrationStartedEventV1 = z.infer<
  typeof vendorRegistrationStartedEventV1Schema
>;

/**
 * The vendor finished their profile.
 *
 * `completeness` is a fraction, and it is the one number here that is safe: it is derived
 * from Core's own view of which fields are filled, it identifies nobody, and it is exactly
 * what an onboarding-funnel recommendation needs.
 */
export const vendorProfileCompletedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.profile-completed',
  1,
  observationPayload({ completeness: z.number().min(0).max(1).optional() }),
);
export type VendorProfileCompletedEventV1 = z.infer<typeof vendorProfileCompletedEventV1Schema>;

/** Core recorded that a verification was requested. Anisha does not verify. */
export const vendorVerificationRequestedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.verification-requested',
  1,
  observationPayload({}),
);
export type VendorVerificationRequestedEventV1 = z.infer<
  typeof vendorVerificationRequestedEventV1Schema
>;

/** Core activated the vendor. Anisha does not activate. */
export const vendorActivatedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.activated',
  1,
  observationPayload({}),
);
export type VendorActivatedEventV1 = z.infer<typeof vendorActivatedEventV1Schema>;

/** The vendor has gone quiet. `inactiveSinceAt` is when, not when we noticed. */
export const vendorInactivityDetectedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.inactivity-detected',
  1,
  observationPayload({ inactiveSinceAt: utcTimestampSchema }),
);
export type VendorInactivityDetectedEventV1 = z.infer<typeof vendorInactivityDetectedEventV1Schema>;

/**
 * The vendor's performance picture changed.
 *
 * A band, not a rank. **Anisha never controls ranking** — a ranking is an input to
 * assignment, assignment is Core's, and an agent that could move a vendor's rank could
 * move which vendors receive leads, which is the vendor's livelihood.
 */
export const vendorPerformanceUpdatedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.performance-updated',
  1,
  observationPayload({ performanceBand: qualitativeBandSchema }),
);
export type VendorPerformanceUpdatedEventV1 = z.infer<typeof vendorPerformanceUpdatedEventV1Schema>;

/** Package readiness moved. A band. No amounts, no credits, no money. */
export const vendorPackageReadinessChangedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.package-readiness-changed',
  1,
  observationPayload({ readinessBand: qualitativeBandSchema }),
);
export type VendorPackageReadinessChangedEventV1 = z.infer<
  typeof vendorPackageReadinessChangedEventV1Schema
>;

/**
 * A recharge conversation may be worth having.
 *
 * **A band. Never a balance, never an amount.** See the file header — this is the event
 * most likely to grow a money field later, and it must not.
 */
export const vendorRechargeOpportunityDetectedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.recharge-opportunity-detected',
  1,
  observationPayload({ opportunityBand: qualitativeBandSchema }),
);
export type VendorRechargeOpportunityDetectedEventV1 = z.infer<
  typeof vendorRechargeOpportunityDetectedEventV1Schema
>;

/** A complaint against or from the vendor. */
export const vendorComplaintRecordedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.complaint-recorded',
  1,
  observationPayload({ severity: qualitativeBandSchema }),
);
export type VendorComplaintRecordedEventV1 = z.infer<typeof vendorComplaintRecordedEventV1Schema>;

/** The vendor may be about to leave. */
export const vendorRetentionRiskDetectedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.retention-risk-detected',
  1,
  observationPayload({ riskBand: qualitativeBandSchema }),
);
export type VendorRetentionRiskDetectedEventV1 = z.infer<
  typeof vendorRetentionRiskDetectedEventV1Schema
>;

/** A departed vendor may be worth approaching again. */
export const vendorWinbackCandidateDetectedEventV1Schema = defineCanonicalEvent(
  'qf.vendor.winback-candidate-detected',
  1,
  observationPayload({ candidacyBand: qualitativeBandSchema }),
);
export type VendorWinbackCandidateDetectedEventV1 = z.infer<
  typeof vendorWinbackCandidateDetectedEventV1Schema
>;
