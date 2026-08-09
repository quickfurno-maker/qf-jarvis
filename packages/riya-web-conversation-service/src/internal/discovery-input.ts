/**
 * Projecting a stored `NeedDiscovery` back into the shape its own constructor accepts (RWC-P6B).
 *
 * ### Why this is needed at all
 *
 * `NeedDiscovery` is an OUTPUT: it carries a derived `behaviourVersion`, a recomputed `missingFields`,
 * and every optional slot present as `undefined`. `NeedDiscoveryInput` is strict and accepts none of
 * those. So a canonical discovery cannot be handed straight back to `createNeedDiscovery`, and the
 * Core submission contract re-proves its discovery through exactly that constructor.
 *
 * ### What this is NOT
 *
 * It is not a reducer and it is not a second definition of a valid discovery. It moves no value,
 * merges nothing, ranks no provenance and recomputes no completeness — it drops a derived field and
 * turns "present holding `undefined`" into "absent", which under `exactOptionalPropertyTypes` are
 * genuinely different objects. Everything that matters is then re-proved by the real constructor
 * inside `createCoreRiyaIntakeSubmissionRequestV1`, and a spec asserts the round trip returns a
 * discovery deep-equal to the one that was stored.
 *
 * The pure RWC-P6A package performs the identical projection for the identical reason, privately. It
 * is not exported, and P6B does not change that package to make it so.
 */
import type { NeedDiscovery, NeedDiscoveryInput } from '@qf-jarvis/riya-agent';

export function needDiscoveryInputOf(discovery: NeedDiscovery): NeedDiscoveryInput {
  return {
    ...(discovery.serviceInterestRef === undefined
      ? {}
      : { serviceInterestRef: discovery.serviceInterestRef }),
    ...(discovery.locationRef === undefined ? {} : { locationRef: discovery.locationRef }),
    ...(discovery.propertyTypeRef === undefined
      ? {}
      : { propertyTypeRef: discovery.propertyTypeRef }),
    ...(discovery.scopeSummary === undefined ? {} : { scopeSummary: discovery.scopeSummary }),
    ...(discovery.budgetNote === undefined ? {} : { budgetNote: discovery.budgetNote }),
    ...(discovery.timelineNote === undefined ? {} : { timelineNote: discovery.timelineNote }),
    ...(discovery.consultationPreferenceRef === undefined
      ? {}
      : { consultationPreferenceRef: discovery.consultationPreferenceRef }),
    completeness: discovery.completeness,
    ...(discovery.missingFields.length === 0
      ? {}
      : { missingFields: [...discovery.missingFields] }),
  };
}
