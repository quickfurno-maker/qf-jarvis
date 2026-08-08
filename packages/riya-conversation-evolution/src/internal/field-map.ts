/**
 * The discovery-field mapping and the provenance precedence, as this reducer uses them (RWC-P4A).
 *
 * INTERNAL. Neither export reaches the barrel.
 *
 * `riya-conversation-continuity` records the same two facts and deliberately does not act on them —
 * its own note says recording the order is a contract decision and acting on it is a merge that
 * belongs to RWC-P4. This is RWC-P4. They are restated here rather than exported from there because
 * exporting a rank map from the contract package is exactly the "first half of a reducer" that
 * package refused to contain, and `satisfies` pins both to the real upstream contracts so a renamed
 * field or a new provenance source stops the build instead of silently changing a merge outcome.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField, NeedDiscovery } from '@qf-jarvis/riya-agent';
import type { RiyaFieldProvenance } from '@qf-jarvis/riya-conversation-continuity';

/**
 * Which `NeedDiscovery` value a `DiscoveryField` names.
 *
 * The field is `location`, the value is `locationRef`; `scope → scopeSummary` and
 * `budget → budgetNote` do not follow the `Ref` pattern at all. Any clever suffix rule would be
 * wrong for three of the seven and would fail silently on whichever one nobody tested, so the
 * mapping is data.
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
 * The four fields a conversation must have learned before a summary can be shown.
 *
 * `propertyType`, `scope` and `consultationPreference` are deliberately ABSENT: they are genuinely
 * optional, and requiring them would strand conversations that legitimately never needed them.
 */
export const SUMMARY_REQUIRED_FIELDS: readonly DiscoveryField[] = Object.freeze([
  'serviceInterest',
  'location',
  'budget',
  'timeline',
]);

/**
 * The frozen precedence ranks.
 *
 * `model_inferred (1) < server_runtime (2) < user_selected (3) == user_stated (3) < user_confirmed (4)`
 *
 * `user_selected` and `user_stated` rank EQUALLY: choosing a chip and typing the same thing are the
 * same act of telling us, and ranking one above the other would let a surface affordance change how
 * much a client's own words counted.
 */
export const PROVENANCE_RANK = {
  model_inferred: 1,
  server_runtime: 2,
  user_selected: 3,
  user_stated: 3,
  user_confirmed: 4,
} as const satisfies Readonly<Record<RiyaFieldProvenance, number>>;

/**
 * The provenances whose ORIGIN is the person, and which may therefore clear a value.
 *
 * A `CLEAR` withdraws something the conversation believed. Only the person who could have said it
 * may take it back: a model that inferred a budget must not be able to delete one, and a server
 * seed must not be able to erase what a client chose. Those are refused as
 * `clear-not-user-origin`, distinct from an ordinary rank loss.
 */
export const USER_ORIGIN_PROVENANCES: readonly RiyaFieldProvenance[] = Object.freeze([
  'user_selected',
  'user_stated',
  'user_confirmed',
]);

/** Every canonical discovery field, in the frozen order. Re-exported so callers iterate one list. */
export const ALL_DISCOVERY_FIELDS: readonly DiscoveryField[] = DISCOVERY_FIELDS_FROZEN;
