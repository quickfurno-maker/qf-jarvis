/**
 * The control-plane read model (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * ### These are DTOs, and that is the whole point
 *
 * Jarvis OS renders operator surfaces today from a local demo provider, and will later
 * render them from a governed control-plane API. A future React Native / Expo Android
 * client must reuse the same conceptual contracts through that API rather than growing a
 * second business-logic stack beside this one.
 *
 * So the shapes live here, in a boundary module, and **no business decision lives in a
 * React component**. A component receives a `SystemHealth` and paints it; it does not
 * decide what healthy means, which agent owns which vendor, or whether anything may be
 * sent. Swap the provider and every screen keeps working; port the provider to Android and
 * every screen's meaning travels with it.
 *
 * ### What these types deliberately CANNOT express
 *
 * There is no `canSend`, `canExecute`, `isAuthorized`, `approve()`, `dispatch()` or
 * `consentValid` anywhere in this file, and no field in which one could be smuggled. The
 * read model is a description of what the system reports; authority is QuickFurno Core's,
 * execution is n8n's, delivery is a provider's. A surface that could grant permission would
 * be a second source of business truth, which ADR-0001 forbids outright.
 */
import type { CapabilityId, CapabilityLifecycle, CapabilityTone } from '../capabilities/catalog';

/** A coarse operational reading. Always rendered with its label, never colour alone. */
export type HealthState =
  | 'HEALTHY'
  | 'CONNECTED'
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'SHADOW'
  | 'ROLLOUT_OFF'
  | 'PLANNED'
  | 'DISABLED'
  | 'NOT_CONNECTED';

export interface HealthPresentation {
  readonly label: string;
  readonly tone: CapabilityTone;
}

export const HEALTH_PRESENTATION: Readonly<Record<HealthState, HealthPresentation>> = Object.freeze(
  {
    HEALTHY: { label: 'Healthy', tone: 'healthy' },
    CONNECTED: { label: 'Connected', tone: 'healthy' },
    AVAILABLE: { label: 'Available', tone: 'healthy' },
    DEGRADED: { label: 'Degraded', tone: 'warning' },
    OFFLINE: { label: 'Offline', tone: 'critical' },
    SHADOW: { label: 'Shadow', tone: 'shadow' },
    ROLLOUT_OFF: { label: 'Rollout off', tone: 'warning' },
    PLANNED: { label: 'Planned', tone: 'planned' },
    DISABLED: { label: 'Disabled', tone: 'offline' },
    NOT_CONNECTED: { label: 'Not connected', tone: 'offline' },
  },
);

/** One entry on the top status strip. */
export interface SystemComponentHealth {
  readonly id: string;
  readonly label: string;
  readonly state: HealthState;
  /** One short clause an operator can act on. Never a stack trace, never an identifier. */
  readonly detail: string;
}

export interface SystemHealth {
  readonly components: readonly SystemComponentHealth[];
  /** Whole-plane rollout posture. Off in every environment this release runs in. */
  readonly rolloutEnabled: false;
  readonly environmentLabel: string;
}

/** A headline number, with the trend that gives it meaning. */
export interface MetricSummary {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly deltaLabel?: string;
  readonly deltaDirection?: 'up' | 'down' | 'flat';
  /** Whether "up" is good here. A rising escalation count is not an improvement. */
  readonly higherIsBetter?: boolean;
  readonly caption: string;
}

/** A point on a time series. `label` is what an axis shows. */
export interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

export interface NamedSeries {
  readonly id: string;
  readonly label: string;
  readonly tone: CapabilityTone;
  readonly points: readonly SeriesPoint[];
}

/** A categorical share — agent workload, approval outcome mix. */
export interface DistributionSlice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly tone: CapabilityTone;
}

/**
 * The certified Aarohi acquisition funnel stages (AVG-11, ADR-0128).
 *
 * Closed, and mirrored by value from the wire contract rather than imported, for the same reason
 * `SectionAvailability` below is: a presentation component should never need the contract package
 * to render a state. What matters is what the union CANNOT hold — there is no `registered`, `paid`,
 * `active`, `converted` or `contacted` id, so no page can display a QuickFurno business outcome as
 * an acquisition stage, and no fixture can invent one without failing to compile.
 */
export type FunnelStageId =
  | 'prospect-identified'
  | 'eligibility-evaluated'
  | 'eligible-net-new'
  | 'outreach-workspace-prepared'
  | 'conversation-observed'
  | 'commercial-context-prepared'
  | 'registration-assistance-prepared'
  | 'payment-followup-assistance-prepared'
  | 'core-active-handoff-confirmed';

/**
 * Who is entitled to be believed about one figure (AVG-11, ADR-0128).
 *
 * A third concept, beside `SectionAvailability` (can this panel be read?) and `Provenance` (where
 * did this snapshot come from?). Those describe a transport; this describes authority over a single
 * number.
 */
export type MetricAuthority =
  'JARVIS_WORKFLOW_DERIVED' | 'CORE_AUTHORITATIVE' | 'AUTHORITY_UNAVAILABLE';

export type ResolvedMetricAuthority = Exclude<MetricAuthority, 'AUTHORITY_UNAVAILABLE'>;

/**
 * One stage of the acquisition funnel.
 *
 * A discriminated union, and the discrimination is what stops a component rendering a zero for a
 * source nobody read: the unavailable variant has no `value` key, so `stage.value` does not compile
 * without narrowing and there is no number for a chart to plot at the bottom of an axis.
 */
export type FunnelStage =
  | {
      readonly id: FunnelStageId;
      readonly label: string;
      readonly authority: ResolvedMetricAuthority;
      readonly value: number;
      readonly caption: string;
    }
  | {
      readonly id: FunnelStageId;
      readonly label: string;
      readonly authority: 'AUTHORITY_UNAVAILABLE';
      /** The class that WOULD own this number, so the gap can be explained rather than invented. */
      readonly expectedAuthority: ResolvedMetricAuthority;
      readonly caption: string;
    };

/** What an Aarohi readiness row describes. A `blocker` is a bridge deliberately not built. */
export type AarohiReadinessKind = 'offline-domain' | 'boundary' | 'blocker';

/**
 * One row of the Aarohi acquisition readiness surface (AVG-11, ADR-0128).
 *
 * Readiness carries no number and no authority: it says what merged governance establishes and what
 * it does not, and `HealthState` already spells both.
 */
export interface AarohiReadinessRow {
  readonly id: string;
  readonly label: string;
  readonly kind: AarohiReadinessKind;
  readonly state: HealthState;
  readonly detail: string;
}

/** The four agents, as product surfaces. */
export type AgentId = 'jarvis' | 'riya' | 'aarohi' | 'anisha';

export interface AgentSummary {
  readonly id: AgentId;
  readonly name: string;
  /** The one-line scope. Aarohi and Anisha never share one. */
  readonly role: string;
  readonly capabilityId: CapabilityId;
  readonly lifecycle: CapabilityLifecycle;
  readonly state: HealthState;
  readonly metrics: readonly MetricSummary[];
  readonly notes: readonly string[];
}

/** An item on the action-required rail. Nothing here is actionable in this release. */
export interface AttentionItem {
  readonly id: string;
  readonly kind: 'approval' | 'escalation' | 'warning' | 'worker' | 'blocked';
  readonly title: string;
  readonly context: string;
  readonly age: string;
  readonly severity: 'critical' | 'warning' | 'info';
}

/** One provenance-labelled activity entry. */
export interface ActivityEntry {
  readonly id: string;
  readonly source: 'CORE' | 'JARVIS' | 'RIYA' | 'ANISHA' | 'AAROHI' | 'SYSTEM';
  readonly at: string;
  readonly message: string;
  readonly tone: CapabilityTone;
}

/** One row of the approval desk. */
export interface ApprovalQueueRow {
  readonly id: string;
  readonly requestedAction: string;
  readonly risk:
    | 'informational'
    | 'low-risk-reversible'
    | 'client-or-vendor-facing'
    | 'money-related'
    | 'high-risk';
  readonly requestedAuthority: string;
  readonly sourceAgent: string;
  readonly subject: string;
  readonly age: string;
  readonly slaState: 'ok' | 'due' | 'breached';
  readonly state: 'awaiting-core' | 'awaiting-operator' | 'answered';
}

/** A conversation-control row for the operations centre. */
export interface ConversationControlRow {
  readonly id: string;
  readonly subject: string;
  readonly agent: string;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly lastOperatorAction: string;
  readonly revision: number;
}

/** A worker node. */
export interface WorkerNode {
  readonly id: string;
  readonly label: string;
  readonly kind: 'control-plane' | 'local-node' | 'gpu-node';
  readonly state: HealthState;
  readonly capacity: string;
  readonly detail: string;
}

/** A model/provider profile. */
export interface ModelProfile {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly state: HealthState;
  readonly dataClass: 'external-provider' | 'local-only';
  readonly latencyP95: string;
  readonly circuit: 'closed' | 'half-open' | 'open';
  readonly detail: string;
}

/** A governed knowledge namespace. */
export interface KnowledgeNamespace {
  readonly id: string;
  readonly label: string;
  readonly owner: string;
  readonly state: HealthState;
  readonly detail: string;
}

/** One evaluation dimension. */
export interface EvaluationDimension {
  readonly id: string;
  readonly label: string;
  readonly state: HealthState;
  readonly caseCount: number;
  readonly detail: string;
}

/** One ownership row on the Core-sync boundary table. */
export interface OwnershipRow {
  readonly id: string;
  readonly subject: string;
  readonly owner: 'QuickFurno Core' | 'QF Jarvis';
  readonly detail: string;
}

/** A roadmap marker on the governance surface. */
export interface RoadmapMarker {
  readonly id: string;
  readonly label: string;
  /** The main Jarvis backend track, or the Jarvis OS product overlay. Each has its own `next`. */
  readonly track: 'QFJ' | 'JOS';
  /** `current` is the slice this build IS — not a merge state, which would self-invalidate. */
  readonly state: 'merged' | 'current' | 'next' | 'planned';
  readonly detail: string;
}

/**
 * How a section's data came to be (JOS-01B).
 *
 * Mirrors `SectionAvailability` on the wire contract, deliberately by value rather than by
 * import, so a presentation component never needs the contract package to render a state.
 */
export type SectionAvailability =
  'AVAILABLE' | 'STATIC_BASELINE' | 'NOT_CONNECTED' | 'PLANNED' | 'ROLLOUT_OFF';

/**
 * A section of the surface, with the provenance that makes its emptiness readable.
 *
 * This wrapper is the reason JOS-01B exists. In JOS-01A every getter returned a bare array, and
 * an empty array is ambiguous in the one direction that matters: `approvalQueue() === []` reads
 * as "nothing is waiting for you", when the truth may be "nobody has connected the queue". An
 * operator who trusts the first reading stops checking. Pairing rows with an availability, a
 * reason and the source that will eventually supply them makes the two impossible to confuse.
 */
export interface Section<T> {
  readonly availability: SectionAvailability;
  /** Why it reads this way, in one clause an operator can act on. */
  readonly reason: string;
  /** What will supply it, and in which phase. Never a hostname, never a credential. */
  readonly expectedSource: string;
  readonly items: readonly T[];
}

/** A series with its own availability. An unavailable series carries no points at all. */
export interface SeriesSection extends NamedSeries {
  readonly availability: SectionAvailability;
  readonly reason: string;
  readonly expectedSource: string;
}

/** Whether a section has data worth plotting, as opposed to a state worth explaining. */
export function isReadable(availability: SectionAvailability): boolean {
  return availability === 'AVAILABLE' || availability === 'STATIC_BASELINE';
}

/** Where this whole snapshot came from, rendered as a provenance badge on every page. */
export interface Provenance {
  readonly kind: 'REPOSITORY_BASELINE' | 'LIVE_ADAPTER' | 'DEMO_FIXTURE';
  /**
   * How fresh the underlying FACTS are — not when this snapshot was produced.
   *
   * A compiled-in baseline stays `BUILD_DECLARATION` however often it is served. `generatedAt`
   * moves per response; this does not.
   */
  readonly freshness: 'REQUEST_TIME' | 'BUILD_DECLARATION';
  readonly liveOperationalData: boolean;
  /** When this snapshot was produced. Says nothing about when the facts were observed. */
  readonly generatedAt: string;
}

/**
 * The read model Jarvis OS renders.
 *
 * Every method is a READ. There is no writer on this interface and no place to add one
 * without changing this file, which is exactly the friction that should exist before a
 * surface acquires the ability to change anything.
 */
export interface ControlPlaneReadModel {
  readonly kind: 'demo' | 'baseline';
  provenance(): Provenance;
  systemHealth(): SystemHealth;
  headlineMetrics(): Section<MetricSummary>;
  activitySeries(): SeriesSection;
  latencySeries(): SeriesSection;
  agentWorkload(): Section<DistributionSlice>;
  approvalBreakdown(): Section<DistributionSlice>;
  vendorGrowthFunnel(): Section<FunnelStage>;
  /** The complete Aarohi acquisition readiness surface, including the bridges that do not exist. */
  aarohiReadiness(): Section<AarohiReadinessRow>;
  attention(): Section<AttentionItem>;
  activity(): Section<ActivityEntry>;
  agents(): readonly AgentSummary[];
  agent(id: AgentId): AgentSummary | undefined;
  approvalQueue(): Section<ApprovalQueueRow>;
  conversationControl(): Section<ConversationControlRow>;
  workers(): Section<WorkerNode>;
  models(): Section<ModelProfile>;
  knowledge(): Section<KnowledgeNamespace>;
  evaluations(): Section<EvaluationDimension>;
  ownership(): Section<OwnershipRow>;
  roadmap(): readonly RoadmapMarker[];
  businessAnalytics(): Section<DistributionSlice>;
  n8nExecution(): Section<DistributionSlice>;
}
