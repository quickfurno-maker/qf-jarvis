/**
 * The provider-neutral model RESPONSE (QFJ-P04.01A, ADR-0045).
 *
 * A response carries the validated result (a structured value that satisfied the request schema, or a
 * bounded text string), full provenance, bounded accounting, and a safe finish status. It carries NO
 * raw provider SDK object, NO provider headers, and NO hidden reasoning/chain-of-thought.
 */
import type { ModelResultMode } from './enums.js';
import type { ModelRunProvenance } from './provenance.js';

/** Bounded, non-identifying token/cost accounting for a run. All fields optional (provider-reported). */
export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cost?: number;
}

/** A successful, validated gateway response. */
export interface ModelResponse {
  readonly runId: string;
  readonly resultMode: ModelResultMode;
  /** Present iff `resultMode` is STRUCTURED — the value that satisfied the request's schema. */
  readonly structuredResult?: unknown;
  /** Present iff `resultMode` is TEXT — a bounded string within the request's `maxResultChars`. */
  readonly textResult?: string;
  readonly provenance: ModelRunProvenance;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
  /** A safe, closed finish status. The only success status in P04.01A is `completed`. */
  readonly finishStatus: 'completed';
}
