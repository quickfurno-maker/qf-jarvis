/**
 * A TEST-ONLY preflight entry point (MVP-P2A.2, Turn 1D).
 *
 * ### Why this exists at all
 *
 * The integrated composition test needs to drive a SYNTHETIC smoke configuration, which by definition
 * does not hash to the governed digest. The previous solution put an optional expected digest on
 * `PreflightInput` — and that made the digest lock advisory for anybody holding the production
 * contract, which is exactly the kind of convenience seam that stops being a test seam.
 *
 * So the override lives here instead, on a surface named for what it is. Production `runPreflight`
 * always passes the governed constant and cannot be told otherwise. A containment spec proves no
 * production module imports this file.
 */
import { preflightCore } from '../preflight.js';
import type { PreflightInput, PreflightResult } from '../preflight.js';

/**
 * Run preflight against a SYNTHETIC expected digest.
 *
 * Never call this from `bin.ts`, `operator.ts` or anything else that ships. The name says so and a
 * spec enforces it.
 */
export function runPreflightForTesting(
  input: PreflightInput,
  expectedSmokeConfigDigest: string,
): PreflightResult {
  return preflightCore(input, expectedSmokeConfigDigest);
}
