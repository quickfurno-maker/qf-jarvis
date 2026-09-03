/**
 * What each role is allowed to SEE (AS2, ADR-0143 §6).
 *
 * ### The teacher gets a PROJECTION, not the scenario
 *
 * The first version passed the whole `RiyaAiSyntheticScenarioV1` to the Riya teacher while a comment
 * claimed the teacher could not read the customer's plan. The comment was aspirational and the type
 * was the truth: a real adapter receives `structuredInput`, so a real teacher could read
 * `plannedCustomerFacts` on turn 1 and answer around a budget the customer reveals on turn 4.
 *
 * That is synthetic omniscience. The transcript stays chronologically turn-by-turn while the
 * INFORMATION is not, and the result is a corpus that reads beautifully and teaches Riya to know
 * things nobody told her.
 *
 * So the teacher receives `RiyaSyntheticTeacherScenarioViewV1`: an explicit ALLOWLIST, built field by
 * field. Not `Omit<...>` — an omit-list silently re-admits every field a future scenario gains, and
 * the next hidden-state field would arrive in the teacher's input without anybody deciding it should.
 *
 * ### The customer simulator keeps the whole plan
 *
 * It owns that hidden state; revealing facts on its own schedule is its entire job.
 *
 * ### No protected-exam field exists anywhere here
 *
 * ADR-0143 §7. The protected corpus reaches the AS1 validator after a candidate exists. There is
 * deliberately nowhere for it to travel, so an edit that tried to hand the exam to a generator would
 * have to change these types first — visibly, in review.
 */
import type { RiyaAiSyntheticScenarioV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type {
  RiyaDatasetDiscoveryField,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
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
 * Each field earns its place as something the ASSISTANT side legitimately needs. Deliberately absent,
 * and each for the same reason — it would tell the teacher what the customer is going to do:
 *
 * - `plannedCustomerFacts` — the customer's undisclosed facts and when they surface;
 * - `customerBehaviorCodes` — that a correction, a detour or an objection is coming;
 * - `requiredConversationEvents` — the same, in event form (`APPLY_CORRECTION`, `HANDOFF_TO_HUMAN`);
 * - `persona` and `difficulty` — a forecast of how the customer will behave;
 * - `targetAssistantTurns` — how long the conversation is "supposed" to run, which invites a teacher
 *   to pace toward a close it has been told about rather than one the customer reached.
 */
export interface RiyaSyntheticTeacherScenarioViewV1 {
  readonly scenarioRef: string;
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly primaryInteractionKind: RiyaDatasetInteractionKind;
  readonly secondaryInteractionKinds: readonly RiyaDatasetInteractionKind[];
  readonly riskClass: RiyaDatasetRiskClass;
  readonly startPhase: RiyaConversationPhase;
  /** An assistant-side teaching target: which fields this conversation should get to. */
  readonly plannedDiscoveryFields: readonly RiyaDatasetDiscoveryField[];
  readonly forbiddenBehaviors: readonly string[];
}

/**
 * Project a scenario down to what the teacher may see.
 *
 * Written as an explicit construction rather than a deletion. If `RiyaAiSyntheticScenarioV1` gains a
 * field tomorrow, this function does not change and the teacher does not learn about it — which is
 * the correct default for a boundary whose failure mode is silent.
 */
export function teacherScenarioView(
  scenario: RiyaAiSyntheticScenarioV1,
): RiyaSyntheticTeacherScenarioViewV1 {
  return Object.freeze({
    scenarioRef: scenario.scenarioRef,
    languageMode: scenario.languageMode,
    primaryInteractionKind: scenario.primaryInteractionKind,
    secondaryInteractionKinds: scenario.secondaryInteractionKinds,
    riskClass: scenario.riskClass,
    startPhase: scenario.startPhase,
    plannedDiscoveryFields: scenario.plannedDiscoveryFields,
    forbiddenBehaviors: scenario.forbiddenBehaviors,
  });
}

export interface RiyaSyntheticCustomerSimulatorInput {
  /** The FULL plan. The simulator owns the hidden customer state and reveals it on its own schedule. */
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  /** Which exchange this is. Lets a simulator pace a correction or a detour across turns. */
  readonly turnIndex: number;
  /** True once the conversation has reached its planned depth and may close naturally. */
  readonly mayConclude: boolean;
}

export interface RiyaSyntheticTeacherInput {
  /** The PROJECTION. Never the scenario — see the note at the top of this file. */
  readonly scenario: RiyaSyntheticTeacherScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  readonly turnIndex: number;
  /** Fact refs already supplied by an EARLIER authoritative context turn, and only those. */
  readonly availableFactRefs: readonly string[];
}

export interface RiyaSyntheticVerifierInput {
  /** The verifier checks the teacher's claims, so it sees what the teacher saw. */
  readonly scenario: RiyaSyntheticTeacherScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  readonly askedDiscoveryFieldsByTurn: readonly (readonly string[])[];
  readonly decisionsByTurn: readonly string[];
}

export interface RiyaSyntheticCriticInput {
  /** A critic judges the finished conversation, not the plan behind it. */
  readonly scenario: RiyaSyntheticTeacherScenarioViewV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  /** The dimensions this critic is asked about. A closed list, never free-form guidance. */
  readonly requestedQualityDimensions: readonly string[];
}
