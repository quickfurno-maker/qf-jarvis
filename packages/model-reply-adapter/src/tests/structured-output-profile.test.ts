/**
 * QFJ-M4 — the optional structured-output profile seam (ADR-0099 §33).
 *
 * A profile lets ONE caller ask the model's single structured answer to carry more than a reply,
 * without a second inference. These specs pin the two halves of that bargain:
 *
 * - **The default path did not move.** With no profile configured, the request bytes, the schema, the
 *   user message and the result's own keys are exactly what they were before this seam existed. That
 *   is asserted rather than assumed, because "optional" is only true if absence changes nothing.
 * - **A profile chooses the shape of the question and the answer, and nothing else.** It cannot touch
 *   the system prompt, cannot widen what counts as a reply, cannot bypass a citation check or either
 *   state gate, cannot cause a second gateway call, and cannot leak a raw provider value.
 *
 * Nothing here is Riya-specific: the profiles below are synthetic and the companion containment spec
 * proves this package names no Riya concept at all.
 */
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import { structuredReplySchema } from '../contracts/reply-schema.js';
import type { StructuredReply } from '../contracts/reply-schema.js';
import type { ModelReplyStructuredOutputProfile } from '../contracts/structured-output-profile.js';
import type {
  ModelGatewayInvocation,
  ModelGatewayInvoker,
} from '../gateway/model-gateway-invoker.js';
import {
  clearReplyState,
  fixedClock,
  replyPlan,
  scriptedReplyStateReader,
  structuredReply,
  syntheticPromptDefinition,
  syntheticRelease,
} from '../testing/index.js';

const M4_PROMPT = syntheticPromptDefinition();

/**
 * A gateway invoker that RECORDS the request it was handed.
 *
 * Local to this spec rather than added to the shipped `./testing` subpath: a recorder exists to prove
 * what the adapter asked for, and that is a question only these specs ask.
 */
function recordingInvoker(structuredResult: unknown): ModelGatewayInvoker & {
  invoked(): number;
  request(): ModelRequest | undefined;
} {
  let n = 0;
  let seen: ModelRequest | undefined;
  return {
    invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
      n += 1;
      seen = request;
      const md = request.metadata;
      const response: ModelResponse = {
        runId: request.runId,
        resultMode: 'STRUCTURED',
        structuredResult,
        provenance: {
          runId: request.runId,
          purpose: request.purpose,
          providerId: String(md['providerId']),
          modelId: String(md['modelId']),
          modelVersion: String(md['modelVersion']),
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          promptDigest: request.promptDigest,
          mode: 'ACTIVE',
          usedFallback: false,
          attempts: 1,
        },
        usage: { outputTokens: 42, inputTokens: 10, totalTokens: 52 },
        latencyMs: 5,
        finishStatus: 'completed',
      };
      return Promise.resolve({ ok: true, response });
    },
    invoked: () => n,
    request: () => seen,
  };
}

function adapterWith(
  invoker: ModelGatewayInvoker,
  profile?: ModelReplyStructuredOutputProfile,
  over: Partial<ModelReplyAdapterConfig> = {},
) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    promptRegistry: createPromptRegistry([M4_PROMPT]),
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    evaluationPromptDigest: M4_PROMPT.contentDigest,
    stateReader: scriptedReplyStateReader(clearReplyState(), clearReplyState()),
    clock: fixedClock(),
    invoker,
    ...(profile === undefined ? {} : { structuredOutputProfile: profile }),
    ...over,
  };
  return createModelReplyAdapter(config);
}

// ---------------------------------------------------------------------------
// A synthetic profile. Deliberately domain-free: a "note" beside a reply.
// ---------------------------------------------------------------------------

const SYNTHETIC_SCHEMA = z
  .object({
    reply: structuredReplySchema,
    note: z.string().min(1).max(64),
  })
  .strict();

const PROFILE_USER_CONTENT = 'SYNTHETIC-PROFILE-USER-CONTENT-9c4a';

/**
 * Narrow a parsed reply to the exact-optional `StructuredReply`.
 *
 * Zod infers `replyBody?: string | undefined`, which `exactOptionalPropertyTypes` refuses to accept
 * for `replyBody?: string`. Omitting the key is the honest fix — a present key holding `undefined`
 * is a different object, and the adapter's own result builder makes the same distinction.
 */
function asReply(parsed: z.infer<typeof structuredReplySchema>): StructuredReply {
  return {
    kind: parsed.kind,
    ...(parsed.replyBody === undefined ? {} : { replyBody: parsed.replyBody }),
    ...(parsed.reasonCode === undefined ? {} : { reasonCode: parsed.reasonCode }),
    citations: parsed.citations,
  };
}

function syntheticProfile(
  over: Partial<ModelReplyStructuredOutputProfile> = {},
): ModelReplyStructuredOutputProfile {
  return {
    structuredSchema: SYNTHETIC_SCHEMA,
    buildUserContent: () => PROFILE_USER_CONTENT,
    projectStructuredResult: (value: unknown) => {
      const parsed = SYNTHETIC_SCHEMA.safeParse(value);
      if (!parsed.success) {
        return undefined;
      }
      return { reply: asReply(parsed.data.reply), detail: { note: parsed.data.note } };
    },
    ...over,
  };
}

const validProfileAnswer = (): unknown => ({ reply: structuredReply(), note: 'synthetic-note' });

// ---------------------------------------------------------------------------
// The DEFAULT path: absence changes nothing.
// ---------------------------------------------------------------------------

describe('no profile: the path this package always had', () => {
  it('uses the base structuredReplySchema in the request', async () => {
    const invoker = recordingInvoker(structuredReply());
    await adapterWith(invoker).draftReplyDetailed(replyPlan());
    expect(invoker.request()?.structuredSchema).toBe(structuredReplySchema);
  });

  it('the one user message is the plan normalizedText, verbatim', async () => {
    const invoker = recordingInvoker(structuredReply());
    await adapterWith(invoker).draftReplyDetailed(replyPlan({ normalizedText: 'exactly this' }));
    const messages = invoker.request()?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toStrictEqual({ role: 'user', content: 'exactly this' });
  });

  it('an absent normalizedText is still the empty string, not a fabricated prompt', async () => {
    const invoker = recordingInvoker(structuredReply());
    const plan = replyPlan();
    const { normalizedText: _dropped, ...withoutText } = plan;
    await adapterWith(invoker).draftReplyDetailed(withoutText as typeof plan);
    expect(invoker.request()?.messages[1]?.content).toBe('');
  });

  it('the result carries its exact original keys — profileDetail is ABSENT, not undefined', async () => {
    const result = await adapterWith(recordingInvoker(structuredReply())).draftReplyDetailed(
      replyPlan(),
    );
    expect(result.ok).toBe(true);
    // `in` rather than `=== undefined`: an own key holding `undefined` would change the shape a
    // caller sees from `Object.keys`, from a spread, and from JSON.
    expect('profileDetail' in result).toBe(false);
    expect(Object.keys(result).sort()).toStrictEqual([
      'draft',
      'gatewayInvoked',
      'kind',
      'latencyMs',
      'ok',
      'outputTokens',
      'provenance',
      'reason',
      'structuredReply',
    ]);
  });

  it('invokes the gateway at most once', async () => {
    const invoker = recordingInvoker(structuredReply());
    await adapterWith(invoker).draftReplyDetailed(replyPlan());
    expect(invoker.invoked()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The PROFILE path: what it may change.
// ---------------------------------------------------------------------------

describe('a profile chooses the shape of the question and the answer', () => {
  it("the profile's schema reaches the request, and the base schema does not", async () => {
    const invoker = recordingInvoker(validProfileAnswer());
    await adapterWith(invoker, syntheticProfile()).draftReplyDetailed(replyPlan());
    expect(invoker.request()?.structuredSchema).toBe(SYNTHETIC_SCHEMA);
    expect(invoker.request()?.structuredSchema).not.toBe(structuredReplySchema);
  });

  it("the profile's content is the ONE user message, and the plan text does not also appear", async () => {
    const invoker = recordingInvoker(validProfileAnswer());
    await adapterWith(invoker, syntheticProfile()).draftReplyDetailed(
      replyPlan({ normalizedText: 'RAW-CLIENT-SENTENCE' }),
    );
    const messages = invoker.request()?.messages ?? [];
    // Still exactly two messages. A profile adds material to the ONE user turn; it never adds turns.
    expect(messages).toHaveLength(2);
    expect(messages[1]).toStrictEqual({ role: 'user', content: PROFILE_USER_CONTENT });
    expect(messages[1]?.content).not.toContain('RAW-CLIENT-SENTENCE');
  });

  it('the system message stays the resolved prompt bytes, and the digest is unchanged', async () => {
    const withProfile = recordingInvoker(validProfileAnswer());
    const without = recordingInvoker(structuredReply());
    await adapterWith(withProfile, syntheticProfile()).draftReplyDetailed(replyPlan());
    await adapterWith(without).draftReplyDetailed(replyPlan());

    // Byte-identical system content, and the same prompt-content digest binds both requests. A
    // profile that could prepend a policy line would silently invalidate every prompt evaluation.
    expect(withProfile.request()?.messages[0]?.content).toBe(M4_PROMPT.systemTemplate);
    expect(withProfile.request()?.messages[0]?.content).toBe(
      without.request()?.messages[0]?.content,
    );
    expect(withProfile.request()?.promptDigest).toBe(M4_PROMPT.contentDigest);
    expect(withProfile.request()?.promptDigest).toBe(without.request()?.promptDigest);
    expect(withProfile.request()?.metadata['promptDigest']).toBe(
      without.request()?.metadata['promptDigest'],
    );
  });

  it('everything except the user content and schema is identical to the default request', async () => {
    const withProfile = recordingInvoker(validProfileAnswer());
    const without = recordingInvoker(structuredReply());
    await adapterWith(withProfile, syntheticProfile()).draftReplyDetailed(replyPlan());
    await adapterWith(without).draftReplyDetailed(replyPlan());

    const strip = (r: ModelRequest | undefined): unknown => {
      if (r === undefined) {
        throw new Error('no request was recorded');
      }
      const { messages: _m, structuredSchema: _s, ...rest } = r;
      return rest;
    };
    expect(strip(withProfile.request())).toStrictEqual(strip(without.request()));
  });

  it('the projected reply is RE-PROVED against the base schema', async () => {
    // A projection that returns something the strict reply schema refuses is refused, even though the
    // profile's own schema accepted the provider's answer. The profile chooses the shape of the
    // answer; it does not get to decide what counts as a reply.
    const widening = syntheticProfile({
      projectStructuredResult: () =>
        ({
          reply: { kind: 'REPLY', replyBody: 'x', citations: [], sendNow: true },
          detail: undefined,
        }) as never,
    });
    const result = await adapterWith(
      recordingInvoker(validProfileAnswer()),
      widening,
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-structured-output-invalid');
  });

  it('citations are still authorized exactly, with no silent drop', async () => {
    const unauthorized = syntheticProfile({
      projectStructuredResult: () => ({
        reply: {
          kind: 'REPLY',
          replyBody: 'x',
          citations: [{ knowledgeId: 'kb.not-in-plan', version: 9 }],
        },
      }),
    });
    const result = await adapterWith(
      recordingInvoker(validProfileAnswer()),
      unauthorized,
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-citation-mismatch');
  });

  it('a profile that refuses is model-structured-output-invalid', async () => {
    const refusing = syntheticProfile({ projectStructuredResult: () => undefined });
    const result = await adapterWith(
      recordingInvoker(validProfileAnswer()),
      refusing,
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-structured-output-invalid');
  });

  it('a profile that THROWS while projecting is treated exactly as one that refused', async () => {
    const throwing = syntheticProfile({
      projectStructuredResult: () => {
        throw new Error('provider said {"apiKey":"sk-live-leak"}');
      },
    });
    const result = await adapterWith(
      recordingInvoker(validProfileAnswer()),
      throwing,
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-structured-output-invalid');
    // No raw error, and nothing it carried, escapes.
    expect(JSON.stringify(result)).not.toContain('sk-live-leak');
  });

  it('a profile that throws while BUILDING the request fails closed before the gateway', async () => {
    const throwing = syntheticProfile({
      buildUserContent: () => {
        throw new Error('bound exceeded');
      },
    });
    const invoker = recordingInvoker(validProfileAnswer());
    const result = await adapterWith(invoker, throwing).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-plan-invalid');
    // A half-built request is never sent.
    expect(invoker.invoked()).toBe(0);
    expect(result.gatewayInvoked).toBe(false);
  });

  it('a profile still costs exactly one gateway invocation', async () => {
    const invoker = recordingInvoker(validProfileAnswer());
    await adapterWith(invoker, syntheticProfile()).draftReplyDetailed(replyPlan());
    expect(invoker.invoked()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The detail: when it exists, and what it may contain.
// ---------------------------------------------------------------------------

describe("the profile's detail rides only on a fully accepted result", () => {
  it('a fully accepted result carries exactly the detail the profile validated', async () => {
    const result = await adapterWith(
      recordingInvoker(validProfileAnswer()),
      syntheticProfile(),
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(true);
    expect(result.profileDetail).toStrictEqual({ note: 'synthetic-note' });
    // And the ordinary reply is unaffected: a profile adds, it does not substitute.
    expect(result.kind).toBe('REPLY');
    expect(result.draft?.replyBody).toBe(structuredReply().replyBody);
  });

  it('the extra material the profile did NOT project cannot escape', async () => {
    // The provider answered with a field the profile's schema strips. Nothing downstream sees it.
    const invoker = recordingInvoker({
      reply: structuredReply(),
      note: 'synthetic-note',
    });
    const dropping = syntheticProfile({
      projectStructuredResult: (value: unknown) => {
        const parsed = SYNTHETIC_SCHEMA.safeParse(value);
        return parsed.success ? { reply: asReply(parsed.data.reply) } : undefined;
      },
    });
    const result = await adapterWith(invoker, dropping).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(true);
    expect('profileDetail' in result).toBe(false);
  });

  it('no raw provider response reaches the detail', async () => {
    const raw = { reply: structuredReply(), note: 'synthetic-note' };
    const result = await adapterWith(recordingInvoker(raw), syntheticProfile()).draftReplyDetailed(
      replyPlan(),
    );
    const serialized = JSON.stringify(result.profileDetail);
    for (const forbidden of ['provenance', 'usage', 'finishStatus', 'latencyMs', 'runId']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  const refusals: {
    readonly label: string;
    readonly build: () => ReturnType<typeof adapterWith>;
    readonly plan?: Parameters<typeof replyPlan>[0];
  }[] = [
    {
      label: 'a pre-gateway state block',
      build: () =>
        adapterWith(recordingInvoker(validProfileAnswer()), syntheticProfile(), {
          stateReader: scriptedReplyStateReader(
            { ...clearReplyState(), humanTakeover: true },
            clearReplyState(),
          ),
        }),
    },
    {
      label: 'a post-gateway state block',
      build: () =>
        adapterWith(recordingInvoker(validProfileAnswer()), syntheticProfile(), {
          stateReader: scriptedReplyStateReader(clearReplyState(), {
            ...clearReplyState(),
            humanTakeover: true,
          }),
        }),
    },
    {
      label: 'an invalid structured answer',
      build: () => adapterWith(recordingInvoker({ nope: true }), syntheticProfile()),
    },
    {
      label: 'a citation mismatch',
      build: () =>
        adapterWith(
          recordingInvoker(validProfileAnswer()),
          syntheticProfile({
            projectStructuredResult: () => ({
              reply: {
                kind: 'REPLY',
                replyBody: 'x',
                citations: [{ knowledgeId: 'kb.not-in-plan', version: 9 }],
              },
              detail: { note: 'should never surface' },
            }),
          }),
        ),
    },
  ];
  for (const { label, build } of refusals) {
    it(`${label} carries no detail`, async () => {
      const result = await build().draftReplyDetailed(replyPlan());
      expect(result.ok).toBe(false);
      // Detail beside a refusal would be material extracted from an answer the adapter had already
      // decided not to trust.
      expect('profileDetail' in result).toBe(false);
      expect(JSON.stringify(result)).not.toContain('should never surface');
    });
  }

  it('a provenance mismatch carries no detail', async () => {
    const invoker: ModelGatewayInvoker = {
      invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
        const md = request.metadata;
        return Promise.resolve({
          ok: true,
          response: {
            runId: request.runId,
            resultMode: 'STRUCTURED',
            structuredResult: validProfileAnswer(),
            provenance: {
              runId: request.runId,
              purpose: request.purpose,
              providerId: String(md['providerId']),
              // A different model answered than the one the plan bound.
              modelId: 'model.someone-else',
              modelVersion: String(md['modelVersion']),
              promptId: request.promptId,
              promptVersion: request.promptVersion,
              promptDigest: request.promptDigest,
              mode: 'ACTIVE',
              usedFallback: false,
              attempts: 1,
            },
            usage: { outputTokens: 1, inputTokens: 1, totalTokens: 2 },
            latencyMs: 1,
            finishStatus: 'completed',
          },
        });
      },
    };
    const result = await adapterWith(invoker, syntheticProfile()).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-provenance-mismatch');
    expect('profileDetail' in result).toBe(false);
  });

  it('a gateway refusal carries no detail and never reached a projection', async () => {
    let projected = 0;
    const counting = syntheticProfile({
      projectStructuredResult: (value: unknown) => {
        projected += 1;
        const parsed = SYNTHETIC_SCHEMA.safeParse(value);
        return parsed.success ? { reply: asReply(parsed.data.reply), detail: {} } : undefined;
      },
    });
    const refusing: ModelGatewayInvoker = {
      invoke: () => Promise.resolve({ ok: false, transient: false, reason: 'refused' } as never),
    };
    const result = await adapterWith(refusing, counting).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect('profileDetail' in result).toBe(false);
    expect(projected).toBe(0);
  });
});
