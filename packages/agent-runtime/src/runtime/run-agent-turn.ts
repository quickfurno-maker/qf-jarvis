/**
 * The shared agent-turn entry point (QFJ-S3-B, ADR-0066).
 *
 * COMPOSITION, NOT A SECOND PIPELINE. Every gate, every ordering guarantee and every authority rule
 * already lives in `orchestrateInbound` (QFJ-M2, ADR-0055 §C): validate envelope, read revision-bound
 * context, enforce takeover/pause/scope/freshness/privacy/data-class, retrieve exact knowledge, plan,
 * invoke the injected model port, validate the draft, double-gate before Core, build a
 * `PENDING_CORE_VALIDATION` proposal, obtain the injected Core decision, return an immutable result.
 *
 * This function adds exactly one thing that pipeline never had — a provenance record — and delegates
 * everything else unchanged. Re-implementing the ordering here would create a second actor-assignment
 * and gate mechanism that could drift from the merged one, which is the single failure this package
 * exists to prevent.
 *
 * What it therefore CANNOT do, because it never re-decides anything: override actor-party
 * compatibility, bypass human takeover or AI pause, fabricate a Core decision, mark a proposal
 * approved, persist a state transition, or send anything.
 */
import type { InboundEnvelope } from '../contracts/inbound-envelope.js';
import { createRuntimeProvenance } from '../contracts/provenance.js';
import type { RuntimeProvenance } from '../contracts/provenance.js';
import type { RuntimeActor } from '../contracts/vocabularies.js';
import { orchestrateInbound } from '../orchestration/orchestrate-inbound.js';
import type { Orchestrator } from '../orchestration/orchestrate-inbound.js';
import type { OrchestrationResult } from '../orchestration/contracts.js';

/** The shared-runtime contract version. */
export const SHARED_RUNTIME_VERSION = 1 as const;
export type SharedRuntimeVersion = typeof SHARED_RUNTIME_VERSION;

/**
 * The provenance references a caller supplies. Deliberately references only — there is no metadata bag,
 * and `actor` is NOT accepted: it is taken from the outcome the merged pipeline decided.
 */
export interface AgentTurnProvenanceRefs {
  readonly runtimeRef: string;
  readonly policyRef: string;
  readonly promptRef?: string;
  readonly modelRef?: string;
  readonly providerRef?: string;
  readonly releaseRef?: string;
  readonly configRef?: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface AgentTurnInput {
  readonly envelope: InboundEnvelope;
  readonly provenance: AgentTurnProvenanceRefs;
}

/**
 * One turn's outcome plus its provenance.
 *
 * `outcome` is the merged `OrchestrationResult`, unchanged and un-rewrapped, so callers keep the exact
 * shape ADR-0055 governs. Provenance is a sibling, so no merged contract had to change.
 */
export interface AgentTurnResult {
  readonly runtimeVersion: SharedRuntimeVersion;
  readonly outcome: OrchestrationResult;
  readonly provenance: RuntimeProvenance;
}

/**
 * The actor a provenance record attributes a turn to.
 *
 * On success it is the actor the merged pipeline assigned. When a gate refused, no agent acted, so the
 * turn is attributed to `SYSTEM` — attributing a refusal to Riya or Anisha would record an action that
 * never happened, and `SYSTEM` is already the merged vocabulary's non-agent actor.
 */
function actorFor(outcome: OrchestrationResult): RuntimeActor {
  return outcome.ok ? outcome.assignedActor : 'SYSTEM';
}

/**
 * Run one agent turn: delegate to the merged orchestrator, then stamp provenance.
 *
 * The decision ports are called at most once, by `orchestrateInbound`, and not at all when a gate
 * blocks — this function adds no call of its own on any path. A provenance record is produced for
 * EVERY outcome, including a refusal, so a blocked turn is as auditable as a served one.
 */
export async function runAgentTurn(
  orchestrator: Orchestrator,
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const outcome = await orchestrateInbound(orchestrator, input.envelope);
  const provenance = createRuntimeProvenance({
    actor: actorFor(outcome),
    ...input.provenance,
  });
  return Object.freeze({
    runtimeVersion: SHARED_RUNTIME_VERSION,
    outcome,
    provenance,
  });
}
