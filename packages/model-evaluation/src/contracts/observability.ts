/**
 * Content-free evaluation observability (QFJ-P04.04, ADR-0052 §P).
 *
 * Evaluation emits closed-reason events carrying only suite/run/evidence and release/provider/model
 * ids and versions, a category/severity/outcome/reason, and counts/digests. An event NEVER carries a
 * prompt, output, knowledge content, subject reference, PII, secret, token, raw body, or chain-of-
 * thought. The hook is injected; the default is a no-op.
 */
import type {
  EvaluationApprovalTarget,
  EvaluationCategory,
  EvaluationOutcome,
  EvaluationReason,
  EvaluationSeverity,
} from './vocabularies.js';

/** The kind of evaluation event. */
export type EvaluationEventType =
  'suite-evaluated' | 'case-evaluated' | 'evidence-created' | 'evidence-blocked';

/** One safe, content-free evaluation event. */
export interface EvaluationEvent {
  readonly type: EvaluationEventType;
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly category: EvaluationCategory | undefined;
  readonly severity: EvaluationSeverity | undefined;
  readonly outcome: EvaluationOutcome | undefined;
  readonly reason: EvaluationReason | undefined;
  readonly target: EvaluationApprovalTarget | undefined;
  readonly count: number;
  readonly digest: string | undefined;
}

/** An injected sink for {@link EvaluationEvent}s. Implementations must not throw. */
export interface EvaluationObservabilityHook {
  onEvent(event: EvaluationEvent): void;
}

/** The default no-op hook: evaluation emits nothing unless a hook is injected. */
export const NOOP_EVALUATION_OBSERVABILITY: EvaluationObservabilityHook = Object.freeze({
  onEvent(_event: EvaluationEvent): void {
    // Intentionally empty.
  },
});
