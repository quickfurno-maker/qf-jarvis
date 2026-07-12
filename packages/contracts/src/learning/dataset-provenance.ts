/**
 * DatasetExampleProvenanceV1 — where a candidate training example came from.
 *
 * **A candidate. Not a training example.** Nothing in this contract makes anything
 * eligible for training; eligibility is a separate, explicit, human-or-policy decision
 * (see training-eligibility.ts). This record only answers *where did this come from,
 * and what is in it* — which are the two questions you must be able to answer before
 * anyone is allowed to say yes.
 *
 * ### Provenance is the thing that makes the decision possible
 *
 * A dataset example with no provenance cannot be governed. You cannot honour a deletion
 * request against it, because you do not know whose data it contains. You cannot assess
 * whether it is anonymised, because you do not know what it was derived from. You cannot
 * withdraw it when the client it came from leaves, because you cannot find it.
 *
 * So an example that cannot name its sources is not a low-quality example. It is an
 * **ungovernable** one, and this contract refuses to represent it: `sourceReferences`
 * is non-empty, always.
 *
 * ### Purpose limitation is mandatory
 *
 * `purposeLimitation` records what this example may be used *for*. Data gathered to
 * evaluate lead-quality scoring is not thereby available to train an outbound-messaging
 * model. "We already had the data" is the oldest bad argument in this field, and a
 * mandatory purpose code is what makes it answerable rather than persuasive
 * (docs/governance/privacy-principles.md).
 */

import { z } from 'zod';

import {
  correctionIdSchema,
  correlationIdSchema,
  datasetExampleIdSchema,
  evaluationIdSchema,
  eventIdSchema,
  outcomeFeedbackIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import {
  dataClassificationSchema,
  erasureStateSchema,
  minimisationStatusSchema,
} from '../common/classification.js';
import { machineTokenSchema } from '../common/text.js';
import { policyReferenceSchema } from '../common/policy.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const DATASET_EXAMPLE_PROVENANCE_CONTRACT_VERSION = 1;

export const MAX_SOURCE_REFERENCES = 50;

/**
 * What kind of artifact an example was derived from.
 *
 * Note that every one of these is something the system *recorded*, not something a
 * model *produced*. There is no `model-output` source kind, and its absence is
 * deliberate: training a model on its own prior output is how a system drifts away from
 * reality while its internal metrics keep improving.
 */
export const DATASET_SOURCE_KINDS = [
  'canonical-event',
  'recommendation',
  'human-correction',
  'recommendation-evaluation',
  'outcome-feedback',
] as const;

export const datasetSourceKindSchema = z.enum(DATASET_SOURCE_KINDS);
export type DatasetSourceKind = z.infer<typeof datasetSourceKindSchema>;

/** One thing this example was derived from, named by kind and by id. */
export const datasetSourceReferenceSchema = z.discriminatedUnion('sourceKind', [
  z.strictObject({ sourceKind: z.literal('canonical-event'), eventId: eventIdSchema }),
  z.strictObject({
    sourceKind: z.literal('recommendation'),
    recommendationId: recommendationIdSchema,
  }),
  z.strictObject({ sourceKind: z.literal('human-correction'), correctionId: correctionIdSchema }),
  z.strictObject({
    sourceKind: z.literal('recommendation-evaluation'),
    evaluationId: evaluationIdSchema,
  }),
  z.strictObject({
    sourceKind: z.literal('outcome-feedback'),
    outcomeFeedbackId: outcomeFeedbackIdSchema,
  }),
]);

export type DatasetSourceReference = z.infer<typeof datasetSourceReferenceSchema>;

export const datasetExampleProvenanceV1Schema = z.strictObject({
  datasetExampleId: datasetExampleIdSchema,
  contractVersion: z.literal(DATASET_EXAMPLE_PROVENANCE_CONTRACT_VERSION),

  /** Non-empty, always. An example that cannot name its sources is ungovernable. */
  sourceReferences: z.array(datasetSourceReferenceSchema).min(1).max(MAX_SOURCE_REFERENCES),

  /**
   * The corrections and evaluations that give this example its label.
   *
   * An example with no human signal behind it is an example whose "right answer" is
   * whatever the system already thought — which teaches the system to agree with itself.
   */
  correctionReferences: z.array(correctionIdSchema).max(MAX_SOURCE_REFERENCES),
  evaluationReferences: z.array(evaluationIdSchema).max(MAX_SOURCE_REFERENCES),

  /** What is actually in it, and how thoroughly personal data has been removed. */
  dataClassification: dataClassificationSchema,
  minimisationStatus: minimisationStatusSchema,

  /**
   * Where this example stands with respect to erasure. **Mandatory.**
   *
   * `dataset-examples` is an erasable scope (see privacy/erasure.ts), which means a
   * deletion request must reach in here — and a dataset example is the single easiest
   * place for an erasure to *silently miss*, because it has already been extracted,
   * transformed, and filed somewhere nobody thinks of as personal data.
   *
   * Requiring the field is what makes a missed erasure **detectable**: an example whose
   * subject Core has deleted, still reading `none`, is a defect somebody can find with a
   * query rather than a fact that quietly survives forever inside a training set.
   *
   * The same argument as agent memory, and for the same reason
   * (memory/agent-memory.ts, ADR-0016).
   */
  erasureState: erasureStateSchema,

  /** What this example may be used for. Not "anything we later think of". */
  purposeLimitation: machineTokenSchema,

  policy: policyReferenceSchema,

  createdAt: utcTimestampSchema,

  correlationId: correlationIdSchema,
});

export type DatasetExampleProvenanceV1 = z.infer<typeof datasetExampleProvenanceV1Schema>;
