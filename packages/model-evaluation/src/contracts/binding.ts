/**
 * The exact evaluation binding (QFJ-P04.04, ADR-0052 §C).
 *
 * Every suite/run/evidence object binds EXACT identities so parity holds — every provider and every
 * model is measured against the same suite, and evidence names precisely which release/prompt/
 * capability/knowledge/policy versions it rests on. No wildcard/`latest`, no runtime discovery, no
 * model self-description as authority.
 */
import { z } from 'zod';

import { EvaluationError } from './errors.js';
import { isCanonicalInstant } from './instant.js';
import { providerModelIdSchema } from './model-id.js';
import { EVALUATION_EXECUTION_CLASSES } from './vocabularies.js';
import type { EvaluationExecutionClass } from './vocabularies.js';

/** An exact provider release identity (mirrors the gateway's ProviderReleaseRef, provider-neutral). */
export interface ProviderReleaseRef {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly configDigest: string;
  readonly executionClass: EvaluationExecutionClass;
}

/** The exact identities an evaluation suite/run/evidence is bound to. */
export interface EvaluationBinding {
  readonly evaluationSuiteId: string;
  readonly evaluationSuiteVersion: number;
  readonly redTeamSuiteId: string | undefined;
  readonly redTeamSuiteVersion: number | undefined;
  readonly fixtureManifestId: string;
  readonly fixtureManifestVersion: number;
  readonly evaluatorImplId: string;
  readonly evaluatorImplVersion: number;
  readonly release: ProviderReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  /**
   * The exact prompt-content digest the evaluation was produced against (QFJ-S3-I-B, ADR-0073).
   *
   * REQUIRED. `promptFamily` + `promptVersion` name a prompt; only this says which BYTES were
   * evaluated. Without it a binding could attest a version whose text later changed, which is the
   * drift ADR-0073 closes at the runtime end -- an evaluation that cannot name the content it covers
   * is evidence about a label, not about a prompt.
   */
  readonly promptDigest: string;
  readonly capabilityProfileRef: string;
  readonly knowledgeRevision: string | undefined;
  readonly policyContractRevision: string;
  readonly createdAt: string;
}

export interface EvaluationBindingInput {
  readonly evaluationSuiteId: string;
  readonly evaluationSuiteVersion: number;
  readonly fixtureManifestId: string;
  readonly fixtureManifestVersion: number;
  readonly evaluatorImplId: string;
  readonly evaluatorImplVersion: number;
  readonly release: ProviderReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  /** The exact prompt-content digest the evaluation covers (ADR-0073). Required. */
  readonly promptDigest: string;
  readonly capabilityProfileRef: string;
  readonly policyContractRevision: string;
  readonly createdAt: string;
  readonly redTeamSuiteId?: string | undefined;
  readonly redTeamSuiteVersion?: number | undefined;
  readonly knowledgeRevision?: string | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);
const DIGEST = z.string().regex(/^[0-9a-f]{8,64}$/);

const releaseSchema = z
  .object({
    releaseId: IDENTIFIER,
    providerId: IDENTIFIER,
    // QFJ-S1C-B: a provider model id may be namespaced (`openai/gpt-oss-20b`), so evidence can name
    // the real catalogue identity. Only this field uses the slash-segment grammar; every neighbouring
    // identifier keeps the generic charset.
    modelId: providerModelIdSchema,
    modelVersion: IDENTIFIER,
    configDigest: DIGEST,
    executionClass: z.enum(EVALUATION_EXECUTION_CLASSES),
  })
  .strict();

const bindingSchema = z
  .object({
    evaluationSuiteId: IDENTIFIER,
    evaluationSuiteVersion: VERSION,
    fixtureManifestId: IDENTIFIER,
    fixtureManifestVersion: VERSION,
    evaluatorImplId: IDENTIFIER,
    evaluatorImplVersion: VERSION,
    release: releaseSchema,
    promptFamily: IDENTIFIER,
    promptVersion: VERSION,
    promptDigest: z.string().regex(/^[0-9a-f]{64}$/),
    capabilityProfileRef: IDENTIFIER,
    policyContractRevision: IDENTIFIER,
    createdAt: z.string().refine(isCanonicalInstant),
    redTeamSuiteId: IDENTIFIER.optional(),
    redTeamSuiteVersion: VERSION.optional(),
    knowledgeRevision: IDENTIFIER.optional(),
  })
  .strict();

/**
 * True iff `value` is an EXACT governed identity — no wildcard, no `latest` segment.
 *
 * ### Segment-aware, because a model id may be namespaced
 *
 * `modelId` uses the slash-SEGMENT grammar, so `vendor/latest` is a well-formed catalogue id — and a
 * moving target, which is exactly what this rule exists to keep out of evidence. Checking the whole
 * string for `latest` missed it, so the check splits on `/` and refuses if ANY complete segment is
 * `latest`, case-insensitively.
 *
 * A segment that merely CONTAINS the substring is fine: `latest-model` and `model-latest-v2` are
 * ordinary names that happen to include six letters, and refusing them would be a grammar rule
 * masquerading as governance.
 *
 * This is governance, not grammar. `PROVIDER_MODEL_ID_PATTERN` still answers "is this a well-formed
 * provider catalogue id?"; this answers "is this an exact governed identity?", and evidence is
 * entitled to be stricter than the gateway's syntax.
 *
 * EXPORTED so the operational-benchmark package applies the same rule to the prompt, capability,
 * knowledge and policy refs it owns. A second copy would be a second rule the day one of them changed.
 */
export function isExactGovernedIdentity(value: string): boolean {
  if (value.includes('*')) {
    return false;
  }
  return value.split('/').every((segment) => segment.toLowerCase() !== 'latest');
}

/** The throwing form used throughout this file. Same rule, one implementation. */
function rejectWildcard(value: string): void {
  if (!isExactGovernedIdentity(value)) {
    throw new EvaluationError('invalid-binding');
  }
}

/**
 * Validate and freeze a release identity ON ITS OWN. Throws `EvaluationError('invalid-binding')`.
 *
 * Extracted so a package that needs to name a release WITHOUT running an evaluation can reuse this
 * exact grammar rather than restate it. The RMB-A operational-benchmark package is the first such
 * caller:
 * operational benchmark evidence is about a release, but it owns no suite, no fixture manifest, no
 * evaluator and no prompt family, so `createEvaluationBinding` is the wrong shape for it and copying
 * the six fields into a second schema would create an identity that could drift from this one.
 *
 * `createEvaluationBinding` validates through the SAME schema and the SAME wildcard rule below, so
 * there is one release grammar in the repository and callers cannot disagree about it.
 */
export function createProviderReleaseRef(input: ProviderReleaseRef): ProviderReleaseRef {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new EvaluationError('invalid-binding');
  }
  const release = parsed.data;
  for (const token of [
    release.releaseId,
    release.providerId,
    release.modelId,
    release.modelVersion,
  ]) {
    rejectWildcard(token);
  }
  return Object.freeze({ ...release });
}

/** Validate and freeze an evaluation binding. Throws `EvaluationError('invalid-binding')`. */
export function createEvaluationBinding(input: EvaluationBindingInput): EvaluationBinding {
  const parsed = bindingSchema.safeParse(input);
  if (!parsed.success) {
    throw new EvaluationError('invalid-binding');
  }
  const b = parsed.data;
  for (const token of [
    b.evaluationSuiteId,
    b.fixtureManifestId,
    b.evaluatorImplId,
    b.release.releaseId,
    b.release.providerId,
    b.release.modelId,
    b.release.modelVersion,
    b.promptFamily,
    b.capabilityProfileRef,
    b.policyContractRevision,
    // The OPTIONAL identities were omitted from this list, which meant a binding could name
    // `knowledgeRevision: 'latest'` -- a moving target attesting to a knowledge base that changes
    // under the evidence. Optional does not mean ungoverned; an identity that is present must be
    // exact.
    ...(b.knowledgeRevision === undefined ? [] : [b.knowledgeRevision]),
    ...(b.redTeamSuiteId === undefined ? [] : [b.redTeamSuiteId]),
  ]) {
    rejectWildcard(token);
  }
  return Object.freeze({
    evaluationSuiteId: b.evaluationSuiteId,
    evaluationSuiteVersion: b.evaluationSuiteVersion,
    redTeamSuiteId: b.redTeamSuiteId,
    redTeamSuiteVersion: b.redTeamSuiteVersion,
    fixtureManifestId: b.fixtureManifestId,
    fixtureManifestVersion: b.fixtureManifestVersion,
    evaluatorImplId: b.evaluatorImplId,
    evaluatorImplVersion: b.evaluatorImplVersion,
    release: Object.freeze({ ...b.release }),
    promptFamily: b.promptFamily,
    promptVersion: b.promptVersion,
    promptDigest: b.promptDigest,
    capabilityProfileRef: b.capabilityProfileRef,
    knowledgeRevision: b.knowledgeRevision,
    policyContractRevision: b.policyContractRevision,
    createdAt: b.createdAt,
  });
}

/** The exact tuple key identifying a release. */
export function releaseKey(release: ProviderReleaseRef): string {
  return [
    release.releaseId,
    release.providerId,
    release.modelId,
    release.modelVersion,
    release.configDigest,
    release.executionClass,
  ].join('|');
}

/** True iff two bindings refer to the exact same identities (deep, field-by-field). */
export function bindingsMatch(a: EvaluationBinding, b: EvaluationBinding): boolean {
  return (
    a.evaluationSuiteId === b.evaluationSuiteId &&
    a.evaluationSuiteVersion === b.evaluationSuiteVersion &&
    a.fixtureManifestId === b.fixtureManifestId &&
    a.fixtureManifestVersion === b.fixtureManifestVersion &&
    a.evaluatorImplId === b.evaluatorImplId &&
    a.evaluatorImplVersion === b.evaluatorImplVersion &&
    releaseKey(a.release) === releaseKey(b.release) &&
    a.promptFamily === b.promptFamily &&
    a.promptVersion === b.promptVersion &&
    // Two bindings that agree on every label but cover different prompt bytes are NOT the same
    // binding (ADR-0073).
    a.promptDigest === b.promptDigest &&
    a.capabilityProfileRef === b.capabilityProfileRef &&
    a.knowledgeRevision === b.knowledgeRevision &&
    a.policyContractRevision === b.policyContractRevision
  );
}
