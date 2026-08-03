/**
 * The control-plane boundary (JOS-01A).
 *
 * Every surface reads through `controlPlane()` and never imports the demo fixture directly.
 * That indirection is the whole architecture: JOS-01B swaps this one function for an API
 * adapter, and no page changes.
 */
import { createDemoControlPlane } from './demo-provider';
import type { ControlPlaneReadModel } from './types';

const INSTANCE: ControlPlaneReadModel = createDemoControlPlane();

/** The read model this build renders. Read-only, and honest about being a demo. */
export function controlPlane(): ControlPlaneReadModel {
  return INSTANCE;
}

export type * from './types';
