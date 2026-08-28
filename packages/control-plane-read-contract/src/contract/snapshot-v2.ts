import { z } from 'zod';

import {
  healthStateSchema,
  identifierSchema,
  labelSchema,
  sectionCarriesUnearnedItems,
  sectionSchema,
  sentenceSchema,
  canonicalInstantSchema,
} from './primitives.js';
import {
  activityEntrySchema,
  agentSchema,
  approvalRowSchema,
  attentionItemSchema,
  authorityBoundarySchema,
  capabilitySchema,
  conversationControlRowSchema,
  distributionSliceSchema,
  evaluationDimensionSchema,
  knowledgeNamespaceSchema,
  metricSchema,
  modelProfileSchema,
  ownershipRowSchema,
  roadmapMarkerSchema,
  rolloutSchema,
  seriesSectionSchema,
  snapshotSourceSchema,
  systemComponentSchema,
  workerNodeSchema,
} from './snapshot.js';

/**
 * The `ControlPlaneSnapshotV2` wire contract (AVG-11, ADR-0129).
 *
 * ### Why this is a NEW VERSION and not an edit
 *
 * ADR-0086 states the rule this file exists to obey, in one sentence: *`contractVersion` is `"1"`. A
 * breaking change to the snapshot shape requires a new version and a superseding ADR, not an edit in
 * place — a shipped Android client cannot be asked to re-parse.*
 *
 * AVG-11 needs two breaking changes. The funnel stage becomes a discriminated union over a closed
 * Aarohi stage vocabulary, which no V1 stage satisfies; and a new section joins a `.strict()` object,
 * which every V1 producer would now be missing. Either one alone invalidates a V1 payload in one
 * direction or the other, so both belong behind a version.
 *
 * V1 is therefore untouched — byte for byte — and stays the contract `parseControlPlaneSnapshotV1`
 * enforces and `GET /api/control-plane/v1/snapshot` serves.
 *
 * ### It is a version SUCCESSOR, not a second contract
 *
 * Every row schema here is IMPORTED from V1 rather than restated: a metric, an approval row, a worker
 * node and an agent mean exactly what they meant, and cannot drift into meaning something else at V2.
 * What V2 changes is stated in one place each — `funnelStageSchema` and one added section — so the
 * whole delta between the versions is readable without diffing two files.
 *
 * ### The invariants V1 checks are restated, not shared
 *
 * V1's cross-field rules live inside V1's own `superRefine`, and V1 is frozen: extracting them into a
 * helper would edit the file this ADR exists to leave alone. They are restated below, and a spec
 * drives the SAME violations through both parsers and requires both to refuse — so the duplication is
 * a tested property rather than a place for the two versions to quietly disagree.
 *
 * ### It carries no more authority than V1 did
 *
 * There is no `canSend`, `canExecute`, `isAuthorized`, `consentValid`, `approvalGranted` or
 * `dispatchAllowed` here either, every object is `.strict()`, `rollout.enabled` is still the literal
 * `false`, and there are still no methods. V2 adds a way to say who is entitled to be believed about
 * a number. It adds no way to act on one.
 */

/** The second contract version this package speaks. Not a range, not a minimum. */
export const CONTROL_PLANE_READ_CONTRACT_V2_VERSION = '2' as const;

/**
 * The certified Aarohi acquisition funnel stages (AVG-11, ADR-0128).
 *
 * A CLOSED vocabulary, restated here in the contract's own lowercase identifier spelling. The domain
 * package that derives these counts is framework-neutral and deliberately imported by nothing, so
 * this contract cannot import it; a spec in that package compares the two lists token for token,
 * which is the same trade `compose.ts` makes for the canonical-instant grammar.
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
 * describes authority over a single number, and collapsing them is how "Core is not connected" comes
 * to render as "none".
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
 * variants carry `value`; the unavailable variant has no `value` key at all, so a client, a mapper, a
 * default or a `?? 0` has nothing to read. `expectedAuthority` names the class that would have owned
 * the number, which is what a surface needs to explain the gap without inventing one.
 *
 * `SectionAvailability` still governs the section as a whole. This is finer: a funnel can be
 * readable, and still have one stage whose authority nobody has connected.
 *
 * This is the shape that breaks V1. A V1 stage is `{ id, label, value, caption }` with a free
 * identifier and no authority, and no such object satisfies any branch here.
 */
export const funnelStageV2Schema = z.discriminatedUnion('authority', [
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

export const aarohiReadinessRowSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    kind: aarohiReadinessKindSchema,
    state: healthStateSchema,
    detail: sentenceSchema,
  })
  .strict();

/**
 * The V2 operational sections.
 *
 * Sixteen of the eighteen are V1's, row schema and all. `vendorGrowthFunnel` carries the new stage
 * union, and `aarohiAcquisitionReadiness` is the added section — the two changes that require the
 * version.
 */
export const sectionsV2Schema = z
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
    vendorGrowthFunnel: sectionSchema(funnelStageV2Schema, 12),
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

export const controlPlaneSnapshotV2Schema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_READ_CONTRACT_V2_VERSION),
    /**
     * When this JSON snapshot was PRODUCED — not when the facts in it were observed.
     * `source.freshness` owns that, and a request cannot move it. Unchanged from V1.
     */
    generatedAt: canonicalInstantSchema,
    /** There is no other mode in V2 either, and adding one is a contract-version decision. */
    mode: z.literal('READ_ONLY'),
    source: snapshotSourceSchema,
    authority: authorityBoundarySchema,
    rollout: rolloutSchema,
    system: z.array(systemComponentSchema).max(24),
    capabilities: z.array(capabilitySchema).max(64),
    agents: z.array(agentSchema).max(8),
    roadmap: z.array(roadmapMarkerSchema).max(32),
    sections: sectionsV2Schema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    // ---------------------------------------------------------------------
    // Restated from V1, deliberately. See the note at the top of this file: V1 is frozen, so these
    // rules are duplicated rather than extracted, and a spec drives the same violations through both
    // parsers so the two versions cannot quietly disagree about them.
    // ---------------------------------------------------------------------

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

    // Agent ids are the primary key of the agent list; a duplicate would silently hide one.
    const agentIds = snapshot.agents.map((agent) => agent.id);
    if (new Set(agentIds).size !== agentIds.length) {
      ctx.addIssue({ code: 'custom', path: ['agents'], message: 'agent ids must be unique' });
    }

    // ---------------------------------------------------------------------
    // New at V2.
    // ---------------------------------------------------------------------

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
  });

export type ControlPlaneSnapshotV2 = z.infer<typeof controlPlaneSnapshotV2Schema>;
export type ControlPlaneSectionsV2 = z.infer<typeof sectionsV2Schema>;
export type FunnelStageV2 = z.infer<typeof funnelStageV2Schema>;
export type AarohiReadinessRow = z.infer<typeof aarohiReadinessRowSchema>;
