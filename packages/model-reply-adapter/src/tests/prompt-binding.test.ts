/**
 * QFJ-S3-I-B — the executed prompt is the resolved definition (ADR-0073).
 *
 * Before this, the adapter carried a hard-coded `REPLY_PROMPT_CONTRACT` while reporting
 * `promptId`/`promptVersion` from deployer configuration, so a request could truthfully name a version
 * whose text it was not sending, and a green evaluation could attest a prompt that never ran. These
 * cases pin the replacement at the adapter boundary: one registry resolution, identity AND content
 * from the same object, and a refusal wherever the two could diverge.
 *
 * The per-scope selector is covered here too, because it is what lets one runtime serve Riya and
 * Anisha; the whole-runtime proof lives in `jarvis-runtime`'s multi-agent spec.
 */
import { describe, expect, it } from 'vitest';

import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptRegistry } from '@qf-jarvis/prompt-registry';
import type { ModelRequest } from '@qf-jarvis/model-gateway';

import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import type {
  ModelGatewayInvocation,
  ModelGatewayInvoker,
} from '../gateway/model-gateway-invoker.js';
import type { ReplyState } from '../contracts/state.js';
import {
  clearReplyState,
  fixedClock,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticPromptDefinition,
  syntheticRelease,
} from '../testing/index.js';

const CLIENT_PROMPT = syntheticPromptDefinition();
const VENDOR_PROMPT = createPromptDefinition({
  promptId: 'reply.vendor',
  promptVersion: 1,
  agentScope: 'VENDOR',
  taskClass: 'RESPONSE_GENERATION',
  resultMode: 'STRUCTURED',
  systemTemplate: 'Synthetic VENDOR adapter fixture prompt. Not a production instruction.',
});
const REGISTRY = createPromptRegistry([CLIENT_PROMPT, VENDOR_PROMPT]);

/** Records the request the gateway was handed — the only direct evidence of what executed. */
function capturingInvoker(): ModelGatewayInvoker & {
  readonly seen: () => readonly ModelRequest[];
} {
  const seen: ModelRequest[] = [];
  const inner = scriptedGatewayInvoker(structuredReply());
  return {
    invoke: (request: ModelRequest): Promise<ModelGatewayInvocation> => {
      seen.push(request);
      return inner.invoke(request);
    },
    seen: () => seen,
  };
}

function adapterWith(
  over: Partial<ModelReplyAdapterConfig>,
  invoker: ModelGatewayInvoker = scriptedGatewayInvoker(structuredReply()),
) {
  const base: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    capabilityProfileRef: 'cap.reply.v1',
    promptRegistry: REGISTRY,
    stateReader: scriptedReplyStateReader(clearReplyState()),
    clock: fixedClock(),
    invoker,
    ...over,
  };
  return createModelReplyAdapter(base);
}

/** The legacy single-prompt config the rest of the suite uses. */
function legacyConfig(
  over: Partial<ModelReplyAdapterConfig> = {},
): Partial<ModelReplyAdapterConfig> {
  return {
    promptFamily: CLIENT_PROMPT.promptId,
    promptVersion: CLIENT_PROMPT.promptVersion,
    evaluationRef: 'evref-000000',
    evaluationPromptDigest: CLIENT_PROMPT.contentDigest,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The request carries the resolved definition's bytes, not a module constant.
// ---------------------------------------------------------------------------

describe('the executed prompt comes from the registry', () => {
  it('sends the resolved definition as the system message, with its identity and digest', async () => {
    const invoker = capturingInvoker();
    const result = await adapterWith(legacyConfig(), invoker).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(true);

    const request = invoker.seen()[0];
    expect(request).toBeDefined();
    if (request === undefined) return;

    // Identity, digest and body all come from the SAME object. That is the whole property: a request
    // can no longer name one version and send another's text.
    expect(request.promptId).toBe(CLIENT_PROMPT.promptId);
    expect(request.promptVersion).toBe(String(CLIENT_PROMPT.promptVersion));
    expect(request.promptDigest).toBe(CLIENT_PROMPT.contentDigest);
    expect(request.messages.find((m) => m.role === 'system')?.content).toBe(
      CLIENT_PROMPT.systemTemplate,
    );
    expect(request.metadata['promptDigest']).toBe(CLIENT_PROMPT.contentDigest);
  });

  it('resolves the prompt exactly once per turn and invokes the gateway exactly once', async () => {
    // A registry that counts resolutions. One model call per turn (ADR-0057) is only meaningful if
    // the prompt behind it was also chosen once.
    let resolutions = 0;
    const counting: PromptRegistry = {
      ...REGISTRY,
      resolve: (request) => {
        resolutions += 1;
        return REGISTRY.resolve(request);
      },
    };
    const invoker = capturingInvoker();
    await adapterWith(legacyConfig({ promptRegistry: counting }), invoker).draftReplyDetailed(
      replyPlan(),
    );
    expect(resolutions).toBe(1);
    expect(invoker.seen()).toHaveLength(1);
  });

  it('carries no hard-coded prompt: without a registry it fails closed and never calls the gateway', async () => {
    const invoker = capturingInvoker();
    // The key is REMOVED, not set to `undefined`: under `exactOptionalPropertyTypes` those are
    // different things, and only the removal models a deployment that never wired a registry.
    const config: Record<string, unknown> = {
      release: syntheticRelease(),
      capabilityProfileRef: 'cap.reply.v1',
      stateReader: scriptedReplyStateReader(clearReplyState()),
      clock: fixedClock(),
      invoker,
      ...legacyConfig(),
    };
    delete config['promptRegistry'];
    const result = await createModelReplyAdapter(
      config as unknown as ModelReplyAdapterConfig,
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-adapter-unavailable');
    // Inventing text would have been the easy failure mode; there is nothing to invent from.
    expect(invoker.seen()).toHaveLength(0);
  });

  it('refuses an unresolvable version rather than falling back to a nearby one', async () => {
    const invoker = capturingInvoker();
    const result = await adapterWith(
      legacyConfig({ promptVersion: 2 }),
      invoker,
    ).draftReplyDetailed(replyPlan({ promptVersion: 2 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-plan-invalid');
    expect(invoker.seen()).toHaveLength(0);
  });

  it('normalizes a THROWING registry to the same closed refusal, leaking nothing', async () => {
    // `PromptRegistry` is a structural interface an injected implementation may satisfy without being
    // the shipped one. Rethrowing "unexpected" errors would let a foreign exception escape
    // `draftReplyDetailed` as a rejected promise instead of the closed result every other failure
    // here produces -- and a generic `Error` is exactly what a foreign registry throws.
    const SECRET = 'registry-exploded-with-conversation-detail';
    let resolves = 0;
    const throwing: PromptRegistry = {
      ...REGISTRY,
      resolve: () => {
        resolves += 1;
        throw new Error(SECRET);
      },
    };
    const invoker = capturingInvoker();
    const events: unknown[] = [];

    // Resolves, does not reject.
    const result = await adapterWith(
      {
        ...legacyConfig({ promptRegistry: throwing }),
        observability: { onEvent: (e) => events.push(e) },
      },
      invoker,
    ).draftReplyDetailed(replyPlan());

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-plan-invalid');
    expect(result.gatewayInvoked).toBe(false);
    expect(invoker.seen()).toHaveLength(0);
    // A throw is a refusal, not a reason to resolve again or resolve differently.
    expect(resolves).toBe(1);
    // The thrown value is discarded, never copied into the result or an event.
    expect(JSON.stringify({ result, events })).not.toContain(SECRET);
    expect(JSON.stringify({ result, events })).not.toContain('Error');
  });

  it('refuses a plan whose identity disagrees with the configured binding', async () => {
    const invoker = capturingInvoker();
    const result = await adapterWith(legacyConfig(), invoker).draftReplyDetailed(
      replyPlan({ promptFamily: VENDOR_PROMPT.promptId }),
    );
    expect(result.ok).toBe(false);
    expect(invoker.seen()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The evaluation reference names the exact bytes it covers.
// ---------------------------------------------------------------------------

describe('the evaluation digest pairs with the evaluation reference', () => {
  it('refuses when the evaluated digest is not the digest about to run', async () => {
    const invoker = capturingInvoker();
    const result = await adapterWith(
      // A real digest of real bytes — just not these bytes.
      legacyConfig({ evaluationPromptDigest: VENDOR_PROMPT.contentDigest }),
      invoker,
    ).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-plan-invalid');
    expect(invoker.seen()).toHaveLength(0);
  });

  it('refuses a reference with no digest — a half-claim is not a partial claim', async () => {
    const config = legacyConfig();
    delete (config as Record<string, unknown>)['evaluationPromptDigest'];
    const result = await adapterWith(config).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-plan-invalid');
  });

  it('accepts a turn with neither — an unevaluated prompt is a separate concern', async () => {
    const config = legacyConfig();
    delete (config as Record<string, unknown>)['evaluationRef'];
    delete (config as Record<string, unknown>)['evaluationPromptDigest'];
    const result = await adapterWith(config).draftReplyDetailed(
      replyPlan({ evaluationRef: undefined }),
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-scope selection: one adapter, two agents.
// ---------------------------------------------------------------------------

describe('per-scope prompt bindings', () => {
  const bindings = {
    promptBindings: {
      CLIENT: {
        promptFamily: CLIENT_PROMPT.promptId,
        promptVersion: CLIENT_PROMPT.promptVersion,
        evaluationRef: 'evref-client',
        evaluationPromptDigest: CLIENT_PROMPT.contentDigest,
      },
      VENDOR: {
        promptFamily: VENDOR_PROMPT.promptId,
        promptVersion: VENDOR_PROMPT.promptVersion,
        evaluationRef: 'evref-vendor',
        evaluationPromptDigest: VENDOR_PROMPT.contentDigest,
      },
    },
  } as const;

  it('exposes the selector in per-scope mode and answers per assigned actor', () => {
    const port = adapterWith(bindings);
    // The selector exists ONLY in per-scope mode; legacy ports keep the flat fields they always had.
    expect(typeof port.selectPromptIdentity).toBe('function');
    expect(
      port.selectPromptIdentity?.({ assignedActor: 'RIYA', taskClass: 'RESPONSE_GENERATION' }),
    ).toEqual({
      promptFamily: CLIENT_PROMPT.promptId,
      promptVersion: CLIENT_PROMPT.promptVersion,
      evaluationRef: 'evref-client',
    });
    expect(
      port.selectPromptIdentity?.({ assignedActor: 'ANISHA', taskClass: 'RESPONSE_GENERATION' }),
    ).toEqual({
      promptFamily: VENDOR_PROMPT.promptId,
      promptVersion: VENDOR_PROMPT.promptVersion,
      evaluationRef: 'evref-vendor',
    });
  });

  it('returns undefined for an unbound scope instead of another agent’s prompt', () => {
    const port = adapterWith({
      promptBindings: { CLIENT: bindings.promptBindings.CLIENT },
    });
    expect(
      port.selectPromptIdentity?.({ assignedActor: 'ANISHA', taskClass: 'RESPONSE_GENERATION' }),
    ).toBeUndefined();
  });

  it('does not expose the selector in legacy mode', () => {
    // `in` rather than reading the property: reading a method off its object detaches `this`, which
    // the lint rule flags, and presence is what this case is actually about.
    expect('selectPromptIdentity' in adapterWith(legacyConfig())).toBe(false);
  });

  it('drafts each scope with its own prompt text through the same adapter', async () => {
    const invoker = capturingInvoker();
    // One adapter, two turns, and the authoritative reply state matching each -- a vendor turn whose
    // state still said CLIENT would be refused by the state gate for an unrelated (correct) reason.
    let state: ReplyState = clearReplyState();
    const port = adapterWith(
      { ...bindings, stateReader: { read: () => Promise.resolve(state) } },
      invoker,
    );

    const client = await port.draftReplyDetailed(
      replyPlan({ evaluationRef: 'evref-client', promptFamily: CLIENT_PROMPT.promptId }),
    );
    state = clearReplyState({ partyType: 'VENDOR', assignedActor: 'ANISHA' });
    const vendor = await port.draftReplyDetailed(
      replyPlan({
        assignedActor: 'ANISHA',
        partyType: 'VENDOR',
        evaluationRef: 'evref-vendor',
        promptFamily: VENDOR_PROMPT.promptId,
      }),
    );

    expect(client.ok).toBe(true);
    expect(vendor.ok).toBe(true);
    expect(invoker.seen()[0]?.messages.find((m) => m.role === 'system')?.content).toBe(
      CLIENT_PROMPT.systemTemplate,
    );
    expect(invoker.seen()[1]?.messages.find((m) => m.role === 'system')?.content).toBe(
      VENDOR_PROMPT.systemTemplate,
    );
  });

  it('refuses a draft for a scope that has no binding', async () => {
    const invoker = capturingInvoker();
    const result = await adapterWith(
      {
        promptBindings: { CLIENT: bindings.promptBindings.CLIENT },
        stateReader: scriptedReplyStateReader(
          clearReplyState({ partyType: 'VENDOR', assignedActor: 'ANISHA' }),
        ),
      },
      invoker,
    ).draftReplyDetailed(
      replyPlan({
        assignedActor: 'ANISHA',
        partyType: 'VENDOR',
        promptFamily: VENDOR_PROMPT.promptId,
      }),
    );
    expect(result.ok).toBe(false);
    expect(invoker.seen()).toHaveLength(0);
  });

  it('rejects a config that mixes the two shapes', async () => {
    // Merging would have to pick a winner for CLIENT, and every answer silently sends some agent a
    // prompt its deployer did not choose.
    const result = await adapterWith({
      ...bindings,
      promptFamily: CLIENT_PROMPT.promptId,
      promptVersion: CLIENT_PROMPT.promptVersion,
    }).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
  });
});
