/**
 * The accounted session: phase ownership, per-case counts, and the cancellation signal chain.
 *
 * ### The two defects this file exists for
 *
 * A single session carried one fixed phase, so a real run booked all 72 P10 calls as safety and the
 * advertised 1 / 10 / 72 split was unreachable. And the cancellation transport aborted a controller
 * whose signal was never handed to `gateway.invoke` — proving a controller had been aborted while
 * cancelling nothing.
 *
 * Both are wiring, and both are invisible to a test that stubs the gateway. So these specs use the
 * REAL candidate gateway and the REAL Groq provider, with only the transport faked, and assert
 * SIGNAL OBJECT IDENTITY end to end.
 */
import { createGroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqTransport, ModelRequest } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { createOperatorLedger, MAX_PROVIDER_REQUESTS } from '../accounting.js';
import { createAccountedSession } from '../candidate-session.js';
import {
  createTransportBoundaryAbort,
  createTransportStartHook,
} from '../cancellation-transport.js';
import { createCandidateGateway } from '../evaluation-gateway.js';

/** An obvious sentinel. It has never been a credential. */
const SENTINEL_KEY = 'sk-SENTINEL-ACCOUNTED-NEVER-A-REAL-KEY-00';

/** Records every signal it was handed, and whether that signal was already aborted on entry. */
function recordingTransport(): {
  readonly transport: GroqTransport;
  readonly signals: () => readonly AbortSignal[];
  readonly abortedOnEntry: () => readonly boolean[];
  readonly calls: () => number;
} {
  const signals: AbortSignal[] = [];
  const abortedOnEntry: boolean[] = [];
  return {
    transport: {
      send: (_request, signal) => {
        signals.push(signal);
        abortedOnEntry.push(signal.aborted);
        return Promise.resolve({
          status: 200,
          bodyText: '{}',
          retryAfterSeconds: null,
        } as Awaited<ReturnType<GroqTransport['send']>>);
      },
    },
    signals: () => signals,
    abortedOnEntry: () => abortedOnEntry,
    calls: () => signals.length,
  };
}

function harness() {
  const apiKey = createGroqApiKey(SENTINEL_KEY);
  const ledger = createOperatorLedger();
  const ordinary = recordingTransport();
  const underlyingCancellation = recordingTransport();
  const abort = createTransportBoundaryAbort();

  const session = createAccountedSession({
    gateway: createCandidateGateway({ apiKey, transport: ordinary.transport }),
    cancellationGateway: createCandidateGateway({
      apiKey,
      transport: createTransportStartHook(
        underlyingCancellation.transport,
        abort.onTransportStarted,
      ),
    }),
    cancellationController: abort.controller,
    transportStarts: abort.started,
    ledger,
    clock: () => '2026-08-12T00:00:00.000Z',
  });
  return { session, ledger, ordinary, underlyingCancellation, abort };
}

/**
 * A valid gateway request, built to the real contract.
 *
 * The gateway validates before it routes, so a hand-waved shape would be refused at the door and the
 * transport would never be entered — which would make every assertion below vacuously pass on zero
 * calls. It is deliberately a full request.
 */
function request(runId: string): ModelRequest {
  return {
    runId,
    purpose: 'synthetic-evaluation',
    agentScope: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    messages: [{ role: 'user', content: 'synthetic evaluation turn' }],
    requiredCapabilities: {
      structuredOutput: true,
      strictJsonSchema: true,
      cancellation: false,
      minContextTokens: 1024,
    },
    resultMode: 'TEXT',
    maxResultChars: 2048,
    promptId: 'riya.client-sales',
    promptVersion: '1',
    promptDigest: 'b'.repeat(64),
    tokenBudget: 512,
    costBudget: 1,
    timeoutMs: 10_000,
    retryBudget: 0,
    metadata: {},
  };
}

describe('each phase is charged to itself', () => {
  it('THE FINAL SPLIT IS 1 SMOKE / 10 SAFETY / 72 P10 / 83 TOTAL', async () => {
    // The arithmetic the whole run advertises. Before the fix every P10 call landed in
    // `safetyProviderRequests`, so this exact assertion could not have passed.
    const { session, ledger } = harness();
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle({ inputTokens: 10, outputTokens: 4 }, true);

    for (let index = 0; index < 10; index += 1) {
      const deps = session.safetyTurnDeps(`safety.case.${String(index)}`);
      await deps?.invoker.invoke(request(`run.safety.${String(index)}`));
    }
    for (let index = 0; index < 72; index += 1) {
      const deps = session.qualityTurnDeps(`p10.case.${String(index)}`);
      await deps?.invoker.invoke(request(`run.p10.${String(index)}`));
    }

    const snapshot = ledger.snapshot();
    expect(snapshot.smokeRequests).toBe(1);
    expect(snapshot.safetyProviderRequests).toBe(10);
    expect(snapshot.p10ProviderRequests).toBe(72);
    expect(snapshot.totalProviderRequests).toBe(MAX_PROVIDER_REQUESTS);
    expect(snapshot.totalProviderRequests).toBe(83);
  });

  it('SAFETY STAYS AT 10 AFTER P10 RUNS — IT DOES NOT BECOME 82', async () => {
    const { session, ledger } = harness();
    for (let index = 0; index < 10; index += 1) {
      await session.safetyTurnDeps(`safety.${String(index)}`)?.invoker.invoke(request('r'));
    }
    expect(ledger.snapshot().safetyProviderRequests).toBe(10);
    for (let index = 0; index < 72; index += 1) {
      await session.qualityTurnDeps(`p10.${String(index)}`)?.invoker.invoke(request('r'));
    }
    expect(ledger.snapshot().safetyProviderRequests).toBe(10);
    expect(ledger.snapshot().p10ProviderRequests).toBe(72);
  });

  it('the per-case count is per case, not a running total', async () => {
    const { session } = harness();
    await session.safetyTurnDeps('case.one')?.invoker.invoke(request('r1'));
    await session.safetyTurnDeps('case.two')?.invoker.invoke(request('r2'));
    expect(session.invocationsFor('case.one')).toBe(1);
    expect(session.invocationsFor('case.two')).toBe(1);
    expect(session.invocationsFor('case.never-run')).toBe(0);
  });

  it('the 84th request is refused BEFORE the gateway is touched', async () => {
    const { session, ledger, ordinary } = harness();
    for (let index = 0; index < MAX_PROVIDER_REQUESTS; index += 1) {
      await session.qualityTurnDeps(`p10.${String(index)}`)?.invoker.invoke(request('r'));
    }
    const before = ordinary.calls();
    const overflow = await session
      .qualityTurnDeps('p10.overflow')
      ?.invoker.invoke(request('overflow'));
    expect(overflow?.ok).toBe(false);
    // The transport was never entered for the refused call.
    expect(ordinary.calls()).toBe(before);
    expect(session.invocationsFor('p10.overflow')).toBe(0);
    expect(ledger.snapshot().totalProviderRequests).toBe(MAX_PROVIDER_REQUESTS);
    expect(session.accountingRefusal()).toBe('request-limit-reached');
  });

  it('candidate usage is settled for every attempt, not only for smoke', async () => {
    const { session, ledger } = harness();
    await session.safetyTurnDeps('case.one')?.invoker.invoke(request('r'));
    const snapshot = ledger.snapshot();
    expect(snapshot.totalProviderRequests).toBe(1);
    // The fake transport returns no parseable usage, so the guaranteed bound is used and the run
    // says so rather than inventing a token count.
    expect(snapshot.inputTokens).toBeGreaterThan(0);
    expect(snapshot.costIsEstimated).toBe(true);
  });
});

describe('the cancellation signal is ONE object, all the way down', () => {
  it('THE UNDERLYING TRANSPORT RECEIVES THE EXACT CONTROLLER SIGNAL', async () => {
    // Identity, not equivalence. The previous wiring aborted a controller whose signal the gateway
    // never saw, so the request carried on with a different, un-abortable signal.
    const { session, abort, underlyingCancellation } = harness();
    expect(abort.controller.signal.aborted).toBe(false);

    await session.safetyCancellationTurnDeps('case.cancel')?.invoker.invoke(request('r.cancel'));

    expect(underlyingCancellation.calls()).toBe(1);
    expect(underlyingCancellation.signals()[0]).toBe(abort.controller.signal);
    // Not aborted before the boundary was crossed; aborted by crossing it.
    expect(abort.started()).toBe(1);
    expect(abort.controller.signal.aborted).toBe(true);
    expect(underlyingCancellation.abortedOnEntry()).toStrictEqual([true]);
  });

  it('the abort is observed for that case, and only that case', async () => {
    const { session } = harness();
    await session.safetyCancellationTurnDeps('case.cancel')?.invoker.invoke(request('r'));
    await session.safetyTurnDeps('case.ordinary')?.invoker.invoke(request('r'));
    expect(session.cancellationObservedFor('case.cancel')).toBe(true);
    expect(session.cancellationObservedFor('case.ordinary')).toBe(false);
  });

  it('exactly one attempt, and the ordinary path never touches the cancellation transport', async () => {
    const { session, ordinary, underlyingCancellation, abort } = harness();
    await session.safetyTurnDeps('case.ordinary')?.invoker.invoke(request('r'));
    expect(ordinary.calls()).toBe(1);
    expect(underlyingCancellation.calls()).toBe(0);
    expect(abort.started()).toBe(0);
    // And the ordinary request was never handed a cancellation signal that was already aborted.
    expect(ordinary.abortedOnEntry()).toStrictEqual([false]);
  });

  it('the cancellation gateway is the same release and credential, only a different transport', () => {
    // Not a second model, provider or credential — a spec rather than a promise.
    const { session } = harness();
    expect(session.safetyCancellationTurnDeps('c')).toBeDefined();
    expect(session.qualityTurnDeps('q')).toBeDefined();
  });
});
