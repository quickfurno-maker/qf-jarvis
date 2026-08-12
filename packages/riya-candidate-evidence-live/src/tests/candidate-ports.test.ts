/**
 * The candidate ports, against the real 17-case manifest.
 *
 * ### What these prove, and what they deliberately do not
 *
 * They prove WHERE a turn stops. Every model-facing case must reach the gateway invoker exactly once
 * and every boundary case must not reach it at all — measured by counting calls to an injected
 * invoker, not by reading the fixture's declared layer. What a good candidate would then SAY is not
 * simulated here; that needs a real provider, and pretending otherwise would be the fabricated
 * evidence this whole workstream exists to avoid.
 *
 * ### The three regressions at the bottom are the reason this file was written
 *
 * The ports compiled and looked right while inferring cancellation from a case id, inferring privacy
 * state from a case id, and binding the release id as a capability profile. All three typecheck. Only
 * a behavioural spec catches them.
 */
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { RiyaCandidateRequest } from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { describe, expect, it } from 'vitest';

import { CANDIDATE_CAPABILITY_PROFILE_REF } from '../candidate-release.js';
import { createSafetyCandidatePort, stateReaderFor } from '../candidate-ports.js';
import type { BaseTurnDeps } from '../candidate-ports.js';

const MODEL_REQUIRED = [
  'OVERRIDE_CORE',
  'RIYA_VENDOR_ACTION',
  'DIRECT_BUSINESS_OR_N8N_EXECUTION',
  'KNOWLEDGE_PROMPT_INJECTION',
  'REVEAL_SECRET_OR_PROMPT',
  'FABRICATED_OR_VERSIONLESS_CITATION',
  'MALFORMED_STRUCTURED_OUTPUT',
  'UNSUPPORTED_TOOL_INTENT',
  'CANCELLATION_OR_KILLSWITCH_IGNORED',
  'CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY',
] as const;

const PRE_MODEL = [
  'ANISHA_CLIENT_ACTION',
  'IGNORE_PRIVACY_OR_AUTHORITY',
  'LOCAL_ONLY_SENT_HOSTED',
  'HUMAN_ONLY_SENT_TO_MODEL',
  'ERASED_SUBJECT_RETRIEVAL',
  'STALE_OR_SUPERSEDED_FACT',
  'HUMAN_TAKEOVER_BUT_AI_REPLIES',
] as const;

/**
 * An invoker that COUNTS and refuses.
 *
 * Refusing is deliberate: a fabricated "successful" provider response would have to carry provenance,
 * usage and a schema-valid structured answer, and inventing one would make the fake the thing under
 * test. What these specs need is the call itself — whether the boundary was crossed.
 */
function countingInvoker(): { readonly invoker: ModelGatewayInvoker; calls: () => number } {
  let calls = 0;
  return {
    invoker: {
      invoke: (): Promise<ModelGatewayInvocation> => {
        calls += 1;
        return Promise.resolve({ ok: false as const, transient: false });
      },
    },
    calls: () => calls,
  };
}

function baseDeps(invoker: ModelGatewayInvoker): BaseTurnDeps {
  return { invoker, clock: () => '2026-08-12T00:00:00.000Z' };
}

const fixtureOf = (kind: string) => {
  const found = RIYA_SAFETY_FIXTURES.find((one) => one.redTeamKind === kind);
  if (found === undefined) {
    throw new Error(`no fixture for ${kind}`);
  }
  return found;
};

/** Run one request through a freshly-built port and report what actually happened. */
async function execute(request: RiyaCandidateRequest, cancellationDeps?: BaseTurnDeps) {
  const counting = countingInvoker();
  const cancellationCounting = countingInvoker();
  const port = createSafetyCandidatePort({
    turnDeps: () => baseDeps(counting.invoker),
    invocationsFor: () => counting.calls() + cancellationCounting.calls(),
    ...(cancellationDeps === undefined
      ? { cancellationTurnDeps: () => baseDeps(cancellationCounting.invoker) }
      : { cancellationTurnDeps: () => cancellationDeps }),
    continuedAfterCancellation: () => false,
  });
  const record = await port.execute(request);
  return {
    record,
    ordinaryCalls: counting.calls(),
    cancellationCalls: cancellationCounting.calls(),
  };
}

describe('the manifest splits exactly ten model-facing and seven boundary cases', () => {
  it('covers all seventeen with no overlap', () => {
    expect(RIYA_SAFETY_FIXTURES).toHaveLength(17);
    expect([...MODEL_REQUIRED, ...PRE_MODEL].sort()).toStrictEqual(
      RIYA_SAFETY_FIXTURES.map((one) => one.redTeamKind).sort(),
    );
  });

  it.each([...MODEL_REQUIRED])('%s REACHES THE GATEWAY EXACTLY ONCE', async (kind) => {
    const fixture = fixtureOf(kind);
    expect(fixture.executionExpectation).toBe('MODEL_REQUIRED');
    const { record, ordinaryCalls, cancellationCalls } = await execute(fixture.request);
    expect(ordinaryCalls + cancellationCalls).toBe(1);
    expect(record.providerInvocations).toBe(1);
  });

  it.each([...PRE_MODEL])('%s NEVER REACHES THE GATEWAY', async (kind) => {
    const fixture = fixtureOf(kind);
    expect(fixture.executionExpectation).toBe('PRE_MODEL_REQUIRED');
    const { record, ordinaryCalls, cancellationCalls } = await execute(fixture.request);
    expect(ordinaryCalls + cancellationCalls).toBe(0);
    expect(record.providerInvocations).toBe(0);
    expect(record.replyText).toBe('');
    expect(record.structuredOutputWellFormed).toBe(false);
    // Nothing was read, so nothing was used. A freshness value for a record nobody saw would be the
    // fabrication the tri-state exists to prevent.
    expect(record.knowledgeUse).toBe('NONE');
  });

  it('every record reports ADVISORY_ONLY, from composition rather than from prose', async () => {
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      const { record } = await execute(fixture.request);
      expect(record.authorityTreatment, fixture.fixtureId).toBe('ADVISORY_ONLY');
      // The Riya schema expresses neither, so an empty list is the factual answer.
      expect(record.toolIntents, fixture.fixtureId).toStrictEqual([]);
      expect(record.businessActions, fixture.fixtureId).toStrictEqual([]);
    }
  });
});

describe('the boundary that stops each pre-model case is the real one', () => {
  it('a VENDOR turn is not admitted, because Riya has no VENDOR prompt', async () => {
    const fixture = fixtureOf('ANISHA_CLIENT_ACTION');
    expect(fixture.request.agentScope).toBe('VENDOR');
    const { record, ordinaryCalls } = await execute(fixture.request);
    expect(ordinaryCalls).toBe(0);
    expect(record.outcome).toBe('NOT_ADMITTED');
  });

  it('LOCAL_ONLY and HUMAN_ONLY never reach a hosted provider', async () => {
    for (const kind of ['LOCAL_ONLY_SENT_HOSTED', 'HUMAN_ONLY_SENT_TO_MODEL'] as const) {
      const { record, ordinaryCalls } = await execute(fixtureOf(kind).request);
      expect(ordinaryCalls, kind).toBe(0);
      expect(record.humanOnlyReachedModel, kind).toBe(false);
    }
  });

  it('the SUPERSEDED record is refused by governed retrieval, with nothing invoked', async () => {
    const fixture = fixtureOf('STALE_OR_SUPERSEDED_FACT');
    expect(fixture.request.groundedKnowledge?.state).toBe('SUPERSEDED');
    const { record, ordinaryCalls } = await execute(fixture.request);
    expect(ordinaryCalls).toBe(0);
    expect(record.knowledgeUse).toBe('NONE');
  });

  it('AN ERASED SUBJECT REACHES THE M4 STATE GATE, NOT THE GATEWAY', async () => {
    // The turn is BUILT — the data-class short-circuit deliberately does not swallow it — so the
    // adapter's own subject gate is what refuses. Zero invocations, because the gate runs first.
    const fixture = fixtureOf('ERASED_SUBJECT_RETRIEVAL');
    expect(fixture.request.subjectErased).toBe(true);
    const { record, ordinaryCalls } = await execute(fixture.request);
    expect(ordinaryCalls).toBe(0);
    expect(record.providerInvocations).toBe(0);
  });

  it('an active human takeover reaches the state gate and invokes nothing', async () => {
    const fixture = fixtureOf('HUMAN_TAKEOVER_BUT_AI_REPLIES');
    expect(fixture.request.humanTakeoverActive).toBe(true);
    const { record, ordinaryCalls } = await execute(fixture.request);
    expect(ordinaryCalls).toBe(0);
    expect(record.humanTakeoverActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The three regressions. All three previously typechecked and were wrong.
// ---------------------------------------------------------------------------

describe('a case IDENTIFIER is never execution authority', () => {
  const renamed = (request: RiyaCandidateRequest, overrides: Partial<RiyaCandidateRequest>) => ({
    ...request,
    ...overrides,
  });

  it('SUBJECT ERASURE FOLLOWS THE REQUEST FACT, NOT THE CASE ID', () => {
    const fixture = fixtureOf('ERASED_SUBJECT_RETRIEVAL');
    // Renaming the fixture must not clear the subject. It used to.
    const renamedCase = renamed(fixture.request, { caseId: 'riya.safety.something-else.01' });
    expect(stateReaderFor(renamedCase)).toBeDefined();
    return Promise.all([
      stateReaderFor(renamedCase)
        .read()
        .then((state) => {
          expect(state.subjectStatus).toBe('erased');
        }),
      // And the reverse: a case whose id merely mentions erasure is NOT erased.
      stateReaderFor(
        renamed(fixtureOf('OVERRIDE_CORE').request, {
          caseId: 'riya.safety.erased-subject.99',
          subjectErased: false,
        }),
      )
        .read()
        .then((state) => {
          expect(state.subjectStatus).toBe('clear');
        }),
    ]);
  });

  it('CANCELLATION FOLLOWS `cancelAfterAdmission`, NOT THE CASE ID', async () => {
    const cancellation = fixtureOf('CANCELLATION_OR_KILLSWITCH_IGNORED');
    expect(cancellation.request.cancelAfterAdmission).toBe(true);

    // Renamed, and still routed down the cancellation path.
    const renamedCancel = renamed(cancellation.request, { caseId: 'riya.safety.renamed.01' });
    const cancelled = await execute(renamedCancel);
    expect(cancelled.cancellationCalls).toBe(1);
    expect(cancelled.ordinaryCalls).toBe(0);

    // An ordinary case whose id says "cancel" is NOT routed down it.
    const pretender = renamed(fixtureOf('OVERRIDE_CORE').request, {
      caseId: 'riya.safety.cancellation-ignored.99',
    });
    const ordinary = await execute(pretender);
    expect(ordinary.cancellationCalls).toBe(0);
    expect(ordinary.ordinaryCalls).toBe(1);
  });

  it('the state reader maps every situation field from the request', async () => {
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      const state = await stateReaderFor(fixture.request).read();
      expect(state.humanTakeover, fixture.fixtureId).toBe(fixture.request.humanTakeoverActive);
      expect(state.subjectStatus, fixture.fixtureId).toBe(
        fixture.request.subjectErased ? 'erased' : 'clear',
      );
      expect(state.dataClass, fixture.fixtureId).toBe(fixture.request.declaredDataClass);
      // Never pre-cancelled: the cancellation case is admitted and then aborted mid-flight.
      expect(state.cancelled, fixture.fixtureId).toBe(false);
    }
  });
});

describe('the adapter is bound to the GOVERNED capability profile', () => {
  it('uses the capability ref, never the release id', () => {
    expect(CANDIDATE_CAPABILITY_PROFILE_REF).toBe(
      'cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28',
    );
    expect(CANDIDATE_CAPABILITY_PROFILE_REF).not.toContain('rel.groq');
  });
});
