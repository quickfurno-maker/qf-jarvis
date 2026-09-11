/**
 * The JF-5B certification ENGINE, driven end to end with deterministic transports and ZERO network.
 *
 * ### What is real here
 *
 * Everything above the socket. The real Mastra workflow, the real three-agent composition, the real
 * Jarvis runtime, the real agent assignment, the real per-scope prompt bindings resolving the three
 * REVIEWED production prompt bodies, the real model reply adapter, the real QF Model Gateway with real
 * Groq and Nara provider adapters, the real capability matching, the real strict-schema projection and
 * the real Core decision adapter.
 *
 * The only doubles are the two HTTP transports and the Core responder. That is the narrowest possible
 * seam, and it is what makes the measurements below measurements of OUR code rather than of a stub.
 *
 * ### What running it for real found, and what R2 closed
 *
 * R1 ran this engine and found that five of the six certifications could not reach a provider at all:
 * the generic reply wire shape was not strict-projectable, and every reply request demanded
 * provider-native strict JSON Schema. Both were production defects no fixture could have shown, and
 * both are closed in R2 — see `jf5b-provider-eligibility.test.ts`, which now proves the compatibility
 * rather than pinning the breakage.
 *
 * So the counts below are the real ones: every model-required case reaches a provider, for BOTH
 * providers, across all three agents.
 */
import {
  createCallLedger,
  createLiveBudget,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { createGroqApiKey, createNaraApiKey } from '@qf-jarvis/model-gateway';
import type { GroqTransport, NaraTransport } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  JF5B_CASES,
  MODEL_REQUIRED_CASES,
  PRE_MODEL_CASES,
  casesFor,
} from '../composition/jf5b-case-corpus.js';
import { createJf5bCertificationRunner } from '../composition/jf5b-certification-runner-impl.js';

const GROQ_KEY = createGroqApiKey('gsk-synthetic-certification-key-000000');
const NARA_KEY = createNaraApiKey('nara-synthetic-certification-key-0000');
const NARA_MODEL = 'vendor-a/model-one';
const RUN_ID = 'run.jf5b.spec';
const HEAD = 'a'.repeat(40);

/** The only agent whose reviewed prompt currently reaches a provider through the governed path. */
const RIYA_MODEL_CASES = casesFor('RIYA').filter((one) => one.layer === 'MODEL_REQUIRED');

/** A neutral synthetic answer. Deliberately asserts no price, package, availability or registration. */
const NEUTRAL_BODY =
  'Thank you for asking. I can note what you need and pass it to the team, who will confirm the details.';

/**
 * The structured answer the fake provider returns, chosen from the SCHEMA the request declared.
 *
 * Reading the schema rather than a flag is the point: Riya's capability and the ordinary inbound path
 * ask for genuinely different shapes, and a fake that always returned one of them would quietly prove
 * that only one of the two paths was ever exercised.
 */
function answerFor(body: string, replyBody: string): string {
  const parsed = JSON.parse(body) as {
    response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } };
    messages?: readonly { readonly role: string; readonly content: string }[];
  };
  const properties = parsed.response_format?.json_schema?.schema?.properties ?? {};
  // A strict endpoint is handed the schema and can answer from it. A `json_object` endpoint is NOT,
  // and a real model there answers from the SYSTEM PROMPT — so the fake does the same, rather than
  // assuming a schema it was never sent. Without this, the Nara side of Riya's certification would
  // look broken when what was really broken was the double.
  const system = parsed.messages?.find((one) => one.role === 'system')?.content ?? '';
  const wantsEvolution =
    Object.prototype.hasOwnProperty.call(properties, 'evolution') ||
    system.startsWith('You are Riya,');
  if (wantsEvolution) {
    return JSON.stringify({
      reply: { kind: 'REPLY', replyBody, reasonCode: null, citations: [] },
      evolution: {
        version: 1,
        observations: { sets: [], clears: [] },
        skipProjectDetails: false,
        // One of the six phases RWC-P4A lets a model name. CONTACT, CONSENT and COMPLETE are
        // RWC-P6's, and the schema does not offer them.
        questionPlan: { phase: 'NEED', questionFields: [] },
      },
    });
  }
  // The GENERIC wire shape: every property present, the semantically-optional one explicitly null.
  // A strict endpoint has no concept of an absent key, so "no reason code" has to be said.
  return JSON.stringify({ kind: 'REPLY', replyBody, reasonCode: null, citations: [] });
}

function chatCompletion(content: string): string {
  return JSON.stringify({
    id: 'chatcmpl-jf5b-spec',
    model: 'synthetic',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  });
}

/**
 * The bounded request and response shapes, read OFF the transport interfaces themselves.
 *
 * `@qf-jarvis/model-gateway` exports the two transport contracts and not the HTTP records they carry,
 * which is the right public surface: a caller implements `send`, it does not build one of these by
 * hand. Deriving them keeps this spec honest if either record ever changes shape.
 */
type GroqRequest = Parameters<GroqTransport['send']>[0];
type GroqResponse = Awaited<ReturnType<GroqTransport['send']>>;
type NaraRequest = Parameters<NaraTransport['send']>[0];
type NaraResponse = Awaited<ReturnType<NaraTransport['send']>>;

interface Wire {
  readonly groq: GroqTransport;
  readonly nara: NaraTransport;
  readonly groqCalls: () => number;
  readonly naraCalls: () => number;
  readonly urls: () => readonly string[];
}

/** Deterministic transports. They open no socket, and they count what they were asked to send. */
function wire(replyBody: string = NEUTRAL_BODY): Wire {
  const counts = { groq: 0, nara: 0 };
  const urls: string[] = [];
  return {
    groqCalls: () => counts.groq,
    naraCalls: () => counts.nara,
    urls: () => urls,
    groq: {
      send(request: GroqRequest): Promise<GroqResponse> {
        counts.groq += 1;
        urls.push(request.url);
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: chatCompletion(answerFor(request.body, replyBody)),
        });
      },
    },
    nara: {
      send(request: NaraRequest): Promise<NaraResponse> {
        counts.nara += 1;
        urls.push(request.url);
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: chatCompletion(answerFor(request.body, replyBody)),
        });
      },
    },
  };
}

/** A transport that answers 200 with a structurally unusable body. Nothing here is a provider fault. */
function brokenWire(): Wire {
  const counts = { groq: 0, nara: 0 };
  const urls: string[] = [];
  const answer = (): { status: number; retryAfterSeconds: null; bodyText: string } => ({
    status: 200,
    retryAfterSeconds: null,
    // A well-formed completion carrying an object the request's schema refuses.
    bodyText: chatCompletion(JSON.stringify({ kind: 'REPLY', unexpected: true })),
  });
  return {
    groqCalls: () => counts.groq,
    naraCalls: () => counts.nara,
    urls: () => urls,
    groq: {
      send(request: GroqRequest): Promise<GroqResponse> {
        counts.groq += 1;
        urls.push(request.url);
        return Promise.resolve(answer());
      },
    },
    nara: {
      send(request: NaraRequest): Promise<NaraResponse> {
        counts.nara += 1;
        urls.push(request.url);
        return Promise.resolve(answer());
      },
    },
  };
}

const budget = () =>
  createCallLedger(
    createLiveBudget({
      maxGroqCalls: 400,
      maxNaraCalls: 400,
      maxTotalCalls: 800,
      maxEstimatedSpendUsd: 10,
    }),
  );

async function certify(replyBody: string = NEUTRAL_BODY) {
  const seams = wire(replyBody);
  const result = await createJf5bCertificationRunner({
    groqTransport: seams.groq,
    naraTransport: seams.nara,
  }).certifyAllSix({
    naraModelId: NARA_MODEL,
    naraApiKey: NARA_KEY,
    groqApiKey: GROQ_KEY,
    runId: RUN_ID,
    headSha: HEAD,
    ledger: budget(),
  });
  return { result, seams };
}

describe('JF-5B (3) the engine executes every case, through the real composition', () => {
  it('runs the whole corpus against BOTH providers and records one result each', async () => {
    const { result } = await certify();
    // Two providers x the whole corpus. Not six binding objects: six executed case sets.
    expect(result.cases).toHaveLength(JF5B_CASES.length * 2);
    for (const provider of ['groq', 'nara'] as const) {
      for (const agent of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
        const pair = result.cases.filter((one) => one.provider === provider && one.agent === agent);
        expect([provider, agent, pair.length]).toEqual([provider, agent, casesFor(agent).length]);
      }
    }
  });

  it('each agent ran under its OWN reviewed prompt digest, and the three differ', async () => {
    const { result } = await certify();
    const digests = new Map<string, Set<string>>();
    for (const record of result.cases) {
      const seen = digests.get(record.agent) ?? new Set<string>();
      seen.add(record.promptDigest);
      digests.set(record.agent, seen);
    }
    // One digest per agent: a prompt that changed mid-suite would show up as two.
    for (const [, seen] of digests) {
      expect(seen.size).toBe(1);
    }
    // And three distinct bodies across the three agents. This is the whole reason there are SIX
    // bindings rather than two: one binding carries one digest.
    expect(new Set([...digests.values()].flatMap((seen) => [...seen])).size).toBe(3);
  });

  it('a turn blocked by authoritative state or data class costs ZERO provider calls', async () => {
    const { result } = await certify();
    const blocked = result.cases.filter((one) => one.executionLayer === 'PRE_MODEL_REQUIRED');
    expect(blocked).toHaveLength(PRE_MODEL_CASES.length * 2);
    // Zero calls AND a PASS: the gate is what answered, and it answered correctly. Asserting the count
    // alone could not tell "correctly no model" from "broken, so no model".
    expect(blocked.every((one) => one.networkCalls === 0)).toBe(true);
    expect(blocked.every((one) => one.outcome === 'PASS')).toBe(true);
  });

  it('same-provider retry and fallback are ZERO on every executed case', async () => {
    const { result } = await certify();
    // `retryCount` is a literal-zero field on the record contract, so the schema is what enforces it.
    // What is measurable here is the fallback count: a single-provider gateway has nowhere to fall
    // back TO, and a non-zero count would mean one had appeared.
    expect(result.cases.map((one) => one.fallbackCount).filter((count) => count !== 0)).toEqual([]);
  });
});

describe('JF-5B (3) all six provider x agent pairs certify', () => {
  it('every pair reaches a provider once per model-required case and passes each', async () => {
    const { result, seams } = await certify();
    for (const provider of ['groq', 'nara'] as const) {
      for (const agent of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
        const model = result.cases.filter(
          (one) =>
            one.provider === provider &&
            one.agent === agent &&
            one.executionLayer === 'MODEL_REQUIRED',
        );
        const label = `${provider}/${agent}`;
        expect([label, model.length > 0]).toEqual([label, true]);
        // Named rather than counted: a failure here should say WHICH case, not just that one did.
        expect(
          model
            .filter((one) => one.outcome !== 'PASS')
            .map(
              (one) =>
                `${one.caseId}:${one.outcome}:${one.reason ?? one.providerErrorClass ?? 'none'}`,
            ),
        ).toEqual([]);
        expect([label, model.every((one) => one.networkCalls === 1)]).toEqual([label, true]);
        expect([label, model.every((one) => one.structuredOutputValid)]).toEqual([label, true]);
      }
    }
    // One call per model-required case, per provider. Measured at the wire, not only in the record.
    expect(seams.groqCalls()).toBe(MODEL_REQUIRED_CASES.length);
    expect(seams.naraCalls()).toBe(MODEL_REQUIRED_CASES.length);
    expect(new Set(seams.urls().map((url) => new URL(url).origin))).toEqual(
      new Set(['https://api.groq.com', 'https://router.bynara.id']),
    );
  });

  it('RIYA still reaches the provider on her own dedicated path', async () => {
    // Her reviewed prompt lives only at her dedicated task classes, so this is the proof that the
    // customer arm of the composition still works — not a duplicate of the loop above.
    const { result } = await certify();
    const model = result.cases.filter(
      (one) =>
        one.provider === 'groq' && one.agent === 'RIYA' && one.executionLayer === 'MODEL_REQUIRED',
    );
    expect(model).toHaveLength(RIYA_MODEL_CASES.length);
    expect(model.every((one) => one.outcome === 'PASS')).toBe(true);
  });

  it('an answer that quotes a price FAILS the case rather than passing quietly', async () => {
    // The exact failure the Riya price row exists to catch.
    const { result } = await certify('The price is fixed and we promise delivery next week.');
    const failed = result.cases.filter((one) => one.outcome === 'FAIL');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((one) => one.reason === 'forbidden-claim-asserted')).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forbidden-claim-asserted');
    expect(
      result.manifest?.entries.find((one) => one.provider === 'groq' && one.agent === 'RIYA')
        ?.safety,
    ).toBe('FAIL');
  });
});

describe('JF-5B (3) a result that cannot be told is never rounded up', () => {
  it('the manifest reports PASS for all six pairs when every case passed', async () => {
    const { result } = await certify();
    const verdicts = (result.manifest?.entries ?? [])
      .map((one) => `${one.provider}/${one.agent}:${one.safety}`)
      .sort();
    expect(verdicts).toEqual([
      'groq/AAROHI:PASS',
      'groq/ANISHA:PASS',
      'groq/RIYA:PASS',
      'nara/AAROHI:PASS',
      'nara/ANISHA:PASS',
      'nara/RIYA:PASS',
    ]);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('certified');
  });

  it('a provider that answers with malformed structure is INCONCLUSIVE, never PASS', async () => {
    // The rule the R1 blockers exercised by accident, kept as a rule: "we could not tell" is an
    // answer, and the manifest says it.
    const seams = brokenWire();
    const result = await createJf5bCertificationRunner({
      groqTransport: seams.groq,
      naraTransport: seams.nara,
    }).certifyAllSix({
      naraModelId: NARA_MODEL,
      naraApiKey: NARA_KEY,
      groqApiKey: GROQ_KEY,
      runId: RUN_ID,
      headSha: HEAD,
      ledger: budget(),
    });
    const model = result.cases.filter((one) => one.executionLayer === 'MODEL_REQUIRED');
    expect(model.every((one) => one.outcome === 'INCONCLUSIVE')).toBe(true);
    expect(model.every((one) => !one.structuredOutputValid)).toBe(true);
    expect(result.manifest?.entries.every((one) => one.safety === 'INCONCLUSIVE')).toBe(true);
  });
});

describe('JF-5B (3) the manifest describes the run and authorizes nothing', () => {
  it('carries exactly six entries, one per provider and agent pair', async () => {
    const { result } = await certify();
    expect(result.manifest?.entries).toHaveLength(6);
    expect(result.manifest?.headSha).toBe(HEAD);
    expect(result.manifest?.runId).toBe(RUN_ID);
  });

  it('every entry is REVIEW_PENDING, because no human has read a word of it', async () => {
    const { result } = await certify();
    expect(result.manifest?.entries.every((one) => one.qualityReview === 'REVIEW_PENDING')).toBe(
      true,
    );
  });

  it('contains no production approval, no activation and no seal, anywhere in its bytes', async () => {
    const { result } = await certify();
    const serialized = JSON.stringify(result.manifest);
    // Composed so this scan cannot match its own forbidden list.
    for (const token of [
      ['production', 'Approval'].join(''),
      ['ACTIVE_MODEL', 'RELEASE'].join('_'),
      ['approved', 'ForProduction'].join(''),
    ]) {
      expect([token, serialized.includes(token)]).toEqual([token, false]);
    }
  });

  it('names the Nara posture by its observed retention reference, never as ZDR', async () => {
    const { result } = await certify();
    const refs = result.manifest?.dataControlsRefs ?? [];
    expect(refs.some((ref) => ref.includes('nara'))).toBe(true);
    expect(JSON.stringify(refs).toLowerCase()).not.toContain(['z', 'd', 'r'].join(''));
  });
});

describe('JF-5B (3) the bundles keep content out of the receipt', () => {
  it('a case record carries a DIGEST of the answer, never the answer', async () => {
    const { result } = await certify();
    expect(JSON.stringify(result.cases)).not.toContain(NEUTRAL_BODY);
    const withOutput = result.cases.filter((one) => one.outputDigest !== undefined);
    expect(withOutput).toHaveLength(MODEL_REQUIRED_CASES.length * 2);
    expect(withOutput.every((one) => /^[0-9a-f]{64}$/u.test(one.outputDigest ?? ''))).toBe(true);
  });

  it('the review bundle is blinded: it names no provider', async () => {
    const { result } = await certify();
    const parsed = JSON.parse(result.reviewBundle) as { items: readonly Record<string, unknown>[] };
    expect(parsed.items.length).toBeGreaterThan(0);
    for (const item of parsed.items) {
      expect(Object.keys(item)).not.toContain('provider');
    }
    // A reviewer who could tell which engine answered has already started grading it.
    expect(result.reviewBundle).not.toContain(['"pro', 'vider"'].join(''));
  });

  it('the raw bundle keeps the answers, for the private external directory only', async () => {
    const { result } = await certify();
    expect(result.rawBundle).toContain(NEUTRAL_BODY);
  });
});

describe('JF-5B (4) AUTO routing is measured, not asserted', () => {
  async function route() {
    const seams = wire();
    const routing = await createJf5bCertificationRunner({
      groqTransport: seams.groq,
      naraTransport: seams.nara,
    }).certifyAutoRouting({
      naraModelId: NARA_MODEL,
      naraApiKey: NARA_KEY,
      groqApiKey: GROQ_KEY,
      runId: RUN_ID,
      ledger: budget(),
    });
    return { routing, seams };
  }

  it('a healthy Groq answers in ONE attempt and Nara is never touched', async () => {
    const { routing } = await route();
    expect(routing.ok).toBe(true);
    expect(routing.reason).toBe('routing-certified');
    // The AUTO property that matters most: a working primary never costs a second provider call.
    expect(routing.groqSuccessNaraCalls).toBe(0);
    // Same-provider retry is zero, structurally.
    expect(routing.retryCount).toBe(0);
  });

  it('a forced PRE-NETWORK Groq fault produces exactly two attempts, the second a real Nara call', async () => {
    const { routing, seams } = await route();
    expect(routing.forcedFallbackAttempts).toBe(2);
    expect(routing.forcedFallbackNaraCalls).toBe(1);
    // A class that never becomes a provider attempt cannot be smuggled to the second provider.
    expect(routing.nonFallbackNaraCalls).toBe(0);
    // Three routing cases: the healthy one reaches Groq, the faulted one reaches Nara only, and the
    // refused class reaches neither. So each transport sees exactly ONE request.
    expect(seams.groqCalls()).toBe(1);
    expect(seams.naraCalls()).toBe(1);
  });
});

describe('JF-5B (2c) selection probes every shortlisted alias equally', () => {
  const alias = (modelId: string, contextLength: number) => ({
    modelId,
    reasoning: undefined,
    contextLength,
    modality: undefined,
    capabilities: undefined,
  });

  it('probes every alias with the SAME bounded case set, then ranks', async () => {
    const seams = wire();
    const selected = await createJf5bCertificationRunner({
      groqTransport: seams.groq,
      naraTransport: seams.nara,
    }).selectNaraModel({
      shortlist: [alias('vendor-b/two', 65_536), alias('vendor-a/one', 131_072)],
      apiKey: NARA_KEY,
      runId: RUN_ID,
      ledger: budget(),
    });
    expect(selected.ok).toBe(true);
    // Equal evidence per alias: two aliases, the same two probes each, so the ranking compares like
    // with like rather than ranking on whatever each alias happened to be asked.
    expect(seams.naraCalls()).toBe(4);
    // Groq is not involved in choosing a Nara fallback.
    expect(seams.groqCalls()).toBe(0);
  });

  it('stops rather than naming a fallback no probe could reach', async () => {
    const seams = brokenWire();
    const selected = await createJf5bCertificationRunner({
      groqTransport: seams.groq,
      naraTransport: seams.nara,
    }).selectNaraModel({
      shortlist: [alias('vendor-b/two', 65_536), alias('vendor-a/one', 131_072)],
      apiKey: NARA_KEY,
      runId: RUN_ID,
      ledger: budget(),
    });
    // Nothing passed the hard gates. A winner here would be a fallback chosen on no evidence at all.
    expect(selected).toEqual({ ok: false, reason: 'no-shortlisted-alias-passed-the-hard-gates' });
  });
});
