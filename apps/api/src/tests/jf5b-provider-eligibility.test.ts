/**
 * OFFLINE provider-compatibility proofs for all six provider × agent pairs (JF-5B-R2).
 *
 * ### What this file used to be, and why it changed
 *
 * R1 ran the certification engine for real and found two production defects. This spec pinned both,
 * deliberately written to FAIL once either was lifted. R2 lifted them, so the file now proves the
 * compatibility instead of preserving the breakage — which is the point of writing a blocker pin that
 * fails on repair rather than a comment that outlives it.
 *
 * ### What is real here
 *
 * The real generic reply contract, the real default wire profile, the real Groq strict projector, real
 * `GroqModelProvider` and `NaraModelProvider` instances, the real capability matcher, the real model
 * reply adapter, the real gateway, and the real three-agent composition. Only the two HTTP transports
 * are doubles, and each one RECORDS the body it was handed — so "Groq still sends a strict schema" and
 * "Nara still sends json_object" are measurements of the outgoing request, not of a comment.
 *
 * ### What this is NOT
 *
 * Compatibility, not quality. Nothing here says a model answered well, and nothing here certifies
 * anything: the live run is still the owner's step.
 */
import {
  capabilitiesSatisfy,
  createFetchNaraTransport,
  createGroqApiKey,
  createGroqProviderConfig,
  createNaraApiKey,
  createNaraProviderConfig,
  createSystemClock,
  GroqModelProvider,
  NaraModelProvider,
  projectGroqStrictJsonSchema,
  renderStructuredJsonSchema,
} from '@qf-jarvis/model-gateway';
import type { GroqTransport, NaraTransport } from '@qf-jarvis/model-gateway';
import {
  DEFAULT_STRUCTURED_OUTPUT_PROFILE,
  genericReplyWireSchema,
  structuredReplySchema,
} from '@qf-jarvis/model-reply-adapter';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { casesFor } from '../composition/jf5b-case-corpus.js';
import {
  certificationControlState,
  certificationEnvelope,
  createCertificationRiyaService,
  createCertificationRuntime,
  PARTY_BY_AGENT,
} from '../composition/jf5b-certification-context.js';
import {
  createEvaluationGateway,
  createEvaluationInvoker,
  JF5B_GROQ_MODEL_ID,
} from '../composition/jf5b-certification-runner-impl.js';
import { createRiyaCustomerRuntimeComposition } from '../riya-customer-orchestration/create-riya-customer-runtime.js';
import { createThreeAgentJarvisRuntimeComposition } from '../riya-customer-orchestration/three-agent-runtime.js';

const GROQ_KEY = createGroqApiKey('gsk-synthetic-certification-key-000000');
const NARA_KEY = createNaraApiKey('nara-synthetic-certification-key-0000');
const NARA_MODEL = 'vendor-a/model-one';
const CLOCK = (): string => '2026-09-11T00:00:00Z';

type GroqRequest = Parameters<GroqTransport['send']>[0];
type GroqResponse = Awaited<ReturnType<GroqTransport['send']>>;
type NaraRequest = Parameters<NaraTransport['send']>[0];
type NaraResponse = Awaited<ReturnType<NaraTransport['send']>>;

// ---------------------------------------------------------------------------
// A. The generic wire shape is strict-projectable.
// ---------------------------------------------------------------------------

describe('JF-5B-R2 (A) the generic model-wire shape projects to Groq strict mode', () => {
  const rendered = (): { properties: Record<string, unknown>; required: readonly string[] } =>
    renderStructuredJsonSchema(genericReplyWireSchema) as {
      properties: Record<string, unknown>;
      required: readonly string[];
    };

  it('declares every property REQUIRED, which is what a strict endpoint demands', () => {
    const document = rendered();
    const names = Object.keys(document.properties).sort();
    expect(names).toEqual(['citations', 'kind', 'reasonCode', 'replyBody']);
    // The defect R1 found was exactly this list being shorter than that one.
    expect([...document.required].sort()).toEqual(names);
  });

  it('expresses the two semantically-optional fields as NULLABLE rather than absent', () => {
    const document = rendered();
    for (const field of ['replyBody', 'reasonCode']) {
      const node = document.properties[field] as { anyOf?: readonly { type?: string }[] };
      const types = (node.anyOf ?? []).map((one) => one.type);
      expect([field, types.includes('null')]).toEqual([field, true]);
      expect([field, types.includes('string')]).toEqual([field, true]);
    }
  });

  it('projects successfully, where the old semantic wire shape was refused', () => {
    expect(projectGroqStrictJsonSchema(renderStructuredJsonSchema(genericReplyWireSchema)).ok).toBe(
      true,
    );
    // And the shape the adapter used to send is still refused — the reason the fix was needed.
    expect(projectGroqStrictJsonSchema(renderStructuredJsonSchema(structuredReplySchema))).toEqual({
      ok: false,
      reason: 'malformed-object',
    });
  });

  it('keeps the same bounds as the semantic schema, so nothing is accepted that is later thrown away', () => {
    const tooLong = 'x'.repeat(8193);
    expect(
      genericReplyWireSchema.safeParse({
        kind: 'REPLY',
        replyBody: tooLong,
        reasonCode: null,
        citations: [],
      }).success,
    ).toBe(false);
    expect(
      structuredReplySchema.safeParse({ kind: 'REPLY', replyBody: tooLong, citations: [] }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. The SEMANTIC contract did not move.
// ---------------------------------------------------------------------------

describe('JF-5B-R2 (B) the semantic StructuredReply contract is unchanged', () => {
  const project = (wire: unknown): unknown =>
    DEFAULT_STRUCTURED_OUTPUT_PROFILE.projectStructuredResult(wire)?.reply;

  it('a REPLY keeps its body, and null optional fields become ABSENT keys', () => {
    const reply = project({
      kind: 'REPLY',
      replyBody: 'here is the answer',
      reasonCode: null,
      citations: [],
    }) as Record<string, unknown>;
    expect(Object.keys(reply).sort()).toEqual(['citations', 'kind', 'replyBody']);
    expect('reasonCode' in reply).toBe(false);
    // And what comes out satisfies the base schema, which is what the adapter re-proves against.
    expect(structuredReplySchema.safeParse(reply).success).toBe(true);
  });

  it('a non-REPLY with a null body projects to an ABSENT body', () => {
    for (const kind of ['ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION']) {
      const reply = project({
        kind,
        replyBody: null,
        reasonCode: 'policy.block',
        citations: [],
      }) as Record<string, unknown> | undefined;
      expect([kind, Object.keys(reply ?? {}).sort()]).toEqual([
        kind,
        ['citations', 'kind', 'reasonCode'],
      ]);
      expect([kind, structuredReplySchema.safeParse(reply).success]).toEqual([kind, true]);
    }
  });

  it('a non-REPLY carrying a body is REFUSED, never silently stripped', () => {
    for (const kind of ['ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION']) {
      const projection = DEFAULT_STRUCTURED_OUTPUT_PROFILE.projectStructuredResult({
        kind,
        replyBody: 'I will answer anyway',
        reasonCode: null,
        citations: [],
      });
      // Dropping it would hand the caller a clean escalation and never mention that the model
      // tried to answer.
      expect([kind, projection]).toEqual([kind, undefined]);
    }
  });

  it('a REPLY with a null body is refused', () => {
    expect(
      DEFAULT_STRUCTURED_OUTPUT_PROFILE.projectStructuredResult({
        kind: 'REPLY',
        replyBody: null,
        reasonCode: null,
        citations: [],
      }),
    ).toBeUndefined();
  });

  it('a malformed reason code is refused rather than normalised to absence', () => {
    expect(
      DEFAULT_STRUCTURED_OUTPUT_PROFILE.projectStructuredResult({
        kind: 'REPLY',
        replyBody: 'ok',
        reasonCode: 'not a valid identifier!',
        citations: [],
      }),
    ).toBeUndefined();
  });

  it('an extra key is refused, and citations cross verbatim under the same strict rules', () => {
    expect(
      DEFAULT_STRUCTURED_OUTPUT_PROFILE.projectStructuredResult({
        kind: 'REPLY',
        replyBody: 'ok',
        reasonCode: null,
        citations: [],
        reasoning: 'chain of thought',
      }),
    ).toBeUndefined();
    const withCitations = project({
      kind: 'REPLY',
      replyBody: 'ok',
      reasonCode: null,
      citations: [{ knowledgeId: 'kb.fact', version: 2 }],
    }) as { citations: readonly unknown[] };
    expect(withCitations.citations).toEqual([{ knowledgeId: 'kb.fact', version: 2 }]);
    // A citation with an extra key is refused exactly as it always was.
    expect(
      DEFAULT_STRUCTURED_OUTPUT_PROFILE.projectStructuredResult({
        kind: 'REPLY',
        replyBody: 'ok',
        reasonCode: null,
        citations: [{ knowledgeId: 'kb.fact', version: 2, source: 'invented' }],
      }),
    ).toBeUndefined();
  });

  it('the default profile asks the same user message the no-profile path always did', () => {
    const plan = { normalizedText: 'a question about what you offer' } as never;
    expect(DEFAULT_STRUCTURED_OUTPUT_PROFILE.buildUserContent(plan)).toBe(
      'a question about what you offer',
    );
    expect(DEFAULT_STRUCTURED_OUTPUT_PROFILE.buildUserContent({} as never)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// C. The minimum capability requirement.
// ---------------------------------------------------------------------------

describe('JF-5B-R2 (C) a structured reply requires structured output, not native strict schema', () => {
  const groqCapabilities = () =>
    createGroqProviderConfig({
      providerId: 'groq',
      modelId: JF5B_GROQ_MODEL_ID,
      modelVersion: 'certification-snapshot-2026-09-11',
      executionClass: 'HOSTED',
      maxInputTokens: 16_384,
      maxCompletionTokens: 4_096,
      supportsStrictJsonSchema: true,
      apiKey: GROQ_KEY,
      transport: { send: () => Promise.reject(new Error('unused')) },
      dataControlsAttested: true,
    }).capabilities;

  const naraCapabilities = () =>
    createNaraProviderConfig({
      providerId: 'nara',
      modelId: NARA_MODEL,
      modelVersion: 'certification-snapshot-2026-09-11',
      executionClass: 'HOSTED',
      maxInputTokens: 16_384,
      maxCompletionTokens: 4_096,
      apiKey: NARA_KEY,
      transport: createFetchNaraTransport(),
      dataControlsAttested: true,
    }).capabilities;

  /** Exactly what `build-gateway-request.ts` now puts on every reply request it builds. */
  const REQUIRED = Object.freeze({
    structuredOutput: true,
    strictJsonSchema: false,
    cancellation: false,
    minContextTokens: 1,
  });

  it('`false` means NOT REQUIRED: a strict-capable provider still satisfies it', () => {
    expect(groqCapabilities().supportsStrictJsonSchema).toBe(true);
    expect(capabilitiesSatisfy(groqCapabilities(), REQUIRED)).toBe(true);
  });

  it('a structured-but-not-natively-strict provider now satisfies it', () => {
    expect(naraCapabilities().supportsStructuredOutput).toBe(true);
    expect(capabilitiesSatisfy(naraCapabilities(), REQUIRED)).toBe(true);
  });

  it('Nara still truthfully declares NO native strict JSON-Schema support', () => {
    // The capability requirement moved. The provider descriptor did not, and must not: raising it
    // needs live evidence from the endpoint itself, which no lane has gathered.
    expect(naraCapabilities().supportsStrictJsonSchema).toBe(false);
    // Demanding it still excludes Nara, which is what makes the lowered requirement the actual fix.
    expect(capabilitiesSatisfy(naraCapabilities(), { ...REQUIRED, strictJsonSchema: true })).toBe(
      false,
    );
  });

  it('structured output is still REQUIRED: an unstructured provider is refused', () => {
    // The Nara descriptor with ONE field flipped, so the only thing being tested is that field.
    const unstructured = { ...naraCapabilities(), supportsStructuredOutput: false };
    expect(capabilitiesSatisfy(unstructured, REQUIRED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. What each provider actually puts on the wire.
// ---------------------------------------------------------------------------

const NEUTRAL_BODY = 'noted, the team will confirm';

/**
 * The answer a well-behaved provider would give for the shape it was ASKED for.
 *
 * A strict endpoint is handed the schema and answers from it. A `json_object` endpoint is not, and a
 * real model there answers from the SYSTEM PROMPT — so the double does the same rather than assuming
 * a schema it was never sent. Without this, Riya's Nara column would look broken when what was really
 * broken was the fake.
 */
function answerFor(body: string): string {
  const parsed = JSON.parse(body) as {
    response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } };
    messages?: readonly { readonly role: string; readonly content: string }[];
  };
  const properties = parsed.response_format?.json_schema?.schema?.properties ?? {};
  const system = parsed.messages?.find((one) => one.role === 'system')?.content ?? '';
  const wantsEvolution =
    Object.prototype.hasOwnProperty.call(properties, 'evolution') ||
    system.startsWith('You are Riya,');
  if (wantsEvolution) {
    return JSON.stringify({
      reply: { kind: 'REPLY', replyBody: NEUTRAL_BODY, reasonCode: null, citations: [] },
      evolution: {
        version: 1,
        observations: { sets: [], clears: [] },
        skipProjectDetails: false,
        questionPlan: { phase: 'NEED', questionFields: [] },
      },
    });
  }
  return JSON.stringify({
    kind: 'REPLY',
    replyBody: NEUTRAL_BODY,
    reasonCode: null,
    citations: [],
  });
}

/** A Groq transport that records the outgoing body and answers with a valid reply for that shape. */
function recordingGroq(content?: string): {
  readonly transport: GroqTransport;
  readonly bodies: () => readonly string[];
} {
  const bodies: string[] = [];
  return {
    bodies: () => bodies,
    transport: {
      send(request: GroqRequest): Promise<GroqResponse> {
        bodies.push(request.body);
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: JSON.stringify({
            id: 'chatcmpl-eligibility',
            model: 'synthetic',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: content ?? answerFor(request.body) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        });
      },
    },
  };
}

/** The Nara twin. Same recorded body, same answer shape. */
function recordingNara(content?: string): {
  readonly transport: NaraTransport;
  readonly bodies: () => readonly string[];
} {
  const inner = recordingGroq(content);
  return {
    bodies: inner.bodies,
    transport: {
      send(request: NaraRequest): Promise<NaraResponse> {
        return inner.transport.send(request, new AbortController().signal);
      },
    },
  };
}

/**
 * Run ONE governed case for one provider and one agent, through the real composition.
 *
 * The same two arms the certification engine uses: Anisha and Aarohi through the internal agent turn,
 * Riya through her customer runtime. Both traverse the same Mastra workflow.
 */
interface OneTurn {
  /**
   * The GATEWAY accepted the provider's structured answer: it validated against the exact request
   * schema, and the adapter received a response rather than a refusal.
   *
   * This is what provider ELIGIBILITY means, and it is the strongest thing a compatibility proof may
   * claim. What an agent then does with a valid answer — Riya cross-checks the plan it names against
   * the plan her domain decided — is that agent's own contract, proved by that agent's own specs, and
   * asserting it here would make this file depend on a test double guessing domain state correctly.
   */
  readonly gatewayAccepted: boolean;
  /** True when the whole governed turn also produced a draft. Asserted for the generic path. */
  readonly modelDrafted: boolean;
  readonly outcome: string;
}

async function runOne(
  provider: 'groq' | 'nara',
  agent: 'RIYA' | 'ANISHA' | 'AAROHI',
  seams: { readonly groqTransport?: GroqTransport; readonly naraTransport?: NaraTransport },
): Promise<OneTurn> {
  const governed = casesFor(agent).find((one) => one.layer === 'MODEL_REQUIRED');
  if (governed === undefined) {
    throw new Error('no model-required case');
  }
  const gateway = createEvaluationGateway(provider === 'groq' ? 'GROQ_ONLY' : 'NARA_ONLY', {
    ...(provider === 'groq'
      ? { groqApiKey: GROQ_KEY }
      : { naraApiKey: NARA_KEY, naraModelId: NARA_MODEL }),
    ...seams,
  });
  const conversationId = `conv.eligibility.${provider}.${agent}`;
  const state = certificationControlState({
    conversationId,
    partyType: PARTY_BY_AGENT[agent],
    dataClass: 'HOSTED_ALLOWED',
  });
  // The real invoker, wrapped so gateway acceptance is MEASURED rather than inferred from a later
  // gate's verdict. It delegates once and changes nothing.
  const inner = createEvaluationInvoker(gateway);
  const accepted = { ok: false };
  const invoker = {
    async invoke(request: Parameters<typeof inner.invoke>[0]) {
      const result = await inner.invoke(request);
      accepted.ok = result.ok;
      return result;
    },
  };
  const runtime = createCertificationRuntime({
    agent,
    invoker,
    state: () => state,
    release: {
      releaseId: `rel.jf5b.${provider}.1`,
      providerId: provider,
      modelId: provider === 'groq' ? JF5B_GROQ_MODEL_ID : NARA_MODEL,
      modelVersion: 'certification-snapshot-2026-09-11',
      configDigest: 'abcdef0123456789',
      executionClass: 'HOSTED',
    },
    clock: CLOCK,
  });
  const riya = createRiyaCustomerRuntimeComposition({
    conversationService: createCertificationRiyaService(runtime),
  });
  const composition = createThreeAgentJarvisRuntimeComposition({
    riyaCustomerRuntime: riya.customerTurnRunner,
    jarvisRuntime: runtime,
  });

  if (agent === 'RIYA') {
    const result = await composition.riyaCustomerRuntime.handleConversationTurn({
      version: 1,
      channel: 'WEB',
      tenantId: 'tenant.synthetic.jf5b',
      conversationId,
      messageId: `msg.eligibility.${provider}`,
      receivedAt: '2026-09-11T00:00:00Z',
      channelTurnRef: `web.eligibility.${provider}`,
      dataClass: 'HOSTED_ALLOWED',
      normalizedText: governed.text,
    });
    return {
      gatewayAccepted: accepted.ok,
      modelDrafted: result.authorizedReply !== undefined,
      outcome: result.disposition,
    };
  }
  const result = (await composition.internalAgentTurnRunner.handleAgentTurn(
    certificationEnvelope({
      agent,
      conversationId,
      messageId: `msg.eligibility.${provider}`,
      text: governed.text,
      dataClass: 'HOSTED_ALLOWED',
      receivedAt: '2026-09-11T00:00:00Z',
    }),
  )) as { readonly modelDrafted: boolean; readonly outcome: string };
  return {
    gatewayAccepted: accepted.ok,
    modelDrafted: result.modelDrafted,
    outcome: result.outcome,
  };
}

describe('JF-5B-R2 (D) lowering the requirement did not lower either provider wire guarantee', () => {
  it('GROQ still sends provider-native STRICT JSON Schema, and reaches the transport once', async () => {
    const groq = recordingGroq();
    const run = await runOne('groq', 'ANISHA', { groqTransport: groq.transport });
    expect(run.modelDrafted).toBe(true);
    // ONE request, and no malformed-object refusal before transport.
    expect(groq.bodies()).toHaveLength(1);
    const body = JSON.parse(groq.bodies()[0] ?? '{}') as {
      response_format?: {
        type?: string;
        json_schema?: { strict?: boolean; schema?: { required?: readonly string[] } };
      };
    };
    expect(body.response_format?.type).toBe('json_schema');
    expect(body.response_format?.json_schema?.strict).toBe(true);
    // The minimum REQUIREMENT says strict is not required; the selected provider's own capability
    // says it has it. Those are different concepts, and this is the line that locks the distinction.
    expect([...(body.response_format?.json_schema?.schema?.required ?? [])].sort()).toEqual([
      'citations',
      'kind',
      'reasonCode',
      'replyBody',
    ]);
  });

  it('NARA still sends json_object, and preserves the exact model id', async () => {
    const nara = recordingNara();
    const run = await runOne('nara', 'ANISHA', { naraTransport: nara.transport });
    expect(run.modelDrafted).toBe(true);
    expect(nara.bodies()).toHaveLength(1);
    const body = JSON.parse(nara.bodies()[0] ?? '{}') as {
      model?: string;
      response_format?: { type?: string; json_schema?: unknown };
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
    // No schema is claimed on the wire, because the provider does not declare strict support.
    expect(body.response_format?.json_schema).toBeUndefined();
    expect(body.model).toBe(NARA_MODEL);
  });

  it('BOTH providers are held to the same exact request schema after the call', async () => {
    // Malformed JSON.
    for (const [provider, seams] of [
      ['groq', { groqTransport: recordingGroq('not json at all').transport }],
      ['nara', { naraTransport: recordingNara('not json at all').transport }],
    ] as const) {
      const run = await runOne(provider, 'ANISHA', seams);
      expect([provider, 'malformed', run.modelDrafted]).toEqual([provider, 'malformed', false]);
    }
    // Well-formed JSON the schema refuses: an extra key.
    const extra = JSON.stringify({
      kind: 'REPLY',
      replyBody: 'ok',
      reasonCode: null,
      citations: [],
      reasoning: 'chain of thought',
    });
    for (const [provider, seams] of [
      ['groq', { groqTransport: recordingGroq(extra).transport }],
      ['nara', { naraTransport: recordingNara(extra).transport }],
    ] as const) {
      const run = await runOne(provider, 'ANISHA', seams);
      expect([provider, 'extra-key', run.modelDrafted]).toEqual([provider, 'extra-key', false]);
    }
    // A non-REPLY carrying a body — refused by the projection, on both providers alike.
    const nonReplyWithBody = JSON.stringify({
      kind: 'NO_ACTION',
      replyBody: 'I will answer anyway',
      reasonCode: null,
      citations: [],
    });
    for (const [provider, seams] of [
      ['groq', { groqTransport: recordingGroq(nonReplyWithBody).transport }],
      ['nara', { naraTransport: recordingNara(nonReplyWithBody).transport }],
    ] as const) {
      const run = await runOne(provider, 'ANISHA', seams);
      expect([provider, 'non-reply-body', run.modelDrafted]).toEqual([
        provider,
        'non-reply-body',
        false,
      ]);
    }
  });

  it('there is no provider name anywhere in the reply adapter', async () => {
    // The adapter states what it NEEDS; the provider decides how it meets it. A special case here
    // would be a second provider router hiding inside an agent-facing package.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const readFileSync = (file: string): string => fs.readFileSync(file, 'utf8');
    const readdirSync = (dir: string): readonly string[] => fs.readdirSync(dir);
    const isDirectory = (entry: string): boolean => fs.statSync(entry).isDirectory();
    const join = (a: string, b: string): string => path.join(a, b);
    const fileURLToPath = (value: URL): string => url.fileURLToPath(value);
    const root = fileURLToPath(
      new URL('../../../../packages/model-reply-adapter/src', import.meta.url),
    );
    const walk = (dir: string): string[] =>
      [...readdirSync(dir)].flatMap((entry) => {
        const full = join(dir, entry);
        return isDirectory(full) ? walk(full) : full.endsWith('.ts') ? [full] : [];
      });
    for (const file of walk(root)) {
      if (file.replace(/\\/gu, '/').includes('/tests/')) {
        continue;
      }
      const code = readFileSync(file)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//u.test(line))
        .join('\n')
        .toLowerCase();
      for (const name of ['groq', 'nara']) {
        expect({ file: file.split(/[\\/]/u).pop(), name, present: code.includes(name) }).toEqual({
          file: file.split(/[\\/]/u).pop(),
          name,
          present: false,
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// E. The six-pair offline eligibility matrix.
// ---------------------------------------------------------------------------

describe('JF-5B-R2 (E) all six provider x agent pairs are offline-eligible', () => {
  for (const provider of ['groq', 'nara'] as const) {
    for (const agent of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
      it(`${provider} x ${agent} reaches the provider and its answer is accepted`, async () => {
        const groq = recordingGroq();
        const nara = recordingNara();
        const run = await runOne(provider, agent, {
          groqTransport: groq.transport,
          naraTransport: nara.transport,
        });
        const label = `${provider}/${agent}`;
        // The governed turn reached the gateway, the gateway reached the provider, and the provider's
        // structured answer validated against this exact request's schema.
        expect([label, run.gatewayAccepted]).toEqual([label, true]);
        // Exactly one request, to the provider under test and to no other.
        const [used, unused] = provider === 'groq' ? [groq, nara] : [nara, groq];
        expect([label, used.bodies().length]).toEqual([label, 1]);
        expect([label, unused.bodies().length]).toEqual([label, 0]);
        // The generic path — the one this correction is about — also completes end to end.
        if (agent !== 'RIYA') {
          expect([label, run.modelDrafted, run.outcome]).toEqual([label, true, 'CORE_ACCEPTED']);
        }
      });
    }
  }

  it('a provider adapter constructed for one agent is not constructed per agent', () => {
    // One generic fix, not three. Anisha and Aarohi share the SAME default wire profile, and Riya's
    // configured profile is what makes her different — not a second copy of this one.
    expect(DEFAULT_STRUCTURED_OUTPUT_PROFILE.structuredSchema).toBe(genericReplyWireSchema);
  });

  it('a clock-driven provider instance is still bounded by its own config, not by the agent', () => {
    // Guards the shape of the fix: provider capability is a PROVIDER decision. Two providers built
    // from the same config for two different agents are identical.
    const clock = createSystemClock();
    const config = {
      providerId: 'nara' as const,
      modelId: NARA_MODEL,
      modelVersion: 'certification-snapshot-2026-09-11',
      executionClass: 'HOSTED' as const,
      maxInputTokens: 16_384,
      maxCompletionTokens: 4_096,
      apiKey: NARA_KEY,
      transport: createFetchNaraTransport(),
      dataControlsAttested: true,
    };
    const first = new NaraModelProvider(createNaraProviderConfig(config), clock);
    const second = new NaraModelProvider(createNaraProviderConfig(config), clock);
    expect(first.capabilities()).toEqual(second.capabilities());
    expect(first.capabilities().supportsStrictJsonSchema).toBe(false);
    // And the Groq twin keeps its stronger capability, from its own config.
    const groq = new GroqModelProvider(
      createGroqProviderConfig({
        providerId: 'groq',
        modelId: JF5B_GROQ_MODEL_ID,
        modelVersion: 'certification-snapshot-2026-09-11',
        executionClass: 'HOSTED',
        maxInputTokens: 16_384,
        maxCompletionTokens: 4_096,
        supportsStrictJsonSchema: true,
        apiKey: GROQ_KEY,
        transport: { send: () => Promise.reject(new Error('unused')) },
        dataControlsAttested: true,
      }),
      clock,
    );
    expect(groq.capabilities().supportsStrictJsonSchema).toBe(true);
  });
});

describe('JF-5B-R2 (F) the evaluation gateway crosses providers only under AUTO', () => {
  /**
   * A SOURCE lock, and a mutation control is why.
   *
   * Changing `allowFallback: posture === 'AUTO'` to `allowFallback: true` breaks no behavioural spec,
   * because a single-provider gateway has no second provider to fall back TO — the flag would sit
   * there, harmless today, and become a silent cross-provider call the moment a second provider was
   * registered for a posture that is supposed to have one. The rule is about the CONSTRUCTION, so the
   * construction is what is asserted.
   *
   * R2 is when this matters most: before it, Nara was ineligible for every reply request, so a
   * cross-provider call could not have happened by accident. Now it can.
   */
  const runner = readFileSync(
    fileURLToPath(new URL('../composition/jf5b-certification-runner-impl.ts', import.meta.url)),
    'utf8',
  );

  it('binds the fallback flag to the posture, and never to a constant', () => {
    expect(runner.match(/allowFallback:/gu)).toHaveLength(1);
    expect(runner).toContain("allowFallback: posture === 'AUTO'");
    expect(runner).not.toMatch(/allowFallback:\s*true/u);
  });

  it('leaves the retry budget alone, because the adapter already pins it to zero', () => {
    // A retry budget here would be a second opinion about retries, and the first one is the contract.
    expect(runner).not.toMatch(/retryBudget\s*:\s*[1-9]/u);
    expect(runner).not.toMatch(/maxAttempts\s*:\s*[2-9]/u);
  });
});
