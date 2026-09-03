/**
 * What each role is allowed to SEE (AS2, ADR-0143 §6).
 *
 * ### Every model input is an explicit ALLOWLIST
 *
 * Not `Omit`. An omit-list silently re-admits every field a future scenario gains, so the next piece
 * of hidden state would arrive in a model's prompt because nobody remembered to exclude it. Each view
 * below is built field by field, and a scenario field added tomorrow reaches no model until somebody
 * decides it should.
 *
 * ### Three separate leaks, three separate views
 *
 * **Hidden customer state** must not reach the teacher. A teacher that could read
 * `plannedCustomerFacts` on turn 1 answers around a budget the customer reveals on turn 4 — a
 * transcript that is chronologically turn-by-turn and informationally not.
 *
 * **Future interaction labels** are the same leak in taxonomy form. `OBJECTION_PRICE` handed to the
 * teacher on turn 1 says a price objection is coming before the customer has objected. So the teacher
 * view carries no interaction kind at all; what the conversation currently IS must be inferred from
 * `visibleHistory`, exactly as a deployed Riya would have to.
 *
 * **Dataset governance state** must not reach ANY model — the customer simulator included. Splits are
 * fixed before generation for lineage isolation, and that is not the same as telling the generator
 * which split it is writing. A simulator that knows it is producing `VALIDATION` can drift the
 * validation distribution away from `TRAIN` for no reason a reader could ever find, and the exam is
 * quietly contaminated while lineage looks perfectly separated.
 *
 * `scenarioRef` and `lineageRootRef` stay out of the views too. They are transport and evidence
 * identity — the invocation envelope carries them — and nothing a model writes should depend on them.
 *
 * ### No protected-exam field exists anywhere here
 *
 * ADR-0143 §7. The protected corpus reaches the AS1 validator after a candidate exists, and there is
 * nowhere in these types for it to travel.
 */
import type { RiyaAiSyntheticScenarioV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetDiscoveryField,
  RiyaDatasetFactClass,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
} from '@qf-jarvis/riya-intelligence-dataset';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';

/** One thing that was said. The shared, visible transcript. */
export interface RiyaSyntheticVisibleTurn {
  readonly speaker: 'USER' | 'ASSISTANT';
  readonly text: string;
}

/**
 * Everything the Riya teacher may know about the plan.
 *
 * Deliberately absent, each because it forecasts what the customer will do or what the dataset is
 * for: `plannedCustomerFacts`, `customerBehaviorCodes`, `requiredConversationEvents`, `persona`,
 * `difficulty`, `targetAssistantTurns`, `primaryInteractionKind`, `secondaryInteractionKinds`,
 * `split`, `lineageRootRef`, `scenarioRef`.
 */
export interface RiyaSyntheticTeacherScenarioViewV1 {
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly riskClass: RiyaDatasetRiskClass;
  readonly startPhase: RiyaConversationPhase;
  /** An assistant-side teaching target: which fields this conversation should get to. */
  readonly plannedDiscoveryFields: readonly RiyaDatasetDiscoveryField[];
  readonly forbiddenBehaviors: readonly string[];
}

/**
 * Everything the customer simulator may know.
 *
 * It keeps the hidden CUSTOMER state, because revealing it on its own schedule is its entire job. It
 * does not keep dataset GOVERNANCE state — no split, no lineage, no corpus identity.
 */
export interface RiyaSyntheticCustomerScenarioViewV1 {
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly persona: RiyaDatasetPersona;
  readonly difficulty: RiyaDatasetDifficulty;
  readonly plannedDiscoveryFields: readonly RiyaDatasetDiscoveryField[];
  readonly plannedCustomerFacts: readonly { readonly field: string; readonly value: string }[];
  readonly customerBehaviorCodes: readonly string[];
  readonly requiredConversationEvents: readonly string[];
  readonly forbiddenBehaviors: readonly string[];
}

/**
 * A governed synthetic authority fact the teacher may actually use.
 *
 * The VALUE is here on purpose. A teacher given only a `factRef` can produce a citation label but not
 * a grounded answer, which pushes it toward the two behaviours this lane exists to prevent: invent
 * the number, or refuse to use authority even where the scenario calls for it.
 *
 * These are built ONLY from `AUTHORITATIVE_CONTEXT` turns already earlier in the trajectory — never
 * from `plannedCustomerFacts`. A customer's undisclosed fact and a governed business fact are
 * different channels with different rules, and merging them into one bag of "facts" is how a corpus
 * learns to assert a customer's private information as company truth.
 */
export interface RiyaSyntheticAvailableAuthorityFactV1 {
  readonly factRef: string;
  readonly factClass: RiyaDatasetFactClass;
  readonly value: string;
}

export interface RiyaSyntheticCustomerSimulatorInput {
  readonly scenario: RiyaSyntheticCustomerScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  /** Which exchange this is. Lets a simulator pace a correction or a detour across turns. */
  readonly turnIndex: number;
  /** True once the conversation has reached its planned depth and may close naturally. */
  readonly mayConclude: boolean;
}

export interface RiyaSyntheticTeacherInput {
  readonly scenario: RiyaSyntheticTeacherScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  readonly turnIndex: number;
  /** Governed authority already supplied EARLIER in this trajectory, with values. Only those. */
  readonly availableAuthorityFacts: readonly RiyaSyntheticAvailableAuthorityFactV1[];
}

export interface RiyaSyntheticVerifierInput {
  /** The verifier checks the teacher's claims, so it sees what the teacher saw. */
  readonly scenario: RiyaSyntheticTeacherScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  readonly askedDiscoveryFieldsByTurn: readonly (readonly string[])[];
  readonly decisionsByTurn: readonly string[];
}

export interface RiyaSyntheticCriticInput {
  /** A critic judges the finished conversation, not the plan behind it — and never the split. */
  readonly scenario: RiyaSyntheticTeacherScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  /** The dimensions this critic is asked about. A closed list, never free-form guidance. */
  readonly requestedQualityDimensions: readonly string[];
}

/** Project a scenario down to what the teacher may see. Constructed, never deleted from. */
export function teacherScenarioView(
  scenario: RiyaAiSyntheticScenarioV1,
): RiyaSyntheticTeacherScenarioViewV1 {
  return Object.freeze({
    languageMode: scenario.languageMode,
    riskClass: scenario.riskClass,
    startPhase: scenario.startPhase,
    plannedDiscoveryFields: scenario.plannedDiscoveryFields,
    forbiddenBehaviors: scenario.forbiddenBehaviors,
  });
}

/** Project a scenario down to what the customer simulator may see. */
export function customerScenarioView(
  scenario: RiyaAiSyntheticScenarioV1,
): RiyaSyntheticCustomerScenarioViewV1 {
  return Object.freeze({
    languageMode: scenario.languageMode,
    persona: scenario.persona,
    difficulty: scenario.difficulty,
    plannedDiscoveryFields: scenario.plannedDiscoveryFields,
    plannedCustomerFacts: scenario.plannedCustomerFacts,
    customerBehaviorCodes: scenario.customerBehaviorCodes,
    requiredConversationEvents: scenario.requiredConversationEvents,
    forbiddenBehaviors: scenario.forbiddenBehaviors,
  });
}
