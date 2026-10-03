import type {
  ChoiceDecisionQuestion,
  DecisionJson,
  ScoreDecisionQuestion,
  SystemOneDecisionAnswer,
  SystemOneDecisionEngine,
  SystemOneDecisionQuestion,
  SystemOneDecisionRequest,
  SystemOneDecisionResult,
} from '@qf-jarvis/system-one-decision-runtime';
import { SYSTEM_ONE_ADVISORY_AUTHORITY } from '@qf-jarvis/system-one-decision-runtime';

export const TYPESAFE_JEV_SYSTEM_ONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_JEV_MAX_RESPONSE_BYTES = 1_000_000;
const MODEL = /^[A-Za-z0-9._:-]{1,128}$/u;
const REDACTED = '[REDACTED_TYPESAFE_API_KEY]';

export class TypeSafeApiKey {
  readonly #value: string;

  public constructor(value: string) {
    this.#value = value;
  }

  public authorizationHeaderValue(): string {
    return `Bearer ${this.#value}`;
  }

  public toString(): string {
    return REDACTED;
  }

  public toJSON(): string {
    return REDACTED;
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

export function createTypeSafeApiKey(value: string): TypeSafeApiKey {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 512) {
    throw new TypeError('typesafe-api-key-invalid');
  }
  return new TypeSafeApiKey(value);
}

export interface TypeSafeJevHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface TypeSafeJevHttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

export interface TypeSafeJevTransport {
  send(request: TypeSafeJevHttpRequest, signal: AbortSignal): Promise<TypeSafeJevHttpResponse>;
}

export function createFetchTypeSafeJevTransport(): TypeSafeJevTransport {
  return Object.freeze({
    async send(
      request: TypeSafeJevHttpRequest,
      signal: AbortSignal,
    ): Promise<TypeSafeJevHttpResponse> {
      if (request.url !== TYPESAFE_JEV_SYSTEM_ONE_ENDPOINT) {
        throw new Error('typesafe-jev-endpoint-refused');
      }
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { ...request.headers },
        body: request.body,
        redirect: 'error',
        signal,
      });
      const raw = await response.text();
      return Object.freeze({
        status: response.status,
        bodyText:
          raw.length > TYPESAFE_JEV_MAX_RESPONSE_BYTES
            ? raw.slice(0, TYPESAFE_JEV_MAX_RESPONSE_BYTES)
            : raw,
      });
    },
  });
}

export interface TypeSafeJevConfig {
  readonly model: string;
  readonly apiKey: TypeSafeApiKey;
  readonly transport: TypeSafeJevTransport;
}

export function createTypeSafeJevConfig(input: TypeSafeJevConfig): TypeSafeJevConfig {
  if (!MODEL.test(input.model) || !(input.apiKey instanceof TypeSafeApiKey)) {
    throw new TypeError('typesafe-jev-config-invalid');
  }
  const transport: unknown = input.transport;
  if (
    typeof transport !== 'object' ||
    transport === null ||
    typeof (transport as { readonly send?: unknown }).send !== 'function'
  ) {
    throw new TypeError('typesafe-jev-config-invalid');
  }
  return Object.freeze({ ...input });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function sameKeys(actual: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(actual);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function validProbabilities(
  value: unknown,
  expected: readonly string[],
): value is Record<string, number> {
  if (!isRecord(value) || !sameKeys(value, expected)) return false;
  const probabilities = Object.values(value);
  if (!probabilities.every(unit)) return false;
  const sum = probabilities.reduce((total, one) => total + one, 0);
  return sum >= 0.98 && sum <= 1.02;
}

function sameJson(left: DecisionJson, right: unknown): boolean {
  if (left === null || typeof left !== 'object') return Object.is(left, right);
  if (Array.isArray(left)) {
    const arrayLeft = left as readonly DecisionJson[];
    return (
      Array.isArray(right) &&
      arrayLeft.length === right.length &&
      arrayLeft.every((one, index) => sameJson(one, right[index]))
    );
  }
  if (!isRecord(right)) return false;
  const objectLeft = left as Readonly<Record<string, DecisionJson>>;
  const keys = Object.keys(objectLeft);
  return (
    sameKeys(right, keys) &&
    keys.every((key) => sameJson(objectLeft[key] as DecisionJson, right[key]))
  );
}

function parseChoiceAnswer(
  value: unknown,
  question: ChoiceDecisionQuestion,
): SystemOneDecisionAnswer | null {
  if (!isRecord(value) || value['type'] !== 'choice') return null;
  const choice = value['choice'];
  const confidence = value['confidence'];
  const probabilities = value['probabilities'];
  const choices = Object.keys(question.criteria);
  if (
    typeof choice !== 'string' ||
    !choices.includes(choice) ||
    !unit(confidence) ||
    !validProbabilities(probabilities, choices)
  ) {
    return null;
  }
  return Object.freeze({
    type: 'choice' as const,
    choice,
    confidence,
    probabilities: Object.freeze({ ...probabilities }),
  });
}

function parseScoreAnswer(
  value: unknown,
  question: ScoreDecisionQuestion,
): SystemOneDecisionAnswer | null {
  if (!isRecord(value) || value['type'] !== 'score') return null;
  const score = value['score'];
  const confidence = value['confidence'];
  const legend = value['legend'];
  const probabilities = value['probabilities'];
  if (!isRecord(legend)) return null;
  const keys = question.criteria.map((_, index) => String(index));
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > question.criteria.length - 1 ||
    !unit(confidence) ||
    !sameKeys(legend, keys) ||
    !keys.every((key, index) => sameJson(question.criteria[index] as DecisionJson, legend[key])) ||
    !validProbabilities(probabilities, keys)
  ) {
    return null;
  }
  return Object.freeze({
    type: 'score' as const,
    score,
    confidence,
    legend: Object.freeze({ ...(legend as Record<string, DecisionJson>) }),
    probabilities: Object.freeze({ ...probabilities }),
  });
}

function parseAnswer(
  value: unknown,
  question: SystemOneDecisionQuestion,
): SystemOneDecisionAnswer | null {
  if (question.type === 'noul') {
    if (!isRecord(value) || value['type'] !== 'noul' || !unit(value['noul'])) return null;
    return Object.freeze({ type: 'noul' as const, noul: value['noul'] });
  }
  return question.type === 'choice'
    ? parseChoiceAnswer(value, question)
    : parseScoreAnswer(value, question);
}

function parseCompleted(
  bodyText: string,
  request: SystemOneDecisionRequest,
): Omit<
  Extract<SystemOneDecisionResult, { status: 'completed' }>,
  'providerId' | 'runId' | 'authority'
> | null {
  let value: unknown;
  try {
    value = JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const model = value['model'];
  const rawAnswers = value['answers'];
  const usage = value['usage'];
  if (
    typeof model !== 'string' ||
    !MODEL.test(model) ||
    !isRecord(rawAnswers) ||
    !isRecord(usage)
  ) {
    return null;
  }
  const inputTokens = usage['input_tokens'];
  const outputTokens = usage['output_tokens'];
  const expected = Object.keys(request.questions);
  if (
    !sameKeys(rawAnswers, expected) ||
    !Number.isInteger(inputTokens) ||
    (inputTokens as number) < 0 ||
    !Number.isInteger(outputTokens) ||
    (outputTokens as number) < 0
  ) {
    return null;
  }
  const answers: Record<string, SystemOneDecisionAnswer> = {};
  for (const key of expected) {
    const question = request.questions[key];
    if (question === undefined) return null;
    const parsed = parseAnswer(rawAnswers[key], question);
    if (parsed === null) return null;
    answers[key] = parsed;
  }
  return Object.freeze({
    status: 'completed' as const,
    model,
    answers: Object.freeze(answers),
    usage: Object.freeze({
      inputTokens: inputTokens as number,
      outputTokens: outputTokens as number,
    }),
  });
}

function signalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function mapHttpFailure(
  status: number,
): Exclude<SystemOneDecisionResult, { readonly status: 'completed' }> {
  if (status === 408) return Object.freeze({ status: 'timeout' as const });
  if (status === 429) return Object.freeze({ status: 'rate-limited' as const });
  if (status >= 500 && status <= 599) {
    return Object.freeze({ status: 'unavailable' as const });
  }
  return Object.freeze({ status: 'failed' as const });
}

export function createTypeSafeJevDecisionEngine(
  rawConfig: TypeSafeJevConfig,
): SystemOneDecisionEngine {
  const config = createTypeSafeJevConfig(rawConfig);
  return Object.freeze({
    descriptor: Object.freeze({
      engineId: 'typesafe.jev.system-one',
      providerId: 'typesafe.jev',
      modelFamily: 'JEV',
    }),
    async evaluate(
      request: SystemOneDecisionRequest,
      signal: AbortSignal,
    ): Promise<SystemOneDecisionResult> {
      if (signalAborted(signal)) return Object.freeze({ status: 'cancelled' as const });
      const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
      const combined = AbortSignal.any([signal, timeoutSignal]);
      let response: TypeSafeJevHttpResponse;
      try {
        response = await config.transport.send(
          {
            url: TYPESAFE_JEV_SYSTEM_ONE_ENDPOINT,
            headers: Object.freeze({
              Authorization: config.apiKey.authorizationHeaderValue(),
              'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
              model: config.model,
              state: request.state,
              questions: request.questions,
            }),
          },
          combined,
        );
      } catch {
        if (signalAborted(signal)) return Object.freeze({ status: 'cancelled' as const });
        if (signalAborted(timeoutSignal)) return Object.freeze({ status: 'timeout' as const });
        return Object.freeze({ status: 'failed' as const });
      }
      if (signalAborted(signal)) return Object.freeze({ status: 'cancelled' as const });
      if (signalAborted(timeoutSignal)) return Object.freeze({ status: 'timeout' as const });
      if (response.status !== 200) {
        return mapHttpFailure(response.status);
      }
      const completed = parseCompleted(response.bodyText, request);
      if (completed === null) return Object.freeze({ status: 'malformed' as const });
      return Object.freeze({
        ...completed,
        runId: request.runId,
        providerId: 'typesafe.jev',
        authority: SYSTEM_ONE_ADVISORY_AUTHORITY,
      });
    },
  });
}
