import { z } from 'zod';

import {
  CONTROL_PLANE_READ_CONTRACT_VERSION,
  agentIdSchema,
  sectionAvailabilitySchema,
  canonicalInstantSchema,
  capabilityLifecycleSchema,
  displayValueSchema,
  healthStateSchema,
  identifierSchema,
  labelSchema,
  sectionCarriesUnearnedItems,
  sectionSchema,
  sentenceSchema,
} from './primitives.js';

/**
 * The `ControlPlaneSnapshotV1` wire contract (JOS-01B, ADR-0086).
 *
 * ### This contract cannot express authority, by construction
 *
 * There is no `canSend`, `canExecute`, `isAuthorized`, `consentValid`, `approvalGranted` or
 * `dispatchAllowed` in this file, and every object is `.strict()`, so there is nowhere to smuggle
 * one in later without editing this file and failing review. That is deliberate and permanent:
 * QuickFurno Core authorizes, n8n executes, providers deliver. A read surface that could carry a
 * permission bit would become a second source of business truth, which ADR-0001 forbids outright.
 *
 * There are also no methods. A JSON contract with a method is not a contract, it is an API client,
 * and an Android app parsing this must get data and nothing that can act.
 *
 * ### Everything is bounded
 *
 * Strings have maximum lengths and arrays have maximum sizes. This is not defensive decoration:
 * unbounded fields are how a stack trace, a raw WhatsApp body or an entire table ends up rendered
 * in an operator's browser. The bounds are stated once, here, before anything depends on the slack.
 */

/**
 * Where the DATA came from, and how fresh the underlying FACTS are.
 *
 * ### `source.freshness` is not `generatedAt`
 *
 * This distinction is the whole reason the two fields are separate, and getting it wrong is the
 * defect this schema now makes unrepresentable. Serving a response stamps a new instant on the
 * envelope; it does not re-read anything. A deployed binary could be a week old, answer every
 * request with a brand-new timestamp, and still be reciting facts compiled into it at build time.
 *
 * So `generatedAt` answers "when was this JSON produced" and `freshness` answers "when were the
 * underlying facts last actually observed". A request may move the first. It may never move the
 * second.
 *
 * There is deliberately no `NOT_CONNECTED` freshness. Connectivity is a per-section fact and
 * `SectionAvailability` already owns it; a second, coarser copy at snapshot level could only
 * disagree with the sections beneath it.
 */
export const snapshotSourceSchema = z
  .object({
    /**
     * `REPOSITORY_BASELINE` — declared by merged repository and governance state, compiled in.
     * `LIVE_ADAPTER` — read from an adopted runtime source. No such adapter exists in this release.
     * `DEMO_FIXTURE` — synthetic. Test and visual-fixture use only; never the default surface.
     */
    kind: z.enum(['REPOSITORY_BASELINE', 'LIVE_ADAPTER', 'DEMO_FIXTURE']),
    /**
     * When the underlying FACTS were observed.
     *
     * `BUILD_DECLARATION` — fixed when this build was produced. `REQUEST_TIME` — genuinely
     * re-read while answering this request, which only a live adapter can honestly claim.
     */
    freshness: z.enum(['REQUEST_TIME', 'BUILD_DECLARATION']),
    /**
     * Whether ANY figure in this snapshot is a live operational observation.
     *
     * A single boolean the client can render without interpretation. In this release it is always
     * false, and the contract does not assume it stays false — that is what makes it useful later.
     */
    liveOperationalData: z.boolean(),
  })
  .strict();

/**
 * The permanent authority boundary, restated on every snapshot.
 *
 * Every value is a literal. A client cannot receive a snapshot claiming Jarvis authorizes anything,
 * because no such snapshot can be constructed — and repeating the boundary on the wire means a
 * future Android client inherits it without re-deriving it from prose.
 */
export const authorityBoundarySchema = z
  .object({
    jarvis: z.literal('RECOMMENDS_AND_OBSERVES'),
    quickfurnoCore: z.literal('AUTHORIZES_AND_OWNS_BUSINESS_TRUTH'),
    n8n: z.literal('EXECUTES_ONLY'),
    provider: z.literal('DELIVERS_ONLY'),
  })
  .strict();

/**
 * Production rollout posture.
 *
 * `enabled` is `z.literal(false)`. In V1 there is no true. Making it a literal rather than a
 * boolean means a snapshot claiming rollout is on cannot be parsed at all, so no client can be
 * talked into showing a live-send affordance by a malformed or hostile payload.
 */
export const rolloutSchema = z
  .object({
    enabled: z.literal(false),
    state: z.literal('ROLLOUT_OFF'),
  })
  .strict();

export const systemComponentSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    state: healthStateSchema,
    detail: sentenceSchema,
  })
  .strict();

/** A dotted lowercase capability id, shared by the capability list and the agent that owns it. */
export const capabilityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9.-]*$/u, 'must be a dotted lowercase capability id');

export const capabilitySchema = z
  .object({
    id: capabilityIdSchema,
    label: labelSchema,
    lifecycle: capabilityLifecycleSchema,
    note: sentenceSchema,
  })
  .strict();

export const agentSchema = z
  .object({
    id: agentIdSchema,
    name: labelSchema,
    /** The one-line scope. Aarohi and Anisha never share one (ADR-0085). */
    role: sentenceSchema,
    capabilityId: capabilityIdSchema,
    lifecycle: capabilityLifecycleSchema,
    state: healthStateSchema,
    /** Scope and boundary clauses, printed verbatim. The UI composes none of them. */
    notes: z.array(sentenceSchema).max(12),
  })
  .strict();

/**
 * A roadmap marker.
 *
 * `track` exists because the main Jarvis backend and the Jarvis OS product overlay advance
 * independently, and a single flat list of states cannot say "QFJ-P09.02 is next" and
 * "JOS-01C is next" at the same time without one of them being wrong.
 *
 * `current` exists because `next` was wrong for the slice a build is actually running. Marking
 * JOS-01B as `next` inside a build that IS JOS-01B is false on the day it ships and stays false.
 * `current` describes the software slice in this build — not a GitHub merge state, which the
 * repository is not the right place to track and which would invalidate itself on merge.
 */
export const roadmapMarkerSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    track: z.enum(['QFJ', 'JOS']),
    state: z.enum(['merged', 'current', 'next', 'planned']),
    detail: sentenceSchema,
  })
  .strict();

export const metricSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    value: displayValueSchema,
    unit: z.string().max(16).optional(),
    caption: sentenceSchema,
  })
  .strict();

export const seriesPointSchema = z
  .object({
    label: z.string().min(1).max(16),
    value: z.number().nonnegative().max(1_000_000_000),
  })
  .strict();

/**
 * A time series, wrapped in its own availability.
 *
 * A chart is the easiest place in a control plane to tell a lie: a flat line at zero across
 * twenty-four hours looks like a quiet night, not like a source nobody has connected. So an
 * unavailable series carries no points at all and the client is obliged to render the reason.
 */
export const seriesSectionSchema = z
  .object({
    availability: sectionAvailabilitySchema,
    reason: sentenceSchema,
    expectedSource: sentenceSchema,
    id: identifierSchema,
    label: labelSchema,
    points: z.array(seriesPointSchema).max(288),
  })
  .strict();

export const distributionSliceSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    value: z.number().nonnegative().max(1_000_000_000),
  })
  .strict();

/**
 * The certified Aarohi acquisition funnel stages (AVG-11, ADR-0128).
 *
 * A CLOSED vocabulary, restated here in the contract's own lowercase identifier spelling. The
 * domain package that derives these counts is framework-neutral and deliberately unimported by any
 * app, so the wire cannot import it either; a spec in that package compares the two lists token for
 * token, which is the same trade `compose.ts` makes for the canonical-instant grammar.
 *
 * The point of closing it is what the vocabulary CANNOT say. There is no `registered`, `paid`,
 * `active`, `converted` or `contacted` stage, so no adapter — present or future, in this repository
 * or in an Android client — can publish a QuickFurno business outcome through this section. The two
 * stages that come closest each say ASSISTANCE, in their own token.
 */
export const AAROHI_FUNNEL_STAGE_IDS = [
  'prospect-identified',
  'eligibility-evaluated',
  'eligible-net-new',
  'outreach-workspace-prepared',
  'conversation-observed',
  'commercial-context-prepared',
  'registration-assistance-prepared',
  'payment-followup-assistance-prepared',
  'core-active-handoff-confirmed',
] as const;

export const funnelStageIdSchema = z.enum(AAROHI_FUNNEL_STAGE_IDS);
export type FunnelStageId = (typeof AAROHI_FUNNEL_STAGE_IDS)[number];

/**
 * Who is entitled to be believed about one figure (AVG-11, ADR-0128).
 *
 * Deliberately a THIRD concept, beside `SectionAvailability` (can this panel be read?) and
 * `SnapshotSource` (where did this payload come from?). Those two describe a transport; this
 * describes authority over a single number, and collapsing them is how "Core is not connected"
 * comes to render as "none".
 */
export const METRIC_AUTHORITIES = [
  /** Counted from Jarvis-side artifacts. True about Aarohi's own work and about nothing else. */
  'JARVIS_WORKFLOW_DERIVED',
  /** Established by canonical QuickFurno Core evidence. The only class a business outcome may carry. */
  'CORE_AUTHORITATIVE',
  /** No source was read. NOT zero — and this variant carries no `value` at all. */
  'AUTHORITY_UNAVAILABLE',
] as const;

export const metricAuthoritySchema = z.enum(METRIC_AUTHORITIES);
export type MetricAuthority = (typeof METRIC_AUTHORITIES)[number];

export const resolvedMetricAuthoritySchema = z.enum([
  'JARVIS_WORKFLOW_DERIVED',
  'CORE_AUTHORITATIVE',
]);
export type ResolvedMetricAuthority = z.infer<typeof resolvedMetricAuthoritySchema>;

/**
 * One funnel stage, and the reason an unavailable one cannot be rendered as zero.
 *
 * A discriminated union on `authority`, and the discrimination IS the guarantee. The readable
 * variants carry `value`; the unavailable variant has no `value` key at all, so a client, a mapper,
 * a default or a `?? 0` has nothing to read. `expectedAuthority` names the class that would have
 * owned the number, which is what a surface needs to explain the gap without inventing one.
 *
 * `SectionAvailability` still governs the section as a whole. This is finer: a funnel can be
 * readable, and still have one stage whose authority nobody has connected.
 */
export const funnelStageSchema = z.discriminatedUnion('authority', [
  z
    .object({
      id: funnelStageIdSchema,
      label: labelSchema,
      authority: z.literal('JARVIS_WORKFLOW_DERIVED'),
      value: z.number().int().nonnegative().max(1_000_000_000),
      caption: sentenceSchema,
    })
    .strict(),
  z
    .object({
      id: funnelStageIdSchema,
      label: labelSchema,
      authority: z.literal('CORE_AUTHORITATIVE'),
      value: z.number().int().nonnegative().max(1_000_000_000),
      caption: sentenceSchema,
    })
    .strict(),
  z
    .object({
      id: funnelStageIdSchema,
      label: labelSchema,
      authority: z.literal('AUTHORITY_UNAVAILABLE'),
      expectedAuthority: resolvedMetricAuthoritySchema,
      caption: sentenceSchema,
    })
    .strict(),
]);

/**
 * One row of the Aarohi acquisition readiness surface (AVG-11, ADR-0128).
 *
 * Readiness is not a metric and carries no number, which is why it has no authority field: it says
 * what exists in merged governance and what does not, and `HealthState` already spells both. A
 * `blocker` row is the honest name for a bridge this repository decided NOT to build — the
 * post-registration continuation boundary and the entry into `AWAITING_CORE_ACTIVATION` are both
 * absent on purpose (ADR-0127), and a surface that quietly omitted them would read as complete.
 */
export const AAROHI_READINESS_KINDS = ['offline-domain', 'boundary', 'blocker'] as const;
export const aarohiReadinessKindSchema = z.enum(AAROHI_READINESS_KINDS);
export type AarohiReadinessKind = (typeof AAROHI_READINESS_KINDS)[number];

/**
 * Stage to authority, TOTAL over the wire vocabulary and mirroring the domain's own map.
 *
 * Checked centrally in the snapshot parser rather than per-variant, so a violation names the
 * offending stage. The single `CORE_AUTHORITATIVE` entry is the whole reason this map exists: a
 * confirmed handoff is Core's fact, and no adapter may publish it under any other class.
 */
export const AAROHI_FUNNEL_STAGE_AUTHORITY: Readonly<
  Record<FunnelStageId, ResolvedMetricAuthority>
> = Object.freeze({
  'prospect-identified': 'JARVIS_WORKFLOW_DERIVED',
  'eligibility-evaluated': 'JARVIS_WORKFLOW_DERIVED',
  'eligible-net-new': 'JARVIS_WORKFLOW_DERIVED',
  'outreach-workspace-prepared': 'JARVIS_WORKFLOW_DERIVED',
  'conversation-observed': 'JARVIS_WORKFLOW_DERIVED',
  'commercial-context-prepared': 'JARVIS_WORKFLOW_DERIVED',
  'registration-assistance-prepared': 'JARVIS_WORKFLOW_DERIVED',
  'payment-followup-assistance-prepared': 'JARVIS_WORKFLOW_DERIVED',
  'core-active-handoff-confirmed': 'CORE_AUTHORITATIVE',
});

export const aarohiReadinessRowSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    kind: aarohiReadinessKindSchema,
    state: healthStateSchema,
    detail: sentenceSchema,
  })
  .strict();

export const attentionItemSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['governance', 'capability', 'rollout', 'integration']),
    title: labelSchema,
    context: sentenceSchema,
    severity: z.enum(['critical', 'warning', 'info']),
  })
  .strict();

export const activityEntrySchema = z
  .object({
    id: identifierSchema,
    /** Where the fact came from. `REPOSITORY` and `GOVERNANCE` are the only sources this release has. */
    source: z.enum(['REPOSITORY', 'GOVERNANCE']),
    at: canonicalInstantSchema,
    message: sentenceSchema,
  })
  .strict();

export const ownershipRowSchema = z
  .object({
    id: identifierSchema,
    subject: labelSchema,
    owner: z.enum(['QuickFurno Core', 'QF Jarvis']),
    detail: sentenceSchema,
  })
  .strict();

export const approvalRowSchema = z
  .object({
    id: identifierSchema,
    requestedAction: labelSchema,
    risk: z.enum([
      'informational',
      'low-risk-reversible',
      'client-or-vendor-facing',
      'money-related',
      'high-risk',
    ]),
    requestedAuthority: labelSchema,
    sourceAgent: labelSchema,
    subject: labelSchema,
    state: z.enum(['awaiting-core', 'awaiting-operator', 'answered']),
  })
  .strict();

export const conversationControlRowSchema = z
  .object({
    id: identifierSchema,
    subject: labelSchema,
    agent: labelSchema,
    humanTakeover: z.boolean(),
    aiPaused: z.boolean(),
    revision: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();

export const workerNodeSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    kind: z.enum(['control-plane', 'local-node', 'gpu-node']),
    state: healthStateSchema,
    capacity: displayValueSchema,
    detail: sentenceSchema,
  })
  .strict();

export const modelProfileSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    provider: labelSchema,
    state: healthStateSchema,
    dataClass: z.enum(['external-provider', 'local-only']),
    detail: sentenceSchema,
  })
  .strict();

export const knowledgeNamespaceSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    owner: labelSchema,
    state: healthStateSchema,
    detail: sentenceSchema,
  })
  .strict();

export const evaluationDimensionSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    state: healthStateSchema,
    detail: sentenceSchema,
  })
  .strict();

/**
 * The operational sections.
 *
 * Each is separately available or not. That granularity matters: "the approval queue is
 * unreachable" and "there are no models configured" are different facts, and collapsing them into
 * one page-level banner is how an operator stops reading banners.
 */
export const sectionsSchema = z
  .object({
    headlineMetrics: sectionSchema(metricSchema, 12),
    attention: sectionSchema(attentionItemSchema, 24),
    activity: sectionSchema(activityEntrySchema, 40),
    approvalQueue: sectionSchema(approvalRowSchema, 200),
    approvalBreakdown: sectionSchema(distributionSliceSchema, 12),
    conversationControl: sectionSchema(conversationControlRowSchema, 200),
    conversationActivity: seriesSectionSchema,
    modelLatency: seriesSectionSchema,
    agentWorkload: sectionSchema(distributionSliceSchema, 12),
    vendorGrowthFunnel: sectionSchema(funnelStageSchema, 12),
    aarohiAcquisitionReadiness: sectionSchema(aarohiReadinessRowSchema, 24),
    workers: sectionSchema(workerNodeSchema, 64),
    models: sectionSchema(modelProfileSchema, 32),
    knowledge: sectionSchema(knowledgeNamespaceSchema, 32),
    evaluations: sectionSchema(evaluationDimensionSchema, 32),
    coreSync: sectionSchema(ownershipRowSchema, 32),
    businessAnalytics: sectionSchema(distributionSliceSchema, 24),
    n8nExecution: sectionSchema(distributionSliceSchema, 24),
  })
  .strict();

export const controlPlaneSnapshotV1Schema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_READ_CONTRACT_VERSION),
    /**
     * When this JSON snapshot was PRODUCED — not when the facts in it were observed.
     * See `snapshotSourceSchema`: `source.freshness` owns that, and a request cannot move it.
     */
    generatedAt: canonicalInstantSchema,
    /** There is no other mode in V1, and adding one is a contract-version decision. */
    mode: z.literal('READ_ONLY'),
    source: snapshotSourceSchema,
    authority: authorityBoundarySchema,
    rollout: rolloutSchema,
    system: z.array(systemComponentSchema).max(24),
    capabilities: z.array(capabilitySchema).max(64),
    agents: z.array(agentSchema).max(8),
    roadmap: z.array(roadmapMarkerSchema).max(32),
    sections: sectionsSchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    // "Unreadable is not empty." Checked centrally so the failure names the offending section.
    for (const [name, section] of Object.entries(snapshot.sections)) {
      const items = 'items' in section ? section.items : section.points;
      if (sectionCarriesUnearnedItems({ availability: section.availability, items })) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', name],
          message: `${section.availability} section must carry no rows: an unreadable source is not an empty one`,
        });
      }
    }

    // Cross-field source invariants: the combinations that are simply impossible.
    //
    // A compiled-in baseline cannot become fresher because someone made a request. Stating this in
    // the parser rather than in a builder means no future caller -- and no future client, on any
    // platform -- can construct the claim at all.
    const { kind, freshness, liveOperationalData } = snapshot.source;

    if (liveOperationalData && kind !== 'LIVE_ADAPTER') {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'liveOperationalData'],
        message: 'only a LIVE_ADAPTER source may report live operational data',
      });
    }

    if (kind === 'REPOSITORY_BASELINE' && freshness !== 'BUILD_DECLARATION') {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'freshness'],
        message:
          'a REPOSITORY_BASELINE is compiled in and is always BUILD_DECLARATION: serving a request re-reads nothing',
      });
    }

    if (kind === 'DEMO_FIXTURE' && freshness !== 'BUILD_DECLARATION') {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'freshness'],
        message: 'a DEMO_FIXTURE observes nothing and is always BUILD_DECLARATION',
      });
    }

    if (kind === 'LIVE_ADAPTER' && liveOperationalData && freshness !== 'REQUEST_TIME') {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'freshness'],
        message: 'a LIVE_ADAPTER claiming live operational data must have read it at REQUEST_TIME',
      });
    }

    // A funnel stage may not claim an authority its stage does not own, and may not appear twice.
    //
    // Checked here for the same reason "unreadable is not empty" is: the rule belongs in exactly one
    // place, and a violation should name the section rather than surface as a generic union error.
    const funnelIds = snapshot.sections.vendorGrowthFunnel.items.map((stage) => stage.id);
    if (new Set(funnelIds).size !== funnelIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections', 'vendorGrowthFunnel'],
        message: 'funnel stage ids must be unique',
      });
    }
    for (const stage of snapshot.sections.vendorGrowthFunnel.items) {
      const owned = AAROHI_FUNNEL_STAGE_AUTHORITY[stage.id];
      const claimed =
        stage.authority === 'AUTHORITY_UNAVAILABLE' ? stage.expectedAuthority : stage.authority;
      if (claimed !== owned) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', 'vendorGrowthFunnel', stage.id],
          message: `stage ${stage.id} is ${owned}: a metric may not claim an authority its stage does not own`,
        });
      }
    }

    // Agent ids are the primary key of the agent list; a duplicate would silently hide one.
    const agentIds = snapshot.agents.map((agent) => agent.id);
    if (new Set(agentIds).size !== agentIds.length) {
      ctx.addIssue({ code: 'custom', path: ['agents'], message: 'agent ids must be unique' });
    }
  });

export type ControlPlaneSnapshotV1 = z.infer<typeof controlPlaneSnapshotV1Schema>;
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;
export type AuthorityBoundary = z.infer<typeof authorityBoundarySchema>;
export type RolloutPosture = z.infer<typeof rolloutSchema>;
export type SystemComponent = z.infer<typeof systemComponentSchema>;
export type SnapshotCapability = z.infer<typeof capabilitySchema>;
export type SnapshotAgent = z.infer<typeof agentSchema>;
export type RoadmapMarker = z.infer<typeof roadmapMarkerSchema>;
export type SnapshotMetric = z.infer<typeof metricSchema>;
export type SeriesPoint = z.infer<typeof seriesPointSchema>;
export type SeriesSection = z.infer<typeof seriesSectionSchema>;
export type DistributionSlice = z.infer<typeof distributionSliceSchema>;
export type FunnelStage = z.infer<typeof funnelStageSchema>;
export type AarohiReadinessRow = z.infer<typeof aarohiReadinessRowSchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type OwnershipRow = z.infer<typeof ownershipRowSchema>;
export type ApprovalRow = z.infer<typeof approvalRowSchema>;
export type ConversationControlRow = z.infer<typeof conversationControlRowSchema>;
export type WorkerNode = z.infer<typeof workerNodeSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type KnowledgeNamespace = z.infer<typeof knowledgeNamespaceSchema>;
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;
export type ControlPlaneSections = z.infer<typeof sectionsSchema>;
