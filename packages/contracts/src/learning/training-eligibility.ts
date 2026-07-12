/**
 * TrainingEligibilityDecisionV1 — somebody decided this data may be trained on.
 *
 * **No data becomes training data automatically.** That sentence is the entire reason
 * this contract exists, and every field on it is in service of making the sentence
 * *enforceable* rather than aspirational.
 *
 * ### The default is no, and the shape makes "no" the cheap path
 *
 * There is no "eligible by default" state. There is no inferred eligibility, no
 * eligibility that follows from a classification, and no eligibility that a pipeline
 * can conclude for itself. Eligibility exists **only** as a record in which a named
 * human — or a named, versioned policy that a human approved — said yes, on a specific
 * date, for a specific purpose, against a specific provenance record.
 *
 * The failure mode being prevented is not malice. It is drift: a pipeline is written
 * that trains on "the good examples", the definition of good widens by one field, and
 * eighteen months later a model has been trained on client conversations that nobody
 * ever agreed to hand over. Nobody decided that. It happened because no decision was
 * ever *required*.
 *
 * ### Eligibility fails closed, and the validator enforces the conditions
 *
 * `eligible: true` is refused unless **all** of these hold:
 *
 * - the example's personal data has actually been dealt with (`minimisationStatus` is
 *   not `not-minimised`);
 * - provenance is complete — we know where every part of it came from;
 * - a purpose limitation is stated.
 *
 * And `eligible: false` **requires** a `rejectionReasonCode`, so that a refusal is a
 * fact somebody can count and query, not an absence somebody has to infer.
 *
 * ### Sensitive personal data is never eligible
 *
 * Not "eligible with care". Not "eligible with founder approval". There is no path
 * through this schema by which `sensitive-personal` data becomes training data, because
 * there is no legitimate one, and a field that permitted it would eventually be used
 * (docs/governance/privacy-principles.md).
 */

import { z } from 'zod';

import {
  correlationIdSchema,
  datasetExampleIdSchema,
  trainingEligibilityDecisionIdSchema,
} from '../common/identifiers.js';
import { actorReferenceSchema } from '../common/actor.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { dataClassificationSchema, minimisationStatusSchema } from '../common/classification.js';
import { policyReferenceSchema } from '../common/policy.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const TRAINING_ELIGIBILITY_DECISION_CONTRACT_VERSION = 1;

const trainingEligibilityShapeSchema = z.strictObject({
  trainingEligibilityDecisionId: trainingEligibilityDecisionIdSchema,
  contractVersion: z.literal(TRAINING_ELIGIBILITY_DECISION_CONTRACT_VERSION),

  /** The example this decision is about. Provenance first; eligibility second. */
  datasetExampleId: datasetExampleIdSchema,

  /**
   * The decision. There is no default, and no third value.
   *
   * A missing decision is not "not yet eligible" — it is the *absence of this record*,
   * which is how the system represents "nobody has said yes", which is the state
   * everything starts in and stays in until a human acts.
   */
  eligible: z.boolean(),

  /** A named human, or a named and versioned policy. Never an agent. */
  decidedBy: actorReferenceSchema,
  decidedAt: utcTimestampSchema,

  /** What the data actually is, restated at the point of decision. */
  dataClassification: dataClassificationSchema,
  minimisationStatus: minimisationStatusSchema,

  /** Do we know where all of it came from? `false` blocks eligibility outright. */
  provenanceComplete: z.boolean(),

  /** What it may be used for. Never "anything". */
  purposeLimitation: machineTokenSchema,

  /** Mandatory when not eligible. A refusal must be countable. */
  rejectionReasonCode: reasonCodeSchema.optional(),

  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export const trainingEligibilityDecisionV1Schema = trainingEligibilityShapeSchema.superRefine(
  (value, ctx) => {
    if (!value.eligible) {
      // A "no" that does not say why cannot be reviewed, counted, or appealed.
      if (value.rejectionReasonCode === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['rejectionReasonCode'],
          message: 'A decision that data is not eligible for training must record why',
        });
      }
      return;
    }

    // From here on: eligible === true. Every condition below must hold.

    if (value.rejectionReasonCode !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rejectionReasonCode'],
        message: 'An eligible decision must not carry a rejection reason',
      });
    }

    // Training on data whose personal content nobody has dealt with.
    if (value.minimisationStatus === 'not-minimised') {
      ctx.addIssue({
        code: 'custom',
        path: ['minimisationStatus'],
        message:
          'Data that has not been minimised, pseudonymised, or anonymised is not eligible for training. Minimisation is a precondition, not a follow-up task',
      });
    }

    // Training on data we cannot trace is training we cannot later undo.
    if (!value.provenanceComplete) {
      ctx.addIssue({
        code: 'custom',
        path: ['provenanceComplete'],
        message:
          'Data with incomplete provenance is not eligible for training. If we cannot say where it came from, we cannot honour a deletion request against it',
      });
    }

    // There is no careful way to do this.
    if (value.dataClassification === 'sensitive-personal') {
      ctx.addIssue({
        code: 'custom',
        path: ['dataClassification'],
        message: 'Sensitive personal data is never eligible for training, under any approval',
      });
    }
  },
);

export type TrainingEligibilityDecisionV1 = z.infer<typeof trainingEligibilityDecisionV1Schema>;
