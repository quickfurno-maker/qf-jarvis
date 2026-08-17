/**
 * MVP-P2A.2 HF4-R8 — the Groq HTTP-400 differential canary harness.
 *
 * ### What two live authorizations bought, and what they did not
 *
 * S9 and S10 each ran the bounded safety replication. Both times the text smoke PASSED, the clipboard
 * ingress worked, the timer order held, every wire milestone was present, the one governed
 * cancellation cancelled — and all NINE ordinary MODEL_REQUIRED requests came back HTTP 400 /
 * `invalid_request_error`, zero usable responses, `executionHealth=INVALID`.
 *
 * Between them, HF4-R7/R1 removed every provider-facing schema keyword Groq's strict documentation
 * does not establish and closed a `$ref`/`$defs` projection bypass. S10 reproduced S9 exactly anyway.
 * So the remaining cause is not another unproven keyword, and a third guess would cost a third
 * authorization to learn nothing.
 *
 * These specs pin a harness that varies ONE axis at a time, and a pure classifier that reads the
 * result. Everything here is offline: no provider, no credential, no clipboard, no network.
 */
import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_CANARY_REQUESTS,
  MAX_PROVIDER_REQUESTS,
  REQUEST_CONTRACT_DIAGNOSTIC_MAX_ESTIMATED_COST_USD,
  REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS,
  SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS,
} from '../accounting.js';
import { CANDIDATE_MAX_COMPLETION_TOKENS } from '../candidate-release.js';
import {
  CANARY_ANYOF_NULLABLE_SCHEMA,
  CANARY_CAP_PAIRS,
  CANARY_HIGH_COMPLETION_CAP,
  CANARY_LOW_COMPLETION_CAP,
  CANARY_MINIMAL_SCHEMA,
  CANARY_NUMERIC_ENUM_SCHEMA,
  CANARY_REQUEST_CLASSES,
  canaryById,
  DIAGNOSTIC_CANARIES,
  DIAGNOSTIC_CANARY_IDS,
} from '../diagnostic-canaries.js';
import type { DiagnosticCanaryId } from '../diagnostic-canaries.js';
import {
  createDiagnosticCanaryPort,
  SYNTHETIC_CANARY_MESSAGES,
} from '../diagnostic-canary-port.js';
import { OPERATOR_EXIT_CODES } from '../exit-codes.js';
import {
  classifyDiagnosticCanaries,
  DIAGNOSTIC_CLASSIFICATIONS,
} from '../internal/diagnostic-classification.js';
import type { CanaryOutcome } from '../internal/diagnostic-classification.js';
import { OPERATOR_RUN_GOALS } from '../internal/run-goal.js';
import { createCandidateTransportObservations } from '../candidate-transport-observation.js';

/** A canary outcome fixture. `ok` means the PROVIDER accepted the request; local semantics are not consulted. */
function outcome(canaryId: DiagnosticCanaryId, ok: boolean): CanaryOutcome {
  return ok
    ? {
        canaryId,
        providerTransportStarted: true,
        providerHttpStatus: 200,
        providerHttpClass: 'SUCCESS_2XX',
        providerErrorType: 'NONE',
        providerErrorCode: 'NONE',
        providerCompleted: true,
      }
    : {
        canaryId,
        providerTransportStarted: true,
        providerHttpStatus: 400,
        providerHttpClass: 'BAD_REQUEST_400',
        providerErrorType: 'INVALID_REQUEST_ERROR',
        providerErrorCode: 'OTHER_OR_ABSENT',
        providerCompleted: false,
      };
}

/** Build a full matrix from the ids that FAILED; everything else is accepted. */
function matrix(...rejected: readonly DiagnosticCanaryId[]): readonly CanaryOutcome[] {
  return DIAGNOSTIC_CANARY_IDS.map((id) => outcome(id, !rejected.includes(id)));
}

describe('R8-C3/C4/C5 — the diagnostic goal is explicit and the narrowest', () => {
  it('R8-C3 the goal exists, is closed, and is not the default', () => {
    expect([...OPERATOR_RUN_GOALS]).toContain('REQUEST_CONTRACT_DIAGNOSTIC');
    // Absence still means FULL_EVIDENCE, so no existing command line can reach the diagnostic.
    expect(OPERATOR_RUN_GOALS[0]).toBe('FULL_EVIDENCE');
    // Its own exit code: a run that evaluated nothing must not share an integer with one that did.
    expect(OPERATOR_EXIT_CODES.REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE).toBe(23);
    expect(OPERATOR_EXIT_CODES.REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE).not.toBe(0);
    expect(OPERATOR_EXIT_CODES.REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE).not.toBe(
      OPERATOR_EXIT_CODES.SAFETY_REPLICATION_COMPLETE,
    );
  });

  it('R8-C4 the diagnostic ceiling is exactly nine, including the smoke', () => {
    expect(DIAGNOSTIC_CANARY_REQUESTS).toBe(8);
    expect(REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS).toBe(9);
    expect(DIAGNOSTIC_CANARIES).toHaveLength(DIAGNOSTIC_CANARY_REQUESTS);
    expect(REQUEST_CONTRACT_DIAGNOSTIC_MAX_ESTIMATED_COST_USD).toBe(1);
    // Deliberately BELOW the run it exists to explain, and far below the full run.
    expect(REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS).toBeLessThan(
      SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS,
    );
    expect(REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS).toBeLessThan(MAX_PROVIDER_REQUESTS);
  });

  it('R8-C1/C2/C5 the existing goals and their ceilings are untouched', () => {
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBe(11);
    expect(MAX_PROVIDER_REQUESTS).toBe(83);
  });
});

describe('R8-C6..C13 — the matrix varies exactly one axis at a time', () => {
  it('R8-C6 D1 is the smallest documented strict schema', () => {
    const d1 = canaryById('D1');
    expect(d1.requestClass).toBe('STRICT_MINIMAL');
    expect(d1.schemaSource).toBe('SYNTHETIC_MINIMAL');
    expect(d1.messageSource).toBe('SYNTHETIC_TINY');
    expect(d1.maxCompletionTokens).toBe(CANARY_LOW_COMPLETION_CAP);
    expect(CANARY_MINIMAL_SCHEMA).toEqual({
      type: 'object',
      properties: { ok: { type: 'string', enum: ['OK'] } },
      required: ['ok'],
      additionalProperties: false,
    });
  });

  it('R8-C7/C11/C13 each pair differs ONLY by the completion cap', () => {
    // The entire evidentiary value of a pair is that one field moved. Asserted, not reviewed.
    for (const [lowId, highId] of CANARY_CAP_PAIRS) {
      const low = canaryById(lowId);
      const high = canaryById(highId);
      expect(low.completionCapClass).toBe('LOW_512');
      expect(high.completionCapClass).toBe('HIGH_65536');
      expect(low.maxCompletionTokens).toBe(512);
      expect(high.maxCompletionTokens).toBe(65_536);
      expect(low.requestClass).toBe(high.requestClass);
      expect(low.schemaSource).toBe(high.schemaSource);
      expect(low.messageSource).toBe(high.messageSource);
    }
    expect([...CANARY_CAP_PAIRS]).toEqual([
      ['D1', 'D2'],
      ['D5', 'D6'],
      ['D7', 'D8'],
    ]);
  });

  it('the HIGH cap is the exact value production puts on the wire today', () => {
    // Derived, not restated: a second literal could drift away from the release constant, and then
    // the pair would stop measuring the production request.
    expect(CANARY_HIGH_COMPLETION_CAP).toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
    expect(CANARY_HIGH_COMPLETION_CAP).toBe(65_536);
  });

  it('R8-C8 D3 carries the documented anyOf/nullable form', () => {
    expect(canaryById('D3').requestClass).toBe('STRICT_ANYOF_NULLABLE');
    const note = (CANARY_ANYOF_NULLABLE_SCHEMA['properties'] as Record<string, unknown>)['note'];
    expect(note).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    // The optional value is still REQUIRED, which is the strict-mode rule the form exists to satisfy.
    expect(CANARY_ANYOF_NULLABLE_SCHEMA['required']).toEqual(['ok', 'note']);
    expect(CANARY_ANYOF_NULLABLE_SCHEMA['additionalProperties']).toBe(false);
  });

  it('R8-C9 D4 carries a NUMERIC singleton enum', () => {
    expect(canaryById('D4').requestClass).toBe('STRICT_NUMERIC_ENUM');
    const version = (CANARY_NUMERIC_ENUM_SCHEMA['properties'] as Record<string, unknown>)[
      'version'
    ] as Record<string, unknown>;
    expect(version['enum']).toEqual([1]);
    expect(version['type']).toBe('integer');
  });

  it('R8-C10/C12 D5-D8 use the REAL Riya schema, and D7/D8 the real request builder', () => {
    for (const id of ['D5', 'D6', 'D7', 'D8'] as const) {
      expect(canaryById(id).schemaSource).toBe('REAL_RIYA_STRUCTURED');
    }
    // D5/D6 hold the message shape constant and vary the schema; D7/D8 vary the message shape.
    expect(canaryById('D5').messageSource).toBe('SYNTHETIC_TINY');
    expect(canaryById('D6').messageSource).toBe('SYNTHETIC_TINY');
    expect(canaryById('D7').messageSource).toBe('REAL_RIYA_REQUEST_BUILDER');
    expect(canaryById('D8').messageSource).toBe('REAL_RIYA_REQUEST_BUILDER');
    expect(canaryById('D7').requestClass).toBe('EXACT_REPRESENTATIVE_RIYA');
  });

  it('the request-class axis is a closed, ordered escalation', () => {
    expect([...CANARY_REQUEST_CLASSES]).toEqual([
      'STRICT_MINIMAL',
      'STRICT_ANYOF_NULLABLE',
      'STRICT_NUMERIC_ENUM',
      'STRICT_REAL_RIYA_SCHEMA',
      'EXACT_REPRESENTATIVE_RIYA',
    ]);
    expect(DIAGNOSTIC_CANARIES.map((one) => one.canaryId)).toEqual([...DIAGNOSTIC_CANARY_IDS]);
  });
});

describe('R8-C14/C15/C23 — canaries carry no content and report only closed tokens', () => {
  it('R8-C14 every synthetic message is content-free', () => {
    const text = SYNTHETIC_CANARY_MESSAGES.map((one) => one.content).join(' ');
    // No client, vendor, project, person or business term. It asks for the smallest valid object.
    expect(text).not.toMatch(/client|vendor|customer|project|budget|quote|invoice|phone|email/iu);
    expect(SYNTHETIC_CANARY_MESSAGES.map((one) => one.role)).toEqual(['system', 'user']);
  });

  it('R8-C15/C23 a canary contract names sources and classes, never content', () => {
    for (const canary of DIAGNOSTIC_CANARIES) {
      const serialized = JSON.stringify(canary);
      expect(serialized).not.toContain('sk-');
      expect(serialized).not.toMatch(/Bearer|Authorization/u);
      // The contract carries a purpose sentence and closed tokens; it holds no schema document.
      expect(serialized).not.toContain('additionalProperties');
    }
  });

  it('R8-C28 a canary OUTCOME has no field a provider body could occupy', () => {
    const keys = Object.keys(outcome('D1', false)).sort();
    expect(keys).toEqual([
      'canaryId',
      'providerCompleted',
      'providerErrorCode',
      'providerErrorType',
      'providerHttpClass',
      'providerHttpStatus',
      'providerTransportStarted',
    ]);
  });
});

describe('R8-C24/C25/C29 — the differential classifier', () => {
  it('R8-C29 an empty or partial matrix is DIAGNOSTIC_NOT_RUN', () => {
    // S9 and S10 ran NO canaries. Retrofitting a dimension onto them would be inventing evidence.
    expect(classifyDiagnosticCanaries([])).toBe('DIAGNOSTIC_NOT_RUN');
    expect(classifyDiagnosticCanaries([outcome('D1', true)])).toBe('DIAGNOSTIC_NOT_RUN');
    expect(classifyDiagnosticCanaries(matrix('D1').slice(0, 7))).toBe('DIAGNOSTIC_NOT_RUN');
  });

  it('R8-C24 each documented pattern returns its own class', () => {
    expect(classifyDiagnosticCanaries(matrix())).toBe('CURRENT_EXACT_REQUEST_ACCEPTED');
    // D1 rejected: the floor. Every later canary fails for a reason that is not what it varied.
    expect(classifyDiagnosticCanaries(matrix('D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'))).toBe(
      'MINIMAL_STRICT_REJECTED',
    );
    expect(classifyDiagnosticCanaries(matrix('D2'))).toBe('HIGH_COMPLETION_CAP_SENSITIVE');
    expect(classifyDiagnosticCanaries(matrix('D8'))).toBe('HIGH_COMPLETION_CAP_SENSITIVE');
    expect(classifyDiagnosticCanaries(matrix('D3'))).toBe('ANYOF_NULLABLE_REJECTED');
    expect(classifyDiagnosticCanaries(matrix('D4'))).toBe('NUMERIC_ENUM_REJECTED');
    expect(classifyDiagnosticCanaries(matrix('D5'))).toBe('REAL_RIYA_SCHEMA_REJECTED');
    expect(classifyDiagnosticCanaries(matrix('D7'))).toBe('EXACT_RIYA_MESSAGE_SHAPE_REJECTED');
  });

  it('M22 — D1 rejected is NEVER attributed to the Riya schema', () => {
    // The exact over-claim to prevent: everything downstream of a rejected D1 is also rejected, and
    // reading that as "the Riya schema failed" would send the next phase after the wrong thing.
    for (const also of [[], ['D5'], ['D5', 'D7'], ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']]) {
      const result = classifyDiagnosticCanaries(
        matrix('D1', ...(also as readonly DiagnosticCanaryId[])),
      );
      expect(result).not.toBe('REAL_RIYA_SCHEMA_REJECTED');
      expect(result).not.toBe('EXACT_RIYA_MESSAGE_SHAPE_REJECTED');
    }
  });

  it('M23 — a cap-sensitive matrix stays cap-sensitive even when everything behind it fails', () => {
    // Behind a cap that already fails, a later shape failing says nothing about the shape. The
    // shape rules require D2 accepted precisely so this does not become MIXED.
    expect(classifyDiagnosticCanaries(matrix('D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'))).toBe(
      'HIGH_COMPLETION_CAP_SENSITIVE',
    );
  });

  it('R8-C25 two genuinely different findings return MIXED_OR_INCONCLUSIVE', () => {
    // anyOf AND numeric enum both rejected, at a cap that is fine: the matrix names two dimensions,
    // so it names none. An honest "inconclusive" beats a confident wrong dimension.
    expect(classifyDiagnosticCanaries(matrix('D3', 'D4'))).toBe('MIXED_OR_INCONCLUSIVE');
  });

  it('the classification vocabulary is closed and complete', () => {
    expect([...DIAGNOSTIC_CLASSIFICATIONS]).toEqual([
      'MINIMAL_STRICT_REJECTED',
      'HIGH_COMPLETION_CAP_SENSITIVE',
      'ANYOF_NULLABLE_REJECTED',
      'NUMERIC_ENUM_REJECTED',
      'REAL_RIYA_SCHEMA_REJECTED',
      'EXACT_RIYA_MESSAGE_SHAPE_REJECTED',
      'CURRENT_EXACT_REQUEST_ACCEPTED',
      'MIXED_OR_INCONCLUSIVE',
      'DIAGNOSTIC_NOT_RUN',
    ]);
  });

  it('provider acceptance is what is measured — local validation never changes the class', () => {
    // A synthetic prompt may well produce a structurally wrong answer. The provider still ACCEPTED
    // the request, which is the only question this matrix asks.
    const withLocalFailures = matrix().map((one) => ({ ...one, localValidationAccepted: false }));
    expect(classifyDiagnosticCanaries(withLocalFailures)).toBe('CURRENT_EXACT_REQUEST_ACCEPTED');
  });
});

describe('R8-C16..C19 — the port sends one request per canary, at the right cap', () => {
  function harness(): {
    port: ReturnType<typeof createDiagnosticCanaryPort>;
    caps: number[];
    schemas: unknown[];
    invocations: number;
  } {
    const caps: number[] = [];
    const schemas: unknown[] = [];
    const state = { invocations: 0 };
    const observations = createCandidateTransportObservations();
    const port = createDiagnosticCanaryPort({
      providerForCompletionCap: (cap) => {
        caps.push(cap);
        return {
          invoke: (input) => {
            state.invocations += 1;
            schemas.push(input.structuredJsonSchema);
            return Promise.resolve({ status: 'completed' });
          },
        };
      },
      rawSchemaFor: () => CANARY_MINIMAL_SCHEMA,
      messagesFor: () => SYNTHETIC_CANARY_MESSAGES,
      observations,
      timeoutMs: 30_000,
    });
    return {
      port,
      caps,
      schemas,
      get invocations() {
        return state.invocations;
      },
    };
  }

  it('R8-C16/C17/C18/C19 exactly ONE invocation per canary, at that canary’s cap, no retry', async () => {
    const h = harness();
    for (const canary of DIAGNOSTIC_CANARIES) {
      await h.port(canary);
    }
    // Eight canaries, eight invocations. No retry, no fallback, no second attempt anywhere.
    expect(h.invocations).toBe(DIAGNOSTIC_CANARY_REQUESTS);
    expect(h.caps).toEqual(DIAGNOSTIC_CANARIES.map((one) => one.maxCompletionTokens));
    expect(h.caps.filter((one) => one === 512)).toHaveLength(5);
    expect(h.caps.filter((one) => one === 65_536)).toHaveLength(3);
  });

  it('the port hands the RAW schema to the provider, so production projection still runs', async () => {
    // A canary that arrived pre-projected would skip the very step HF4-R7/R1 added, and would measure
    // a request the production path cannot send.
    const h = harness();
    await h.port(canaryById('D1'));
    expect(h.schemas[0]).toBe(CANARY_MINIMAL_SCHEMA);
  });

  it('R8-C28 the port returns EXACTLY the closed outcome fields, and no more', async () => {
    // A field-set lock on what the port PRODUCES, not just on a fixture. Adding anything here — a
    // raw error, a message, a body, a preview — fails now rather than reaching an emitter that would
    // happily print it. The outcome is built solely from the transport observer, and this pins that.
    const h = harness();
    const result = await h.port(canaryById('D1'));
    expect(Object.keys(result).sort()).toEqual([
      'canaryId',
      'providerCompleted',
      'providerErrorCode',
      'providerErrorType',
      'providerHttpClass',
      'providerHttpStatus',
      'providerTransportStarted',
    ]);
  });

  it('a thrown provider is a failed canary, and nothing it carried is read', async () => {
    const observations = createCandidateTransportObservations();
    const port = createDiagnosticCanaryPort({
      providerForCompletionCap: () => ({
        invoke: () => Promise.reject(new Error('SYNTHETIC-SENTINEL-MUST-NOT-SURFACE')),
      }),
      rawSchemaFor: () => CANARY_MINIMAL_SCHEMA,
      messagesFor: () => SYNTHETIC_CANARY_MESSAGES,
      observations,
      timeoutMs: 30_000,
    });
    const result = await port(canaryById('D1'));
    expect(result.providerCompleted).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-SENTINEL-MUST-NOT-SURFACE');
  });
});
