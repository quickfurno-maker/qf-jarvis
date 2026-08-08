/**
 * The phase reducer and the next-question plan (RWC-P4A, ADR-0098 §9–§12).
 *
 * Pure, total, and deliberately ordered: phase is DERIVED from what is known, not advanced one step
 * at a time. That is what lets one message supplying service, city, budget and timeline arrive at
 * `SUMMARY` in a single evolution, and what stops Riya asking for something she already has —
 * the product rule being that the conversation must not be longer than the form it replaces.
 *
 * ### The ceiling is SUMMARY
 *
 * `CONTACT`, `CONSENT` and `COMPLETE` belong to RWC-P6. Nothing here can produce them, and a state
 * that already sits in one is refused rather than reinterpreted: regressing a conversation that has
 * moved past the summary would be worse than declining to evolve it.
 */
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';

import { SUMMARY_REQUIRED_FIELDS } from './field-map.js';

/** Phases RWC-P4A may produce. `INTRO` is only ever preserved, never entered. */
export const EVOLVABLE_PHASES: readonly RiyaConversationPhase[] = Object.freeze([
  'INTRO',
  'NEED',
  'LOCATION',
  'PROJECT_DETAILS',
  'BUDGET_TIMELINE',
  'SUMMARY',
]);

/** Phases owned by RWC-P6. Evolving one is `phase-out-of-scope`. */
export const OUT_OF_SCOPE_PHASES: readonly RiyaConversationPhase[] = Object.freeze([
  'CONTACT',
  'CONSENT',
  'COMPLETE',
]);

export interface RiyaNextQuestionPlanV1 {
  readonly phase: RiyaConversationPhase;
  /**
   * The field(s) the next assistant turn should ask about. At most two, and two ONLY for the
   * budget+timeline pair. Never prose: how to phrase the question is the prompt's job, and a
   * sentence in this package would be a second place Riya's voice lived.
   */
  readonly questionFields: readonly DiscoveryField[];
}

const has = (
  values: Readonly<Partial<Record<DiscoveryField, string>>>,
  field: DiscoveryField,
): boolean => values[field] !== undefined;

/** True when all four summary-required values are present. */
export function summaryReady(values: Readonly<Partial<Record<DiscoveryField, string>>>): boolean {
  return SUMMARY_REQUIRED_FIELDS.every((field) => has(values, field));
}

/**
 * Decide the phase from what is known.
 *
 * Priority is exact and total:
 *
 * 1. no service → `NEED`
 * 2. service but no location → `LOCATION`
 * 3. all four summary-required present → `SUMMARY`
 * 4. service + location, budget/timeline still missing → the PROJECT_DETAILS question in §10D
 * 5. otherwise → `BUDGET_TIMELINE`
 *
 * `INTRO` survives only a complete semantic no-op on an untouched state: the first meaningful turn
 * with no service known is `NEED`, because a conversation that has heard something is no longer
 * introducing itself.
 */
export function nextPhase(args: {
  readonly currentPhase: RiyaConversationPhase;
  readonly values: Readonly<Partial<Record<DiscoveryField, string>>>;
  readonly changed: boolean;
  readonly skipProjectDetails: boolean;
  /** Fields this turn actually applied — used only for the PROJECT_DETAILS exit test. */
  readonly appliedFields: readonly DiscoveryField[];
}): RiyaConversationPhase {
  const { currentPhase, values, changed, skipProjectDetails, appliedFields } = args;

  if (currentPhase === 'INTRO' && !changed) {
    // A complete no-op on an untouched greeting. Nothing has been learned, so nothing has moved.
    return 'INTRO';
  }

  if (!has(values, 'serviceInterest')) {
    return 'NEED';
  }
  if (!has(values, 'location')) {
    return 'LOCATION';
  }
  if (summaryReady(values)) {
    return 'SUMMARY';
  }

  // Service and location are known; budget and/or timeline are not. The optional PROJECT_DETAILS
  // detour gets exactly ONE opportunity, and never blocks the summary.
  const suppliedDownstream = appliedFields.includes('budget') || appliedFields.includes('timeline');
  const detailsAnswered = has(values, 'propertyType') || has(values, 'scope');

  if (currentPhase === 'PROJECT_DETAILS') {
    // Exit on ANY of: a detail supplied, an explicit skip, or the client having already moved
    // downstream in this same turn. Otherwise STAY -- silence and a side question are not a skip,
    // which is what keeps the detour resilient without persisting a pending-question field.
    return detailsAnswered || skipProjectDetails || suppliedDownstream
      ? 'BUDGET_TIMELINE'
      : 'PROJECT_DETAILS';
  }

  // Not currently in PROJECT_DETAILS. Enter it only if the conversation has not already passed it
  // and nothing this turn makes the detour pointless.
  const alreadyPast = currentPhase === 'BUDGET_TIMELINE' || currentPhase === 'SUMMARY';
  if (alreadyPast || detailsAnswered || skipProjectDetails || suppliedDownstream) {
    return 'BUDGET_TIMELINE';
  }
  return 'PROJECT_DETAILS';
}

/** The question plan for a decided phase. Derived every time; never persisted. */
export function questionPlanFor(
  phase: RiyaConversationPhase,
  values: Readonly<Partial<Record<DiscoveryField, string>>>,
): RiyaNextQuestionPlanV1 {
  const fields: DiscoveryField[] = [];
  switch (phase) {
    case 'NEED':
      fields.push('serviceInterest');
      break;
    case 'LOCATION':
      fields.push('location');
      break;
    case 'PROJECT_DETAILS':
      // At most ONE optional ask, and only if it is still open.
      if (!has(values, 'propertyType')) {
        fields.push('propertyType');
      } else if (!has(values, 'scope')) {
        fields.push('scope');
      }
      break;
    case 'BUDGET_TIMELINE': {
      // The ONE permitted pairing: budget and timeline form a single natural thought
      // ("what's your approximate budget, and when would you like to start?").
      if (!has(values, 'budget')) {
        fields.push('budget');
      }
      if (!has(values, 'timeline')) {
        fields.push('timeline');
      }
      break;
    }
    // `INTRO` asks nothing here -- the greeting is the surface's, and RWC-P4A does not author it.
    // `SUMMARY` asks nothing: the client is being shown a draft, not interviewed.
    case 'INTRO':
    case 'SUMMARY':
    case 'CONTACT':
    case 'CONSENT':
    case 'COMPLETE':
      break;
  }
  return Object.freeze({ phase, questionFields: Object.freeze(fields) });
}
