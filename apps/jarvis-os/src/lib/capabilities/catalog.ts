/**
 * The capability catalog (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * ### A capability lifecycle is a PRESENTATION fact, never an authority
 *
 * This is the single most important sentence in this file. A capability state here decides
 * whether a surface renders as usable, planned, disabled or disconnected. It decides
 * nothing else. It cannot approve, authorize, send, execute or unlock anything, because
 * Jarvis OS holds none of those powers to begin with — QuickFurno Core authorizes, QuickFurno Core Automation
 * executes, providers deliver.
 *
 * The reason to write it down rather than scatter booleans through page components is
 * ordinary engineering, and one specific hazard. Ad-hoc flags drift: `enabled`, `ready`,
 * `isLive` and `available` accumulate across a codebase until nobody can say which one an
 * operator's screen is actually reading, and at that point a surface can claim a system is
 * live because a variable in a component said so. One vocabulary, one catalog, one place to
 * read the truth.
 *
 * ### The lifecycle values, and what each MEANS
 *
 * They are deliberately not a boolean pair, because the interesting states are the ones
 * between "on" and "off".
 */

/** The closed lifecycle vocabulary. Shared, verbatim, with any future Android client. */
export const CAPABILITY_LIFECYCLES = [
  /** Implemented, merged, and usable through the surfaces this release ships. */
  'AVAILABLE',
  /** Designed and owner-approved, not implemented. Renders as a preview, never as data. */
  'PLANNED',
  /** Implemented and deliberately switched off. Not a fault. */
  'DISABLED',
  /** Running observed-only: it computes, and its output authorizes nothing. */
  'SHADOW',
  /** Implemented here, and the system it depends on is not reachable from this surface. */
  'NOT_CONNECTED',
  /** Gated behind production rollout, which is OFF. */
  'ROLLOUT_OFF',
] as const;

export type CapabilityLifecycle = (typeof CAPABILITY_LIFECYCLES)[number];

/** The closed set of capability identifiers this release knows about. */
export const CAPABILITY_IDS = [
  'jarvis.orchestration',
  'riya.customer-conversation',
  'anisha.vendor-care',
  'aarohi.vendor-growth',
  'approval.queue.read',
  'approval.submit',
  'conversation.control.read',
  'conversation.control.write',
  'execution.intent.validate',
  'execution.core-automation.bridge',
  'communication.live-send',
  'core.sync',
  'model.gateway',
  'knowledge.rag',
  'evaluation.run',
  'worker.local-inference',
  'operator.authentication',
  'intelligence.proactive',
  'intelligence.correlation',
  'memory.governed',
  'context.semantic-cache',
  'simulation.digital-twin',
  'recovery.certified-fallback',
  'evaluation.continuous',
  'release.certification',
  'interface.voice',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** One capability, as an operator sees it. */
export interface Capability {
  readonly id: CapabilityId;
  readonly label: string;
  readonly lifecycle: CapabilityLifecycle;
  /** Why it is in this state. Shown to the operator; never inferred from the state alone. */
  readonly note: string;
}

/**
 * How each lifecycle should read and look.
 *
 * `tone` maps to a semantic colour, and `label` is the text that always accompanies it — a
 * state must never be conveyed by colour alone.
 */
export const LIFECYCLE_PRESENTATION: Readonly<
  Record<CapabilityLifecycle, { readonly label: string; readonly tone: CapabilityTone }>
> = Object.freeze({
  AVAILABLE: { label: 'Available', tone: 'healthy' },
  PLANNED: { label: 'Planned', tone: 'planned' },
  DISABLED: { label: 'Disabled', tone: 'offline' },
  SHADOW: { label: 'Shadow', tone: 'shadow' },
  NOT_CONNECTED: { label: 'Not connected', tone: 'offline' },
  ROLLOUT_OFF: { label: 'Rollout off', tone: 'warning' },
});

export type CapabilityTone =
  'healthy' | 'warning' | 'critical' | 'offline' | 'info' | 'planned' | 'shadow';

/**
 * The capability snapshot this release renders.
 *
 * Local, read-only and hand-maintained against what has actually merged — it is a statement
 * about the repository, not a reading taken from a running system. Every entry that is not
 * `AVAILABLE` says so, and says why.
 */
export const CAPABILITY_SNAPSHOT: readonly Capability[] = Object.freeze([
  {
    id: 'jarvis.orchestration',
    label: 'Jarvis orchestration',
    lifecycle: 'SHADOW',
    note: 'Runtime composition merged. Observed only; it authorizes nothing.',
  },
  {
    id: 'riya.customer-conversation',
    label: 'Riya — customer conversation',
    lifecycle: 'SHADOW',
    note: 'Behaviour package merged. No live channel is attached.',
  },
  {
    id: 'anisha.vendor-care',
    label: 'Anisha — vendor relationship & success',
    lifecycle: 'SHADOW',
    note: 'Registered-vendor care. Behaviour package merged; no live channel.',
  },
  {
    id: 'aarohi.vendor-growth',
    label: 'Aarohi — vendor growth & acquisition',
    lifecycle: 'PLANNED',
    note: 'Owner-locked product surface. No runtime, no outreach, no channel.',
  },
  {
    id: 'approval.queue.read',
    label: 'Approval queue — read',
    lifecycle: 'AVAILABLE',
    note: 'Versioned read surface and signed Core observation adapter are implemented. Runtime reachability is resolved from live evidence.',
  },
  {
    id: 'approval.submit',
    label: 'Approval submission to Core',
    lifecycle: 'AVAILABLE',
    note: 'Versioned operator-command submission is implemented. QuickFurno Core validates authority and may refuse; runtime reachability is resolved separately.',
  },
  {
    id: 'conversation.control.read',
    label: 'Conversation control — read',
    lifecycle: 'AVAILABLE',
    note: 'Governed conversation-control state is exposed through the signed Core observation boundary. Runtime reachability is resolved separately.',
  },
  {
    id: 'conversation.control.write',
    label: 'Human takeover / pause',
    lifecycle: 'AVAILABLE',
    note: 'Takeover, pause and resume submit versioned requests to QuickFurno Core. Jarvis OS never authorizes the state change itself.',
  },
  {
    id: 'execution.intent.validate',
    label: 'Execution intent correlation',
    lifecycle: 'AVAILABLE',
    note: 'QFJ-P09.01 merged. Validates a Core-issued intent; issues none.',
  },
  {
    id: 'execution.core-automation.bridge',
    label: 'QuickFurno Core Automation execution bridge',
    lifecycle: 'PLANNED',
    note: 'QFJ-P09.02 — next main-track slice. Not implemented.',
  },
  {
    id: 'communication.live-send',
    label: 'Live communication send',
    lifecycle: 'ROLLOUT_OFF',
    note: 'Production rollout is off. No provider is reachable from anywhere in Jarvis.',
  },
  {
    id: 'core.sync',
    label: 'QuickFurno Core sync',
    lifecycle: 'AVAILABLE',
    note: 'Signed read-only observation and signed operator-command boundaries are implemented. Core remains authoritative; runtime reachability is resolved from evidence.',
  },
  {
    id: 'model.gateway',
    label: 'Model gateway',
    lifecycle: 'SHADOW',
    note: 'Provider-neutral gateway merged. Shadow evaluation only.',
  },
  {
    id: 'knowledge.rag',
    label: 'Governed knowledge / RAG',
    lifecycle: 'SHADOW',
    note: 'One governed RAG path with isolated Riya, Anisha and Aarohi scopes is implemented and tested. Runtime observation decides whether retrieval is active.',
  },
  {
    id: 'evaluation.run',
    label: 'Evaluation suites',
    lifecycle: 'SHADOW',
    note: 'Suites run against fixtures. No production certification is claimed.',
  },
  {
    id: 'operator.authentication',
    label: 'Operator authentication and session',
    lifecycle: 'AVAILABLE',
    note: 'JOS-01C merged. Grants viewing of Jarvis OS only; it confers no business authority.',
  },
  {
    id: 'worker.local-inference',
    label: 'Local inference worker',
    lifecycle: 'PLANNED',
    note: 'Local/GPU node topology is a future slice. No discovery runs.',
  },
  {
    id: 'intelligence.proactive',
    label: 'Proactive operating intelligence',
    lifecycle: 'AVAILABLE',
    note: 'Read-only Now Brief, anomaly assessment, operator reasoning and runtime-capability truth are implemented. They authorize and execute nothing.',
  },
  {
    id: 'intelligence.correlation',
    label: 'End-to-end correlation timeline',
    lifecycle: 'NOT_CONNECTED',
    note: 'The correlation projection and privacy-bounded read model are implemented. The migration must be applied and observed before live trace coverage is claimed.',
  },
  {
    id: 'memory.governed',
    label: 'Governed long-term memory',
    lifecycle: 'DISABLED',
    note: 'Durable memory runtime and PostgreSQL store are implemented. Durable writes remain disabled until owner, retention and erasure policy references are approved.',
  },
  {
    id: 'context.semantic-cache',
    label: 'Semantic cache and context compression',
    lifecycle: 'DISABLED',
    note: 'Public-knowledge-only semantic cache and bounded context compression primitives are implemented. No serving-path cache store is activated.',
  },
  {
    id: 'simulation.digital-twin',
    label: 'Digital-twin simulation',
    lifecycle: 'AVAILABLE',
    note: 'Zero-effect scenario replay and baseline/candidate comparison are implemented for offline change rehearsal. Simulations cannot call providers, mutate Core or send channels.',
  },
  {
    id: 'recovery.certified-fallback',
    label: 'Certified provider recovery',
    lifecycle: 'DISABLED',
    note: 'Certified fallback planning is implemented, but fallback remains policy-disabled until exact ACTIVE evidence exists for both primary and fallback releases.',
  },
  {
    id: 'evaluation.continuous',
    label: 'Continuous production evaluation',
    lifecycle: 'SHADOW',
    note: 'Continuous-evaluation posture and regression gating are implemented as evidence only. Production sampling/labels must be connected before it can become operational.',
  },
  {
    id: 'release.certification',
    label: 'Release assurance and certification',
    lifecycle: 'AVAILABLE',
    note: 'Release-assurance observations, build/test evidence and rollout separation are implemented. Passing evidence never activates production by itself.',
  },
  {
    id: 'interface.voice',
    label: 'Operator voice interface',
    lifecycle: 'NOT_CONNECTED',
    note: 'LiveKit operator voice and the read-only Jarvis Intelligence bridge are implemented. Runtime stays disconnected until reviewed LiveKit credentials and the matching voice agent exist; voice carries no Core or execution authority.',
  },
]);

const BY_ID: ReadonlyMap<CapabilityId, Capability> = new Map(
  CAPABILITY_SNAPSHOT.map((capability) => [capability.id, capability]),
);

/** Look one up. Returns `undefined` rather than inventing a default state. */
export function capability(id: CapabilityId): Capability | undefined {
  return BY_ID.get(id);
}

/**
 * Is this capability's surface interactive?
 *
 * Presentation only. A `true` here means "render this as usable", and it is still the
 * backend — which does not exist yet for any of these — that would decide anything.
 */
export function isInteractive(lifecycle: CapabilityLifecycle): boolean {
  return lifecycle === 'AVAILABLE';
}
