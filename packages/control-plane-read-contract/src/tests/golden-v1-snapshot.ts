/**
 * A GOLDEN pre-AVG-11 V1 snapshot (ADR-0129).
 *
 * ### Why this is a frozen literal and not a builder
 *
 * Every other fixture in this package is written against the CURRENT types, so it moves when the
 * types move — which is exactly what you want for testing today's shape and exactly wrong for
 * testing compatibility. A compatibility fixture that tracks the code cannot fail: change the
 * contract, and the fixture changes with it.
 *
 * So this is a literal, typed `unknown`, transcribed from what a V1 producer emitted BEFORE AVG-11
 * existed. It carries no `aarohiAcquisitionReadiness` section, and its funnel stages are the old
 * generic `{ id, label, value, caption }` shape with free-form identifiers — including `registered`
 * and `paid-active`, which the V2 vocabulary deliberately refuses.
 *
 * If `parseControlPlaneSnapshotV1` ever stops accepting this payload, a shipped client stopped being
 * able to read the contract it was built against. That is the whole point of the file.
 */
export const GOLDEN_V1_SNAPSHOT_PRE_AVG11: unknown = Object.freeze({
  contractVersion: '1',
  generatedAt: '2026-08-06T09:14:02.000Z',
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
      detail: 'Authoritative for business truth. No Jarvis-to-Core read protocol is adopted.',
    },
    {
      id: 'production-rollout',
      label: 'Production rollout',
      state: 'ROLLOUT_OFF',
      detail: 'No communication may reach a real recipient from anywhere in Jarvis.',
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
      id: 'jos-01b',
      label: 'JOS-01B - Read-only control-plane contract and snapshot API',
      track: 'JOS',
      state: 'merged',
      detail: 'Versioned read contract, pure snapshot builder and one GET route.',
    },
  ],
  sections: {
    headlineMetrics: {
      availability: 'STATIC_BASELINE',
      reason: 'Counted from merged governance and merged packages, not from a running system.',
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
    attention: {
      availability: 'STATIC_BASELINE',
      reason: 'Repository and governance notices. Not a live business queue.',
      expectedSource: 'The approval queue, once a governed read adapter is adopted.',
      items: [
        {
          id: 'aarohi-planned',
          kind: 'capability',
          title: 'Aarohi has no runtime',
          context: 'Owner-locked PLANNED surface under ADR-0085. No outreach, no channel.',
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
          id: 'adr-0085-merged',
          source: 'GOVERNANCE',
          at: '2026-08-03T10:45:17.000Z',
          message: 'ADR-0085 merged: Aarohi adopted as the fourth governed agent under QFJ-P12.',
        },
      ],
    },
    approvalQueue: {
      availability: 'NOT_CONNECTED',
      reason:
        'The durable approval queue is merged, and Jarvis OS has no adopted protocol to read it.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    approvalBreakdown: {
      availability: 'NOT_CONNECTED',
      reason: 'Outcome mix requires the approval source, which is not connected.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    conversationControl: {
      availability: 'NOT_CONNECTED',
      reason: 'Durable conversation control is merged, and this surface cannot read it.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    conversationActivity: {
      availability: 'NOT_CONNECTED',
      reason: 'No conversation source is connected, so there is no traffic to plot.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      id: 'conversation-activity',
      label: 'Conversation activity',
      points: [],
    },
    modelLatency: {
      availability: 'NOT_CONNECTED',
      reason: 'Gateway telemetry has no adopted read protocol in this release.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      id: 'model-latency',
      label: 'Model latency',
      points: [],
    },
    agentWorkload: {
      availability: 'NOT_CONNECTED',
      reason: 'Per-agent workload requires a conversation source, which is not connected.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    /**
     * The pre-AVG-11 funnel, POPULATED, in the shape V1 has always had.
     *
     * Free-form identifiers, a bare `value`, and no authority anywhere — and two stage ids
     * (`registered`, `paid-active`) that AVG-11 concluded a Jarvis surface must never publish. V1
     * accepted them, a shipped client parsed them, and V1 must go on accepting them.
     */
    vendorGrowthFunnel: {
      availability: 'STATIC_BASELINE',
      reason: 'Planned stages, declared by governance. Nothing has run.',
      expectedSource: 'The QVGE acquisition domain (AVG-1 onward), which is PLANNED and DISABLED.',
      items: [
        { id: 'sourced', label: 'Sourced', value: 0, caption: 'Prospect discovery - planned' },
        { id: 'researched', label: 'Researched', value: 0, caption: 'Enrichment queue - planned' },
        { id: 'contacted', label: 'Contacted', value: 0, caption: 'No channel is attached' },
        { id: 'registered', label: 'Registered', value: 0, caption: 'Core owns registration' },
        {
          id: 'paid-active',
          label: 'Paid active',
          value: 0,
          caption: 'Core owns commercial outcome',
        },
      ],
    },
    workers: {
      availability: 'PLANNED',
      reason: 'Local and GPU node topology is a future slice. No discovery runs.',
      expectedSource: 'Worker discovery, in a later phase.',
      items: [],
    },
    models: {
      availability: 'NOT_CONNECTED',
      reason: 'Provider profiles are configuration this surface cannot read.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    knowledge: {
      availability: 'NOT_CONNECTED',
      reason: 'Governed knowledge is merged with retrieval disabled, and is unreadable from here.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    evaluations: {
      availability: 'NOT_CONNECTED',
      reason: 'Evaluation evidence lives with the suites and has no adopted read protocol.',
      expectedSource: 'A governed control-plane adapter, in a later JOS phase.',
      items: [],
    },
    coreSync: {
      availability: 'STATIC_BASELINE',
      reason: 'Ownership is declared by governance, not read from Core.',
      expectedSource: 'QuickFurno Core, once a read protocol is adopted and authenticated.',
      items: [
        {
          id: 'vendors-registration',
          subject: 'Vendor registration, activation and paid-active status',
          owner: 'QuickFurno Core',
          detail: 'Core decides who is a vendor. Aarohi hands off to Anisha on Core ACTIVE.',
        },
      ],
    },
    businessAnalytics: {
      availability: 'NOT_CONNECTED',
      reason: 'Business analytics are QuickFurno Core truth, and Core is not connected.',
      expectedSource: 'QuickFurno Core, once a read protocol is adopted and authenticated.',
      items: [],
    },
    n8nExecution: {
      availability: 'NOT_CONNECTED',
      reason: 'n8n executes approved intents. Jarvis OS has no adopted protocol to read its state.',
      expectedSource: 'The real Core-to-n8n execution transport, which is not implemented.',
      items: [],
    },
  },
});
