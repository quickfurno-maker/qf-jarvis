/**
 * The deterministic `FakeModelProvider` (QFJ-P04.01A, ADR-0045).
 *
 * A test double only — it makes NO network call, reads NO environment variable, holds NO secret, and
 * uses NO randomness. Responses are scripted; health, latency (an injected number, never a wall-clock
 * sleep), and failures are configurable; an optional `gate` lets a test hold an invocation in flight to
 * exercise concurrency. It records only bounded metadata (invocation count and the safe run ids it saw)
 * — never message content. It is exported ONLY from the `@qf-jarvis/model-gateway/testing` subpath, so
 * it can never become a production default.
 */
import type { ProviderCapabilities } from '../contracts/capabilities.js';
import type {
  ModelProvider,
  ProviderDescriptor,
  ProviderHealth,
  ProviderInvocationInput,
  ProviderInvocationResult,
} from '../contracts/provider.js';
import type { ModelUsage } from '../contracts/response.js';

/** A completed TEXT result. */
export function completedText(
  text: string,
  options: { latencyMs?: number; usage?: ModelUsage } = {},
): ProviderInvocationResult {
  return {
    status: 'completed',
    output: { mode: 'TEXT', text },
    latencyMs: options.latencyMs ?? 1,
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
}

/** A completed STRUCTURED result carrying an arbitrary value (the gateway validates it). */
export function completedStructured(
  value: unknown,
  options: { latencyMs?: number; usage?: ModelUsage } = {},
): ProviderInvocationResult {
  return {
    status: 'completed',
    output: { mode: 'STRUCTURED', value },
    latencyMs: options.latencyMs ?? 1,
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
}

export function timedOut(latencyMs: number): ProviderInvocationResult {
  return { status: 'timeout', latencyMs };
}
export function providerFailed(): ProviderInvocationResult {
  return { status: 'failed' };
}
export function providerUnavailable(): ProviderInvocationResult {
  return { status: 'unavailable' };
}
export function providerMalformed(latencyMs = 1): ProviderInvocationResult {
  return { status: 'malformed', latencyMs };
}
export function providerCancelled(): ProviderInvocationResult {
  return { status: 'cancelled' };
}

export interface FakeModelProviderConfig {
  readonly capabilities: ProviderCapabilities;
  /** Health; defaults to available. May be a value or a predicate re-evaluated per call. */
  readonly available?: boolean | (() => boolean);
  /** Scripted results consumed in order; the last one repeats once exhausted. Defaults to a TEXT "ok". */
  readonly responses?: readonly ProviderInvocationResult[];
  /** When true, an aborted signal at invocation returns a cancelled result. */
  readonly honorSignal?: boolean;
  /** Optional gate a test can hold to keep an invocation in flight (concurrency tests). */
  readonly gate?: () => Promise<void>;
}

export class FakeModelProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor;
  public invocations = 0;
  public readonly seenRunIds: string[] = [];
  private readonly caps: ProviderCapabilities;
  private readonly availableFn: () => boolean;
  private readonly queue: ProviderInvocationResult[];
  private readonly honorSignal: boolean;
  private readonly gate: (() => Promise<void>) | undefined;

  public constructor(config: FakeModelProviderConfig) {
    this.caps = config.capabilities;
    this.descriptor = Object.freeze({
      providerId: config.capabilities.providerId,
      executionClass: config.capabilities.executionClass,
    });
    const available = config.available ?? true;
    this.availableFn = typeof available === 'function' ? available : (): boolean => available;
    this.queue = [...(config.responses ?? [completedText('ok')])];
    this.honorSignal = config.honorSignal ?? false;
    this.gate = config.gate;
  }

  public capabilities(): ProviderCapabilities {
    return this.caps;
  }

  public health(): Promise<ProviderHealth> {
    return Promise.resolve({ available: this.availableFn() });
  }

  public async invoke(input: ProviderInvocationInput): Promise<ProviderInvocationResult> {
    this.invocations += 1;
    this.seenRunIds.push(input.runId);
    if (this.gate !== undefined) {
      await this.gate();
    }
    if (this.honorSignal && input.signal.aborted) {
      return { status: 'cancelled' };
    }
    const next = this.queue.length > 1 ? this.queue.shift() : this.queue[0];
    return next ?? completedText('ok');
  }
}
