/**
 * The discovery-field ↔ value-field mapping, and the recorded provenance precedence (RWC-P2A).
 *
 * INTERNAL. Neither export reaches the barrel.
 */
import type { DiscoveryField, NeedDiscovery } from '@qf-jarvis/riya-agent';

/**
 * Which `NeedDiscovery` value a `DiscoveryField` names.
 *
 * `DISCOVERY_FIELDS` and the value keys are deliberately spelled differently in ADR-0067 — the
 * field is `location`, the value is `locationRef` — so the mapping has to exist somewhere. It lives
 * here, as data, rather than as a string transformation: `scope → scopeSummary` and
 * `budget → budgetNote` do not follow the `Ref` pattern, so any clever suffix rule would be wrong
 * for three of the seven and would fail silently on whichever one nobody tested.
 *
 * `satisfies` pins it to the real contract: if ADR-0067 ever renames a value field or adds an
 * eighth discovery field, this stops compiling instead of quietly dropping a provenance check.
 */
export const DISCOVERY_VALUE_KEY = {
  serviceInterest: 'serviceInterestRef',
  location: 'locationRef',
  propertyType: 'propertyTypeRef',
  scope: 'scopeSummary',
  budget: 'budgetNote',
  timeline: 'timelineNote',
  consultationPreference: 'consultationPreferenceRef',
} as const satisfies Readonly<Record<DiscoveryField, keyof NeedDiscovery>>;

/**
 * The precedence ranks RWC-P0B froze, recorded so RWC-P4 inherits a reviewed order.
 *
 * `model_inferred < server_runtime < user_selected == user_stated < user_confirmed`
 *
 * Deliberately INTERNAL and deliberately UNUSED by this package. Recording the order is a contract
 * decision; acting on it is a merge, and the merge belongs to RWC-P4. A comparison helper exported
 * from here would be the first half of a reducer this slice must not contain — and once it existed,
 * the second half would arrive as an obvious convenience.
 *
 * It is written down rather than left to the next slice because "which source wins" is the decision
 * that determines whether a model inference can silently overwrite something a client confirmed.
 * That is not a detail to re-derive under implementation pressure.
 */
export const PROVENANCE_PRECEDENCE_RANK = Object.freeze({
  model_inferred: 1,
  server_runtime: 2,
  user_selected: 3,
  user_stated: 3,
  user_confirmed: 4,
});
