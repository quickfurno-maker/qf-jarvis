import { describe, expect, it } from 'vitest';
import { createAosBehaviourPolicy, createAosBehaviourRegistry } from '@qf-jarvis/aos-intelligence';

import {
  canonicalAosBehaviourRegistryJson,
  createAosBehaviourDraft,
  createVerifiedAosBehaviourRuntimeBinding,
  digestAosBehaviourRegistry,
  markAosBehaviourOwnerApproved,
  markAosBehaviourSimulated,
  sealAosBehaviourSuggestShadow,
  verifyAosBehaviourRuntimeBinding,
} from '../index.js';

const at = '2026-10-01T06:00:00.000Z';

function policy(threshold: number) {
  return createAosBehaviourPolicy({
    policyId: 'test.vendor-first-contact',
    version: 1,
    lifecycle: 'SUGGESTING',
    title: 'Test vendor first-contact threshold',
    trigger: 'VENDOR_FIRST_CONTACT_MISSING',
    priority: 'P1',
    scope: {
      cityRefs: [],
      localityRefs: [],
      categoryRefs: [],
    },
    conditions: [{ field: 'elapsedMinutes', operator: 'GTE', value: threshold }],
    action: 'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP',
    ownerApprovalRequired: false,
    coreDecisionRequired: true,
    maximumVendorExposureWithoutOwnerApproval: 3,
    communication: {
      cooldownMinutes: 10,
      maxMessagesPer30Days: 8,
      directPhoneAllowed: false,
      maskedOpportunityOnly: true,
    },
  });
}

function registry(threshold: number) {
  return createAosBehaviourRegistry({
    registryRef: 'qfj.aos.behaviour-registry.control-test',
    policies: [policy(threshold)],
  });
}

function approvedShadow(threshold: number) {
  const current = registry(threshold);
  const draft = createAosBehaviourDraft({
    manifestId: 'aos.behaviour.control-test',
    manifestVersion: 1,
    registry: current,
    createdAt: at,
  });
  const simulated = markAosBehaviourSimulated({
    draft,
    registry: current,
    scenarioCount: 500,
    reportRef: 'simulation:aos:control-test',
    generatedAt: at,
    digitalTwinScenarioCount: 500,
    digitalTwinReportRef: 'digital-twin:aos:control-test',
    digitalTwinGeneratedAt: at,
  });
  const approved = markAosBehaviourOwnerApproved({
    simulated,
    registry: current,
    approvalRef: 'owner-approval:aos:control-test',
    approvedAt: at,
  });
  const manifest = sealAosBehaviourSuggestShadow({
    approved,
    registry: current,
  });
  return { current, manifest };
}

describe('AOS behaviour-control cryptographic binding', () => {
  it('produces a stable canonical digest independent of registry input ordering', () => {
    const first = createAosBehaviourRegistry({
      registryRef: 'qfj.aos.behaviour-registry.order-test',
      policies: [policy(20), { ...policy(30), policyId: 'test.vendor-replacement', version: 2 }],
    });
    const firstPolicy = first.policies[0];
    const secondPolicy = first.policies[1];
    if (firstPolicy === undefined || secondPolicy === undefined) {
      throw new Error('behaviour-order-fixture-missing');
    }
    const second = createAosBehaviourRegistry({
      registryRef: first.registryRef,
      policies: [secondPolicy, firstPolicy],
    });

    expect(canonicalAosBehaviourRegistryJson(first)).toBe(
      canonicalAosBehaviourRegistryJson(second),
    );
    expect(digestAosBehaviourRegistry(first)).toBe(digestAosBehaviourRegistry(second));
    expect(digestAosBehaviourRegistry(first)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('changes the digest when a behaviour threshold changes even if IDs and versions are reused', () => {
    expect(digestAosBehaviourRegistry(registry(20))).not.toBe(
      digestAosBehaviourRegistry(registry(15)),
    );
  });

  it('binds simulation and owner approval to the exact configuration digest', () => {
    const { current, manifest } = approvedShadow(20);
    const binding = createVerifiedAosBehaviourRuntimeBinding({
      manifest,
      registry: current,
    });

    expect(binding).toMatchObject({
      protocol: 'qfj.aos.behaviour-binding.v1',
      mode: 'SUGGEST_SHADOW',
      executionAuthority: 'NONE',
      businessEffect: false,
    });
    expect(verifyAosBehaviourRuntimeBinding(binding)).toBe(true);
  });

  it('refuses an old approval after the policy threshold changes', () => {
    const { manifest } = approvedShadow(20);
    const changed = registry(15);

    expect(() =>
      createVerifiedAosBehaviourRuntimeBinding({
        manifest,
        registry: changed,
      }),
    ).toThrow('aos-behaviour-registry-digest-mismatch');
  });

  it('refuses lifecycle shortcuts that skip simulation or owner approval', () => {
    const current = registry(20);
    const draft = createAosBehaviourDraft({
      manifestId: 'aos.behaviour.lifecycle-test',
      manifestVersion: 1,
      registry: current,
      createdAt: at,
    });

    expect(() =>
      markAosBehaviourOwnerApproved({
        simulated: draft,
        registry: current,
        approvalRef: 'owner-approval:aos:shortcut',
        approvedAt: at,
      }),
    ).toThrow('aos-behaviour-approval-transition-invalid');

    expect(() =>
      sealAosBehaviourSuggestShadow({
        approved: draft,
        registry: current,
      }),
    ).toThrow('aos-behaviour-shadow-transition-invalid');
  });
});
