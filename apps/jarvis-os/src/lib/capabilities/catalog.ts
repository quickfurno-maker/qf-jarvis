/**
 * The capability catalog (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * ### A capability lifecycle is a PRESENTATION fact, never an authority
 *
 * This is the single most important sentence in this file. A capability state here decides
 * whether a surface renders as usable, planned, disabled or disconnected. It decides
 * nothing else. It cannot approve, authorize, send, execute or unlock anything, because
 * Jarvis OS holds none of those powers to begin with — QuickFurno Core authorizes, n8n
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
  'execution.n8n.bridge',
  'communication.live-send',
  'core.sync',
  'model.gateway',
  'knowledge.rag',
  'evaluation.run',
  'worker.local-inference',
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
    lifecycle: 'NOT_CONNECTED',
    note: 'Durable queue merged (QFJ-P08). Jarvis OS has no control-plane API yet.',
  },
  {
    id: 'approval.submit',
    label: 'Approval submission to Core',
    lifecycle: 'NOT_CONNECTED',
    note: 'Adapter merged (QFJ-P08). No live Core transport exists.',
  },
  {
    id: 'conversation.control.read',
    label: 'Conversation control — read',
    lifecycle: 'NOT_CONNECTED',
    note: 'Durable control state merged. Not wired to this surface.',
  },
  {
    id: 'conversation.control.write',
    label: 'Human takeover / pause',
    lifecycle: 'DISABLED',
    note: 'Deliberately off in Jarvis OS. No control action reaches a backend.',
  },
  {
    id: 'execution.intent.validate',
    label: 'Execution intent correlation',
    lifecycle: 'AVAILABLE',
    note: 'QFJ-P09.01 merged. Validates a Core-issued intent; issues none.',
  },
  {
    id: 'execution.n8n.bridge',
    label: 'n8n execution bridge',
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
    lifecycle: 'NOT_CONNECTED',
    note: 'Core remains authoritative. No live Jarvis↔Core protocol has been adopted.',
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
    lifecycle: 'DISABLED',
    note: 'Provisioning contracts merged; retrieval is off and provisions nothing.',
  },
  {
    id: 'evaluation.run',
    label: 'Evaluation suites',
    lifecycle: 'SHADOW',
    note: 'Suites run against fixtures. No production certification is claimed.',
  },
  {
    id: 'worker.local-inference',
    label: 'Local inference worker',
    lifecycle: 'PLANNED',
    note: 'Local/GPU node topology is a future slice. No discovery runs.',
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
