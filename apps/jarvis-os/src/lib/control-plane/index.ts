import { cache } from 'react';

import { loadControlPlaneSnapshot } from '../../server/control-plane/load-snapshot';
import { mapSnapshotToReadModel } from '../../server/control-plane/map-to-ui-model';

import type { ControlPlaneReadModel } from './types';

/**
 * The control-plane boundary (JOS-01A; made truthful in JOS-01B; made request-scoped in JOS-01E).
 *
 * ### The default is the repository baseline, not the demo fixture
 *
 * JOS-01A wired this to `createDemoControlPlane()`. That was the right shape and the wrong default:
 * the surface an operator opens showed synthetic conversation counts and a queue with waiting
 * approvals, and however clearly a banner says "demo", the numbers are what get believed. The
 * fixture still exists and is now reachable only from tests and visual fixtures.
 *
 * ### Per REQUEST, not per process
 *
 * This used to build one read model at module load and return it forever. With no live source that
 * was harmless — a compiled-in baseline does not get staler, and a per-render clock read would have
 * implied a freshness the page did not have.
 *
 * JOS-01E makes sources adoptable, and that turns the singleton into a real defect: the API would
 * recompose per request while every page kept reciting whatever was true when the process started.
 * The two would drift silently, and "the page and the API cannot drift" would stop being true at
 * exactly the moment it started to matter. So the snapshot is now loaded per request, through the
 * same boundary the API uses.
 *
 * ### `cache()` is per-request memoisation, NOT a process cache
 *
 * React's `cache` deduplicates within a single render pass, so a page reading four sections acquires
 * its sources once rather than four times. It does not persist across requests, which is the
 * property that matters here: a live observation must never outlive the request that produced it.
 *
 * ### It does not self-fetch
 *
 * A server component calling its own HTTP route would add a network hop, a failure mode and a second
 * source of truth for no benefit. The page and the route are two callers of one loader.
 */
export const controlPlane = cache(async (): Promise<ControlPlaneReadModel> =>
  mapSnapshotToReadModel(await loadControlPlaneSnapshot()),
);

export type * from './types';
