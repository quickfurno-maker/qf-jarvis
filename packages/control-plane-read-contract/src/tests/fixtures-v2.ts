import type { ControlPlaneSnapshotV2 } from '../contract/snapshot-v2.js';

/**
 * A minimal VALID V2 snapshot, used as the base for negative cases (AVG-11, ADR-0129).
 *
 * Deliberately a sibling of `fixtures.ts` rather than a transformation of it. A V2 fixture derived
 * from the V1 one by patching two sections would silently inherit whatever V1 does next, and the
 * point of a version boundary is that the two are allowed to diverge.
 */
export function validSnapshotV2(): ControlPlaneSnapshotV2 {
  return {
    contractVersion: '2',
    generatedAt: '2026-08-03T12:00:00.000Z',
    mode: 'READ_ONLY',
    source: {
      kind: 'REPOSITORY_BASELINE',
      freshness: 'BUILD_DECLARATION',
      liveOperationalData: false,
    },
    authority: {
      jarvis: 'RECOMMENDS_AND_OBSERVES',
      quickfurnoCore: 'AUTHORIZES_AND_OWNS_BUSINESS_TRUTH',
      n8n: 'EXECUTES_ONLY',
      provider: 'DELIVERS_ONLY',
    },
    rollout: { enabled: false, state: 'ROLLOUT_OFF' },
    system: [
      {
        id: 'quickfurno-core',
        label: 'QuickFurno Core',
        state: 'NOT_CONNECTED',
        detail: 'Authoritative. No Jarvis-to-Core read protocol has been adopted.',
      },
    ],
    capabilities: [
      {
        id: 'aarohi.vendor-growth',
        label: 'Aarohi vendor growth',
        lifecycle: 'PLANNED',
        note: 'Owner-locked PLANNED surface under ADR-0085. No outreach, no channel, no credential.',
      },
    ],
    agents: [
      {
        id: 'aarohi',
        name: 'Aarohi',
        role: 'Vendor growth and acquisition - QuickFurno Vendor Growth Engine',
        capabilityId: 'aarohi.vendor-growth',
        lifecycle: 'PLANNED',
        state: 'PLANNED',
        notes: ['Owner-locked product surface. The runtime is PLANNED and DISABLED (ADR-0085).'],
      },
    ],
    roadmap: [
      {
        id: 'qfj-p12-aarohi',
        label: 'QFJ-P12 - Aarohi / QVGE overlay AVG-0 to AVG-12',
        track: 'QFJ',
        state: 'planned',
        detail: 'Owner-locked governance merged (ADR-0085). Runtime is PLANNED and DISABLED.',
      },
    ],
    sections: {
      headlineMetrics: emptySection('STATIC_BASELINE'),
      attention: emptySection('STATIC_BASELINE'),
      activity: emptySection('STATIC_BASELINE'),
      approvalQueue: emptySection('NOT_CONNECTED'),
      approvalBreakdown: emptySection('NOT_CONNECTED'),
      conversationControl: emptySection('NOT_CONNECTED'),
      conversationActivity: emptySeries('conversation-activity', 'Conversation activity'),
      modelLatency: emptySeries('model-latency', 'Model latency'),
      agentWorkload: emptySection('NOT_CONNECTED'),
      vendorGrowthFunnel: emptySection('PLANNED'),
      aarohiAcquisitionReadiness: emptySection('STATIC_BASELINE'),
      workers: emptySection('PLANNED'),
      models: emptySection('NOT_CONNECTED'),
      knowledge: emptySection('NOT_CONNECTED'),
      evaluations: emptySection('NOT_CONNECTED'),
      coreSync: emptySection('STATIC_BASELINE'),
      businessAnalytics: emptySection('NOT_CONNECTED'),
      n8nExecution: emptySection('NOT_CONNECTED'),
    },
  };
}

/**
 * An unreadable section, generic in its item type.
 *
 * The wire types are mutable (zod infers them that way), so the arrays here are mutable too -- a
 * fixture is a value under construction, not a published contract.
 */
function emptySection(availability: 'STATIC_BASELINE' | 'NOT_CONNECTED' | 'PLANNED'): {
  availability: typeof availability;
  reason: string;
  expectedSource: string;
  items: never[];
} {
  return {
    availability,
    reason: 'Declared by merged repository governance; not read from a running system.',
    expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
    items: [],
  };
}

function emptySeries(
  id: string,
  label: string,
): ControlPlaneSnapshotV2['sections']['conversationActivity'] {
  return {
    availability: 'NOT_CONNECTED',
    reason: 'No source is connected, so there is nothing to plot.',
    expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
    id,
    label,
    points: [],
  };
}

/** A mutable clone, for tests that break exactly one thing. */
export function mutableSnapshotV2(): Record<string, unknown> {
  return structuredClone(validSnapshotV2());
}
