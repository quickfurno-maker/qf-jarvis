/**
 * Provider-neutral System-One decision runtime (ADR-0171).
 *
 * This is NOT a text-generation provider and NOT an authority surface. A decision engine may classify,
 * score or choose among bounded alternatives. Every completed result is advisory evidence only:
 * business authority, approval and execution remain false and cannot be granted by this contract.
 */
export interface DecisionJsonArray extends ReadonlyArray<DecisionJson> {
  readonly [index: number]: DecisionJson;
}

export interface DecisionJsonObject {
  readonly [key: string]: DecisionJson;
}

export type DecisionJson =
  null | boolean | number | string | DecisionJsonArray | DecisionJsonObject;

export const SYSTEM_ONE_DATA_CLASSES = ['PUBLIC', 'MINIMIZED_BUSINESS'] as const;
export type SystemOneDataClass = (typeof SYSTEM_ONE_DATA_CLASSES)[number];

export const SYSTEM_ONE_MODES = ['SHADOW', 'ADVISORY'] as const;
export type SystemOneMode = (typeof SYSTEM_ONE_MODES)[number];

export interface NoulDecisionQuestion {
  readonly type: 'noul';
  readonly instructions?: DecisionJson;
  readonly criteria?: Readonly<{ readonly true?: DecisionJson; readonly false?: DecisionJson }>;
}

export interface ChoiceDecisionQuestion {
  readonly type: 'choice';
  readonly instructions?: DecisionJson;
  readonly criteria: Readonly<Record<string, DecisionJson>>;
}

export interface ScoreDecisionQuestion {
  readonly type: 'score';
  readonly instructions?: DecisionJson;
  readonly criteria: readonly DecisionJson[];
}

export type SystemOneDecisionQuestion =
  NoulDecisionQuestion | ChoiceDecisionQuestion | ScoreDecisionQuestion;

export interface SystemOneDecisionRequest {
  readonly protocol: 'qfj.system-one-decision.v1';
  readonly runId: string;
  /**
   * Agent-neutral governed actor reference, e.g. agent.riya or agent.future-name.
   * The adapter never decides whether an actor exists or is allowed to act.
   */
  readonly actorRef: string;
  readonly purposeRef: string;
  readonly dataClass: SystemOneDataClass;
  readonly mode: SystemOneMode;
  readonly state: DecisionJson;
  readonly questions: Readonly<Record<string, SystemOneDecisionQuestion>>;
  readonly timeoutMs: number;
}

export interface NoulDecisionAnswer {
  readonly type: 'noul';
  readonly noul: number;
}

export interface ChoiceDecisionAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreDecisionAnswer {
  readonly type: 'score';
  readonly score: number;
  readonly confidence: number;
  readonly legend: Readonly<Record<string, DecisionJson>>;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type SystemOneDecisionAnswer =
  NoulDecisionAnswer | ChoiceDecisionAnswer | ScoreDecisionAnswer;

export interface SystemOneDecisionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface SystemOneDecisionAuthority {
  readonly businessAuthority: false;
  readonly approvalGranted: false;
  readonly executionAuthorized: false;
}

export interface CompletedSystemOneDecision {
  readonly status: 'completed';
  readonly runId: string;
  readonly providerId: string;
  readonly model: string;
  readonly answers: Readonly<Record<string, SystemOneDecisionAnswer>>;
  readonly usage: SystemOneDecisionUsage;
  readonly authority: SystemOneDecisionAuthority;
}

export type SystemOneDecisionResult =
  | CompletedSystemOneDecision
  | { readonly status: 'timeout' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'rate-limited' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed' }
  | { readonly status: 'malformed' };

export interface SystemOneDecisionEngineDescriptor {
  readonly engineId: string;
  readonly providerId: string;
  readonly modelFamily: string;
}

export interface SystemOneDecisionEngine {
  readonly descriptor: SystemOneDecisionEngineDescriptor;
  evaluate(
    request: SystemOneDecisionRequest,
    signal: AbortSignal,
  ): Promise<SystemOneDecisionResult>;
}

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const QUESTION_KEY = /^[A-Za-z0-9._:-]{1,96}$/u;
const CHOICE_KEY = /^[A-Za-z0-9._: -]{1,128}$/u;
const MAX_STATE_CHARS = 200_000;
const MAX_QUESTIONS = 32;
const MAX_JSON_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDecisionJson(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): value is DecisionJson {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.length <= 2048 && value.every((one) => isDecisionJson(one, depth + 1, seen));
  }
  const entries = Object.entries(value);
  return (
    entries.length <= 2048 &&
    entries.every(
      ([key, one]) => key.length >= 1 && key.length <= 256 && isDecisionJson(one, depth + 1, seen),
    )
  );
}

function deepFreezeJson(value: DecisionJson): DecisionJson {
  if (Array.isArray(value)) {
    const arrayValue = value as readonly DecisionJson[];
    return Object.freeze(arrayValue.map((one) => deepFreezeJson(one)));
  }
  if (value !== null && typeof value === 'object') {
    const objectValue = value as DecisionJsonObject;
    const frozen: Record<string, DecisionJson> = {};
    for (const key of Object.keys(objectValue)) {
      const one = objectValue[key];
      if (one === undefined) {
        throw new TypeError('system-one-decision-request-invalid');
      }
      frozen[key] = deepFreezeJson(one);
    }
    return Object.freeze(frozen);
  }
  return value;
}

function cloneJson(value: DecisionJson): DecisionJson {
  return deepFreezeJson(JSON.parse(JSON.stringify(value)) as DecisionJson);
}

function normalizeInstructions(value: unknown): DecisionJson | undefined {
  if (value === undefined) return undefined;
  if (!isDecisionJson(value)) throw new TypeError('system-one-decision-request-invalid');
  return cloneJson(value);
}

function normalizeQuestion(input: unknown): SystemOneDecisionQuestion {
  if (!isRecord(input)) throw new TypeError('system-one-decision-request-invalid');
  const type = input['type'];
  if (!['noul', 'choice', 'score'].includes(String(type))) {
    throw new TypeError('system-one-decision-request-invalid');
  }
  const instructions = normalizeInstructions(input['instructions']);
  const rawCriteria = input['criteria'];
  if (type === 'noul') {
    let criteria: NoulDecisionQuestion['criteria'];
    if (rawCriteria !== undefined) {
      if (!isRecord(rawCriteria)) throw new TypeError('system-one-decision-request-invalid');
      const allowed = new Set(['true', 'false']);
      if (Object.keys(rawCriteria).some((key) => !allowed.has(key))) {
        throw new TypeError('system-one-decision-request-invalid');
      }
      const t = rawCriteria['true'];
      const f = rawCriteria['false'];
      if ((t !== undefined && !isDecisionJson(t)) || (f !== undefined && !isDecisionJson(f))) {
        throw new TypeError('system-one-decision-request-invalid');
      }
      criteria = Object.freeze({
        ...(t === undefined ? {} : { true: cloneJson(t) }),
        ...(f === undefined ? {} : { false: cloneJson(f) }),
      });
    }
    return Object.freeze({
      type: 'noul' as const,
      ...(instructions === undefined ? {} : { instructions }),
      ...(criteria === undefined ? {} : { criteria }),
    });
  }
  if (type === 'choice') {
    if (!isRecord(rawCriteria)) throw new TypeError('system-one-decision-request-invalid');
    const entries = Object.entries(rawCriteria);
    if (entries.length < 1 || entries.length > 255) {
      throw new TypeError('system-one-decision-request-invalid');
    }
    const criteria: Record<string, DecisionJson> = {};
    for (const [key, value] of entries) {
      if (!CHOICE_KEY.test(key) || !isDecisionJson(value)) {
        throw new TypeError('system-one-decision-request-invalid');
      }
      criteria[key] = cloneJson(value);
    }
    return Object.freeze({
      type: 'choice' as const,
      ...(instructions === undefined ? {} : { instructions }),
      criteria: Object.freeze(criteria),
    });
  }
  if (!Array.isArray(rawCriteria) || rawCriteria.length < 1 || rawCriteria.length > 64) {
    throw new TypeError('system-one-decision-request-invalid');
  }
  if (!rawCriteria.every((one) => isDecisionJson(one))) {
    throw new TypeError('system-one-decision-request-invalid');
  }
  return Object.freeze({
    type: 'score' as const,
    ...(instructions === undefined ? {} : { instructions }),
    criteria: Object.freeze(rawCriteria.map((one) => cloneJson(one))),
  });
}

export function createSystemOneDecisionRequest(input: {
  readonly runId: string;
  readonly actorRef: string;
  readonly purposeRef: string;
  readonly dataClass: SystemOneDataClass;
  readonly mode: SystemOneMode;
  readonly state: DecisionJson;
  readonly questions: Readonly<Record<string, SystemOneDecisionQuestion>>;
  readonly timeoutMs: number;
}): SystemOneDecisionRequest {
  if (
    !REF.test(input.runId) ||
    !REF.test(input.actorRef) ||
    !REF.test(input.purposeRef) ||
    !SYSTEM_ONE_DATA_CLASSES.includes(input.dataClass) ||
    !SYSTEM_ONE_MODES.includes(input.mode) ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 50 ||
    input.timeoutMs > 30_000 ||
    !isDecisionJson(input.state)
  ) {
    throw new TypeError('system-one-decision-request-invalid');
  }
  const serialized = JSON.stringify(input.state);
  if (serialized.length > MAX_STATE_CHARS) {
    throw new TypeError('system-one-decision-request-invalid');
  }
  const entries = Object.entries(input.questions);
  if (entries.length < 1 || entries.length > MAX_QUESTIONS) {
    throw new TypeError('system-one-decision-request-invalid');
  }
  const questions: Record<string, SystemOneDecisionQuestion> = {};
  for (const [key, question] of entries) {
    if (!QUESTION_KEY.test(key)) throw new TypeError('system-one-decision-request-invalid');
    questions[key] = normalizeQuestion(question);
  }
  return Object.freeze({
    protocol: 'qfj.system-one-decision.v1' as const,
    runId: input.runId,
    actorRef: input.actorRef,
    purposeRef: input.purposeRef,
    dataClass: input.dataClass,
    mode: input.mode,
    state: cloneJson(input.state),
    questions: Object.freeze(questions),
    timeoutMs: input.timeoutMs,
  });
}

export const SYSTEM_ONE_ADVISORY_AUTHORITY: SystemOneDecisionAuthority = Object.freeze({
  businessAuthority: false,
  approvalGranted: false,
  executionAuthorized: false,
});
