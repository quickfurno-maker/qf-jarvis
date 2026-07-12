/**
 * Data classification and erasure state.
 *
 * Two concerns that recur across derived artifacts — agent memory, dataset
 * examples, learning records — and that must be stated rather than assumed.
 *
 * ### Classification
 *
 * A derived record must say what class of data it holds, because the retention
 * rule, the log rule, and the training rule all differ by class
 * (docs/governance/privacy-principles.md). A record that does not know what it is
 * holding cannot be governed.
 *
 * ### Erasure
 *
 * When QuickFurno Core deletes or anonymises a client or vendor, the deletion must
 * propagate into Jarvis derived views, identity references, and recommendation
 * evidence (docs/architecture/data-ownership.md).
 *
 * Every erasable derived artifact therefore carries its erasure state explicitly.
 * That is what makes propagation **checkable** rather than merely intended: a
 * record whose subject Core has erased, but which still reads `none`, is a
 * detectable defect rather than an invisible one.
 *
 * The propagation *mechanism* is Phase 11's work. Phase 2's contribution is to
 * make the state representable, so the mechanism has somewhere to write.
 */

import { z } from 'zod';

/**
 * What class of data an artifact holds.
 *
 * `personal` and `sensitive-personal` are the two that change behavior: they
 * shorten retention, forbid logging, and make training eligibility a decision
 * somebody has to make rather than a default.
 */
export const DATA_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'personal',
  'sensitive-personal',
] as const;

export const dataClassificationSchema = z.enum(DATA_CLASSIFICATIONS);
export type DataClassification = z.infer<typeof dataClassificationSchema>;

/**
 * Where an artifact stands with respect to erasure.
 *
 * `none` is the ordinary state. The others record that Core has asked for, or
 * completed, a deletion or an anonymisation that this artifact must reflect.
 */
export const ERASURE_STATES = [
  'none',
  'deletion-requested',
  'deleted',
  'anonymisation-requested',
  'anonymised',
] as const;

export const erasureStateSchema = z.enum(ERASURE_STATES);
export type ErasureState = z.infer<typeof erasureStateSchema>;

/**
 * What Core was asked to do: delete the record, or anonymise it.
 *
 * They are different obligations with different outcomes, and collapsing them is
 * how an "anonymised" record turns out to still be re-identifiable.
 */
export const ERASURE_TYPES = ['deletion', 'anonymisation'] as const;

export const erasureTypeSchema = z.enum(ERASURE_TYPES);
export type ErasureType = z.infer<typeof erasureTypeSchema>;

/**
 * How thoroughly personal data has been removed from a derived artifact.
 *
 * `not-minimised` exists so that an honest producer can say so. It is also the
 * value that makes a training-eligibility decision fail closed
 * (see learning/training-eligibility.ts).
 */
export const MINIMISATION_STATUSES = [
  'anonymised',
  'pseudonymised',
  'minimised',
  'not-minimised',
] as const;

export const minimisationStatusSchema = z.enum(MINIMISATION_STATUSES);
export type MinimisationStatus = z.infer<typeof minimisationStatusSchema>;
