import type { ControlPlaneSnapshotV1 } from '../contract/snapshot.js';

/**
 * A minimal VALID snapshot, used as the base for negative cases.
 *
 * Every test below mutates one field of a clone of this and asserts the parse fails. That only
 * proves anything if the base itself parses, so the first test in the suite checks exactly that —
 * otherwise a typo here would make every negative test pass for the wrong reason.
 */
export function validSnapshot(): ControlPlaneSnapshotV1 {
  return {
    contractVersion: '1',
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
        id: 'execution.intent.validate',
        label: 'Execution intent correlation',
        lifecycle: 'AVAILABLE',
        note: 'QFJ-P09.01 merged. Validates a Core-issued intent; issues none.',
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
        notes: ['Owner-locked product surface. The runtime is PLANNED and DISABLED.'],
      },
    ],
    roadmap: [
      {
        id: 'qfj-p09-02',
        label: 'QFJ-P09.02',
        track: 'QFJ',
        state: 'next',
        detail: 'Test-only authorized dispatch envelope and n8n bridge validation.',
      },
    ],
    sections: {
      headlineMetrics: {
        availability: 'STATIC_BASELINE',
        reason: 'Declared by merged repository governance.',
        expectedSource: 'Repository and governance declarations.',
        items: [
          {
            id: 'governed-agents',
            label: 'Governed agents',
            value: '4',
            caption: 'Jarvis, Riya, Aarohi and Anisha (ADR-0085).',
          },
        ],
      },
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
 * The wire types are mutable (zod infers them that way), so the arrays here are mutable too --
 * a `readonly never[]` will not satisfy `T[]`, and widening the fixture is the wrong direction.
 */
function emptySection(availability: 'STATIC_BASELINE' | 'NOT_CONNECTED' | 'PLANNED'): {
  availability: 'STATIC_BASELINE' | 'NOT_CONNECTED' | 'PLANNED';
  reason: string;
  expectedSource: string;
  items: never[];
} {
  return {
    availability,
    reason: 'No adopted read protocol exists in this release.',
    expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
    items: [],
  };
}

function emptySeries(
  id: string,
  label: string,
): {
  availability: 'NOT_CONNECTED';
  reason: string;
  expectedSource: string;
  id: string;
  label: string;
  points: { label: string; value: number }[];
} {
  return {
    availability: 'NOT_CONNECTED',
    reason: 'No adopted read protocol exists in this release.',
    expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
    id,
    label,
    points: [],
  };
}

/** A structural clone that tests may mutate freely. */
export function mutableSnapshot(): Record<string, unknown> {
  // JSON round-trip rather than structuredClone: it produces a plain `any`, so the assertion to a
  // mutable record is meaningful rather than a no-op the linter rejects.
  return JSON.parse(JSON.stringify(validSnapshot())) as Record<string, unknown>;
}
