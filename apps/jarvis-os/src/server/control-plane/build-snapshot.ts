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
 * `observedAt` is INJECTED. The builder reads no clock, no environment variable, no file, no
 * network and no database, and it is deterministic: the same instant in gives byte-identical
 * output. That is what lets the HTTP route and the server-rendered page share one implementation
 * and be provably the same — a self-fetching page could drift from its own API, and this cannot.
 *
 * Reading the clock is the caller's job precisely because the caller knows what the instant MEANS.
 * A statically prerendered page is a `BUILD_DECLARATION`; a request to the route is `REQUEST_TIME`.
 * The builder must not guess which, so it is not given the choice.
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
  /** The instant this reading was taken. Supplied by the boundary, never read here. */
  readonly observedAt: CanonicalInstant;
  /**
   * What the instant means.
   *
   * `REQUEST_TIME` for the HTTP route; `BUILD_DECLARATION` for a prerendered page, whose figures
   * were fixed when the build ran and would be a lie to present as fresh.
   */
  readonly freshness: 'REQUEST_TIME' | 'BUILD_DECLARATION';
}

export function buildControlPlaneSnapshot(request: SnapshotRequest): ControlPlaneSnapshotV1 {
  const draft = {
    contractVersion: '1',
    observedAt: request.observedAt,
    mode: 'READ_ONLY',
    source: {
      // Everything below is declared by merged repository and governance state. No adapter reads a
      // running system, so this is never LIVE_ADAPTER and liveOperationalData is never true.
      kind: 'REPOSITORY_BASELINE',
      freshness: request.freshness,
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
