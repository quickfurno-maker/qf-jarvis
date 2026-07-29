/**
 * Deterministic offline fixtures for the QFJ-S2-C-B evidence specs.
 *
 * Evidence is built from the EXISTING `createEvaluationBinding` factory plus explicit literals, so the
 * fixtures exercise the real grammar rather than a parallel one. Nothing here touches a terminal, the
 * environment, the filesystem, the network, a provider, a database, or a real credential — and no
 * production evidence artifact is manufactured: production-flavoured fixtures exist only to prove the
 * VALIDATION path, never to authorize anything. Not a spec file, so vitest does not collect it.
 */
import {
  contentDigest,
  createEvaluationBinding,
  type ApprovalEvidence,
  type EvaluationApprovalTarget,
} from '@qf-jarvis/model-evaluation';

import {
  CONFIG_DIGEST,
  MODEL_ID,
  MODEL_VERSION,
  PROVIDER_ID,
  RELEASE_ID,
} from './composition-test-support.js';

export const CAPABILITY_PROFILE_REF = 'cap.s2cb.synthetic.v1';

/** The binding every fixture shares: exact identities matching the synthetic release. */
export function evidenceBinding(over: Record<string, unknown> = {}) {
  return createEvaluationBinding({
    evaluationSuiteId: 'suite.s2cb.synthetic',
    evaluationSuiteVersion: 1,
    fixtureManifestId: 'fixtures.s2cb.synthetic',
    fixtureManifestVersion: 1,
    evaluatorImplId: 'evaluator.s2cb',
    evaluatorImplVersion: 1,
    release: {
      releaseId: RELEASE_ID,
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      configDigest: CONFIG_DIGEST,
      executionClass: 'HOSTED',
    },
    promptFamily: 'qfj.s2cb.synthetic',
    promptVersion: 1,
    capabilityProfileRef: CAPABILITY_PROFILE_REF,
    policyContractRevision: 'policy.v1',
    createdAt: '2026-07-29T00:00:00.000Z',
    ...over,
  });
}

/**
 * Build an evidence object with an explicit target and flag pair.
 *
 * `evaluationRef` mirrors the real `evref-<digest>` shape so the fixtures cannot accidentally pass a
 * check that a realistic reference would fail.
 */
export function evidenceFor(
  target: EvaluationApprovalTarget,
  options: {
    readonly synthetic?: boolean;
    readonly productionApproval?: boolean;
    readonly binding?: ReturnType<typeof evidenceBinding>;
    readonly evaluationRef?: string;
    readonly suiteResultDigest?: string;
  } = {},
): ApprovalEvidence {
  const binding = options.binding ?? evidenceBinding();
  const suiteResultDigest = options.suiteResultDigest ?? contentDigest({ target, suite: 's2cb' });
  return Object.freeze({
    evaluationRef: options.evaluationRef ?? `evref-${contentDigest({ target, binding: 's2cb' })}`,
    target,
    binding,
    suiteResultDigest,
    caseSetDigest: contentDigest([['case-1', 1, 'PASS']]),
    createdAt: '2026-07-29T00:00:00.000Z',
    synthetic: options.synthetic ?? true,
    productionApproval: options.productionApproval ?? false,
  });
}

/** Non-synthetic, production-approved evidence — the only shape CANARY/ACTIVE may accept. */
export function productionEvidenceFor(target: EvaluationApprovalTarget): ApprovalEvidence {
  return evidenceFor(target, { synthetic: false, productionApproval: true });
}

/** The digest the registry DERIVES for an evidence object. Tests must never hand-write one. */
export function derivedDigestOf(evidence: ApprovalEvidence): string {
  return contentDigest(evidence);
}
