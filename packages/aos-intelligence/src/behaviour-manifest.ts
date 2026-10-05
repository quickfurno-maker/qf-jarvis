import type { AosBehaviourRegistry } from './policy-registry.js';
import { validInstant, validNonNegativeInt, validRef } from './validation.js';

export const AOS_BEHAVIOUR_MANIFEST_LIFECYCLES = [
  'DRAFT',
  'SIMULATED',
  'OWNER_APPROVED',
  'SUGGEST_SHADOW',
  'RETIRED',
] as const;
export type AosBehaviourManifestLifecycle = (typeof AOS_BEHAVIOUR_MANIFEST_LIFECYCLES)[number];

export interface AosBehaviourSimulationEvidence {
  readonly manifestId: string;
  readonly configurationDigest: string;
  readonly scenarioCount: number;
  readonly reportRef: string;
  readonly generatedAt: string;
}

export interface AosBehaviourDigitalTwinEvidence {
  readonly manifestId: string;
  readonly configurationDigest: string;
  readonly scenarioCount: number;
  readonly regressionCount: number;
  readonly reportRef: string;
  readonly generatedAt: string;
  readonly zeroEffectVerified: boolean;
}

export interface AosBehaviourOwnerApproval {
  readonly manifestId: string;
  readonly configurationDigest: string;
  readonly approvalRef: string;
  readonly approvedAt: string;
}

export interface AosBehaviourManifest {
  readonly protocol: 'qfj.aos.behaviour-manifest.v1';
  readonly manifestId: string;
  readonly manifestVersion: number;
  readonly lifecycle: AosBehaviourManifestLifecycle;
  readonly registryRef: string;
  readonly policyVersionRefs: readonly string[];
  readonly configurationDigest: string;
  readonly createdAt: string;
  readonly simulation?: AosBehaviourSimulationEvidence;
  readonly digitalTwin?: AosBehaviourDigitalTwinEvidence;
  readonly ownerApproval?: AosBehaviourOwnerApproval;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export interface AosBehaviourRuntimeBinding {
  readonly protocol: 'qfj.aos.behaviour-binding.v1';
  readonly manifestId: string;
  readonly manifestVersion: number;
  readonly configurationDigest: string;
  readonly registry: AosBehaviourRegistry;
  readonly mode: 'SUGGEST_SHADOW';
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function policyRefs(registry: AosBehaviourRegistry): readonly string[] {
  return Object.freeze(
    registry.policies.map((policy) => policy.policyId + '.v' + String(policy.version)).sort(),
  );
}

function exactRefs(manifest: AosBehaviourManifest, registry: AosBehaviourRegistry): boolean {
  const actual = policyRefs(registry);
  return (
    manifest.registryRef === registry.registryRef &&
    actual.length === manifest.policyVersionRefs.length &&
    actual.every((ref, index) => ref === manifest.policyVersionRefs[index])
  );
}

function validateSimulation(
  manifest: AosBehaviourManifest,
  simulation: AosBehaviourSimulationEvidence | undefined,
): boolean {
  if (simulation === undefined) return false;
  return (
    simulation.manifestId === manifest.manifestId &&
    simulation.configurationDigest === manifest.configurationDigest &&
    validNonNegativeInt(simulation.scenarioCount, 1_000_000) &&
    simulation.scenarioCount > 0 &&
    validRef(simulation.reportRef) &&
    validInstant(simulation.generatedAt)
  );
}

function validateDigitalTwin(
  manifest: AosBehaviourManifest,
  evidence: AosBehaviourDigitalTwinEvidence | undefined,
): boolean {
  if (evidence === undefined) return false;
  return (
    evidence.manifestId === manifest.manifestId &&
    evidence.configurationDigest === manifest.configurationDigest &&
    validNonNegativeInt(evidence.scenarioCount, 1_000_000) &&
    evidence.scenarioCount > 0 &&
    evidence.regressionCount === 0 &&
    evidence.zeroEffectVerified &&
    validRef(evidence.reportRef) &&
    validInstant(evidence.generatedAt)
  );
}

function validateApproval(
  manifest: AosBehaviourManifest,
  approval: AosBehaviourOwnerApproval | undefined,
): boolean {
  if (approval === undefined) return false;
  return (
    approval.manifestId === manifest.manifestId &&
    approval.configurationDigest === manifest.configurationDigest &&
    validRef(approval.approvalRef) &&
    validInstant(approval.approvedAt)
  );
}

export function createAosBehaviourManifest(
  input: Omit<AosBehaviourManifest, 'protocol' | 'executionAuthority' | 'businessEffect'>,
): AosBehaviourManifest {
  if (
    !validRef(input.manifestId) ||
    !validNonNegativeInt(input.manifestVersion, 1_000_000) ||
    input.manifestVersion < 1 ||
    !AOS_BEHAVIOUR_MANIFEST_LIFECYCLES.includes(input.lifecycle) ||
    !validRef(input.registryRef) ||
    !DIGEST.test(input.configurationDigest) ||
    !validInstant(input.createdAt) ||
    input.policyVersionRefs.length < 1 ||
    input.policyVersionRefs.length > 1_000 ||
    input.policyVersionRefs.some((ref) => !validRef(ref))
  ) {
    throw new TypeError('aos-behaviour-manifest-invalid');
  }

  const manifest: AosBehaviourManifest = Object.freeze({
    protocol: 'qfj.aos.behaviour-manifest.v1' as const,
    ...input,
    policyVersionRefs: Object.freeze([...new Set(input.policyVersionRefs)].sort()),
    ...(input.simulation === undefined
      ? {}
      : { simulation: Object.freeze({ ...input.simulation }) }),
    ...(input.digitalTwin === undefined
      ? {}
      : { digitalTwin: Object.freeze({ ...input.digitalTwin }) }),
    ...(input.ownerApproval === undefined
      ? {}
      : { ownerApproval: Object.freeze({ ...input.ownerApproval }) }),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });

  if (
    (manifest.lifecycle === 'SIMULATED' ||
      manifest.lifecycle === 'OWNER_APPROVED' ||
      manifest.lifecycle === 'SUGGEST_SHADOW') &&
    !validateSimulation(manifest, manifest.simulation)
  ) {
    throw new TypeError('aos-behaviour-simulation-evidence-invalid');
  }
  if (
    (manifest.lifecycle === 'SIMULATED' ||
      manifest.lifecycle === 'OWNER_APPROVED' ||
      manifest.lifecycle === 'SUGGEST_SHADOW') &&
    !validateDigitalTwin(manifest, manifest.digitalTwin)
  ) {
    throw new TypeError('aos-behaviour-digital-twin-evidence-invalid');
  }
  if (
    (manifest.lifecycle === 'OWNER_APPROVED' || manifest.lifecycle === 'SUGGEST_SHADOW') &&
    !validateApproval(manifest, manifest.ownerApproval)
  ) {
    throw new TypeError('aos-behaviour-owner-approval-invalid');
  }
  return manifest;
}

export function createAosBehaviourRuntimeBinding(input: {
  readonly manifest: AosBehaviourManifest;
  readonly registry: AosBehaviourRegistry;
}): AosBehaviourRuntimeBinding {
  if (
    input.manifest.lifecycle !== 'SUGGEST_SHADOW' ||
    !validateSimulation(input.manifest, input.manifest.simulation) ||
    !validateDigitalTwin(input.manifest, input.manifest.digitalTwin) ||
    !validateApproval(input.manifest, input.manifest.ownerApproval) ||
    !exactRefs(input.manifest, input.registry)
  ) {
    throw new TypeError('aos-behaviour-runtime-binding-refused');
  }
  return Object.freeze({
    protocol: 'qfj.aos.behaviour-binding.v1' as const,
    manifestId: input.manifest.manifestId,
    manifestVersion: input.manifest.manifestVersion,
    configurationDigest: input.manifest.configurationDigest,
    registry: input.registry,
    mode: 'SUGGEST_SHADOW' as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export function policyVersionRefsForRegistry(registry: AosBehaviourRegistry): readonly string[] {
  return policyRefs(registry);
}
