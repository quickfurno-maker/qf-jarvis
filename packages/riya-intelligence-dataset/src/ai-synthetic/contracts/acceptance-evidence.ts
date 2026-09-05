/**
 * Per-trajectory automated acceptance evidence (AS1, ADR-0143 §14 as implemented).
 *
 * ### It is bound to CONTENT, not to an id
 *
 * `trajectoryId` alone would let evidence for revision 1 attest revision 4: fix a reply, keep the id,
 * and yesterday's critic verdicts silently cover today's words. So evidence carries
 * `trajectoryArtifactSha256` and `conversationFingerprint`, and the validator RECOMPUTES both from
 * the trajectory it was handed and compares. Evidence that does not match the thing it claims to
 * describe is not weaker evidence, it is a finding.
 *
 * The same reasoning binds the scenario: `scenarioSha256`, recomputed, not `scenarioRef` taken on
 * trust. A scenario edited after generation would otherwise still appear to have been the plan.
 *
 * ### It carries verdicts, not opinions
 *
 * The critic verdicts are embedded because they are already closed and content-free — a decision and
 * closed dimension codes. Embedding them keeps the acceptance decision auditable from one artifact
 * rather than from a join nobody can perform six months later.
 *
 * ### AS1-B added ONE optional field, and the type otherwise did not move
 *
 * `deterministicVerifierRun` is optional, and that is the only shape change. Canonical JSON omits an
 * absent optional, so every evidence record already issued digests to exactly the byte string it
 * digested to before — nothing has to be re-issued, re-proved or reinterpreted.
 *
 * Optional in the CONTRACT is not optional in the GATE. The validator requires the run for a row
 * whose provenance is external-manual-intake, because that route has no `annotationVerifierConfigRef`
 * to stand in its place, and refuses an untruthful one on either route. The in-repo route keeps the
 * binding it always had. Nothing was weakened to fit the new mode in; the new mode is asked for more.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../../internal/sha256.js';
import { createRiyaAiSyntheticCriticVerdict } from './critic.js';
import type { RiyaAiSyntheticCriticVerdictV1 } from './critic.js';
import { createRiyaAiSyntheticDeterministicVerifierRun } from './deterministic-verifier.js';
import type { RiyaAiSyntheticDeterministicVerifierRunV1 } from './deterministic-verifier.js';

export interface RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1 {
  readonly version: 1;
  readonly trajectoryId: string;
  /** Recomputed and compared by the validator. The binding to the exact record. */
  readonly trajectoryArtifactSha256: string;
  /** Recomputed and compared. Catches a re-labelled copy that kept the same artifact shape. */
  readonly conversationFingerprint: string;
  readonly scenarioRef: string;
  readonly scenarioSha256: string;
  /** Must equal the trajectory's `source.teacherRef`. */
  readonly generationRef: string;
  /**
   * The canonical digest of this row's provenance, in EITHER mode.
   *
   * Provenance is bound here by digest and by nothing else, which is what lets a second provenance
   * mode exist without this contract learning about it. AS1-B did not widen this field, add a mode
   * field beside it, or change how it is compared.
   */
  readonly provenanceSha256: string;
  readonly criticVerdicts: readonly RiyaAiSyntheticCriticVerdictV1[];
  /** The deterministic verifier run that checked this exact trajectory, where one was performed. */
  readonly deterministicVerifierRun?: RiyaAiSyntheticDeterministicVerifierRunV1;
}

export type RiyaAiSyntheticTrajectoryAcceptanceEvidenceInput = Omit<
  RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1,
  'version' | 'criticVerdicts' | 'deterministicVerifierRun'
> & {
  readonly version?: 1;
  readonly criticVerdicts: readonly unknown[];
  /** Re-proved through its own constructor below, exactly as the verdicts are. */
  readonly deterministicVerifierRun?: unknown;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const evidenceSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added. Round-tripping is a real path: evidence deep-
    // re-proves verdicts that are themselves already constructed.
    version: z.literal(1).optional(),
    trajectoryId: REF,
    trajectoryArtifactSha256: z.string().regex(SHA256_HEX),
    conversationFingerprint: z.string().regex(SHA256_HEX),
    scenarioRef: REF,
    scenarioSha256: z.string().regex(SHA256_HEX),
    generationRef: REF,
    provenanceSha256: z.string().regex(SHA256_HEX),
    // Re-proved through the verdict constructor below.
    criticVerdicts: z.array(z.unknown()).min(1).max(16),
    // Re-proved through the verifier-run constructor below.
    deterministicVerifierRun: z.unknown().optional(),
  })
  .strict();

/** Validate and freeze acceptance evidence. Throws `invalid-ai-synthetic-evidence`. */
export function createRiyaAiSyntheticTrajectoryAcceptanceEvidence(
  input: RiyaAiSyntheticTrajectoryAcceptanceEvidenceInput,
): RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1 {
  const parsed = evidenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-evidence');
  }
  let verdicts: readonly RiyaAiSyntheticCriticVerdictV1[];
  try {
    // DEEP re-proof. A structurally plausible verdict object cannot enter evidence unchecked.
    verdicts = input.criticVerdicts.map((verdict) =>
      createRiyaAiSyntheticCriticVerdict(verdict as never),
    );
  } catch {
    throw new RiyaDatasetError('invalid-ai-synthetic-evidence');
  }

  const refs = verdicts.map((verdict) => verdict.criticRef);
  if (new Set(refs).size !== refs.length) {
    throw new RiyaDatasetError('invalid-ai-synthetic-evidence');
  }

  let verifierRun: RiyaAiSyntheticDeterministicVerifierRunV1 | undefined;
  if (input.deterministicVerifierRun !== undefined) {
    try {
      // DEEP re-proof, exactly as for the verdicts. A structurally plausible object claiming a
      // deterministic pass cannot enter evidence unchecked — and a model configuration, which has
      // none of the fields the run schema requires, cannot enter here at all.
      verifierRun = createRiyaAiSyntheticDeterministicVerifierRun(
        input.deterministicVerifierRun as never,
      );
    } catch {
      throw new RiyaDatasetError('invalid-ai-synthetic-evidence');
    }

    // Critic and verifier are separate roles, and this is the one artifact that holds both, so it is
    // where the separation is checkable without a join. A critic that is also the verifier means one
    // party judged the dialogue and confirmed its own judgement's premises.
    const criticIdentities = new Set(
      verdicts.flatMap((verdict) => [verdict.criticRef, verdict.criticConfigRef]),
    );
    if (
      criticIdentities.has(verifierRun.verifierRef) ||
      criticIdentities.has(verifierRun.verifierImplementationRef)
    ) {
      throw new RiyaDatasetError('invalid-ai-synthetic-evidence');
    }
  }

  return Object.freeze({
    version: 1 as const,
    trajectoryId: parsed.data.trajectoryId,
    trajectoryArtifactSha256: parsed.data.trajectoryArtifactSha256,
    conversationFingerprint: parsed.data.conversationFingerprint,
    scenarioRef: parsed.data.scenarioRef,
    scenarioSha256: parsed.data.scenarioSha256,
    generationRef: parsed.data.generationRef,
    provenanceSha256: parsed.data.provenanceSha256,
    // Sorted by ref, so evidence bytes do not depend on which critic returned first.
    criticVerdicts: Object.freeze(
      [...verdicts].sort((a, b) =>
        a.criticRef < b.criticRef ? -1 : a.criticRef > b.criticRef ? 1 : 0,
      ),
    ),
    // Spread rather than assigned. `exactOptionalPropertyTypes` makes an explicit `undefined`
    // different from an absent key, and an absent key is what keeps every pre-AS1-B evidence record
    // digesting to the bytes it always digested to.
    ...(verifierRun === undefined ? {} : { deterministicVerifierRun: verifierRun }),
  });
}

/** The content digest of an acceptance evidence record. */
export function riyaAiSyntheticEvidenceSha256(
  evidence: RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1,
): string {
  return sha256OfCanonical(evidence);
}
