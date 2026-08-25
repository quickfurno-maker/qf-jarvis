/**
 * The JAO-5 static monitor registry (ADR-0119).
 *
 * Exactly two monitors, written down, proving both trigger classes: one scheduled, one
 * event-driven. There is no dynamic registration, no discovery, no loader, no install, no nearest
 * match and no fallback -- a cycle either names a monitor that is registered at the exact version,
 * or it is refused before anything is claimed.
 *
 * ### `ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY` is the whole availability vocabulary
 *
 * Spelled that way on purpose. `ACTIVE` alone would eventually be read as "this monitor is running
 * in production", and it is not: nothing schedules it, nothing consumes events, and enrollment is a
 * separate explicit act that expires. The literal says what it means so a later reader cannot
 * mistake a shadow proof for a launch.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage, no process.
 */
import { createHash } from 'node:crypto';

import {
  Jao5AmbientError,
  jao5MonitorDefinitionSchema,
  type Jao5MonitorDefinition,
} from './contracts.js';

/**
 * The scheduled monitor: system health on a cadence.
 *
 * Parsed rather than asserted at module load, so every literal in the definition schema is enforced
 * before the registry exists -- a monitor claiming business effect, production mutation or a wider
 * autonomy ceiling cannot be constructed even momentarily.
 */
export const JAO5_SCHEDULED_HEALTH_MONITOR: Jao5MonitorDefinition = Object.freeze(
  jao5MonitorDefinitionSchema.parse({
    monitorId: 'jao5.system-health.interval.v1',
    monitorVersion: '1',
    ownerId: 'jarvis.operations',
    governanceRef: 'ADR-0119.jao5-controlled-ambient-operations',
    availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',
    triggerType: 'SCHEDULED_INTERVAL',
    scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
    investigationType: 'jarvis.operations.shadow-health-investigation',
    maxAutonomyLevel: 'L1_READ',
    attentionClass: 'SHADOW_OPERATIONAL_ATTENTION',
    modelAuthority: 'QF_MODEL_GATEWAY_ONLY',
    cadenceSeconds: 900,
    eventType: null,
    budgetPolicy: { maxInvestigationsPerWindow: 4, budgetWindowSeconds: 3600 },
    dedupePolicy: { strategy: 'SCHEDULED_SLOT', durable: true },
    expiryPolicy: { maxEnrollmentSeconds: 7 * 24 * 60 * 60, enforcedWithoutSweeper: true },
    quietingPolicy: {
      quietAfterAttentionSeconds: 1800,
      quietAfterFailureSeconds: 300,
      quietAfterNoAnomalySeconds: 0,
    },
    killSwitchPolicy: { terminal: true, reversible: false, requiresExpectedRevision: true },
    readOnly: true,
    businessEffect: false,
    productionMutation: false,
  }),
);

/** The event monitor: system health when an approved signal says it changed. */
export const JAO5_EVENT_HEALTH_MONITOR: Jao5MonitorDefinition = Object.freeze(
  jao5MonitorDefinitionSchema.parse({
    monitorId: 'jao5.system-health.changed.v1',
    monitorVersion: '1',
    ownerId: 'jarvis.operations',
    governanceRef: 'ADR-0119.jao5-controlled-ambient-operations',
    availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',
    triggerType: 'APPROVED_EVENT',
    scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
    investigationType: 'jarvis.operations.shadow-health-investigation',
    maxAutonomyLevel: 'L1_READ',
    attentionClass: 'SHADOW_OPERATIONAL_ATTENTION',
    modelAuthority: 'QF_MODEL_GATEWAY_ONLY',
    cadenceSeconds: null,
    eventType: 'control-plane.system-health.changed.v1',
    budgetPolicy: { maxInvestigationsPerWindow: 6, budgetWindowSeconds: 3600 },
    dedupePolicy: { strategy: 'EVENT_ID', durable: true },
    expiryPolicy: { maxEnrollmentSeconds: 7 * 24 * 60 * 60, enforcedWithoutSweeper: true },
    quietingPolicy: {
      quietAfterAttentionSeconds: 1800,
      quietAfterFailureSeconds: 300,
      quietAfterNoAnomalySeconds: 0,
    },
    killSwitchPolicy: { terminal: true, reversible: false, requiresExpectedRevision: true },
    readOnly: true,
    businessEffect: false,
    productionMutation: false,
  }),
);

/** The monitors JAO-5 ships. Exactly two, and a spec pins the set. */
export const JAO5_MONITOR_DEFINITIONS: readonly Jao5MonitorDefinition[] = Object.freeze([
  JAO5_SCHEDULED_HEALTH_MONITOR,
  JAO5_EVENT_HEALTH_MONITOR,
]);

export const JAO5_MONITOR_IDS: readonly string[] = Object.freeze(
  JAO5_MONITOR_DEFINITIONS.map((one) => one.monitorId).sort(),
);

/**
 * A digest over the governed fields of a definition.
 *
 * An enrollment stores this, so an instance is bound to the exact definition it was enrolled
 * against. A definition edited later -- a widened budget, a shortened quiet, a different owner --
 * no longer matches, and the enrollment fails closed rather than silently governing something else.
 *
 * Serialised through sorted keys rather than `JSON.stringify` over the object, because key order is
 * a property of how an object was built and two identical definitions must digest identically.
 */
export function jao5DefinitionDigest(definition: Jao5MonitorDefinition): string {
  const source: Readonly<Record<string, unknown>> = { ...definition };
  const hash = createHash('sha256');
  for (const key of Object.keys(source).sort()) {
    // Coerced BEFORE stringifying: `JSON.stringify(undefined)` returns undefined rather than a
    // string, and a digest that silently skipped a field would let two different definitions hash
    // identically.
    const value = JSON.stringify(source[key] ?? null);
    // Length-prefixed, so two different splits of the same characters are different definitions.
    hash.update(`${key}=${String(value.length)}:${value};`);
  }
  return hash.digest('hex');
}

export interface Jao5MonitorRegistry {
  readonly definitions: readonly Jao5MonitorDefinition[];
  lookup(monitorId: string, monitorVersion: string): Jao5MonitorDefinition;
}

/**
 * Build the registry over an explicit definition list.
 *
 * The list is a parameter so a spec can prove an unknown or wrong-version monitor is refused.
 * Production callers pass nothing and get the two shipped definitions.
 *
 * Availability is not a lookup outcome here: both shipped monitors carry the one availability
 * literal, and what actually decides whether a monitor may run is its ENROLLMENT -- which expires,
 * can be quieted and can be killed. A definition is a description; an instance is the thing with a
 * lifecycle.
 */
export function createJao5MonitorRegistry(
  definitions: readonly Jao5MonitorDefinition[] = JAO5_MONITOR_DEFINITIONS,
): Jao5MonitorRegistry {
  const frozen = Object.freeze([...definitions]);
  return Object.freeze({
    definitions: frozen,
    lookup(monitorId: string, monitorVersion: string): Jao5MonitorDefinition {
      const byId = frozen.filter((one) => one.monitorId === monitorId);
      if (byId.length === 0) {
        // No nearest match and no substitute. An unknown monitor is a stop, not a routing problem.
        throw new Jao5AmbientError('MONITOR_UNKNOWN');
      }
      const definition = byId.find((one) => one.monitorVersion === monitorVersion);
      if (definition === undefined) {
        // A version is part of the identity, not a hint: serving v1 for a v2 request would make a
        // caller trust bounds that were never agreed.
        throw new Jao5AmbientError('MONITOR_VERSION_MISMATCH');
      }
      return definition;
    },
  });
}
