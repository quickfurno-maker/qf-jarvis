/**
 * Derive model-neutral SFT samples from a trajectory (RID-F1, ADR-0107 §30).
 *
 * ### Derived, never authored
 *
 * One sample per assistant turn, computed from the trajectory. Nobody writes these by hand, and
 * nothing edits them afterwards. That is what keeps the trajectory the single source: fixing an
 * example means fixing one record, and every row regenerates.
 *
 * ### The prefix stops at the turn being learned
 *
 * A sample sees the state it started from, the turns before it, and the authoritative facts supplied
 * before it. It sees nothing after. That sounds obvious and it is the easiest thing in a dataset
 * pipeline to get wrong — a single off-by-one gives the model the customer's next message, it learns
 * to answer a question it has not been asked yet, and the validation score improves while the
 * product gets worse.
 *
 * ### Model-neutral
 *
 * No ChatML, no `<|im_start|>`, no `[INST]`, no system prompt bytes, no tokenizer, no provider
 * envelope. Those belong to a specific model and change with it; a corpus that carried them would
 * have to be regenerated for every candidate, and the base-model choice would be baked into the data
 * before the benchmark that is supposed to make it.
 *
 * ### No review metadata
 *
 * A sample carries no `reviewRef`, no decision, no manifest field. Review is how a trajectory earned
 * release; it is not something a model should see, and it names people.
 */
import type { RiyaConversationObservationBatchV1 } from '@qf-jarvis/riya-conversation-evolution';

import type { RiyaTrainingStateV1 } from '../contracts/training-state.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import type { RiyaDatasetAuthoritativeFactV1, RiyaDatasetTurnV1 } from '../contracts/turns.js';
import type {
  RiyaDatasetAssistantDecision,
  RiyaDatasetContextAuthority,
  RiyaDatasetDiscoveryField,
  RiyaDatasetLanguageMode,
  RiyaDatasetResponseObjective,
  RiyaDatasetSplit,
} from '../contracts/vocabularies.js';

/** One prior spoken turn, as the model would see it. */
export interface RiyaSftPrefixTurnV1 {
  readonly role: 'USER' | 'ASSISTANT';
  readonly text: string;
}

/** One authoritative fact available before the turn being learned. */
export interface RiyaSftContextFactV1 {
  readonly authority: RiyaDatasetContextAuthority;
  readonly factRef: string;
  readonly value: string;
  readonly factClass: RiyaDatasetAuthoritativeFactV1['factClass'];
}

export interface RiyaSftTargetV1 {
  readonly replyText: string;
  readonly decision: RiyaDatasetAssistantDecision;
  readonly expectedObservationBatch?: RiyaConversationObservationBatchV1;
  readonly askedDiscoveryFields: readonly RiyaDatasetDiscoveryField[];
  readonly responseObjective: RiyaDatasetResponseObjective;
}

export interface RiyaSftSampleV1 {
  readonly version: 1;
  readonly sampleId: string;
  readonly sourceTrajectoryId: string;
  readonly sourceTrajectoryRevision: number;
  /** Inherited, so a derived row can never drift into another split. */
  readonly lineageRootRef: string;
  readonly split: RiyaDatasetSplit;
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly stateBefore: RiyaTrainingStateV1;
  readonly conversationPrefix: readonly RiyaSftPrefixTurnV1[];
  readonly authoritativeContext: readonly RiyaSftContextFactV1[];
  readonly target: RiyaSftTargetV1;
}

const isSpoken = (turn: RiyaDatasetTurnV1): turn is Extract<RiyaDatasetTurnV1, { text: string }> =>
  turn.type === 'USER' || turn.type === 'ASSISTANT';

/**
 * One deterministic sample per assistant turn, in order.
 *
 * `stateBefore` is the trajectory's initial state for every sample. RID-F1 deliberately does not
 * re-run the RWC-P4A reducer to project a per-turn state: that would put a second copy of the
 * reducer in an offline package, and the day the two disagreed the corpus would silently encode the
 * wrong one. The per-turn signal a model needs is already present as the conversation prefix and the
 * expected observation batch; projecting state forward is a later slice's decision to make
 * explicitly, against the real reducer.
 */
export function deriveRiyaSftSamples(
  trajectory: RiyaIntelligenceTrajectoryV1,
): readonly RiyaSftSampleV1[] {
  const samples: RiyaSftSampleV1[] = [];
  const prefix: RiyaSftPrefixTurnV1[] = [];
  const context: RiyaSftContextFactV1[] = [];
  let ordinal = 0;

  for (const turn of trajectory.turns) {
    if (turn.type === 'AUTHORITATIVE_CONTEXT') {
      for (const fact of turn.facts) {
        context.push(
          Object.freeze({
            authority: turn.authority,
            factRef: fact.factRef,
            value: fact.value,
            factClass: fact.factClass,
          }),
        );
      }
      continue;
    }

    if (turn.type === 'USER') {
      prefix.push(Object.freeze({ role: 'USER' as const, text: turn.text }));
      continue;
    }

    ordinal += 1;
    samples.push(
      Object.freeze({
        version: 1 as const,
        // Derived from the source, so regenerating produces identical ids. The ordinal rather than
        // the turn ref, so a sample id survives an author renaming a turn.
        sampleId: `${trajectory.trajectoryId}#a${String(ordinal).padStart(2, '0')}`,
        sourceTrajectoryId: trajectory.trajectoryId,
        sourceTrajectoryRevision: trajectory.trajectoryRevision,
        lineageRootRef: trajectory.lineageRootRef,
        split: trajectory.split,
        languageMode: trajectory.languageMode,
        stateBefore: trajectory.initialState,
        // Snapshots taken BEFORE this turn is appended. Nothing later is visible.
        conversationPrefix: Object.freeze([...prefix]),
        authoritativeContext: Object.freeze([...context]),
        target: Object.freeze({
          replyText: turn.text,
          decision: turn.annotation.decision,
          ...(turn.annotation.expectedObservationBatch === undefined
            ? {}
            : { expectedObservationBatch: turn.annotation.expectedObservationBatch }),
          askedDiscoveryFields: turn.annotation.askedDiscoveryFields,
          responseObjective: turn.annotation.responseObjective,
        }),
      }),
    );
    prefix.push(Object.freeze({ role: 'ASSISTANT' as const, text: turn.text }));
  }

  return Object.freeze(samples);
}

/** Derive across a whole dataset, preserving trajectory order. */
export function deriveRiyaSftSamplesForDataset(
  trajectories: readonly RiyaIntelligenceTrajectoryV1[],
): readonly RiyaSftSampleV1[] {
  return Object.freeze(trajectories.flatMap((trajectory) => deriveRiyaSftSamples(trajectory)));
}

/** Exposed so a spec can assert the prefix contains only spoken turns. */
export const isSpokenTurn = isSpoken;
