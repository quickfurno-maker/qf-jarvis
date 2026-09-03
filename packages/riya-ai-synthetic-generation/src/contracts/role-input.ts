/**
 * What each role is allowed to SEE (AS2, ADR-0143 §6).
 *
 * ### The visibility rules are types, not conventions
 *
 * The customer simulator receives `visibleHistory` — everything said so far — and nothing else. There
 * is no field on its input through which a future Riya turn could arrive, so "the simulator cannot
 * see the future" is a property of the contract rather than a discipline somebody maintains.
 *
 * The teacher's input is the same shape for the same reason, and neither carries the scenario's
 * hidden customer state: a teacher that could read the plan would answer questions the customer had
 * not asked yet, which is the single most convincing way to make a synthetic corpus useless.
 *
 * ### No protected exam field exists anywhere here
 *
 * ADR-0143 §7. The protected corpus reaches the AS1 validator after a candidate exists. There is
 * deliberately no input field it could travel in, so a future edit that tried to hand the exam to a
 * generator would have to change these types first — visibly, in review.
 */
import type { RiyaAiSyntheticScenarioV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';

/** One thing that was said. The shared, visible transcript. */
export interface RiyaSyntheticVisibleTurn {
  readonly speaker: 'USER' | 'ASSISTANT';
  readonly text: string;
}

export interface RiyaSyntheticCustomerSimulatorInput {
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  /** Which exchange this is. Lets a simulator pace a correction or a detour across turns. */
  readonly turnIndex: number;
  /** True once the conversation has reached its planned depth and may close naturally. */
  readonly mayConclude: boolean;
}

export interface RiyaSyntheticTeacherInput {
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  readonly turnIndex: number;
  /** Fact refs already supplied by an EARLIER authoritative context turn, and only those. */
  readonly availableFactRefs: readonly string[];
}

export interface RiyaSyntheticVerifierInput {
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  readonly askedDiscoveryFieldsByTurn: readonly (readonly string[])[];
  readonly decisionsByTurn: readonly string[];
}

export interface RiyaSyntheticCriticInput {
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly visibleHistory: readonly RiyaSyntheticVisibleTurn[];
  /** The dimensions this critic is asked about. A closed list, never free-form guidance. */
  readonly requestedQualityDimensions: readonly string[];
}
