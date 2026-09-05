/**
 * Generation provenance: identity, never transcript (AS1, ADR-0143 §9, §11).
 *
 * ### Five roles, named separately
 *
 * ADR-0143 §9 splits generation into a scenario planner, a customer simulator, a Riya teacher, an
 * annotation verifier and an independent critic. This record names the first four — the critic is
 * named on its own verdict, deliberately, so that "who generated it" and "who judged it" are two
 * artifacts rather than two fields somebody could fill with the same value by accident.
 *
 * Naming them separately is what makes the self-approval rule checkable at all. A single
 * `producedBy` field would make "the teacher was also the critic" unrepresentable as a FINDING,
 * because there would be nothing to compare.
 *
 * ### What is deliberately absent
 *
 * No prompt, no URL, no key, no temperature, no token count, no reasoning trace, no raw output.
 * A config ref is an opaque handle into whatever inventory AS2 keeps; this package never learns what
 * is behind it, and could not leak it if it wanted to. Provenance answers "which configuration",
 * not "what did you say to it".
 *
 * ### This record is the IN-REPO mode, and it did not change in AS1-B
 *
 * AS1-B added a second provenance mode for candidates generated outside this repository — see
 * `external-intake-provenance.ts`. Nothing here moved, was renamed or changed meaning to make room
 * for it, and no discriminant was added: this record's canonical bytes are exactly what they were, so
 * every acceptance evidence record already bound to one of these digests still validates unchanged.
 * The in-repo mode is identified by the ABSENCE of the external record's `generationMode` literal.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../../internal/sha256.js';
// TYPE-ONLY, and that is what makes it safe: `verbatimModuleSyntax` erases the statement entirely,
// so the two provenance modules have no runtime edge between them in either direction.
import type { RiyaAiSyntheticProvenanceV1 } from './external-intake-provenance.js';

export interface RiyaAiSyntheticGenerationProvenanceV1 {
  readonly version: 1;
  /**
   * The generation bundle's identity.
   *
   * A trajectory's `source.teacherRef` MUST equal this. That single binding is what stops a corpus
   * from claiming a provenance record that describes a different run.
   */
  readonly generationRef: string;
  readonly scenarioRef: string;
  readonly scenarioSha256: string;
  readonly scenarioPlannerConfigRef: string;
  readonly customerSimulatorConfigRef: string;
  readonly riyaTeacherConfigRef: string;
  readonly annotationVerifierConfigRef: string;
  /**
   * Opaque, non-secret family handles per role.
   *
   * Optional because AS1 cannot know what AS2 will have available, and a required field somebody has
   * to invent a value for is a field that stops meaning anything. When present, an acceptance policy
   * may require the critic's family to differ from the teacher's.
   */
  readonly riyaTeacherModelFamilyRef?: string;
  readonly customerSimulatorModelFamilyRef?: string;
}

export type RiyaAiSyntheticGenerationProvenanceInput = Omit<
  RiyaAiSyntheticGenerationProvenanceV1,
  'version'
> & { readonly version?: 1 };

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const provenanceSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added. Round-tripping is a real path: evidence deep-
    // re-proves verdicts that are themselves already constructed.
    version: z.literal(1).optional(),
    generationRef: REF,
    scenarioRef: REF,
    scenarioSha256: z.string().regex(SHA256_HEX),
    scenarioPlannerConfigRef: REF,
    customerSimulatorConfigRef: REF,
    riyaTeacherConfigRef: REF,
    annotationVerifierConfigRef: REF,
    riyaTeacherModelFamilyRef: REF.optional(),
    customerSimulatorModelFamilyRef: REF.optional(),
  })
  .strict();

/** Validate and freeze generation provenance. Throws `invalid-ai-synthetic-provenance`. */
export function createRiyaAiSyntheticGenerationProvenance(
  input: RiyaAiSyntheticGenerationProvenanceInput,
): RiyaAiSyntheticGenerationProvenanceV1 {
  const parsed = provenanceSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-provenance');
  }
  const data = parsed.data;

  // The generation bundle is not one of its own roles. Collapsing them would make the bundle ref and
  // a config ref interchangeable, and the teacher-vs-critic comparison would start passing by
  // accident.
  const roles = [
    data.scenarioPlannerConfigRef,
    data.customerSimulatorConfigRef,
    data.riyaTeacherConfigRef,
    data.annotationVerifierConfigRef,
  ];
  if (roles.includes(data.generationRef)) {
    throw new RiyaDatasetError('invalid-ai-synthetic-provenance');
  }

  // The annotation verifier checks the teacher's structured claims against the dialogue. Letting it
  // be the same configuration as the teacher means the teacher confirms its own annotations, which
  // is the self-approval failure one layer down from the critic.
  if (data.annotationVerifierConfigRef === data.riyaTeacherConfigRef) {
    throw new RiyaDatasetError('invalid-ai-synthetic-provenance');
  }

  return Object.freeze({
    version: 1 as const,
    generationRef: data.generationRef,
    scenarioRef: data.scenarioRef,
    scenarioSha256: data.scenarioSha256,
    scenarioPlannerConfigRef: data.scenarioPlannerConfigRef,
    customerSimulatorConfigRef: data.customerSimulatorConfigRef,
    riyaTeacherConfigRef: data.riyaTeacherConfigRef,
    annotationVerifierConfigRef: data.annotationVerifierConfigRef,
    ...(data.riyaTeacherModelFamilyRef === undefined
      ? {}
      : { riyaTeacherModelFamilyRef: data.riyaTeacherModelFamilyRef }),
    ...(data.customerSimulatorModelFamilyRef === undefined
      ? {}
      : { customerSimulatorModelFamilyRef: data.customerSimulatorModelFamilyRef }),
  });
}

/**
 * The content digest of a provenance record, in EITHER mode.
 *
 * One function, deliberately. Acceptance evidence binds provenance by `provenanceSha256` and nothing
 * else, so the digest is the join — and a second digest helper for the external mode would be a
 * second way to compute the thing the whole gate hangs on. The widening is purely a type change:
 * `sha256OfCanonical` was always structural, so every digest this function returned before AS1-B it
 * still returns, byte for byte, and every acceptance evidence record already issued still validates
 * against the exact provenance it was built from (`ai-synthetic-external-intake.test.ts` pins this).
 */
export function riyaAiSyntheticProvenanceSha256(provenance: RiyaAiSyntheticProvenanceV1): string {
  return sha256OfCanonical(provenance);
}
