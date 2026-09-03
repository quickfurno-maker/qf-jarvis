/**
 * Deterministic fake adapters (AS2, ADR-0143 §41, §68).
 *
 * ### AS2 ships no provider network code, and that is the design
 *
 * The harness is finished when a scenario can become an accepted candidate through the port. Proving
 * that needs a deterministic implementation of the port, not a paid call: a real invocation makes CI
 * depend on a credential, a network and someone's budget, and gives a *less* reliable signal because
 * the answer changes every run. AS3 activates configured real adapters; AS2 proves the machinery.
 *
 * These fakes are production source of this package rather than test helpers, deliberately — they are
 * the reference implementation of the port, and the thing a real adapter is written against.
 *
 * ### No clock, no randomness
 *
 * Output is a function of the request refs and the turn index. Two runs produce identical bytes, so a
 * scheduler or orchestration change shows up as a diff rather than as noise. Delay, where a spec
 * wants to exercise a timeout, is a `setTimeout` raced against the caller's budget — never a measured
 * elapsed time, because reading a clock would make the artifacts machine-dependent.
 */
import {
  createRiyaSyntheticInvocationResult,
  type RiyaSyntheticInvocationRequestV1,
} from '../contracts/invocation.js';
import type {
  RiyaSyntheticInvocationOptions,
  RiyaSyntheticInvocationOutcome,
  RiyaSyntheticModelInvoker,
} from '../ports/model-invoker.js';
import type {
  RiyaSyntheticCriticInput,
  RiyaSyntheticCustomerSimulatorInput,
  RiyaSyntheticTeacherInput,
} from '../contracts/role-input.js';
import { sha256Hex } from '../internal/digest.js';

export interface RiyaSyntheticFakeInvokerOptions {
  /** Appears in generated text, so two families never produce identical conversations. */
  readonly familyLabel: string;
  /** Return unparseable bytes on attempt 1 only — the one case a structural repair may fix. */
  readonly malformedFirstAttempt?: boolean;
  /** Return unparseable bytes on every attempt, so repair provably runs out. */
  readonly alwaysMalformed?: boolean;
  /** Return a well-formed object of the WRONG shape. Not repairable, by design. */
  readonly schemaMismatch?: boolean;
  /** Fail transiently this many times before succeeding. */
  readonly transientFailures?: number;
  readonly permanentFailure?: boolean;
  /** Never settle before the caller's budget, so a timeout can be exercised honestly. */
  readonly hangs?: boolean;
  /**
   * Succeed, but slowly.
   *
   * Distinct from `hangs`: each call completes well inside its OWN budget, so only the
   * whole-conversation budget can catch a run that is accumulating too much delay across
   * turns. That is the failure the candidate race exists for.
   */
  readonly delayMs?: number;
  /** What this critic decides. Defaults to accepting. */
  readonly criticDecision?: 'ACCEPTED' | 'REJECTED';
  readonly criticSatisfies?: readonly string[];
  readonly criticFails?: readonly string[];
  /** Let the annotation verifier reject, to exercise that boundary. */
  readonly verifierRejects?: boolean;
  /**
   * Cite a governed authority fact when one has been supplied.
   *
   * Uses the VALUE, not just the ref -- which is the whole point of the authority channel: a teacher
   * given only an identifier can label a citation but cannot ground an answer.
   */
  readonly citeAuthority?: boolean;
}

const encode = (value: unknown): string => JSON.stringify(value);

/** A short deterministic token, so two families and two turns never collide. */
const flavour = (familyLabel: string, requestRef: string): string =>
  sha256Hex(`${familyLabel}:${requestRef}`).slice(0, 8);

/**
 * Build a deterministic invoker.
 *
 * Transient-failure counting is per-`generationRef`, held in a closure. It is state, but it is the
 * state a real provider would impose on the caller anyway, and keeping it here means the orchestrator
 * has no idea whether a failure was contrived.
 */
export function createRiyaSyntheticFakeInvoker(
  options: RiyaSyntheticFakeInvokerOptions,
): RiyaSyntheticModelInvoker {
  const transientSeen = new Map<string, number>();

  return {
    async invoke(
      request: RiyaSyntheticInvocationRequestV1,
      structuredInput: unknown,
      invocationOptions: RiyaSyntheticInvocationOptions,
    ): Promise<RiyaSyntheticInvocationOutcome> {
      const failed = (
        status: 'MALFORMED' | 'PROVIDER_ERROR' | 'TIMEOUT' | 'CANCELLED',
        errorClass: 'TRANSIENT' | 'PERMANENT' | 'TIMEOUT' | 'CANCELLED' | 'MALFORMED_OUTPUT',
      ): RiyaSyntheticInvocationOutcome => ({
        result: createRiyaSyntheticInvocationResult({
          requestRef: request.requestRef,
          configRef: request.configRef,
          role: request.role,
          status,
          errorClass,
        }),
      });

      if (invocationOptions.signal?.aborted === true) {
        return failed('CANCELLED', 'CANCELLED');
      }

      if (options.hangs === true) {
        // Settle only when the caller gives up or aborts. Racing rather than sleeping keeps this
        // free of any elapsed-time measurement.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, invocationOptions.timeoutMs * 4);
          invocationOptions.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return failed('TIMEOUT', 'TIMEOUT');
      }

      const delayMs = options.delayMs ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          invocationOptions.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }

      if (options.permanentFailure === true) {
        return failed('PROVIDER_ERROR', 'PERMANENT');
      }

      const budget = options.transientFailures ?? 0;
      if (budget > 0) {
        const seen = transientSeen.get(request.generationRef) ?? 0;
        if (seen < budget) {
          transientSeen.set(request.generationRef, seen + 1);
          return failed('PROVIDER_ERROR', 'TRANSIENT');
        }
      }

      const malformed =
        options.alwaysMalformed === true ||
        (options.malformedFirstAttempt === true && request.attempt === 1);
      if (malformed) {
        // Bytes that are not JSON at all: the repairable class.
        const payload = `{"userText": "unterminated`;
        return {
          result: createRiyaSyntheticInvocationResult({
            requestRef: request.requestRef,
            configRef: request.configRef,
            role: request.role,
            status: 'SUCCESS',
            outputDigest: sha256Hex(payload),
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
          }),
          payload,
        };
      }

      const payload =
        options.schemaMismatch === true
          ? encode({ somethingElseEntirely: true })
          : renderPayload(request.role, structuredInput, options);

      return {
        result: createRiyaSyntheticInvocationResult({
          requestRef: request.requestRef,
          configRef: request.configRef,
          role: request.role,
          status: 'SUCCESS',
          outputDigest: sha256Hex(payload),
          usage: { inputTokens: 40, outputTokens: 30, cachedInputTokens: 0 },
        }),
        payload,
      };
    },
  };
}

function renderPayload(
  role: RiyaSyntheticInvocationRequestV1['role'],
  structuredInput: unknown,
  options: RiyaSyntheticFakeInvokerOptions,
): string {
  const label = options.familyLabel;

  if (role === 'CUSTOMER_SIMULATOR') {
    const input = structuredInput as RiyaSyntheticCustomerSimulatorInput;
    const tag = flavour(label, `u${String(input.turnIndex)}`);
    return encode({
      userText: `${label} customer ${tag} explains a little more about the project at step ${String(input.turnIndex)}.`,
      revealedFields: input.scenario.plannedDiscoveryFields.slice(0, 1),
      behaviorEvents: [...input.scenario.customerBehaviorCodes].slice(0, 1),
      endsConversation: input.mayConclude,
    });
  }

  if (role === 'RIYA_TEACHER') {
    const input = structuredInput as RiyaSyntheticTeacherInput;
    const tag = flavour(label, `a${String(input.turnIndex)}`);

    const authority = input.availableAuthorityFacts[0];
    if (options.citeAuthority === true && authority !== undefined) {
      return encode({
        assistantText: `${label} assistant ${tag} shares what the governed record says: ${authority.value}.`,
        annotation: {
          decision: 'USE_GOVERNED_KNOWLEDGE',
          responseObjective: 'ANSWER',
          askedDiscoveryFields: [],
          // Cited by ref, grounded by value. AS1 proves the fact existed EARLIER.
          supportedFactRefs: [authority.factRef],
          expectedPhaseAfter: 'PROJECT_DETAILS',
        },
      });
    }

    const asks = input.turnIndex % 2 === 0;
    const field =
      input.scenario.plannedDiscoveryFields[
        input.turnIndex % Math.max(1, input.scenario.plannedDiscoveryFields.length)
      ];
    return encode({
      assistantText: `${label} assistant ${tag} answers and moves the conversation forward at step ${String(input.turnIndex)}.`,
      annotation: {
        decision: asks ? 'ASK_DISCOVERY' : 'ANSWER_DIRECT',
        responseObjective: asks ? 'DISCOVER' : 'ADVANCE_NEXT_STEP',
        askedDiscoveryFields: asks && field !== undefined ? [field] : [],
        // The fake never cites a fact it was not told about, which is what a real teacher must also
        // do -- the AS1 validator refuses a citation that has no earlier authoritative context.
        supportedFactRefs: [],
        expectedPhaseAfter: asks ? 'PROJECT_DETAILS' : 'SUMMARY',
      },
    });
  }

  if (role === 'ANNOTATION_VERIFIER') {
    return options.verifierRejects === true
      ? encode({ decision: 'REJECTED', failedChecks: ['ASKED_FIELD_MISMATCH'] })
      : encode({ decision: 'VERIFIED', failedChecks: [] });
  }

  if (role === 'CRITIC') {
    const input = structuredInput as RiyaSyntheticCriticInput;
    const decision = options.criticDecision ?? 'ACCEPTED';
    return decision === 'ACCEPTED'
      ? encode({
          decision: 'ACCEPTED',
          satisfiedQualityDimensions: options.criticSatisfies ?? input.requestedQualityDimensions,
          failedQualityDimensions: [],
        })
      : encode({
          decision: 'REJECTED',
          satisfiedQualityDimensions: [],
          failedQualityDimensions: options.criticFails ?? ['NATURALNESS'],
        });
  }

  // SCENARIO_PLANNER. The scheduler is deterministic, so nothing asks a model to pick enum members;
  // the branch exists so the port stays total rather than throwing on a legal role.
  return encode({ decision: 'VERIFIED', failedChecks: [] });
}

/** A fake standing in for a GPT-family configuration. */
export function createFakeGptInvoker(
  options: Omit<RiyaSyntheticFakeInvokerOptions, 'familyLabel'> = {},
): RiyaSyntheticModelInvoker {
  return createRiyaSyntheticFakeInvoker({ ...options, familyLabel: 'gpt' });
}

/** A fake standing in for a Claude-family configuration. */
export function createFakeClaudeInvoker(
  options: Omit<RiyaSyntheticFakeInvokerOptions, 'familyLabel'> = {},
): RiyaSyntheticModelInvoker {
  return createRiyaSyntheticFakeInvoker({ ...options, familyLabel: 'claude' });
}
