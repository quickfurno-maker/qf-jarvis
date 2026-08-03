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
 * Everything this builder emits is a compiled-in repository declaration, so the source block is
 * fixed here: `REPOSITORY_BASELINE`, `BUILD_DECLARATION`, `liveOperationalData: false`. A caller
 * cannot vary it, and the contract rejects the combination even if one tried.
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
   * This is the ONLY thing a caller may vary. It stamps the envelope and nothing else — see the
   * note above about why freshness is not a parameter.
   */
  readonly generatedAt: CanonicalInstant;
}

export function buildControlPlaneSnapshot(request: SnapshotRequest): ControlPlaneSnapshotV1 {
  const draft = {
    contractVersion: '1',
    generatedAt: request.generatedAt,
    mode: 'READ_ONLY',
    source: {
      // Everything below is declared by merged repository and governance state and compiled into
      // this build. No adapter reads a running system, so this is never LIVE_ADAPTER, freshness is
      // always BUILD_DECLARATION, and liveOperationalData is never true.
      //
      // These three are DERIVED here rather than accepted from the caller. That is the fix for the
      // defect this builder previously had: it took `freshness` as a parameter, so the route passed
      // REQUEST_TIME and the payload claimed a compiled-in baseline had been freshly observed. The
      // contract now rejects that combination, and the builder no longer offers the choice.
      kind: 'REPOSITORY_BASELINE',
      freshness: 'BUILD_DECLARATION',
      liveOperationalData: false,
    },
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
    sections: baselineSections(),
  };

  // Validate before returning, always. `parse` also deep-freezes and detaches, so the module-level
  // baseline constants cannot be reached through the returned graph and mutated by a caller.
  return parseControlPlaneSnapshotV1(draft);
}
