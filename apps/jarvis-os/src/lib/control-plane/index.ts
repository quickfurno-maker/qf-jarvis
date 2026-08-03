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
 * The snapshot builder is pure and takes `observedAt` as an argument. Reading the clock is the
 * caller's job because only the caller knows what the instant means. These pages are statically
 * prerendered, so their figures were fixed when the build ran — `BUILD_DECLARATION`, not
 * `REQUEST_TIME`. The HTTP route, which runs per request, says `REQUEST_TIME`. Both call the same
 * builder, which is why the page and the API cannot disagree.
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
  buildControlPlaneSnapshot({ observedAt: BUILD_INSTANT, freshness: 'BUILD_DECLARATION' }),
);

/** The read model this build renders. Read-only, and honest about where it came from. */
export function controlPlane(): ControlPlaneReadModel {
  return INSTANCE;
}

export type * from './types';
