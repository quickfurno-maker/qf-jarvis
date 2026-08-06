import type { ControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';

/**
 * The repository baseline (JOS-01B, ADR-0086).
 *
 * ### What this file is allowed to say
 *
 * Only facts that merged governance and merged code already establish. Every entry below can be
 * checked against a document or a package in this repository; none of it is an observation of a
 * running system, and none of it is invented to fill a panel.
 *
 * That constraint is the entire difference between JOS-01A and JOS-01B. JOS-01A shipped a
 * synthetic snapshot as the default operator surface: plausible conversation counts, a queue with
 * five waiting approvals, a latency curve. It was clearly labelled as demo data, and it was still
 * the wrong default, because the failure mode of a control plane is an operator believing a number.
 *
 * ### Why unreadable sources carry no rows
 *
 * QuickFurno Core is authoritative and there is no adopted Jarvis-to-Core read protocol in this
 * repository. n8n runs on the VPS and Jarvis OS has no adopted protocol to read it either. So both
 * report NOT_CONNECTED, and every section that would depend on them carries no rows and states why.
 *
 * `0 approvals` and `the approval source is not connected` are different facts. Rendering the
 * second as the first is the specific lie this file exists to prevent.
 */

/** Facts about the current merged state, cited so a reviewer can check each one. */
export const BASELINE_FACTS = Object.freeze({
  governedAgents: 4,
  /**
   * The latest MERGED slice of the QFJ execution track.
   *
   * QFJ-P09.03 merged as PR #96 (merge commit `6aba6795`). What merged is DURABILITY for the
   * P09.02 replay guard — a storage adapter with no transport. Neither slice connected anything,
   * so the sections below still report n8n as NOT_CONNECTED for exactly that reason.
   */
  mergedPhase: 'QFJ-P09.03',
  /**
   * The QFJ execution track has NO owner-locked next slice, so there is deliberately no
   * `currentPhase` — exactly as the JOS track has no `nextJosPhase`.
   *
   * A field holding a phase name nobody has locked would be inventing one, and inventing a
   * QFJ-P09.04 to keep a panel populated is precisely the kind of confident falsehood this file
   * exists to refuse. Work in flight on the separately governed Riya Web track is not a QFJ phase
   * and is not rendered as one.
   */
  qfjTrackHasNoLockedSuccessor: true,
  josPhase: 'JOS-01E',
  /**
   * The JOS foundation track CLOSES after JOS-01E; there is deliberately no `nextJosPhase`.
   *
   * Naming a successor would mean inventing one — the same rule `qfjTrackHasNoLockedSuccessor`
   * above now applies to the QFJ track.
   */
  josTrackClosesAfter: 'JOS-01E',
});

const UNREACHABLE = 'No adopted read protocol exists in this repository.';
const LATER_PHASE = 'A governed control-plane adapter, in a later JOS phase.';

type Sections = ControlPlaneSnapshotV1['sections'];

// The wire types are mutable arrays (zod infers them that way). These constants are frozen, so
// they are declared as readonly element arrays and spread at the point of use. The builder owns
// the mutable copy; the baseline stays immutable.
type SystemComponent = ControlPlaneSnapshotV1['system'][number];
type BaselineAgent = ControlPlaneSnapshotV1['agents'][number];
type BaselineRoadmap = ControlPlaneSnapshotV1['roadmap'][number];
type OwnershipItem = Sections['coreSync']['items'][number];

/** A section that cannot be read, stated as such. */
function unreadable(
  availability: 'NOT_CONNECTED' | 'PLANNED' | 'ROLLOUT_OFF',
  reason: string,
  expectedSource: string,
): { availability: typeof availability; reason: string; expectedSource: string; items: [] } {
  return { availability, reason, expectedSource, items: [] };
}

function unreadableSeries(
  id: string,
  label: string,
  reason: string,
  expectedSource: string,
): Sections['conversationActivity'] {
  return {
    availability: 'NOT_CONNECTED',
    reason,
    expectedSource,
    id,
    label,
    points: [],
  };
}

export const BASELINE_SYSTEM: readonly SystemComponent[] = Object.freeze<
  readonly SystemComponent[]
>([
  {
    id: 'jarvis-os-read-api',
    label: 'Jarvis OS read API',
    state: 'AVAILABLE',
    detail: 'Versioned read-only snapshot API. Requires an operator session; not deployed.',
  },
  {
    id: 'operator-authentication',
    label: 'Operator authentication',
    state: 'AVAILABLE',
    detail: 'Argon2id passphrase and TOTP. Grants viewing only; confers no Core authority.',
  },
  {
    id: 'quickfurno-core',
    label: 'QuickFurno Core',
    state: 'NOT_CONNECTED',
    detail: 'Authoritative for business truth. No Jarvis-to-Core read protocol is adopted.',
  },
  {
    id: 'n8n',
    label: 'n8n execution fabric',
    state: 'NOT_CONNECTED',
    detail:
      'Executes approved intents only. QFJ-P09.02 merged the test-only dispatch VALIDATION ' +
      'boundary; the real Core-to-n8n transport is not implemented.',
  },
  {
    id: 'model-gateway',
    label: 'Model gateway',
    state: 'SHADOW',
    detail: 'Provider-neutral gateway merged. Shadow evaluation only; it authorizes nothing.',
  },
  {
    id: 'worker-fleet',
    label: 'Worker fleet',
    state: 'PLANNED',
    detail: 'Local and GPU node topology is a future slice. No discovery runs.',
  },
  {
    id: 'production-rollout',
    label: 'Production rollout',
    state: 'ROLLOUT_OFF',
    detail: 'No communication may reach a real recipient from anywhere in Jarvis.',
  },
]);

export const BASELINE_AGENTS: readonly BaselineAgent[] = Object.freeze<readonly BaselineAgent[]>([
  {
    id: 'jarvis',
    name: 'Jarvis',
    role: 'Coordination, case routing and founder decision support',
    capabilityId: 'jarvis.orchestration',
    lifecycle: 'SHADOW',
    state: 'SHADOW',
    notes: [
      'Coordinates complex and cross-agent cases. It holds no business authority.',
      'Runtime composition is merged and observed only; it authorizes nothing.',
    ],
  },
  {
    id: 'riya',
    name: 'Riya',
    role: 'Customer conversation and qualification',
    capabilityId: 'riya.customer-conversation',
    lifecycle: 'SHADOW',
    state: 'SHADOW',
    notes: [
      'Customer-side routine work only. No vendor authority.',
      'Behaviour package is merged. No live channel is attached.',
    ],
  },
  {
    id: 'aarohi',
    name: 'Aarohi',
    role: 'Vendor growth and acquisition - QuickFurno Vendor Growth Engine',
    capabilityId: 'aarohi.vendor-growth',
    lifecycle: 'PLANNED',
    state: 'PLANNED',
    notes: [
      'Owner-locked product surface. The runtime is PLANNED and DISABLED (ADR-0085).',
      'No autonomous outreach exists, and no channel is attached.',
      'Acquisition only - Aarohi never handles a registered vendor. That is Anisha.',
      'On QuickFurno Core confirming ACTIVE, ownership moves to Anisha.',
      'Registration, activation and paid-active status are QuickFurno Core to record.',
    ],
  },
  {
    id: 'anisha',
    name: 'Anisha',
    role: 'Registered-vendor relationship, support and success',
    capabilityId: 'anisha.vendor-care',
    lifecycle: 'SHADOW',
    state: 'SHADOW',
    notes: [
      'Existing, registered vendors only. Acquiring an unregistered vendor belongs to Aarohi, never to Anisha.',
      'Recommends and supports; it does not authorize commercial change.',
      'Behaviour package is merged. No live channel is attached.',
    ],
  },
]);

export const BASELINE_ROADMAP: readonly BaselineRoadmap[] = Object.freeze<
  readonly BaselineRoadmap[]
>([
  // The two tracks advance independently, so each has its own `next`. A single flat list could
  // not say "QFJ-P09.02 is next" and "JOS-01C is next" at once without one of them being wrong.
  {
    id: 'qfj-p08',
    track: 'QFJ',
    label: 'QFJ-P08 - Consent, approval and human control',
    state: 'merged',
    detail:
      'Approval runtime, durable queue, operator boundary, communication-authorization correlation.',
  },
  {
    id: 'qfj-p09-01',
    track: 'QFJ',
    label: 'QFJ-P09.01 - Execution intent correlation',
    state: 'merged',
    detail: 'Validates a Core-issued ExecutionIntentV1 against re-proved approval evidence.',
  },
  {
    id: 'qfj-p09-02',
    track: 'QFJ',
    label: 'QFJ-P09.02 - Authorized dispatch envelope validation (test-only)',
    state: 'merged',
    // What merged is a VERIFIER. Saying "the n8n bridge merged" would replace one falsehood with
    // its opposite: the boundary holds no transport, and nothing dispatches.
    detail:
      'Test-only Core-to-n8n dispatch validation. The real transport is not implemented and the ' +
      'wire protocol remains PROPOSED.',
  },
  {
    id: 'qfj-p09-03',
    track: 'QFJ',
    label: 'QFJ-P09.03 - Durable execution replay / idempotency store',
    state: 'merged',
    detail:
      'Durability for the P09.02 replay guard. Transport-neutral: it connects nothing and sends ' +
      'nothing, and the wire protocol remains PROPOSED.',
  },
  {
    id: 'qfj-p09',
    track: 'QFJ',
    label: 'QFJ-P09 - Communication lifecycle and provider dispatch',
    state: 'planned',
    detail: 'Eighteen-state lifecycle and provider delivery. Nothing sends today.',
  },
  {
    id: 'qfj-p12-aarohi',
    track: 'QFJ',
    label: 'QFJ-P12 - Aarohi / QVGE overlay AVG-0 to AVG-12',
    state: 'planned',
    detail: 'Owner-locked governance merged (ADR-0085). Runtime is PLANNED and DISABLED.',
  },
  {
    id: 'jos-01a',
    track: 'JOS',
    label: 'JOS-01A - Premium dashboard foundation',
    state: 'merged',
    detail: 'Shell, design system, capability model and the control-plane read seam.',
  },
  {
    id: 'jos-01b',
    track: 'JOS',
    label: 'JOS-01B - Read-only control-plane contract and snapshot API',
    state: 'merged',
    detail: 'Versioned read contract, pure snapshot builder and one GET route.',
  },
  {
    id: 'jos-01c',
    track: 'JOS',
    label: 'JOS-01C - Owner authentication and operator session boundary',
    state: 'merged',
    detail: 'Argon2id passphrase plus TOTP; encrypted, short-lived operator sessions.',
  },
  {
    // Merged. The deployment topology, the release-provenance guards and the Firefox origin
    // correction are all in this build.
    //
    // `merged` describes the CODE. Whether a deployment is currently running is an operational
    // fact, not a repository one, so no marker here claims a live service -- that stays something
    // an operator verifies against the host, never something this build asserts about itself.
    id: 'jos-01d',
    track: 'JOS',
    label: 'JOS-01D - Isolated Docker, VPS and Traefik deployment',
    state: 'merged',
    detail:
      'Immutable per-SHA release, staged ingress and HSTS. This build claims no running service.',
  },
  {
    // `current`, and the LAST slice of the bounded Jarvis OS foundation track.
    id: 'jos-01e',
    track: 'JOS',
    label: 'JOS-01E - Progressive backend read wiring',
    state: 'current',
    detail:
      'Governed read-source composition. No source is adopted yet: none is reachable without a protocol Core and n8n have not adopted.',
  },
]);

export const BASELINE_CORE_SYNC: {
  readonly availability: 'STATIC_BASELINE';
  readonly reason: string;
  readonly expectedSource: string;
  readonly items: readonly OwnershipItem[];
} = Object.freeze({
  availability: 'STATIC_BASELINE',
  reason: 'Ownership is declared by governance, not read from Core.',
  expectedSource: 'QuickFurno Core, once a read protocol is adopted and authenticated.',
  items: Object.freeze<readonly OwnershipItem[]>([
    {
      id: 'customers-leads',
      subject: 'Customers, leads and assignments',
      owner: 'QuickFurno Core',
      detail: 'Core owns them. Jarvis holds no copy and never becomes a second source.',
    },
    {
      id: 'vendors-registration',
      subject: 'Vendor registration, activation and paid-active status',
      owner: 'QuickFurno Core',
      detail: 'Core decides who is a vendor. Aarohi hands off to Anisha on Core ACTIVE.',
    },
    {
      id: 'packages-pricing',
      subject: 'Packages, entitlements and pricing',
      owner: 'QuickFurno Core',
      detail: 'Commercial truth is Core. Never sourced from a model, RAG or enrichment.',
    },
    {
      id: 'consent-dnc',
      subject: 'Consent, opt-out, suppression and do-not-contact',
      owner: 'QuickFurno Core',
      detail: 'Core decides eligibility and revalidates it at execution time.',
    },
    {
      id: 'payments',
      subject: 'Payments and refunds',
      owner: 'QuickFurno Core',
      detail: 'No agent holds payment, refund or entitlement authority by any path.',
    },
    {
      id: 'recommendations',
      subject: 'Recommendations and observations',
      owner: 'QF Jarvis',
      detail: 'Jarvis recommends and observes. A recommendation carries no authority.',
    },
  ]),
});

/** Every operational section, stated at the availability it has actually earned. */
export function baselineSections(): Sections {
  return {
    headlineMetrics: {
      availability: 'STATIC_BASELINE',
      reason: 'Counted from merged governance and merged packages, not from a running system.',
      expectedSource: 'Repository and governance declarations.',
      items: [
        {
          id: 'governed-agents',
          label: 'Governed agents',
          value: String(BASELINE_FACTS.governedAgents),
          caption: 'Jarvis, Riya, Aarohi and Anisha (ADR-0085).',
        },
        {
          id: 'live-integrations',
          label: 'Live integrations',
          value: '0',
          caption: 'Core and n8n are both NOT_CONNECTED. No provider is reachable.',
        },
        {
          id: 'production-rollout',
          label: 'Production rollout',
          value: 'OFF',
          caption: 'No communication may reach a real recipient, in any environment.',
        },
        {
          id: 'merged-phase',
          label: 'Latest merged phase',
          value: BASELINE_FACTS.mergedPhase,
          caption: 'Durable execution replay store. It records; it connects nothing.',
        },
        {
          id: 'next-phase',
          label: 'Main Jarvis is working on',
          // Not a phase name. The QFJ execution track has no owner-locked successor, and a panel
          // that needed one filled in is how a QFJ-P09.04 nobody approved would get invented.
          value: 'No locked QFJ successor',
          caption: 'The next QFJ slice is not owner-locked. Nothing is in flight on this track.',
        },
        {
          id: 'jos-phase',
          label: 'Jarvis OS phase',
          value: BASELINE_FACTS.josPhase,
          caption: 'Isolated deployment topology. Nothing is deployed from this build.',
        },
      ],
    },

    attention: {
      availability: 'STATIC_BASELINE',
      reason: 'Repository and governance notices. Not a live business queue.',
      expectedSource: 'The approval queue, once a governed read adapter is adopted.',
      items: [
        {
          id: 'core-not-connected',
          kind: 'integration',
          title: 'QuickFurno Core is not connected',
          context:
            'No Jarvis-to-Core read protocol has been adopted. Business truth is unreadable from here.',
          severity: 'warning',
        },
        {
          id: 'n8n-not-connected',
          kind: 'integration',
          title: 'n8n is not connected',
          context:
            'QFJ-P09.02 merged the test-only dispatch VALIDATION boundary. The real transport is ' +
            'not implemented and the protocol is not adopted. Nothing dispatches.',
          severity: 'warning',
        },
        {
          id: 'rollout-off',
          kind: 'rollout',
          title: 'Production rollout is off',
          context: 'Live communication send is gated off independently of every other control.',
          severity: 'info',
        },
        {
          id: 'aarohi-planned',
          kind: 'capability',
          title: 'Aarohi has no runtime',
          context:
            'Owner-locked PLANNED surface under ADR-0085. No outreach, no channel, no credential.',
          severity: 'info',
        },
      ],
    },

    activity: {
      availability: 'STATIC_BASELINE',
      reason: 'Merged repository and governance milestones. This is not a live event stream.',
      expectedSource: 'The Jarvis event backbone, once a governed read adapter is adopted.',
      items: [
        {
          id: 'jos-01a-merged',
          source: 'REPOSITORY',
          at: '2026-08-03T12:32:20.000Z',
          message: 'JOS-01A merged: the Jarvis OS premium dashboard foundation.',
        },
        {
          id: 'adr-0085-merged',
          source: 'GOVERNANCE',
          at: '2026-08-03T10:45:17.000Z',
          message: 'ADR-0085 merged: Aarohi adopted as the fourth governed agent under QFJ-P12.',
        },
        {
          id: 'qfj-p09-01-merged',
          source: 'REPOSITORY',
          at: '2026-08-03T07:06:21.000Z',
          message: 'QFJ-P09.01 merged: execution intent correlation. It issues no intent.',
        },
        {
          id: 'qfj-p09-02-merged',
          source: 'REPOSITORY',
          at: '2026-08-06T06:55:21.000Z',
          message:
            'QFJ-P09.02 merged: test-only dispatch validation. It holds no transport and sends nothing.',
        },
        {
          id: 'qfj-p09-03-merged',
          source: 'REPOSITORY',
          at: '2026-08-06T12:12:42.000Z',
          message:
            'QFJ-P09.03 merged: durable execution replay store. It connects nothing and sends nothing.',
        },
      ],
    },

    approvalQueue: unreadable(
      'NOT_CONNECTED',
      'The durable approval queue is merged, and Jarvis OS has no adopted protocol to read it.',
      'A governed control-plane adapter over the approval queue, in a later JOS phase.',
    ),
    approvalBreakdown: unreadable(
      'NOT_CONNECTED',
      'Outcome mix requires the approval source, which is not connected.',
      LATER_PHASE,
    ),
    conversationControl: unreadable(
      'NOT_CONNECTED',
      'Durable conversation control is merged, and this surface has no adopted protocol to read it.',
      LATER_PHASE,
    ),
    conversationActivity: unreadableSeries(
      'conversation-activity',
      'Conversation activity',
      'No conversation source is connected, so there is no traffic to plot.',
      LATER_PHASE,
    ),
    modelLatency: unreadableSeries(
      'model-latency',
      'Model latency',
      'Gateway telemetry has no adopted read protocol in this release.',
      LATER_PHASE,
    ),
    agentWorkload: unreadable(
      'NOT_CONNECTED',
      'Per-agent workload requires a conversation source, which is not connected.',
      LATER_PHASE,
    ),
    vendorGrowthFunnel: unreadable(
      'PLANNED',
      'Aarohi has no runtime. Nothing has been sourced, researched, approved or contacted.',
      'The QVGE acquisition domain (AVG-1 onward), which is PLANNED and DISABLED.',
    ),
    workers: unreadable(
      'PLANNED',
      'Local and GPU node topology is a future slice. No discovery runs.',
      'Worker discovery, in a later phase.',
    ),
    models: unreadable(
      'NOT_CONNECTED',
      'Provider profiles are configuration this surface has no adopted protocol to read.',
      LATER_PHASE,
    ),
    knowledge: unreadable(
      'NOT_CONNECTED',
      'Governed knowledge is merged with retrieval disabled, and is unreadable from here.',
      LATER_PHASE,
    ),
    evaluations: unreadable(
      'NOT_CONNECTED',
      'Evaluation evidence lives with the suites and has no adopted read protocol.',
      LATER_PHASE,
    ),
    coreSync: { ...BASELINE_CORE_SYNC, items: [...BASELINE_CORE_SYNC.items] },
    businessAnalytics: unreadable(
      'NOT_CONNECTED',
      'Business analytics are QuickFurno Core truth, and Core is not connected.',
      'QuickFurno Core, once a read protocol is adopted and authenticated.',
    ),
    n8nExecution: unreadable(
      'NOT_CONNECTED',
      'n8n executes approved intents. Jarvis OS has no adopted protocol to read its state.',
      'The real Core-to-n8n execution transport, which is not implemented. QFJ-P09.02 merged only ' +
        'the test-only validation boundary.',
    ),
  };
}

export { UNREACHABLE, LATER_PHASE };
