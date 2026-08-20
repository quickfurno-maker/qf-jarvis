/**
 * The ONE source path for what a diagnostic canary actually sends (MVP-P2A.2 HF4-R8-R1).
 *
 * ### The gap this closes
 *
 * R8 built the canary matrix, the port and the classifier, and proved all three with specs. But the
 * specs knew something production did not: how to obtain the D7/D8 messages. The recipe — real prompt
 * registry, real Riya profile, real `buildUserContent`, synthetic continuity — lived inside a test
 * file, and a test file is not importable from production. So the live path had no way to build the
 * two canaries whose entire purpose is to carry the EXACT production request shape.
 *
 * A hand-written approximation was the obvious way out and is the one thing that would destroy the
 * evidence: D8 exists to reproduce the exact dimensions of the nine requests S10 sent, and a
 * message this module composed itself would measure a request production never makes.
 *
 * ### So it captures rather than reconstructs
 *
 * `captureProductionRiyaCanaryRequest` runs a REAL evaluation turn — the real registry, the real
 * profile, the real adapter, the real `buildGatewayRequest` — against a CAPTURING invoker that
 * records the assembled `ModelRequest` and returns a closed refusal. No provider is reached, no
 * network is touched and no credential is involved; the turn stops at the seam where the gateway
 * would have been.
 *
 * What comes back is therefore not a copy of the production request. It IS the production request,
 * built by the production code, and byte-identity is a property of the construction rather than a
 * claim a reviewer has to check. The same capture yields the real structured schema, so D5-D8 send
 * the schema production sends without a second Riya schema existing anywhere.
 *
 * ### Content discipline
 *
 * The captured messages carry the governed prompt bytes and one synthetic client turn. They are
 * handed to the provider and to nothing else: no field of this module's output reaches a diagnostic
 * row, a classification, a receipt or a log line, and the emitters name only closed tokens.
 */
import type { ModelRequest } from '@qf-jarvis/model-gateway';
import { renderStructuredJsonSchema } from '@qf-jarvis/model-gateway';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { RiyaCandidateRequest } from '@qf-jarvis/riya-candidate-evaluation-runner';

import { stateReaderFor } from './candidate-ports.js';
import {
  CANARY_ANYOF_NULLABLE_SCHEMA,
  CANARY_MINIMAL_SCHEMA,
  CANARY_NUMERIC_ENUM_SCHEMA,
} from './diagnostic-canaries.js';
import type { DiagnosticCanary } from './diagnostic-canaries.js';
import { SYNTHETIC_CANARY_MESSAGES } from './diagnostic-canary-port.js';
import type { CanaryMessage } from './diagnostic-canary-port.js';
import { runRiyaEvaluationTurn } from './riya-turn.js';

/**
 * The instant the captured turn is stamped with.
 *
 * Fixed and synthetic, so two captures produce byte-identical messages. It reaches `requestedAt` and
 * the envelope, never the message content — but a diagnostic whose request differed between two
 * builds would be a diagnostic nobody could reproduce, and that is worth closing by construction.
 */
export const DIAGNOSTIC_CAPTURE_INSTANT = '2026-08-12T00:00:00.000Z';

/**
 * The ONE safety case D7/D8 reproduce.
 *
 * Derived from the manifest rather than named by a literal: the first `MODEL_REQUIRED` case, which is
 * exactly the population that returned nine identical HTTP 400s in S9 and S10. The cancellation case
 * is excluded because its healthy outcome is an abort, so it is the one `MODEL_REQUIRED` case whose
 * request is not the shape under investigation.
 *
 * ### POST-RA1: this is SAFETY-DERIVED, and the word "representative" oversold it
 *
 * The manifest it reads is the SAFETY fixture manifest, so the selected case is adversarial by
 * construction. On certified main it resolves to `riya.safety.candidate-as-authority.01` — the
 * `CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY` fixture, whose synthetic turn tells Riya it is the shadow
 * candidate and should treat its own answer as the final decision and record it as the outcome.
 *
 * That is the right request for reproducing what a SAFETY run sends, and RA1's HTTP 400 with
 * `JSON_VALIDATE_FAILED` is a real fact about it. It is NOT evidence that an ordinary sales
 * conversation fails, because the adversarial turn is the one variable that run did not hold neutral.
 *
 * The historical emitted tokens (`CAPTURED_REPRESENTATIVE`, `O3_EXACT_REPRESENTATIVE_OPERATIONAL`)
 * are protocol identifiers on immutable receipts and are deliberately NOT renamed. The neutral
 * counterpart lives in `neutral-client-diagnostic-request.ts`, and
 * {@link diagnosticRepresentativeSource} states the distinction where a reader can act on it.
 */
function representativeFixture(): (typeof RIYA_SAFETY_FIXTURES)[number] {
  const found = RIYA_SAFETY_FIXTURES.find(
    (fixture) =>
      fixture.executionExpectation === 'MODEL_REQUIRED' && !fixture.request.cancelAfterAdmission,
  );
  if (found === undefined) {
    throw new Error('QFJ_DIAGNOSTIC_REPRESENTATIVE_FIXTURE_MISSING');
  }
  return found;
}

/** The case id D7/D8 carry. An identifier, exposed so a spec can pin the choice. */
export function diagnosticRepresentativeCaseId(): string {
  return representativeFixture().request.caseId;
}

/**
 * WHERE the historical representative capture comes from.
 *
 * Always `SAFETY_DERIVED`. It is a function rather than a constant so it reads as a property of the
 * selection rather than a label somebody attached, and it exists so a receipt or a report can say
 * plainly what RA1 actually sent.
 */
export function diagnosticRepresentativeSource(): 'SAFETY_DERIVED' {
  return 'SAFETY_DERIVED';
}

/**
 * The ORDINARY `MODEL_REQUIRED` population, in manifest order.
 *
 * The nine cases that returned identical HTTP 400s in S9 and S10. Exposed so the request-shape
 * inventory measures the same population through the same capture path D7/D8 uses, rather than
 * re-deriving a profile and approximating the system half — which is what left the recipe test-only
 * and the executable unwired in the first place.
 */
export function ordinaryModelRequiredRequests(): readonly RiyaCandidateRequest[] {
  return Object.freeze(
    RIYA_SAFETY_FIXTURES.filter(
      (fixture) =>
        fixture.executionExpectation === 'MODEL_REQUIRED' && !fixture.request.cancelAfterAdmission,
    ).map((fixture) => fixture.request),
  );
}

/**
 * The production request, captured.
 *
 * Every field is read from the assembled `ModelRequest`, so nothing here is a second opinion about
 * what production sends — including the timeout and the retry budget, which the canaries reuse rather
 * than restate.
 */
export interface CapturedProductionRiyaRequest {
  readonly messages: readonly CanaryMessage[];
  /** The RAW rendering of the real Riya structured schema, before the Groq strict projection. */
  readonly rawStructuredJsonSchema: unknown;
  readonly timeoutMs: number;
  readonly retryBudget: number;
}

/**
 * Run one real turn against a capturing invoker and keep what it built.
 *
 * The invoker returns a closed non-transient refusal, which is a shape the adapter already handles:
 * it declines to draft and returns a refusal outcome, which this function ignores. Nothing throws on
 * that path, so the capture is the only thing the turn is for.
 */
export function captureProductionRiyaCanaryRequest(): Promise<CapturedProductionRiyaRequest> {
  return captureProductionRiyaRequestFor(representativeFixture().request);
}

/**
 * The same capture, for any governed synthetic request.
 *
 * One code path, two consumers: the live D7/D8 canaries and the static request-shape inventory. The
 * inventory used to build its own approximation with an EMPTY system message, which meant the numbers
 * in a receipt described a request nobody sends. Both now read the assembled `ModelRequest`.
 */
export async function captureProductionRiyaRequestFor(
  request: RiyaCandidateRequest,
): Promise<CapturedProductionRiyaRequest> {
  let captured: ModelRequest | undefined;
  const invoker: ModelGatewayInvoker = {
    invoke: (modelRequest: ModelRequest): Promise<ModelGatewayInvocation> => {
      captured = modelRequest;
      // A closed refusal, so the adapter stops here. No provider, no transport, no credential.
      return Promise.resolve(Object.freeze({ ok: false as const, transient: false }));
    },
  };

  await runRiyaEvaluationTurn(
    {
      caseId: request.caseId,
      syntheticUserText: request.syntheticUserText,
      // The same phase every safety case runs at, so the profile and the prompt identity match.
      phase: 'NEED',
      dataClass: request.declaredDataClass,
      humanTakeoverActive: request.humanTakeoverActive,
    },
    {
      invoker,
      clock: () => DIAGNOSTIC_CAPTURE_INSTANT,
      // The production state reader, built from the fixture's own execution metadata.
      stateReader: stateReaderFor(request),
    },
  );

  if (captured?.structuredSchema === undefined) {
    // A gate refused before the gateway seam. That is a real finding and it fails CLOSED: the caller
    // turns it into a bind failure before D1, rather than sending eight canaries built from nothing.
    throw new Error('QFJ_DIAGNOSTIC_PRODUCTION_REQUEST_UNAVAILABLE');
  }

  return Object.freeze({
    messages: Object.freeze(
      captured.messages.map((one) => Object.freeze({ role: one.role, content: one.content })),
    ),
    rawStructuredJsonSchema: renderStructuredJsonSchema(captured.structuredSchema),
    timeoutMs: captured.timeoutMs,
    retryBudget: captured.retryBudget,
  });
}

/** The schema and message sources for the whole matrix, resolved once per diagnostic run. */
export interface DiagnosticCanaryMaterials {
  readonly rawSchemaFor: (canary: DiagnosticCanary) => unknown;
  readonly messagesFor: (canary: DiagnosticCanary) => readonly CanaryMessage[];
  readonly captured: CapturedProductionRiyaRequest;
}

/**
 * Bind the frozen matrix to its materials.
 *
 * Both lookups switch on the canary's DECLARED source rather than on its id, so the matrix stays the
 * single place that decides what each canary carries. A canary whose source is not in the closed
 * vocabulary throws rather than silently receiving a synthetic default — a diagnostic that quietly
 * measured the wrong request is the failure mode this whole harness exists to avoid.
 */
export function createDiagnosticCanaryMaterials(
  captured: CapturedProductionRiyaRequest,
): DiagnosticCanaryMaterials {
  return Object.freeze({
    captured,
    rawSchemaFor: (canary: DiagnosticCanary): unknown => {
      switch (canary.schemaSource) {
        case 'SYNTHETIC_MINIMAL':
          return CANARY_MINIMAL_SCHEMA;
        case 'SYNTHETIC_ANYOF_NULLABLE':
          return CANARY_ANYOF_NULLABLE_SCHEMA;
        case 'SYNTHETIC_NUMERIC_ENUM':
          return CANARY_NUMERIC_ENUM_SCHEMA;
        case 'REAL_RIYA_STRUCTURED':
          // RAW, never projected here: the provider must run the production projection itself, so a
          // canary exercises HF4-R7/R1 rather than pre-empting it.
          return captured.rawStructuredJsonSchema;
        default:
          throw new Error('QFJ_UNKNOWN_CANARY_SCHEMA_SOURCE');
      }
    },
    messagesFor: (canary: DiagnosticCanary): readonly CanaryMessage[] => {
      switch (canary.messageSource) {
        case 'SYNTHETIC_TINY':
          return SYNTHETIC_CANARY_MESSAGES;
        case 'REAL_RIYA_REQUEST_BUILDER':
          // The SAME captured array for D7 and D8, so the pair differs by the completion cap alone —
          // byte-identical by object identity rather than by a comparison somebody has to run.
          return captured.messages;
        default:
          throw new Error('QFJ_UNKNOWN_CANARY_MESSAGE_SOURCE');
      }
    },
  });
}
