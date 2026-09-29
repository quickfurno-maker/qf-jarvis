export const DECISION_DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
export type DecisionDataClass = (typeof DECISION_DATA_CLASSES)[number];

export const DECISION_QUESTION_TYPES = ['BOOLEAN', 'CHOICE', 'SCORE'] as const;
export type DecisionQuestionType = (typeof DECISION_QUESTION_TYPES)[number];

export interface BooleanDecisionQuestion {
  readonly type: 'BOOLEAN';
  readonly instructions: string;
  readonly trueCriteria?: string;
  readonly falseCriteria?: string;
}

export interface ChoiceDecisionQuestion {
  readonly type: 'CHOICE';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface ScoreDecisionQuestion {
  readonly type: 'SCORE';
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type DecisionQuestion =
  BooleanDecisionQuestion | ChoiceDecisionQuestion | ScoreDecisionQuestion;

export interface DecisionRequest {
  readonly dataClass: DecisionDataClass;
  readonly state: unknown;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

export interface BooleanDecisionAnswer {
  readonly type: 'BOOLEAN';
  readonly probability: number;
}

export interface ChoiceDecisionAnswer {
  readonly type: 'CHOICE';
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreDecisionAnswer {
  readonly type: 'SCORE';
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type DecisionAnswer = BooleanDecisionAnswer | ChoiceDecisionAnswer | ScoreDecisionAnswer;

export interface DecisionResult {
  readonly providerId: string;
  readonly model: string;
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface DecisionProvider {
  readonly providerId: string;
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResult>;
}

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_STATE_BYTES = 131_072;
const MAX_QUESTIONS = 8;
const MAX_CHOICES = 64;

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2_048;
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function serializedStateBytes(state: unknown): number {
  // JSON.stringify can return undefined at runtime for unsupported top-level values. Widen the
  // intermediate deliberately so this remains a real runtime boundary rather than a type-only one.
  const serialized: unknown = JSON.stringify(state);
  if (typeof serialized !== 'string') throw new TypeError('decision-state-invalid');
  return Buffer.byteLength(serialized, 'utf8');
}

export function validateDecisionRequest(request: DecisionRequest): void {
  // Preserve runtime validation even though callers see the narrower TypeScript union.
  const dataClass: string = request.dataClass;
  if (!(DECISION_DATA_CLASSES as readonly string[]).includes(dataClass))
    throw new TypeError('decision-data-class-invalid');
  if (serializedStateBytes(request.state) > MAX_STATE_BYTES)
    throw new TypeError('decision-state-too-large');
  const entries = Object.entries(request.questions);
  if (entries.length < 1 || entries.length > MAX_QUESTIONS)
    throw new TypeError('decision-question-count-invalid');
  for (const [name, question] of entries) {
    if (!REF.test(name) || !boundedText(question.instructions))
      throw new TypeError('decision-question-invalid');
    const questionType: string = question.type;
    if (!(DECISION_QUESTION_TYPES as readonly string[]).includes(questionType))
      throw new TypeError('decision-question-type-invalid');
    if (question.type === 'CHOICE') {
      const choices = Object.entries(question.criteria);
      if (choices.length < 2 || choices.length > MAX_CHOICES)
        throw new TypeError('decision-choice-count-invalid');
      for (const [key, description] of choices) {
        if (!REF.test(key) || !boundedText(description))
          throw new TypeError('decision-choice-invalid');
      }
    } else if (question.type === 'SCORE') {
      if (
        question.criteria.length < 2 ||
        question.criteria.length > 16 ||
        question.criteria.some((one) => !boundedText(one))
      ) {
        throw new TypeError('decision-score-invalid');
      }
    } else {
      if (question.trueCriteria !== undefined && !boundedText(question.trueCriteria))
        throw new TypeError('decision-boolean-invalid');
      if (question.falseCriteria !== undefined && !boundedText(question.falseCriteria))
        throw new TypeError('decision-boolean-invalid');
    }
  }
}

export const JARVIS_TASK_SHAPES = [
  'DIRECT_RESPONSE',
  'RETRIEVAL',
  'DEEP_REASONING',
  'CORE_VERIFICATION',
  'ACTION_REVIEW',
  'HUMAN_REVIEW',
] as const;
export type JarvisTaskShape = (typeof JARVIS_TASK_SHAPES)[number];

export interface JarvisActionCandidate {
  readonly actionId: string;
  readonly description: string;
}

export interface JarvisDecisionPreflight {
  readonly request: DecisionRequest;
  readonly candidateActionIds: readonly string[];
}

export function createJarvisDecisionPreflight(input: {
  readonly actorRef: string;
  readonly dataClass: DecisionDataClass;
  readonly state: unknown;
  readonly actionCandidates?: readonly JarvisActionCandidate[];
}): JarvisDecisionPreflight {
  if (!REF.test(input.actorRef)) throw new TypeError('decision-actor-ref-invalid');
  if (input.dataClass !== 'HOSTED_ALLOWED')
    throw new TypeError('decision-hosted-data-class-required');
  const actionCandidates = input.actionCandidates ?? [];
  if (actionCandidates.length > 63) throw new TypeError('decision-action-candidate-count-invalid');
  const actionCriteria: Record<string, string> = {
    NO_ACTION: 'No reviewed action candidate is appropriate.',
  };
  for (const candidate of actionCandidates) {
    if (
      !REF.test(candidate.actionId) ||
      !boundedText(candidate.description) ||
      candidate.actionId === 'NO_ACTION'
    ) {
      throw new TypeError('decision-action-candidate-invalid');
    }
    actionCriteria[candidate.actionId] = candidate.description;
  }
  const questions: Record<string, DecisionQuestion> = {
    task_shape: {
      type: 'CHOICE',
      instructions:
        'Choose the best advisory processing shape. This does not assign an agent or authorize an action.',
      criteria: {
        DIRECT_RESPONSE: 'A bounded response can be drafted from current governed context.',
        RETRIEVAL: 'More governed knowledge retrieval should happen before drafting.',
        DEEP_REASONING: 'The task needs a slower generative reasoning model.',
        CORE_VERIFICATION: 'A claim depends on authoritative QuickFurno Core state.',
        ACTION_REVIEW:
          'A reviewed action candidate may be relevant, subject to all downstream gates.',
        HUMAN_REVIEW: 'Human review should happen before continuing.',
      },
    },
    ambiguity: {
      type: 'SCORE',
      instructions: 'Rate ambiguity in the current state.',
      criteria: ['Clear', 'Minor ambiguity', 'Material ambiguity', 'Too ambiguous to automate'],
    },
    human_review: {
      type: 'BOOLEAN',
      instructions: 'Should a human review this state before Jarvis continues?',
      trueCriteria:
        'Safety, policy, ambiguity, conflict, or high-impact uncertainty warrants human review.',
      falseCriteria: 'No human review is needed for the next advisory step.',
    },
  };
  if (actionCandidates.length > 0) {
    questions['candidate_action'] = {
      type: 'CHOICE',
      instructions:
        'Choose at most one reviewed candidate worth evaluating downstream. This never authorizes execution.',
      criteria: actionCriteria,
    };
  }
  const request: DecisionRequest = {
    dataClass: input.dataClass,
    state: { actorRef: input.actorRef, context: input.state },
    questions,
  };
  validateDecisionRequest(request);
  return Object.freeze({
    request: Object.freeze(request),
    candidateActionIds: Object.freeze(actionCandidates.map((one) => one.actionId)),
  });
}

export interface JarvisDecisionAdvisory {
  readonly status: 'ADVISORY_READY' | 'HUMAN_REVIEW' | 'UNCERTAIN' | 'MALFORMED';
  readonly taskShape?: JarvisTaskShape;
  readonly ambiguityScore?: number;
  readonly candidateActionId?: string;
  readonly actorAssignmentMutable: false;
  readonly actionProposalAuthorized: false;
  readonly executionAuthorized: false;
}

export function interpretJarvisDecisionPreflight(input: {
  readonly preflight: JarvisDecisionPreflight;
  readonly result: DecisionResult;
  readonly minConfidence?: number;
}): JarvisDecisionAdvisory {
  const minConfidence = input.minConfidence ?? 0.7;
  if (!isUnit(minConfidence)) throw new TypeError('decision-confidence-threshold-invalid');
  const task = input.result.answers['task_shape'];
  const ambiguity = input.result.answers['ambiguity'];
  const human = input.result.answers['human_review'];
  if (task?.type !== 'CHOICE' || ambiguity?.type !== 'SCORE' || human?.type !== 'BOOLEAN') {
    return Object.freeze({
      status: 'MALFORMED',
      actorAssignmentMutable: false,
      actionProposalAuthorized: false,
      executionAuthorized: false,
    });
  }
  if (
    !JARVIS_TASK_SHAPES.includes(task.choice as JarvisTaskShape) ||
    !isUnit(task.confidence) ||
    !isUnit(ambiguity.confidence) ||
    !isUnit(human.probability)
  ) {
    return Object.freeze({
      status: 'MALFORMED',
      actorAssignmentMutable: false,
      actionProposalAuthorized: false,
      executionAuthorized: false,
    });
  }
  if (human.probability >= 0.5 || task.choice === 'HUMAN_REVIEW') {
    return Object.freeze({
      status: 'HUMAN_REVIEW',
      taskShape: task.choice as JarvisTaskShape,
      ambiguityScore: ambiguity.score,
      actorAssignmentMutable: false,
      actionProposalAuthorized: false,
      executionAuthorized: false,
    });
  }
  if (task.confidence < minConfidence || ambiguity.confidence < minConfidence) {
    return Object.freeze({
      status: 'UNCERTAIN',
      taskShape: task.choice as JarvisTaskShape,
      ambiguityScore: ambiguity.score,
      actorAssignmentMutable: false,
      actionProposalAuthorized: false,
      executionAuthorized: false,
    });
  }
  const candidate = input.result.answers['candidate_action'];
  let candidateActionId: string | undefined;
  if (candidate !== undefined) {
    if (
      candidate.type !== 'CHOICE' ||
      !isUnit(candidate.confidence) ||
      candidate.confidence < minConfidence
    ) {
      return Object.freeze({
        status: 'UNCERTAIN',
        taskShape: task.choice as JarvisTaskShape,
        ambiguityScore: ambiguity.score,
        actorAssignmentMutable: false,
        actionProposalAuthorized: false,
        executionAuthorized: false,
      });
    }
    if (candidate.choice !== 'NO_ACTION') {
      if (!input.preflight.candidateActionIds.includes(candidate.choice)) {
        return Object.freeze({
          status: 'MALFORMED',
          actorAssignmentMutable: false,
          actionProposalAuthorized: false,
          executionAuthorized: false,
        });
      }
      candidateActionId = candidate.choice;
    }
  }
  return Object.freeze({
    status: 'ADVISORY_READY',
    taskShape: task.choice as JarvisTaskShape,
    ambiguityScore: ambiguity.score,
    ...(candidateActionId === undefined ? {} : { candidateActionId }),
    actorAssignmentMutable: false,
    actionProposalAuthorized: false,
    executionAuthorized: false,
  });
}

export interface JarvisDecisionShadowInput {
  readonly actorRef: string;
  readonly dataClass: DecisionDataClass;
  readonly taskClass: string;
  readonly normalizedText: string | undefined;
}

export interface JarvisDecisionShadowPort {
  observe(input: JarvisDecisionShadowInput): Promise<void>;
}
