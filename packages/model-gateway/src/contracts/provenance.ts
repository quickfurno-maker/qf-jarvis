/**
 * Model-run provenance (QFJ-P04.01A, ADR-0045).
 *
 * Every successful result carries provenance so the run can be reproduced, regression-tested, and
 * explained. Model provenance WITHOUT prompt provenance is not provenance. It carries no prompt text,
 * no message content, and no chain-of-thought — only stable identifiers, the mode, and bounded counters.
 * It is returned in-memory; QFJ-P04.01A persists nothing.
 */
import type { GatewayMode } from './enums.js';

/** The reproducible provenance of one gateway run. */
export interface ModelRunProvenance {
  readonly runId: string;
  readonly purpose: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  /**
   * The exact prompt-content digest the request carried (ADR-0073). Copied from the request by the
   * gateway; a provider neither supplies nor selects it, so it cannot be re-pointed at other text.
   */
  readonly promptDigest: string;
  readonly mode: GatewayMode;
  /** Whether the accepted result came from the primary provider or the single fallback. */
  readonly usedFallback: boolean;
  /** The total number of provider invocation attempts (primary + retries + fallback). */
  readonly attempts: number;
}
