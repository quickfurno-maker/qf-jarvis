/**
 * External manual synthetic intake provenance (AS1-B).
 *
 * ### Why a second record instead of a wider first one
 *
 * `RiyaAiSyntheticGenerationProvenanceV1` describes a candidate the AS2 harness produced here, and
 * it names four in-repo role configurations to do it: a scenario planner, a customer simulator, a
 * Riya teacher and an annotation verifier, each an allocation the harness made out of a config
 * inventory. Those refs are the record's whole value — they are what the acceptance gate compares a
 * critic against.
 *
 * A candidate generated OUTSIDE this repository has none of them. It was produced by a person
 * driving some model, and handed over as files. The cheap way to get such a row into canonical
 * acceptance evidence would be to fill the four refs with plausible strings, and that is fabrication:
 * the record would assert an inventory allocation that never happened, the digest would seal the lie,
 * and six months later nobody could separate the invented allocations from the real ones.
 *
 * So external intake gets its OWN record, naming only identity that actually exists for it.
 *
 * ### Neither record can be constructed as the other
 *
 * This one carries `generationMode: 'EXTERNAL_MANUAL_SYNTHETIC_INTAKE'` as a stored literal, and its
 * schema is `.strict()` — so a planner or simulator config ref is not merely unused here, it is
 * REJECTED. The in-repo schema is `.strict()` too and has no `generationMode` key, so an external
 * record cannot be fed to it either. The two shapes are mutually unconstructible, which is a stronger
 * statement than a discriminant a caller could copy across.
 *
 * The in-repo mode is therefore identified by the ABSENCE of `generationMode`, not by a literal on
 * the record. That is deliberate and it is the point of §4: adding a discriminant to the historical
 * V1 record would change its canonical bytes, and every acceptance evidence already issued binds
 * provenance by `provenanceSha256`. Existing evidence would stop validating against the very record
 * it was built from. Backward compatibility here is not a courtesy, it is the difference between
 * evidence that still means what it said and evidence that has to be reinterpreted.
 *
 * ### What is deliberately absent
 *
 * No AS2 run id, no config inventory ref, no planner config, no simulator config — none of those
 * existed. No prompt, no provider, no key, no URL, no raw output: the same content-free rule the
 * in-repo record obeys. And no source file PATH; a path is a location, not an identity, and a file
 * that moved would look like a different candidate while a file that was swapped in place would look
 * like the same one. Digests are the identity here.
 *
 * ### The source digests are CLAIMS, and claims are checked elsewhere
 *
 * `sourceTrajectoryArtifactSha256` and `scenarioSha256` are recomputed by the acceptance validator
 * from the records in hand. `sourceCandidateSha256` and `sourceBundleSha256` cannot be -- the
 * delivered bytes are not in this package -- so they are compared against
 * `RiyaAiSyntheticExternalSourceBindingV1`, which carries what an intake reader observed in the
 * files. Owner review of PR #195 caught the gap those two fields had before that record existed:
 * they were sealed into `provenanceSha256` and compared to nothing, so any well-formed digest passed.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../../internal/sha256.js';
import type { RiyaAiSyntheticGenerationProvenanceV1 } from './generation-provenance.js';
import type { RiyaAiSyntheticProvenanceMode } from './vocabularies.js';

export interface RiyaAiSyntheticExternalIntakeProvenanceV1 {
  readonly version: 1;
  /** The stored discriminant. A literal, assigned by the constructor, never accepted from input. */
  readonly generationMode: 'EXTERNAL_MANUAL_SYNTHETIC_INTAKE';
  /**
   * The intake bundle's identity, and the teacher binding.
   *
   * A trajectory's `source.teacherRef` MUST equal this, exactly as on the in-repo route. External
   * origin changes who produced the dialogue; it does not relax what the row has to be bound to.
   */
  readonly generationRef: string;
  /** Which external intake contract this row was accepted under, and at which version. */
  readonly intakeContractRef: string;
  readonly intakeContractVersion: number;
  /** The delivery this candidate arrived in. */
  readonly batchRef: string;
  /**
   * Opaque, non-secret family handle for whatever produced the dialogue.
   *
   * REQUIRED here, unlike the optional family handles on the in-repo record. There it is a refinement
   * — the config inventory already knows the family, and the handle only lets a policy demand
   * cross-family critique. Here there is no inventory, so this is the only statement of what wrote
   * the words, and a record without it would name no producer at all.
   */
  readonly producerFamilyRef: string;
  /**
   * The producer's own identifier for the teacher that wrote the dialogue.
   *
   * This is what the critic-independence rule compares against on this route. Without it the gate
   * could only prove a critic was not the intake BUNDLE, which every critic trivially is not, and
   * "the thing that wrote it also approved it" would stop being detectable.
   */
  readonly producerTeacherRef: string;
  /** The canonical scenario this candidate was taken in against, bound by ref and by digest. */
  readonly scenarioRef: string;
  readonly scenarioSha256: string;
  /**
   * The delivered candidate record, as received.
   *
   * SHA-256 over the exact UTF-8 bytes of the individual delivered JSONL record, EXCLUDING its line
   * terminator. Raw bytes, deliberately not canonical JSON: canonicalizing would make two
   * differently-formatted deliveries hash the same, which is the opposite of what a substitution
   * check needs.
   *
   * This is a CLAIM. It is corroborated at validation time against
   * `RiyaAiSyntheticExternalSourceBindingV1.observedSourceCandidateSha256`, because sealing it into
   * `provenanceSha256` proves only that it did not change afterwards -- never that it was true.
   */
  readonly sourceCandidateSha256: string;
  /**
   * The trajectory artifact digest derived from that source.
   *
   * Recomputed and compared by the acceptance validator, so a re-derivation that quietly changed a
   * reply cannot keep claiming this provenance.
   */
  readonly sourceTrajectoryArtifactSha256: string;
  /**
   * The delivered bundle the candidate came out of.
   *
   * SHA-256 over the exact bytes of the delivered bundle file, as received. Without it, a swapped
   * file inside an otherwise unchanged delivery is invisible: the candidate digest would move,
   * somebody would recompute it, and the record would look consistent again.
   *
   * A CLAIM, like the candidate digest, and corroborated the same way -- against
   * `observedSourceBundleSha256` on the intake reader's own binding record.
   */
  readonly sourceBundleSha256: string;
}

export type RiyaAiSyntheticExternalIntakeProvenanceInput = Omit<
  RiyaAiSyntheticExternalIntakeProvenanceV1,
  'version' | 'generationMode'
> & {
  readonly version?: 1;
  /**
   * Optional on input, so an already-constructed record can be re-proved without being rejected for
   * carrying the field its own constructor added. The literal is the only accepted value.
   */
  readonly generationMode?: 'EXTERNAL_MANUAL_SYNTHETIC_INTAKE';
};

/**
 * Either provenance mode.
 *
 * A closed union of two record shapes, not a widened single shape. Everything that consumes
 * provenance — the digest, the acceptance validator — takes this type, and narrows on
 * `generationMode` where the modes genuinely differ.
 */
export type RiyaAiSyntheticProvenanceV1 =
  RiyaAiSyntheticGenerationProvenanceV1 | RiyaAiSyntheticExternalIntakeProvenanceV1;

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const externalSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added.
    version: z.literal(1).optional(),
    generationMode: z.literal('EXTERNAL_MANUAL_SYNTHETIC_INTAKE').optional(),
    generationRef: REF,
    intakeContractRef: REF,
    intakeContractVersion: z.int().min(1).max(1_000_000),
    batchRef: REF,
    producerFamilyRef: REF,
    producerTeacherRef: REF,
    scenarioRef: REF,
    scenarioSha256: z.string().regex(SHA256_HEX),
    sourceCandidateSha256: z.string().regex(SHA256_HEX),
    sourceTrajectoryArtifactSha256: z.string().regex(SHA256_HEX),
    sourceBundleSha256: z.string().regex(SHA256_HEX),
  })
  // `.strict()` is load-bearing twice over: it refuses the in-repo role refs, so this record can
  // never be an AS2 allocation wearing an external label, and it refuses anything else somebody
  // might reach for when a truthful field is missing.
  .strict();

/**
 * Validate and freeze external manual intake provenance.
 *
 * Throws `invalid-ai-synthetic-provenance` — the same closed code the in-repo constructor throws,
 * because it is the same failure: a provenance record that does not hold together.
 */
export function createRiyaAiSyntheticExternalIntakeProvenance(
  input: RiyaAiSyntheticExternalIntakeProvenanceInput,
): RiyaAiSyntheticExternalIntakeProvenanceV1 {
  const parsed = externalSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-provenance');
  }
  const data = parsed.data;

  // The intake bundle is not one of its own roles, mirroring the in-repo rule. Collapsing them would
  // make the bundle ref and the teacher ref interchangeable, and the critic-vs-teacher comparison
  // would start passing by accident.
  if (data.generationRef === data.producerTeacherRef) {
    throw new RiyaDatasetError('invalid-ai-synthetic-provenance');
  }

  return Object.freeze({
    version: 1 as const,
    // ASSIGNED, not copied from input. There is no reachable state in which an external record says
    // it is an in-repo one.
    generationMode: 'EXTERNAL_MANUAL_SYNTHETIC_INTAKE' as const,
    generationRef: data.generationRef,
    intakeContractRef: data.intakeContractRef,
    intakeContractVersion: data.intakeContractVersion,
    batchRef: data.batchRef,
    producerFamilyRef: data.producerFamilyRef,
    producerTeacherRef: data.producerTeacherRef,
    scenarioRef: data.scenarioRef,
    scenarioSha256: data.scenarioSha256,
    sourceCandidateSha256: data.sourceCandidateSha256,
    sourceTrajectoryArtifactSha256: data.sourceTrajectoryArtifactSha256,
    sourceBundleSha256: data.sourceBundleSha256,
  });
}

/** Narrow a provenance record to the external mode. */
export function isRiyaAiSyntheticExternalIntakeProvenance(
  provenance: RiyaAiSyntheticProvenanceV1,
): provenance is RiyaAiSyntheticExternalIntakeProvenanceV1 {
  return (
    (provenance as Partial<RiyaAiSyntheticExternalIntakeProvenanceV1>).generationMode ===
    'EXTERNAL_MANUAL_SYNTHETIC_INTAKE'
  );
}

/**
 * Which mode a provenance record is in.
 *
 * The in-repo answer is derived from the absence of `generationMode` rather than read off the record,
 * because the historical V1 bytes do not carry one and must not start to. The derivation is total:
 * the union has exactly two members and one of them stores the literal.
 */
export function riyaAiSyntheticProvenanceMode(
  provenance: RiyaAiSyntheticProvenanceV1,
): RiyaAiSyntheticProvenanceMode {
  return isRiyaAiSyntheticExternalIntakeProvenance(provenance)
    ? 'EXTERNAL_MANUAL_SYNTHETIC_INTAKE'
    : 'IN_REPO_GENERATED_SYNTHETIC';
}

/** The content digest of an external intake provenance record. */
export function riyaAiSyntheticExternalIntakeProvenanceSha256(
  provenance: RiyaAiSyntheticExternalIntakeProvenanceV1,
): string {
  return sha256OfCanonical(provenance);
}
