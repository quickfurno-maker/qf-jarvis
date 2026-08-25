import type { ControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';

import {
  jao1CapabilityDescriptorSchema,
  jao1HealthCapabilityOutputSchema,
  type Jao1CapabilityDescriptor,
} from './contracts.js';

export interface Jao1ReadSystemHealthCapability {
  readonly descriptor: Jao1CapabilityDescriptor;
  invoke(snapshot: ControlPlaneSnapshotV1, signal?: AbortSignal): unknown;
}

export class Jao1CapabilityError extends Error {
  readonly code: 'cancelled' | 'unavailable';

  constructor(code: 'cancelled' | 'unavailable') {
    super(`JAO-1 read capability ${code}`);
    this.name = 'Jao1CapabilityError';
    this.code = code;
  }
}

const descriptor = jao1CapabilityDescriptorSchema.parse({
  id: 'read.system-health-from-snapshot',
  purpose: 'Read validated system health from an injected control-plane snapshot.',
  dataClass: 'CONTROL_PLANE_READ_ONLY',
  allowedActor: 'jarvis',
  maxAutonomyLevel: 'L1_READ',
  timeoutMs: 1_000,
  maxCallsPerRun: 1,
  readOnly: true,
  businessEffect: false,
  requiresHumanApproval: false,
  requiresCoreAuthorization: false,
});

export const JAO1_READ_SYSTEM_HEALTH_CAPABILITY = Object.freeze(descriptor);

export function createSnapshotSystemHealthCapability(): Jao1ReadSystemHealthCapability {
  return Object.freeze({
    descriptor: JAO1_READ_SYSTEM_HEALTH_CAPABILITY,
    invoke(snapshot: ControlPlaneSnapshotV1, signal?: AbortSignal): unknown {
      if (signal?.aborted === true) {
        throw new Jao1CapabilityError('cancelled');
      }

      const snapshotRef = `control-plane:${snapshot.generatedAt}`;
      const components = snapshot.system.map((component) => ({
        id: component.id,
        label: component.label,
        state: component.state,
        detail: component.detail,
      }));
      const evidenceRefs = components.map(
        (component) => `control-plane.system:${component.id}:${component.state}`,
      );

      return jao1HealthCapabilityOutputSchema.parse({
        snapshotRef,
        components,
        evidenceRefs,
      });
    },
  });
}
