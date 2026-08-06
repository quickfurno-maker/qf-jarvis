import { parseControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';
import type {
  CanonicalInstant,
  ControlPlaneSnapshotV1,
} from '@qf-jarvis/control-plane-read-contract';

import { CAPABILITY_SNAPSHOT } from '../../lib/capabilities/catalog';

import {
  BASELINE_AGENTS,
  BASELINE_ROADMAP,
  BASELINE_SYSTEM,
  baselineSections,
} from './repository-baseline';
import { composeSections, type ObservationWindow } from './sources/compose';
import type { CollectedObservation } from './sources/read-source';

/**
 * The snapshot builder (JOS-01B, ADR-0086).
 *
 * ### Pure, and deliberately awkward about it
 *
 * `generatedAt` is INJECTED. The builder reads no clock, no environment variable, no file, no
 * network and no database, and it is deterministic: the same instant in gives byte-identical
 * output. That is what lets the HTTP route and the server-rendered page share one implementation
 * and be provably the same — a self-fetching page could drift from its own API, and this cannot.
 *
 * ### Freshness is DERIVED, not accepted
 *
 * The builder used to take `freshness` alongside the instant, and the route passed `REQUEST_TIME`.
 * That was wrong. Serving a request stamps a new envelope; it re-reads nothing. A deployed binary
 * could be a week old, answer every call with a brand-new timestamp, and still be reciting facts
 * compiled into it at build time — while the payload claimed they were request-fresh.
 *
 * The source block is still never accepted from a caller. JOS-01E makes it DERIVED from what the
 * adopted read sources actually did: `REPOSITORY_BASELINE` / `BUILD_DECLARATION` /
 * `liveOperationalData: false` while nothing has been observed — which is every request in this
 * release, because no source is adopted yet — and `LIVE_ADAPTER` / `REQUEST_TIME` / `true` only
 * once a source genuinely reads something.
 *
 * ### Progressive read sources (JOS-01E, ADR-0089)
 *
 * Sources compose OVER the baseline; they do not replace it. Each declares the sections it may
 * speak for, so adopting one is bounded and reviewable. A source that cannot be read degrades only
 * its own sections to `NOT_CONNECTED` with no rows — never to an empty success, which would read as
 * "nothing is waiting for you". This stays the ONE place a snapshot is assembled and validated: the
 * page and the API both arrive here, and neither can compose its own variant.
 *
 * ### It validates its own output
 *
 * The result goes through `parseControlPlaneSnapshotV1` before it is returned, on every path. The
 * server therefore holds itself to exactly the contract a client will enforce, and a builder bug
 * fails here rather than surfacing as a client-side parse error in a browser nobody is watching.
 * Fail closed: an invalid construction throws and renders nothing, which is the correct outcome
 * for a surface whose only job is to be believed.
 */
export interface SnapshotRequest {
  /**
   * When this JSON snapshot is being produced. Supplied by the boundary; no clock is read here.
   *
   * It stamps the envelope and nothing else — see the note above about why freshness is not a
   * parameter, and §"Progressive read sources" for why an observing source moves freshness and this
   * never does.
   */
  readonly generatedAt: CanonicalInstant;
  /**
   * When the request boundary STARTED acquiring sources, before any I/O.
   *
   * Together with `generatedAt` this is the governed observation window. An observation outside it
   * is not evidence of request-time freshness and its source is refused. Defaults to `generatedAt`,
   * which is the correct degenerate case: with no sources to acquire, the window is a point.
   */
  readonly requestStartedAt?: CanonicalInstant;
  /**
   * Results already acquired by the request boundary (JOS-01E, ADR-0089).
   *
   * ALREADY ACQUIRED is the important word. The builder performs no I/O and awaits nothing, so it
   * stays pure and deterministic; `loadControlPlaneSnapshot` does the impure half and hands the
   * results in. Defaults to none, which is every request in this release because no source is
   * adopted — so the default output is byte-identical to JOS-01B.
   */
  readonly collected?: readonly CollectedObservation[];
}

export function buildControlPlaneSnapshot(request: SnapshotRequest): ControlPlaneSnapshotV1 {
  const window: ObservationWindow = {
    requestStartedAt: request.requestStartedAt ?? request.generatedAt,
    generatedAt: request.generatedAt,
  };
  const composed = composeSections(baselineSections(), request.collected ?? [], window);

  /**
   * Provenance is DERIVED from what the sources actually did, never asserted.
   *
   * With no observation the block is exactly what JOS-01B fixed: a compiled-in baseline that a
   * request cannot make fresher. The moment a source genuinely reads something, all three fields
   * move together — `LIVE_ADAPTER`, `REQUEST_TIME`, `liveOperationalData: true` — because the
   * contract rejects any other combination, and because claiming live data while sourcing none is
   * the exact misrepresentation this snapshot exists to prevent.
   */
  const source = composed.observed
    ? { kind: 'LIVE_ADAPTER', freshness: 'REQUEST_TIME', liveOperationalData: true }
    : { kind: 'REPOSITORY_BASELINE', freshness: 'BUILD_DECLARATION', liveOperationalData: false };

  const draft = {
    contractVersion: '1',
    generatedAt: request.generatedAt,
    mode: 'READ_ONLY',
    // Derived above from what the sources actually did. Still never accepted from the caller: that
    // was the JOS-01B defect, where the route passed REQUEST_TIME and a compiled-in baseline
    // claimed to have been freshly observed.
    source,
    authority: {
      jarvis: 'RECOMMENDS_AND_OBSERVES',
      quickfurnoCore: 'AUTHORIZES_AND_OWNS_BUSINESS_TRUTH',
      n8n: 'EXECUTES_ONLY',
      provider: 'DELIVERS_ONLY',
    },
    rollout: { enabled: false, state: 'ROLLOUT_OFF' },
    system: [...BASELINE_SYSTEM],
    capabilities: CAPABILITY_SNAPSHOT.map((capability) => ({
      id: capability.id,
      label: capability.label,
      lifecycle: capability.lifecycle,
      note: capability.note,
    })),
    agents: BASELINE_AGENTS.map((agent) => ({ ...agent, notes: [...agent.notes] })),
    roadmap: [...BASELINE_ROADMAP],
    sections: composed.sections,
  };

  // Validate before returning, always. `parse` also deep-freezes and detaches, so the module-level
  // baseline constants cannot be reached through the returned graph and mutated by a caller.
  return parseControlPlaneSnapshotV1(draft);
}
