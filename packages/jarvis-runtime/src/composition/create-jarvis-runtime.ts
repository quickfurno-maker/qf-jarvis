/**
 * The M5 Jarvis runtime composition root (QFJ-M5, ADR-0059 §A, §B, §G; QFJ-P08-A, ADR-0075).
 *
 * `createJarvisRuntime(config)` validates the mandatory injected dependencies (fail closed at
 * construction), then returns a frozen runtime with exactly four programmatic methods:
 *
 * - `processInbound` — the ONE pre-transport inbound composition entry point, composing M1–M4 for one
 *   envelope behind the ONE authoritative state source. Its behaviour is unchanged by ADR-0075;
 * - `processInboundForCoreAuthorizedReply` — the RWC-P2D content-bearing sibling (ADR-0096). The SAME
 *   single composition, reported with the Core-authorized body attached. Separate because
 *   `processInbound`'s result is deliberately content-free and callers may log it whole;
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

import type { JarvisCoreAuthorizedReplyResult } from '../contracts/core-authorized-reply.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import { assertMandatoryDependencies } from './validate-composition.js';
import { composeAndProcessDetailed } from './process-inbound.js';
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

/**
 * The runtime plus the ONE explicit content-bearing capability (RWC-P2D, ADR-0096).
 *
 * A fourth concrete method rather than a fourth field on `JarvisRuntimeResult`. `processInbound`
 * keeps its exact result shape and stays safe to log whole; a caller that needs the Core-authorized
 * text has to name a method that says so. Both methods perform ONE orchestration run each — calling
 * this one is not "processInbound plus extra work", it is the same work reported more fully.
 *
 * It extends `JarvisRuntime`, so every existing consumer typed against the three-method contract
 * keeps working untouched and no second factory exists.
 */
export interface CoreAuthorizedReplyJarvisRuntime extends JarvisRuntime {
  /**
   * Process one inbound envelope and additionally return the Core-authorized body when — and only
   * when — the final M3 decision was `ACCEPTED` for a text-carrying proposal that has one.
   *
   * `CORE_ACCEPTED` is authorization, never delivery. Nothing is sent, rendered or persisted here.
   */
  processInboundForCoreAuthorizedReply(
    envelope: InboundEnvelope,
  ): Promise<JarvisCoreAuthorizedReplyResult>;
}

/** Build a frozen Jarvis runtime from injected collaborators. Missing mandatory deps fail closed. */
export function createJarvisRuntime(config: JarvisRuntimeConfig): CoreAuthorizedReplyJarvisRuntime {
  assertMandatoryDependencies(config);
  return Object.freeze({
    async processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult> {
      // ONE run, then drop the materialization. Not a second pipeline, and not a call to the
      // content-bearing method that then discards what it returned.
      return (await composeAndProcessDetailed(config, envelope)).runtimeResult;
    },
    processInboundForCoreAuthorizedReply(
      envelope: InboundEnvelope,
    ): Promise<JarvisCoreAuthorizedReplyResult> {
      // The SAME primitive, called once. `processInbound` is never invoked in addition.
      return composeAndProcessDetailed(config, envelope);
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
