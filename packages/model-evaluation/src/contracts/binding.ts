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

/** Reject any wildcard/`latest` identity token anywhere in the binding. */
function rejectWildcard(value: string): void {
  const lowered = value.toLowerCase();
  if (lowered === 'latest' || value.includes('*')) {
    throw new EvaluationError('invalid-binding');
  }
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
