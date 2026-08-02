/**
 * The M5 Jarvis runtime composition root (QFJ-M5, ADR-0059 §A, §B, §G; QFJ-P08-A, ADR-0075).
 *
 * `createJarvisRuntime(config)` validates the mandatory injected dependencies (fail closed at
 * construction), then returns a frozen runtime with exactly three programmatic methods:
 *
 * - `processInbound` — the ONE pre-transport inbound composition entry point, composing M1–M4 for one
 *   envelope behind the ONE authoritative state source. Its behaviour is unchanged by ADR-0075;
 * - `applyConversationControlCommand` — the operator control entry point (ADR-0074 semantics, applied
 *   by the authoritative source itself);
 * - `readConversationOperationsSnapshot` — the operator query entry point.
 *
 * All three address state through the SAME `config.authoritativeState` object and, since QFJ-P08-B1
 * (ADR-0076), through the same tenant-scoped `(tenantId, conversationId)` key. That is the point: a
 * separate writable
 * store would let an operator set a takeover on one object while the next inbound turn read another
 * and kept replying. The two operator methods are OPTIONAL capabilities detected on that object, so a
 * read-only source stays valid and existing inbound composition is untouched.
 *
 * Still no send/deliver/execute/persist/authorize/approve/callN8n method, no HTTP route, no
 * authentication, no UI, no database and no global mutable state. `operatorRef` is attribution, not
 * proof of identity — a future operator API must authenticate and authorize before calling in.
 * QuickFurno Core remains the only business authority; model output is a draft only.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import { assertMandatoryDependencies } from './validate-composition.js';
import { composeAndProcess } from './process-inbound.js';
import {
  applyControlCommandThroughSource,
  type JarvisConversationControlInput,
  type JarvisConversationControlResult,
} from './control-surface.js';
import {
  readOperationsSnapshotThroughSource,
  type ConversationOperationsQueryInput,
  type JarvisConversationOperationsResult,
} from './operations-snapshot.js';

/** The immutable Jarvis runtime: one inbound entry point plus two operator entry points. */
export interface JarvisRuntime {
  processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult>;
  /**
   * Apply one operator control command, TENANT-SCOPED (QFJ-P08-B1, ADR-0076). Takes INPUT, not a
   * pre-built command, so the composition boundary itself validates — untrusted structural input
   * cannot reach the authoritative source having skipped `createConversationControlCommand`.
   */
  applyConversationControlCommand(
    input: JarvisConversationControlInput,
  ): Promise<JarvisConversationControlResult>;
  /** Read one conversation's validated, content-free operations snapshot. A query, not a console. */
  readConversationOperationsSnapshot(
    input: ConversationOperationsQueryInput,
  ): Promise<JarvisConversationOperationsResult>;
}

/** Build a frozen Jarvis runtime from injected collaborators. Missing mandatory deps fail closed. */
export function createJarvisRuntime(config: JarvisRuntimeConfig): JarvisRuntime {
  assertMandatoryDependencies(config);
  return Object.freeze({
    processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult> {
      return composeAndProcess(config, envelope);
    },
    applyConversationControlCommand(
      input: JarvisConversationControlInput,
    ): Promise<JarvisConversationControlResult> {
      return applyControlCommandThroughSource(config, input);
    },
    readConversationOperationsSnapshot(
      input: ConversationOperationsQueryInput,
    ): Promise<JarvisConversationOperationsResult> {
      return readOperationsSnapshotThroughSource(config, input);
    },
  });
}
