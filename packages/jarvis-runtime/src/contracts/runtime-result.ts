/**
 * The immutable M5 runtime result (QFJ-M5, ADR-0059 §F).
 *
 * A deeply-frozen, content-free record: the closed outcome, the exact conversation/proposal/revision
 * references the flow was bound to, the assigned actor, whether a model draft and a Core decision were
 * produced, and — only when `REFUSED` — the safe orchestration reason. It carries NO reply/prompt/
 * knowledge content, no subject/PII/secret, and no raw error. `CORE_ACCEPTED` is Core-approved only —
 * never sent, delivered, executed, or persisted; the result exposes no send/deliver/execute method.
 */
import type { OrchestrationReason, RuntimeActor } from '@qf-jarvis/agent-runtime';

import type { JarvisRuntimeOutcome } from './reasons.js';

/** The immutable outcome of one composed inbound run. */
export interface JarvisRuntimeResult {
  readonly outcome: JarvisRuntimeOutcome;
  readonly runId: string;
  readonly conversationId: string;
  /** The revision the run was bound to (the proposal/Core expected revision), when a proposal was built. */
  readonly boundRevision: number | undefined;
  readonly assignedActor: RuntimeActor | undefined;
  readonly proposalId: string | undefined;
  /** True when a valid model draft/proposal was produced. */
  readonly modelDrafted: boolean;
  /** True when the M3 Core decision adapter was consulted (a Core transport was wired). */
  readonly coreConsulted: boolean;
  /** The safe orchestration reason, present ONLY when `outcome === 'REFUSED'`. */
  readonly refusalReason: OrchestrationReason | undefined;
}
