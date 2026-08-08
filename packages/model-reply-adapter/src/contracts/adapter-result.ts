/**
 * The detailed result of a reply-drafting attempt (QFJ-M4, ADR-0057 §G, §K, §M).
 *
 * The adapter's rich surface: the closed result kind, a safe reason, the validated M2 `ModelReplyDraft`
 * (present ONLY for a `REPLY` that passed every gate), the full closed structured reply, whether the
 * gateway was invoked, and safe provenance/usage. Model output is a draft/proposal input only — this
 * result contains no Core `ACCEPTED`, no send/deliver/execute instruction, and no raw provider object.
 */
import type { ModelReplyDraft } from '@qf-jarvis/agent-runtime';

import type { ModelReplyAdapterReason } from './reasons.js';
import type { StructuredReply, StructuredReplyKind } from './reply-schema.js';

/** Safe, content-free provenance surfaced from a validated gateway result. */
export interface SafeReplyProvenance {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly promptId: string;
  /** The exact prompt-content digest the gateway echoed back (ADR-0073). */
  readonly promptDigest: string;
  readonly promptVersion: string;
  readonly usedFallback: boolean;
  readonly attempts: number;
}

/** The detailed outcome of `draftReplyDetailed`. */
export interface ModelReplyAdapterResult {
  readonly ok: boolean;
  readonly kind: StructuredReplyKind | undefined;
  readonly reason: ModelReplyAdapterReason;
  /** The validated M2 reply draft — present only for a `REPLY` that passed every gate. */
  readonly draft: ModelReplyDraft | undefined;
  /** The full closed structured reply — present when the result validated. */
  readonly structuredReply: StructuredReply | undefined;
  readonly gatewayInvoked: boolean;
  readonly provenance: SafeReplyProvenance | undefined;
  readonly outputTokens: number | undefined;
  readonly latencyMs: number | undefined;
  /**
   * Whatever a configured structured-output profile validated out of the SAME answer (ADR-0099).
   *
   * OPTIONAL, and the key is ABSENT rather than `undefined` when no profile is configured — the
   * default result shape is unchanged, which existing exact-shape assertions depend on.
   *
   * It is surfaced only on a fully accepted result: after provenance, strict structured validation,
   * citation authorization and BOTH state gates. A profile detail returned beside a refusal would be
   * material extracted from an answer the adapter had already decided not to trust. It is never
   * logged or emitted.
   */
  readonly profileDetail?: unknown;
}
