import { buildControlPlaneSnapshot } from '../../server/control-plane/build-snapshot';
import { mapSnapshotToReadModel } from '../../server/control-plane/map-to-ui-model';

import type { ControlPlaneReadModel } from './types';

/**
 * The control-plane boundary (JOS-01A; made truthful in JOS-01B).
 *
 * ### The default is the repository baseline, not the demo fixture
 *
 * JOS-01A wired this to `createDemoControlPlane()`. That was the right shape and the wrong
 * default: the surface an operator opens showed synthetic conversation counts and a queue with
 * waiting approvals, and however clearly a banner says "demo", the numbers are what get believed.
 * The fixture still exists and is now reachable only from tests and visual fixtures.
 *
 * ### This is the boundary, so this is where the clock is read
 *
 * The snapshot builder is pure and takes `generatedAt` as an argument. That instant stamps the
 * envelope — when this snapshot was produced — and nothing else. It is NOT the freshness of the
 * facts: those are compiled-in repository declarations, so the builder fixes
 * `source.freshness = BUILD_DECLARATION` for the page and the route alike, and neither can raise
 * it by being called more often.
 *
 * ### It does not self-fetch
 *
 * A server component calling its own HTTP route would add a network hop, a failure mode and a
 * second source of truth for no benefit. The page and the route are two callers of one function.
 */

/**
 * The instant this build declares.
 *
 * Captured once at module load. For a prerendered surface that is the build instant, which is
 * exactly what `BUILD_DECLARATION` claims — a per-render clock read would imply a freshness the
 * page does not have.
 */
const BUILD_INSTANT = new Date().toISOString();

const INSTANCE: ControlPlaneReadModel = mapSnapshotToReadModel(
  buildControlPlaneSnapshot({ generatedAt: BUILD_INSTANT }),
);

/** The read model this build renders. Read-only, and honest about where it came from. */
export function controlPlane(): ControlPlaneReadModel {
  return INSTANCE;
}

export type * from './types';
