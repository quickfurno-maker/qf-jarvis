import {
  parseControlPlaneSnapshotV1,
  parseControlPlaneSnapshotV2,
} from '@qf-jarvis/control-plane-read-contract';
import type {
  CanonicalInstant,
  ControlPlaneSections,
  ControlPlaneSnapshotV1,
  ControlPlaneSnapshotV2,
} from '@qf-jarvis/control-plane-read-contract';

import { CAPABILITY_SNAPSHOT } from '../../lib/capabilities/catalog';

import {
  BASELINE_AAROHI_READINESS,
  BASELINE_AGENTS,
  BASELINE_ROADMAP,
  BASELINE_SYSTEM,
  BASELINE_V2_VENDOR_GROWTH_FUNNEL,
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

/**
 * Everything both wire versions share: one composition, one derived source block, one envelope.
 *
 * Extracted when AVG-11 added V2 (ADR-0129). The alternative — a second builder that re-composed
 * sources and re-derived provenance — would have been a second source of truth wearing a version
 * number, and the two would have drifted the first time one was edited. What a version is allowed to
 * change is the final wire SHAPE, and nothing else.
 */
interface SharedSnapshotCore {
  /** Every field except `contractVersion` and `sections`. Identical at both versions. */
  readonly envelope: {
    readonly generatedAt: CanonicalInstant;
    readonly mode: 'READ_ONLY';
    readonly source: {
      readonly kind: string;
      readonly freshness: string;
      readonly liveOperationalData: boolean;
    };
    readonly authority: {
      readonly jarvis: string;
      readonly quickfurnoCore: string;
      readonly n8n: string;
      readonly provider: string;
    };
    readonly rollout: { readonly enabled: false; readonly state: 'ROLLOUT_OFF' };
    readonly system: ControlPlaneSnapshotV1['system'];
    readonly capabilities: ControlPlaneSnapshotV1['capabilities'];
    readonly agents: ControlPlaneSnapshotV1['agents'];
    readonly roadmap: ControlPlaneSnapshotV1['roadmap'];
  };
  readonly sections: ControlPlaneSections;
}

function buildSharedCore(request: SnapshotRequest): SharedSnapshotCore {
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

  return {
    envelope: {
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
    },
    sections: composed.sections,
  };
}

/**
 * Build the V1 snapshot (JOS-01B, ADR-0086).
 *
 * Unchanged by AVG-11, and that is a requirement rather than an accident: ADR-0086's change-control
 * rule says a breaking shape change needs a new version, so the AVG-11 additions live in
 * {@link buildControlPlaneSnapshotV2} and this keeps producing exactly what it produced before.
 */
export function buildControlPlaneSnapshot(request: SnapshotRequest): ControlPlaneSnapshotV1 {
  const core = buildSharedCore(request);

  // Validate before returning, always. `parse` also deep-freezes and detaches, so the module-level
  // baseline constants cannot be reached through the returned graph and mutated by a caller.
  return parseControlPlaneSnapshotV1({
    ...core.envelope,
    contractVersion: '1',
    sections: core.sections,
  });
}

/**
 * Build the V2 snapshot from the SAME shared core (AVG-11, ADR-0129).
 *
 * ### One build, two wire shapes
 *
 * Everything above the `sections` key — the derived source block, the authority boundary, rollout,
 * system, capabilities, agents, roadmap — is produced by exactly the same code as V1, from exactly
 * the same composed observation set. Only the final wire SHAPING differs, and it differs in the two
 * places the version exists for: the funnel section and the added readiness section.
 *
 * That is deliberate and is the reason there is no second control-plane stack here. A V2 that
 * re-derived provenance, re-declared the authority boundary or re-composed sources would be a second
 * source of truth wearing a version number, and the two would drift the first time one was edited.
 *
 * ### The funnel is REPLACED, not converted
 *
 * A V1 funnel stage is `{ id, label, value, caption }` with a free identifier and no authority.
 * There is no honest function from that to a V2 stage: inventing an authority for a row that never
 * carried one is precisely the fabrication AVG-11 exists to prevent, and dropping the rows silently
 * would be worse.
 *
 * So V2 takes its funnel from its own reviewed declaration, and REFUSES to proceed if composition
 * ever produced V1 funnel rows. Today it cannot — the section is `PLANNED` and carries none — and if
 * a future adapter populates it, this throws rather than guessing. That is the same treatment
 * `composeSections` gives a structural failure: the composition it would produce is not trustworthy
 * anywhere, so no output is better than a plausible one.
 */
export function buildControlPlaneSnapshotV2(request: SnapshotRequest): ControlPlaneSnapshotV2 {
  const core = buildSharedCore(request);

  if (core.sections.vendorGrowthFunnel.items.length > 0) {
    throw new Error(
      'a V1 funnel stage cannot be published at V2: it carries no metric authority, and inventing one is the fabrication AVG-11 exists to prevent',
    );
  }

  const draft = {
    ...core.envelope,
    contractVersion: '2',
    sections: {
      ...core.sections,
      // Version-specific shaping, and the whole delta between the two wire shapes.
      vendorGrowthFunnel: {
        ...BASELINE_V2_VENDOR_GROWTH_FUNNEL,
        items: [...BASELINE_V2_VENDOR_GROWTH_FUNNEL.items],
      },
      aarohiAcquisitionReadiness: {
        ...BASELINE_AAROHI_READINESS,
        items: [...BASELINE_AAROHI_READINESS.items],
      },
    },
  };

  // Validated before it is returned, on every path, exactly as V1 is -- by V2's own parser.
  return parseControlPlaneSnapshotV2(draft);
}
