import {
  validateDecisionRequest,
  type DecisionAnswer,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionResult,
} from '@qf-jarvis/decision-intelligence';
import type { TypeSafeApiKey } from './jev-secret.js';
import {
  TYPESAFE_MODELS_ENDPOINT,
  TYPESAFE_SYSTEM_ONE_ENDPOINT,
  type TypeSafeTransport,
} from './jev-transport.js';

const PROVIDER_ID = 'typesafe-jev';
const MODEL_REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface JevDecisionProviderConfig {
  readonly model: string;
  readonly apiKey: TypeSafeApiKey;
  readonly transport: TypeSafeTransport;
}

function mapQuestion(question: DecisionQuestion): unknown {
  if (question.type === 'BOOLEAN') {
    return {
      type: 'noul',
      instructions: question.instructions,
      ...(question.trueCriteria === undefined && question.falseCriteria === undefined
        ? {}
        : {
            criteria: {
              ...(question.trueCriteria === undefined ? {} : { true: question.trueCriteria }),
              ...(question.falseCriteria === undefined ? {} : { false: question.falseCriteria }),
            },
          }),
    };
  }
  if (question.type === 'CHOICE') {
    return { type: 'choice', instructions: question.instructions, criteria: question.criteria };
  }
  return { type: 'score', instructions: question.instructions, criteria: question.criteria };
}

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilityMap(value: unknown): Readonly<Record<string, number>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const output: Record<string, number> = {};
  for (const [key, probability] of Object.entries(value)) {
    if (!MODEL_REF.test(key) || !unit(probability)) return undefined;
    output[key] = probability;
  }
  return Object.freeze(output);
}

function mapAnswer(value: unknown): DecisionAnswer | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw['type'] === 'noul' && unit(raw['noul'])) {
    return Object.freeze({ type: 'BOOLEAN' as const, probability: raw['noul'] });
  }
  if (
    raw['type'] === 'choice' &&
    typeof raw['choice'] === 'string' &&
    MODEL_REF.test(raw['choice']) &&
    unit(raw['confidence'])
  ) {
    const probabilities = probabilityMap(raw['probabilities']);
    if (probabilities === undefined) return undefined;
    return Object.freeze({
      type: 'CHOICE' as const,
      choice: raw['choice'],
      confidence: raw['confidence'],
      probabilities,
    });
  }
  if (
    raw['type'] === 'score' &&
    typeof raw['score'] === 'number' &&
    Number.isFinite(raw['score']) &&
    unit(raw['confidence'])
  ) {
    const probabilities = probabilityMap(raw['probabilities']);
    if (probabilities === undefined) return undefined;
    return Object.freeze({
      type: 'SCORE' as const,
      score: raw['score'],
      confidence: raw['confidence'],
      probabilities,
    });
  }
  return undefined;
}

function parseResult(input: unknown): Omit<DecisionResult, 'providerId'> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw['model'] !== 'string' || !MODEL_REF.test(raw['model'])) return undefined;
  if (
    typeof raw['answers'] !== 'object' ||
    raw['answers'] === null ||
    Array.isArray(raw['answers'])
  )
    return undefined;
  const usage = raw['usage'];
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined;
  const usageRaw = usage as Record<string, unknown>;
  if (!Number.isInteger(usageRaw['input_tokens']) || !Number.isInteger(usageRaw['output_tokens']))
    return undefined;
  const answers: Record<string, DecisionAnswer> = {};
  for (const [name, answer] of Object.entries(raw['answers'])) {
    if (!MODEL_REF.test(name)) return undefined;
    const mapped = mapAnswer(answer);
    if (mapped === undefined) return undefined;
    answers[name] = mapped;
  }
  if (Object.keys(answers).length < 1) return undefined;
  return Object.freeze({
    model: raw['model'],
    answers: Object.freeze(answers),
    usage: Object.freeze({
      inputTokens: usageRaw['input_tokens'] as number,
      outputTokens: usageRaw['output_tokens'] as number,
    }),
  });
}

export class JevDecisionProvider implements DecisionProvider {
  public readonly providerId = PROVIDER_ID;
  readonly #config: JevDecisionProviderConfig;

  public constructor(config: JevDecisionProviderConfig) {
    if (!MODEL_REF.test(config.model)) throw new TypeError('jev-model-invalid');
    this.#config = config;
  }

  public async decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResult> {
    validateDecisionRequest(request);
    if (request.dataClass !== 'HOSTED_ALLOWED') throw new Error('jev-data-class-refused');
    if (signal.aborted) throw new Error('jev-request-cancelled');
    const questions = Object.fromEntries(
      Object.entries(request.questions).map(([name, question]) => [name, mapQuestion(question)]),
    );
    const response = await this.#config.transport.send(
      {
        url: TYPESAFE_SYSTEM_ONE_ENDPOINT,
        headers: {
          'content-type': 'application/json',
          authorization: this.#config.apiKey.authorizationHeaderValue(),
        },
        body: JSON.stringify({ state: request.state, model: this.#config.model, questions }),
      },
      signal,
    );
    if (response.status !== 200) throw new Error('jev-provider-unavailable');
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      throw new Error('jev-response-malformed');
    }
    const result = parseResult(parsed);
    if (result === undefined) throw new Error('jev-response-malformed');
    return Object.freeze({ providerId: this.providerId, ...result });
  }

  public async listModels(signal: AbortSignal): Promise<readonly string[]> {
    if (signal.aborted) throw new Error('jev-request-cancelled');
    const response = await this.#config.transport.send(
      {
        url: TYPESAFE_MODELS_ENDPOINT,
        headers: { authorization: this.#config.apiKey.authorizationHeaderValue() },
      },
      signal,
    );
    if (response.status !== 200) throw new Error('jev-provider-unavailable');
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      throw new Error('jev-response-malformed');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('jev-response-malformed');
    const models = (parsed as Record<string, unknown>)['models'];
    if (!Array.isArray(models)) throw new Error('jev-response-malformed');
    const names = models.map((one) => {
      if (typeof one !== 'object' || one === null || Array.isArray(one))
        throw new Error('jev-response-malformed');
      const name = (one as Record<string, unknown>)['name'];
      if (typeof name !== 'string' || !MODEL_REF.test(name))
        throw new Error('jev-response-malformed');
      return name;
    });
    return Object.freeze(names);
  }
}
