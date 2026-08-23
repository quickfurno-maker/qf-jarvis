/**
 * The DIAGNOSTIC-ONLY best-effort `json_schema` adapter (POST-RBD1).
 *
 * ### The question, and why the normal non-strict path cannot answer it
 *
 * RLD1 sent the neutral production request at `reasoning_effort='low'` and 4,096 with
 * `json_schema.strict: true` and met `json_validate_failed`. RBD1 sent it at 8,192 and met the same.
 * The open axis is now the STRICT DECODING POSTURE itself.
 *
 * Production's {@link buildResponseFormat} cannot express that question. Its non-strict branch
 * returns `{ type: 'json_object' }`, which changes FOUR things at once — the response-format type,
 * the schema name, the strict flag, and the schema body, which disappears entirely. Sending that
 * would answer "what happens with no schema at all", which is a different experiment and a much
 * weaker one.
 *
 * What Groq documents, and what this adapter sends, is best-effort JSON Schema:
 * `{ type: 'json_schema', json_schema: { name, strict: false, schema } }` — same mode, same name,
 * same schema, constrained decoding off.
 *
 * ### The candidate body is DERIVED from the baseline body
 *
 * `buildGroqChatBestEffortDiagnosticBody` calls {@link buildGroqChatReasoningDiagnosticBody} — the
 * merged builder RLD1 and RBD1 both used — and flips exactly one leaf.
 *
 * That is the whole design. The model, the messages, `stream`, `n`, `max_completion_tokens`,
 * `reasoning_effort`, `response_format.type`, `json_schema.name` and `json_schema.schema` are not
 * rebuilt here and cannot be chosen here; they are whatever the baseline builder produced, including
 * the projection the strict path applies to the schema. So "identical to RBD1's request except
 * `response_format.json_schema.strict`" is a property of the construction, and the recorded-wire
 * recursive diff confirms it rather than carrying it.
 *
 * ### It fails closed when there is no strict baseline to flip
 *
 * If the configuration is not strict-capable, the baseline builder returns `json_object` and there is
 * no `json_schema` object to derive from. This refuses rather than falling back, because a run that
 * quietly sent `json_object` would report a strict-posture verdict for a request that carried no
 * schema — the exact confusion the adapter exists to avoid.
 *
 * ### It is not a production capability
 *
 * `buildResponseFormat` is untouched and its non-strict branch still returns `json_object`.
 * `GroqModelProvider` is untouched. Nothing here registers a provider, declares a capability, joins a
 * routing table, or gives production a way to ask for `strict: false` with a schema. There is no
 * automatic best-effort fallback and no retry-on-strict-failure: a strict refusal stays a refusal.
 */
import type { ProviderInvocationResult } from '../../contracts/provider.js';
import type { GatewayClock } from '../../reliability/clock.js';
import { executeGroqChatDiagnosticExchange } from './groq-chat-diagnostic-exchange.js';
import { buildGroqChatReasoningDiagnosticBody } from './groq-chat-reasoning-diagnostic.js';
import type { GroqChatReasoningDiagnosticInput } from './groq-chat-reasoning-diagnostic.js';
import type { GroqProviderConfig } from './groq-config.js';
import type { GroqChatRequestBody } from './groq-contracts.js';

/**
 * The strict posture this adapter sends. A constant rather than a parameter, on purpose: a
 * configurable one would be a switch, and a switch is what must not exist.
 */
export const GROQ_BEST_EFFORT_JSON_SCHEMA_STRICT = false;

/** The baseline body plus the one flipped leaf. Same shape as the reasoning diagnostic body. */
export interface GroqChatBestEffortDiagnosticRequestBody extends GroqChatRequestBody {
  readonly reasoning_effort: GroqChatReasoningDiagnosticInput['reasoningEffort'];
  readonly response_format: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: string;
      readonly strict: false;
      readonly schema: unknown;
    };
  };
}

/** What one best-effort invocation asks for. Identical to the reasoning diagnostic's input. */
export type GroqChatBestEffortDiagnosticInput = GroqChatReasoningDiagnosticInput;

export interface GroqChatBestEffortDiagnosticProvider {
  invoke(input: GroqChatBestEffortDiagnosticInput): Promise<ProviderInvocationResult>;
}

/**
 * Build the best-effort body by DERIVING it from the strict baseline body.
 *
 * Exported so a spec can diff the two bodies without a network. Returns `undefined` when the baseline
 * refuses, and also when the baseline did not produce a `json_schema` format — there is nothing to
 * flip, and inventing one would send a schema the strict path never validated.
 */
export function buildGroqChatBestEffortDiagnosticBody(
  config: GroqProviderConfig,
  input: GroqChatBestEffortDiagnosticInput,
): GroqChatBestEffortDiagnosticRequestBody | undefined {
  const baseline = buildGroqChatReasoningDiagnosticBody(config, input);
  if (baseline === undefined) {
    // An invalid strict schema fails BEFORE any transport call, exactly as the baseline does.
    return undefined;
  }
  const responseFormat = baseline.response_format;
  if (responseFormat?.type !== 'json_schema') {
    // No strict baseline to flip. Falling back to `json_object` here would drop the schema and turn
    // a strict-posture experiment into a no-schema one.
    return undefined;
  }
  return {
    ...baseline,
    response_format: {
      type: 'json_schema',
      json_schema: {
        // The SAME name and the SAME projected schema the strict baseline built. Neither is
        // recomputed, so neither can differ.
        name: responseFormat.json_schema.name,
        strict: GROQ_BEST_EFFORT_JSON_SCHEMA_STRICT,
        schema: responseFormat.json_schema.schema,
      },
    },
  };
}

/**
 * Build the best-effort diagnostic adapter over an ALREADY-VALIDATED Groq config.
 *
 * Takes the same `GroqProviderConfig` production takes, performs exactly one HTTP request per invoke
 * through the SHARED exchange, never retries and never sleeps, and returns the gateway's own
 * provider-neutral result including `usage` when the provider reported it.
 */
export function createGroqChatBestEffortDiagnosticProvider(
  config: GroqProviderConfig,
  clock: GatewayClock,
): GroqChatBestEffortDiagnosticProvider {
  return Object.freeze({
    async invoke(input: GroqChatBestEffortDiagnosticInput): Promise<ProviderInvocationResult> {
      // CANCELLATION OUTRANKS EVERYTHING, checked BEFORE the body is built -- the same precedence
      // the reasoning adapter has always had, and for the same reason. The body builder here refuses
      // in two ways (an invalid strict schema, or a strict-incapable config), and neither may
      // overwrite the fact that the caller had already cancelled.
      if (input.signal.aborted) {
        return { status: 'cancelled' };
      }
      const body = buildGroqChatBestEffortDiagnosticBody(config, input);
      if (body === undefined) {
        return { status: 'failed', retryable: false };
      }
      // The SHARED exchange, so this adapter cannot classify a response differently from the
      // reasoning adapter it is being compared against.
      return executeGroqChatDiagnosticExchange(config, clock, body, input.signal);
    },
  });
}
