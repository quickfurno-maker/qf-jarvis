/**
 * The ONE production wiring of the instrumented transport and its recorder (MVP-P2A.2 HF4-R4).
 *
 * ### The gap this closes
 *
 * RUN S5's smoke PASSED and printed `fetchStartedMs=ABSENT`, `headersReceivedMs=ABSENT`,
 * `responseBodyStartedMs=ABSENT`, `responseBodyCompletedMs=ABSENT`, `networkElapsedMs=ABSENT`. A PASS
 * is proof that a provider request happened, so those milestones were not absent because nothing was
 * sent — they were absent because nothing marked them.
 *
 * The cause was a composition gap, not a defect in the diagnostics. The four wire milestones are
 * marked by `createInstrumentedGroqTransport`, which must be handed the SAME recorder the runner
 * holds. This package's own executable does exactly that. The candidate evidence operator did not: it
 * passed a plain `createFetchGroqTransport()` and no recorder, so the runner built a private recorder
 * that nothing on the wire could reach. Two composition roots, one of them wrong, and no type that
 * could say so — because the pairing was a convention held in two places rather than a function.
 *
 * ### Why a helper rather than a default
 *
 * The obvious alternative was to make `SmokeRunDeps.transport` optional and default it. That would
 * mean a caller who simply forgot to inject a transport silently got a real network client, which is
 * the one mistake this package's injected-transport seam exists to make impossible. Requiring the
 * transport and offering the correct pairing as a single named value keeps the failure mode "you did
 * not compose it" rather than "you accidentally went online".
 *
 * It changes no smoke semantics: same one-shot request, same timer ownership and duration, same
 * credential policy, same zero retries, same zero fallbacks, same configuration. The only difference
 * is that the transport it returns marks the milestones the runner was always ready to print.
 */
import { createDiagnosticRecorder, createSystemMonotonicClock } from './diagnostic-telemetry.js';
import {
  createInstrumentedGroqTransport,
  createSystemFetchLike,
} from './instrumented-transport.js';
import type { SmokeRunDeps } from './run-once.js';

/**
 * The transport and the recorder that MUST be used together, built as one value.
 *
 * Returned as a `Pick` of the existing dependency contract rather than a new interface, so the two
 * fields can only ever be spread into the deps they belong to and no new named type joins the public
 * surface. One recorder, whose origin is this moment, shared by the wire and the run so the milestones
 * sit on a single timeline.
 */
export function createSystemSmokeWireDeps(): Pick<SmokeRunDeps, 'transport' | 'diagnostics'> {
  const recorder = createDiagnosticRecorder(createSystemMonotonicClock());
  return Object.freeze({
    transport: createInstrumentedGroqTransport({
      fetchLike: createSystemFetchLike(),
      recorder,
    }),
    diagnostics: recorder,
  });
}
