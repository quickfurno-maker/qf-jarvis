import { createHash } from 'node:crypto';

import {
  createAosBehaviourManifest,
  createAosBehaviourRuntimeBinding,
  policyVersionRefsForRegistry,
  type AosBehaviourManifest,
  type AosBehaviourRegistry,
  type AosBehaviourRuntimeBinding,
} from '@qf-jarvis/aos-intelligence';

function normalizedRegistry(registry: AosBehaviourRegistry): object {
  return {
    registryRef: registry.registryRef,
    policies: [...registry.policies]
      .sort(
        (left, right) =>
          left.policyId.localeCompare(right.policyId) || left.version - right.version,
      )
      .map((policy) => ({
        policyId: policy.policyId,
        version: policy.version,
        lifecycle: policy.lifecycle,
        title: policy.title,
        trigger: policy.trigger,
        priority: policy.priority,
        scope: {
          cityRefs: [...policy.scope.cityRefs].sort(),
          localityRefs: [...policy.scope.localityRefs].sort(),
          categoryRefs: [...policy.scope.categoryRefs].sort(),
        },
        conditions: [...policy.conditions]
          .map((condition) => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
          }))
          .sort(
            (left, right) =>
              left.field.localeCompare(right.field) ||
              left.operator.localeCompare(right.operator) ||
              left.value - right.value,
          ),
        action: policy.action,
        ownerApprovalRequired: policy.ownerApprovalRequired,
        coreDecisionRequired: policy.coreDecisionRequired,
        maximumVendorExposureWithoutOwnerApproval: policy.maximumVendorExposureWithoutOwnerApproval,
        communication: {
          cooldownMinutes: policy.communication.cooldownMinutes,
          maxMessagesPer30Days: policy.communication.maxMessagesPer30Days,
          ...(policy.communication.quietHoursLocal === undefined
            ? {}
            : {
                quietHoursLocal: {
                  startHour: policy.communication.quietHoursLocal.startHour,
                  endHour: policy.communication.quietHoursLocal.endHour,
                },
              }),
          directPhoneAllowed: policy.communication.directPhoneAllowed,
          maskedOpportunityOnly: policy.communication.maskedOpportunityOnly,
        },
      })),
  };
}

export function canonicalAosBehaviourRegistryJson(registry: AosBehaviourRegistry): string {
  return JSON.stringify(normalizedRegistry(registry));
}

export function digestAosBehaviourRegistry(registry: AosBehaviourRegistry): string {
  return (
    'sha256:' +
    createHash('sha256').update(canonicalAosBehaviourRegistryJson(registry), 'utf8').digest('hex')
  );
}

export function createAosBehaviourDraft(input: {
  readonly manifestId: string;
  readonly manifestVersion: number;
  readonly registry: AosBehaviourRegistry;
  readonly createdAt: string;
}): AosBehaviourManifest {
  return createAosBehaviourManifest({
    manifestId: input.manifestId,
    manifestVersion: input.manifestVersion,
    lifecycle: 'DRAFT',
    registryRef: input.registry.registryRef,
    policyVersionRefs: policyVersionRefsForRegistry(input.registry),
    configurationDigest: digestAosBehaviourRegistry(input.registry),
    createdAt: input.createdAt,
  });
}

function assertRegistryMatches(
  manifest: AosBehaviourManifest,
  registry: AosBehaviourRegistry,
): void {
  const digest = digestAosBehaviourRegistry(registry);
  const refs = policyVersionRefsForRegistry(registry);
  if (
    manifest.configurationDigest !== digest ||
    manifest.registryRef !== registry.registryRef ||
    refs.length !== manifest.policyVersionRefs.length ||
    refs.some((ref, index) => manifest.policyVersionRefs[index] !== ref)
  ) {
    throw new TypeError('aos-behaviour-registry-digest-mismatch');
  }
}

export function markAosBehaviourSimulated(input: {
  readonly draft: AosBehaviourManifest;
  readonly registry: AosBehaviourRegistry;
  readonly scenarioCount: number;
  readonly reportRef: string;
  readonly generatedAt: string;
  readonly digitalTwinScenarioCount: number;
  readonly digitalTwinReportRef: string;
  readonly digitalTwinGeneratedAt: string;
}): AosBehaviourManifest {
  if (input.draft.lifecycle !== 'DRAFT') {
    throw new TypeError('aos-behaviour-simulation-transition-invalid');
  }
  assertRegistryMatches(input.draft, input.registry);
  return createAosBehaviourManifest({
    manifestId: input.draft.manifestId,
    manifestVersion: input.draft.manifestVersion,
    lifecycle: 'SIMULATED',
    registryRef: input.draft.registryRef,
    policyVersionRefs: input.draft.policyVersionRefs,
    configurationDigest: input.draft.configurationDigest,
    createdAt: input.draft.createdAt,
    simulation: {
      manifestId: input.draft.manifestId,
      configurationDigest: input.draft.configurationDigest,
      scenarioCount: input.scenarioCount,
      reportRef: input.reportRef,
      generatedAt: input.generatedAt,
    },
    digitalTwin: {
      manifestId: input.draft.manifestId,
      configurationDigest: input.draft.configurationDigest,
      scenarioCount: input.digitalTwinScenarioCount,
      regressionCount: 0,
      reportRef: input.digitalTwinReportRef,
      generatedAt: input.digitalTwinGeneratedAt,
      zeroEffectVerified: true,
    },
  });
}

export function markAosBehaviourOwnerApproved(input: {
  readonly simulated: AosBehaviourManifest;
  readonly registry: AosBehaviourRegistry;
  readonly approvalRef: string;
  readonly approvedAt: string;
}): AosBehaviourManifest {
  if (input.simulated.lifecycle !== 'SIMULATED') {
    throw new TypeError('aos-behaviour-approval-transition-invalid');
  }
  assertRegistryMatches(input.simulated, input.registry);
  const simulation = input.simulated.simulation;
  const digitalTwin = input.simulated.digitalTwin;
  if (simulation === undefined || digitalTwin === undefined) {
    throw new TypeError('aos-behaviour-simulation-evidence-missing');
  }
  return createAosBehaviourManifest({
    manifestId: input.simulated.manifestId,
    manifestVersion: input.simulated.manifestVersion,
    lifecycle: 'OWNER_APPROVED',
    registryRef: input.simulated.registryRef,
    policyVersionRefs: input.simulated.policyVersionRefs,
    configurationDigest: input.simulated.configurationDigest,
    createdAt: input.simulated.createdAt,
    simulation,
    digitalTwin,
    ownerApproval: {
      manifestId: input.simulated.manifestId,
      configurationDigest: input.simulated.configurationDigest,
      approvalRef: input.approvalRef,
      approvedAt: input.approvedAt,
    },
  });
}

export function sealAosBehaviourSuggestShadow(input: {
  readonly approved: AosBehaviourManifest;
  readonly registry: AosBehaviourRegistry;
}): AosBehaviourManifest {
  if (input.approved.lifecycle !== 'OWNER_APPROVED') {
    throw new TypeError('aos-behaviour-shadow-transition-invalid');
  }
  assertRegistryMatches(input.approved, input.registry);
  const simulation = input.approved.simulation;
  const digitalTwin = input.approved.digitalTwin;
  const ownerApproval = input.approved.ownerApproval;
  if (simulation === undefined || digitalTwin === undefined || ownerApproval === undefined) {
    throw new TypeError('aos-behaviour-approval-evidence-missing');
  }
  return createAosBehaviourManifest({
    manifestId: input.approved.manifestId,
    manifestVersion: input.approved.manifestVersion,
    lifecycle: 'SUGGEST_SHADOW',
    registryRef: input.approved.registryRef,
    policyVersionRefs: input.approved.policyVersionRefs,
    configurationDigest: input.approved.configurationDigest,
    createdAt: input.approved.createdAt,
    simulation,
    digitalTwin,
    ownerApproval,
  });
}

export function createVerifiedAosBehaviourRuntimeBinding(input: {
  readonly manifest: AosBehaviourManifest;
  readonly registry: AosBehaviourRegistry;
}): AosBehaviourRuntimeBinding {
  assertRegistryMatches(input.manifest, input.registry);
  return createAosBehaviourRuntimeBinding(input);
}

export function verifyAosBehaviourRuntimeBinding(binding: AosBehaviourRuntimeBinding): boolean {
  const raw = binding as unknown as Readonly<Record<string, unknown>>;
  if (
    raw['protocol'] !== 'qfj.aos.behaviour-binding.v1' ||
    raw['mode'] !== 'SUGGEST_SHADOW' ||
    raw['executionAuthority'] !== 'NONE' ||
    raw['businessEffect'] !== false
  ) {
    return false;
  }
  return digestAosBehaviourRegistry(binding.registry) === binding.configurationDigest;
}
