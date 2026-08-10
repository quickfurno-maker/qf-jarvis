/**
 * A versioned dataset coverage policy (RID-F1, ADR-0107 §34).
 *
 * ### The generic core hard-codes no target
 *
 * There is no `360` in this file, and no 3 × 12 × 10 anywhere in production source. That number
 * belongs to the Gold V1 RELEASE policy, which a later slice will author as data. Baking it into the
 * validator would mean every future corpus — a targeted objection-only set, a Hinglish top-up, a
 * regression bundle — either failed a rule written for a different corpus or forced the rule to be
 * loosened for everybody.
 *
 * A policy is versioned so a dataset can name the coverage bar it was released against, and so
 * raising the bar later is a visible event rather than a silent one.
 *
 * Every minimum is optional. An absent dimension is deliberately ungated: a policy should state what
 * it actually requires, not carry zeros for everything it does not.
 */
import { z } from 'zod';

import { RiyaDatasetError } from './errors.js';
import {
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_RISK_CLASSES,
} from './vocabularies.js';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
} from './vocabularies.js';

export interface RiyaDatasetCoveragePolicyV1 {
  readonly version: 1;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly minimumTotalTrajectories: number;
  readonly minimumByLanguage: Readonly<Partial<Record<RiyaDatasetLanguageMode, number>>>;
  readonly minimumByPrimaryInteraction: Readonly<
    Partial<Record<RiyaDatasetInteractionKind, number>>
  >;
  readonly minimumByPersona: Readonly<Partial<Record<RiyaDatasetPersona, number>>>;
  readonly minimumByDifficulty: Readonly<Partial<Record<RiyaDatasetDifficulty, number>>>;
  readonly minimumByRiskClass: Readonly<Partial<Record<RiyaDatasetRiskClass, number>>>;
}

export interface RiyaDatasetCoveragePolicyInput {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly minimumTotalTrajectories?: number;
  readonly minimumByLanguage?: Partial<Record<RiyaDatasetLanguageMode, number>>;
  readonly minimumByPrimaryInteraction?: Partial<Record<RiyaDatasetInteractionKind, number>>;
  readonly minimumByPersona?: Partial<Record<RiyaDatasetPersona, number>>;
  readonly minimumByDifficulty?: Partial<Record<RiyaDatasetDifficulty, number>>;
  readonly minimumByRiskClass?: Partial<Record<RiyaDatasetRiskClass, number>>;
}

const COUNT = z.int().min(0).max(1_000_000);

const policySchema = z
  .object({
    policyId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    policyVersion: z.int().min(1).max(1_000_000),
    minimumTotalTrajectories: COUNT.optional(),
    minimumByLanguage: z.record(z.string(), z.unknown()).optional(),
    minimumByPrimaryInteraction: z.record(z.string(), z.unknown()).optional(),
    minimumByPersona: z.record(z.string(), z.unknown()).optional(),
    minimumByDifficulty: z.record(z.string(), z.unknown()).optional(),
    minimumByRiskClass: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function narrow<Key extends string>(
  supplied: Partial<Record<Key, number>> | undefined,
  allowed: readonly Key[],
): Readonly<Partial<Record<Key, number>>> {
  const table: Partial<Record<Key, number>> = {};
  if (supplied === undefined) {
    return Object.freeze(table);
  }
  const known = new Set<string>(allowed);
  for (const key of Object.keys(supplied)) {
    // An unknown key is a typo, and a typo here is a minimum somebody believes is enforced and is
    // not. It must be a refusal, never a silently ignored entry.
    if (!known.has(key)) {
      throw new RiyaDatasetError('invalid-manifest');
    }
  }
  for (const key of allowed) {
    const value = supplied[key];
    if (value === undefined) {
      continue;
    }
    if (!COUNT.safeParse(value).success) {
      throw new RiyaDatasetError('invalid-manifest');
    }
    table[key] = value;
  }
  return Object.freeze(table);
}

/** Validate and freeze a coverage policy. Throws `invalid-manifest`. */
export function createRiyaDatasetCoveragePolicy(
  input: RiyaDatasetCoveragePolicyInput,
): RiyaDatasetCoveragePolicyV1 {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-manifest');
  }
  return Object.freeze({
    version: 1 as const,
    policyId: parsed.data.policyId,
    policyVersion: parsed.data.policyVersion,
    minimumTotalTrajectories: input.minimumTotalTrajectories ?? 0,
    minimumByLanguage: narrow(input.minimumByLanguage, RIYA_DATASET_LANGUAGE_MODES),
    minimumByPrimaryInteraction: narrow(
      input.minimumByPrimaryInteraction,
      RIYA_DATASET_INTERACTION_KINDS,
    ),
    minimumByPersona: narrow(input.minimumByPersona, RIYA_DATASET_PERSONAS),
    minimumByDifficulty: narrow(input.minimumByDifficulty, RIYA_DATASET_DIFFICULTIES),
    minimumByRiskClass: narrow(input.minimumByRiskClass, RIYA_DATASET_RISK_CLASSES),
  });
}
