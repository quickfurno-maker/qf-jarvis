/**
 * Deterministic verifier identity and run evidence (AS1-B).
 *
 * ### What this replaces, and why a config ref was not enough
 *
 * On the in-repo route, provenance names an `annotationVerifierConfigRef`: the configuration the AS2
 * harness allocated to check the teacher's structured claims against the dialogue. That ref is
 * meaningful there because the harness really did run that configuration, in a run the config
 * inventory can name.
 *
 * An externally produced candidate has no such run. What it can have is a pass by this repository's
 * OWN deterministic validation stack — the privacy scan, the authority and citation rules, the
 * duplicate and leakage checks, the trajectory re-proof. That is a strictly better verifier than a
 * model asked to check itself: it is an algorithm, it is in the repository, and it produces a report
 * with a digest.
 *
 * But "the verifier was `cfg.verifier`" is not evidence that anything ran. A string proves nothing
 * about an execution, and a record that carried only a string would let a route with NO verification
 * look identical to one with a clean deterministic pass. So this record binds the run: which
 * implementation, at which version, over which scope, against which trajectory, with what verdict,
 * and the digest of the report the run produced.
 *
 * ### It is not a model configuration
 *
 * `RiyaSyntheticModelConfigV1` requires a `modelRef`, an `adapterRef`, an `instructionSha256`, a
 * `maxOutputTokens`, a `samplingPolicyRef` and a `retryPolicyRef`. A deterministic validator has none
 * of those, and inventing them to fit the shape would assert that a model ran when none did — the
 * same fabrication AS1-B refuses on the provenance side. So this is a sibling contract, and the
 * acceptance gate will not accept a model config in its place: the schema is `.strict()` and every
 * field it requires is one a model config does not have.
 *
 * ### What is deliberately absent
 *
 * No findings list, no message, no excerpt, no matched text. A verifier that reported WHAT it found
 * would be putting the privacy scan's own matches — the exact secrets and identifiers the firewall
 * exists to reject — into a record that gets digested and copied. The report digest cites the report;
 * the report lives wherever the run wrote it.
 *
 * And no protected-corpus material of any kind. This record is constructed at AS1 acceptance time,
 * where RWC-P10 is a validation-only input to the generic validator and reaches no artifact.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../../internal/sha256.js';
import { RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS } from './vocabularies.js';
import type { RiyaAiSyntheticVerifierVerdict } from './vocabularies.js';

export interface RiyaAiSyntheticDeterministicVerifierRunV1 {
  readonly version: 1;
  /** This run's own identity. Compared against the teacher and the critics for separation. */
  readonly verifierRef: string;
  /** WHICH deterministic implementation ran, and at which version. Not a model, not an adapter. */
  readonly verifierImplementationRef: string;
  readonly verifierImplementationVersion: number;
  /**
   * Exactly what the run checked, and at which version of that scope.
   *
   * A verdict is only as strong as the scope it was reached over. Without this, "PASSED" could mean
   * the full firewall or a single field check, and nothing downstream could tell which.
   */
  readonly validationScopeRef: string;
  readonly validationScopeVersion: number;
  /**
   * The trajectory this run actually verified, by artifact digest.
   *
   * Recomputed and compared by the acceptance validator. Without it a clean run record from one row
   * could be pasted onto another, which is the same substitution acceptance evidence's own digest
   * binding exists to stop.
   */
  readonly trajectoryArtifactSha256: string;
  /** The digest of the deterministic report the run produced. THE proof that a run happened. */
  readonly deterministicReportSha256: string;
  readonly verdict: RiyaAiSyntheticVerifierVerdict;
}

export type RiyaAiSyntheticDeterministicVerifierRunInput = Omit<
  RiyaAiSyntheticDeterministicVerifierRunV1,
  'version'
> & { readonly version?: 1 };

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const verifierRunSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added. Round-tripping is a real path: acceptance
    // evidence deep-re-proves a run record that is itself already constructed.
    version: z.literal(1).optional(),
    verifierRef: REF,
    verifierImplementationRef: REF,
    verifierImplementationVersion: z.int().min(1).max(1_000_000),
    validationScopeRef: REF,
    validationScopeVersion: z.int().min(1).max(1_000_000),
    trajectoryArtifactSha256: z.string().regex(SHA256_HEX),
    deterministicReportSha256: z.string().regex(SHA256_HEX),
    verdict: z.enum(RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS),
  })
  .strict();

/**
 * Validate and freeze a deterministic verifier run record.
 *
 * Throws `invalid-ai-synthetic-verifier-run`.
 *
 * A `FAILED` verdict is constructible on purpose. A failed run is a truthful record and refusing to
 * represent one would mean the only run evidence anybody could ever produce is a passing one — which
 * is how "we did not run it" and "it passed" become the same artifact. The acceptance gate is what
 * refuses a failure, and it does so visibly, as a finding.
 */
export function createRiyaAiSyntheticDeterministicVerifierRun(
  input: RiyaAiSyntheticDeterministicVerifierRunInput,
): RiyaAiSyntheticDeterministicVerifierRunV1 {
  const parsed = verifierRunSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-verifier-run');
  }
  const data = parsed.data;

  // The run is not its own implementation, and neither is its scope. Collapsing any two of these
  // would make the independence comparisons downstream pass or fail by coincidence: a critic proved
  // distinct from `verifierRef` would say nothing about the implementation that actually ran.
  const identities = [data.verifierRef, data.verifierImplementationRef, data.validationScopeRef];
  if (new Set(identities).size !== identities.length) {
    throw new RiyaDatasetError('invalid-ai-synthetic-verifier-run');
  }

  return Object.freeze({
    version: 1 as const,
    verifierRef: data.verifierRef,
    verifierImplementationRef: data.verifierImplementationRef,
    verifierImplementationVersion: data.verifierImplementationVersion,
    validationScopeRef: data.validationScopeRef,
    validationScopeVersion: data.validationScopeVersion,
    trajectoryArtifactSha256: data.trajectoryArtifactSha256,
    deterministicReportSha256: data.deterministicReportSha256,
    verdict: data.verdict,
  });
}

/** The content digest of a deterministic verifier run record. */
export function riyaAiSyntheticDeterministicVerifierRunSha256(
  run: RiyaAiSyntheticDeterministicVerifierRunV1,
): string {
  return sha256OfCanonical(run);
}
