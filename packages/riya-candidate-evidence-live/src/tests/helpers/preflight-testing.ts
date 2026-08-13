/**
 * A TEST-ONLY preflight entry point (MVP-P2A.2, Turn 1E).
 *
 * ### Why it lives under `src/tests/`
 *
 * The integrated composition test drives a SYNTHETIC smoke configuration, which by definition does
 * not hash to the governed digest. Every earlier attempt to solve that put a seam on a production
 * contract — first a digest field on `PreflightInput`, then a whole-preflight callback on
 * `OperatorDeps` — and both were bypasses available to any caller holding the public API.
 *
 * This directory is excluded from the emitting build, so nothing here reaches `dist/`. Production
 * `runPreflight` always pins the governed constant and takes no override at all.
 */
import { preflightCore } from '../../internal/preflight-core.js';
import type { PreflightInput, PreflightResult } from '../../preflight.js';

/** Run preflight against a SYNTHETIC expected digest. Test code only; never emitted. */
export function runPreflightForTesting(
  input: PreflightInput,
  expectedSmokeConfigDigest: string,
): PreflightResult {
  return preflightCore(input, expectedSmokeConfigDigest);
}
