/**
 * S3-I-B — ONE runtime, per-scope prompts, still one authoritative path (ADR-0073).
 *
 * A prompt definition is scope-bound and `(promptId, promptVersion)` is globally unique, so the legacy
 * single `promptFamily` can serve exactly one agent: a runtime configured for Riya would refuse every
 * Anisha turn. The alternative on offer was one runtime instance per scope, which duplicates the
 * composition and — worse — moves "which agent is this?" outside M1, where assignment is supposed to
 * be decided exactly once.
 *
 * So these cases build ONE `JarvisRuntimeConfig` carrying a CLIENT binding and a VENDOR binding, and
 * drive CLIENT and VENDOR turns through the SAME runtime object. Every case runs the real composition
 * root; nothing calls `orchestrateInbound`, `behaviourMux` or the M4 adapter directly, because the
 * claim under test is precisely that the selection happens inside the one authoritative path.
 *
 * What is asserted, beyond "it works": the executed system text is the text of the prompt the
 * deployer bound FOR THAT SCOPE, an unbound scope refuses rather than borrowing another agent's
 * prompt, and a scope's evaluation reference and prompt digest travel together.
 */
import { describe, expect, it } from 'vitest';

import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { ConversationStateKey } from '../contracts/authoritative-state.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import {
  clearControlState,
  scriptedAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticPromptDefinition,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

// ---------------------------------------------------------------------------
// The two scope-bound prompts one deployment configures, and the shared registry holding both.
// ---------------------------------------------------------------------------

/**
 * The gateway request type, derived from the invoker rather than imported.
 *
 * `jarvis-runtime` deliberately does not depend on `@qf-jarvis/model-gateway` -- it reaches the
 * gateway only through M4's injected invoker -- and a spec is not a reason to widen the package graph.
 */
type ModelRequest = Parameters<ModelGatewayInvoker['invoke']>[0];

const CLIENT_PROMPT = syntheticPromptDefinition('reply.client', 'CLIENT');
const VENDOR_PROMPT = syntheticPromptDefinition('reply.vendor', 'VENDOR');
const SHARED_REGISTRY = createPromptRegistry([CLIENT_PROMPT, VENDOR_PROMPT]);

/** Their templates must actually differ, or "the right one was sent" would prove nothing. */
it('(pre) the two scope prompts are genuinely different text with different digests', () => {
  expect(CLIENT_PROMPT.systemTemplate).not.toBe(VENDOR_PROMPT.systemTemplate);
  expect(CLIENT_PROMPT.contentDigest).not.toBe(VENDOR_PROMPT.contentDigest);
});

/**
 * A gateway invoker that records the exact request it was handed, then delegates to the shipped
 * scripted invoker. Recording the REQUEST is the point: the system message it carries is the only
 * direct evidence of which prompt actually executed.
 */
function capturingInvoker(): ModelGatewayInvoker & {
  readonly requests: () => readonly ModelRequest[];
} {
  const seen: ModelRequest[] = [];
  const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  return {
    invoke: (request: ModelRequest): Promise<ModelGatewayInvocation> => {
      seen.push(request);
      return inner.invoke(request);
    },
    requests: () => seen,
  };
}

/** The system message actually sent — the only evidence of which prompt executed. */
function systemTextOf(request: ModelRequest | undefined): string | undefined {
  return request?.messages.find((m: ModelRequest['messages'][number]) => m.role === 'system')
    ?.content;
}

/**
 * One runtime config in the PER-SCOPE shape.
 *
 * The fixture default is the legacy single-prompt shape, and mixing the two is refused (a merge would
 * have to silently pick a winner). So the four legacy keys are removed rather than overwritten with
 * `undefined`: under `exactOptionalPropertyTypes` an explicit `undefined` is a present key, and the
 * mode check would correctly call that mixed.
 */
function multiAgentConfig(over: Partial<JarvisRuntimeConfig> = {}): JarvisRuntimeConfig {
  const copy: Record<string, unknown> = { ...syntheticRuntimeConfig(over) };
  delete copy['promptFamily'];
  delete copy['promptVersion'];
  delete copy['evaluationRef'];
  delete copy['evaluationPromptDigest'];
  // An override REPLACES the bindings wholesale rather than merging into them: a case that supplies
  // "only a CLIENT binding" must actually get only a CLIENT binding, or it would silently keep the
  // VENDOR default and stop testing anything.
  return {
    ...(copy as unknown as JarvisRuntimeConfig),
    promptRegistry: SHARED_REGISTRY,
    promptBindings: over.promptBindings ?? {
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
  };
}

async function runTurn(
  config: JarvisRuntimeConfig,
  partyType: 'CLIENT' | 'VENDOR',
): Promise<JarvisRuntimeResult> {
  return createJarvisRuntime(config).processInbound(syntheticInboundEnvelope({ partyType }));
}

// ---------------------------------------------------------------------------
// (A, B) One runtime object serves both agents, each with its own prompt.
// ---------------------------------------------------------------------------

describe('(A, B) one runtime serves CLIENT and VENDOR', () => {
  it('(A) ONE runtime object handles a Riya turn and an Anisha turn', async () => {
    // The authoritative-state port is keyed by conversation (ADR-0059), so a single runtime can hold
    // two live conversations of different party types -- which is what a real deployment looks like,
    // and what makes "one runtime object" testable rather than a figure of speech.
    const invoker = capturingInvoker();
    const runtime = createJarvisRuntime(
      multiAgentConfig({
        authoritativeState: {
          // The state's own tenant AND conversation must match the key, or the runtime would
          // (rightly) refuse a record belonging to a different conversation (QFJ-P08-B1, ADR-0076).
          read: (key: ConversationStateKey) =>
            Promise.resolve(
              key.conversationId === 'conv.vendor'
                ? clearControlState({ ...key, partyType: 'VENDOR' })
                : clearControlState({ ...key }),
            ),
        },
        gatewayInvoker: invoker,
      }),
    );

    const client = await runtime.processInbound(
      syntheticInboundEnvelope({ conversationId: 'conv.client', partyType: 'CLIENT' }),
    );
    // The SAME object, no reconstruction between turns.
    const vendor = await runtime.processInbound(
      syntheticInboundEnvelope({
        conversationId: 'conv.vendor',
        messageId: 'msg.2',
        partyType: 'VENDOR',
      }),
    );

    expect(client.assignedActor).toBe('RIYA');
    expect(client.outcome).not.toBe('REFUSED');
    expect(vendor.assignedActor).toBe('ANISHA');
    expect(vendor.outcome).not.toBe('REFUSED');

    // Exactly one model call each, and each one carried its own scope's prompt.
    expect(invoker.requests()).toHaveLength(2);
    expect(invoker.requests()[0]?.promptId).toBe(CLIENT_PROMPT.promptId);
    expect(invoker.requests()[1]?.promptId).toBe(VENDOR_PROMPT.promptId);
    expect(systemTextOf(invoker.requests()[0])).toBe(CLIENT_PROMPT.systemTemplate);
    expect(systemTextOf(invoker.requests()[1])).toBe(VENDOR_PROMPT.systemTemplate);
  });

  it('(B) each scope executes ITS OWN prompt text, identity and digest', async () => {
    const clientInvoker = capturingInvoker();
    await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: clientInvoker,
      }),
      'CLIENT',
    );
    const vendorInvoker = capturingInvoker();
    await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
        gatewayInvoker: vendorInvoker,
      }),
      'VENDOR',
    );

    const clientRequest = clientInvoker.requests()[0];
    const vendorRequest = vendorInvoker.requests()[0];
    expect(clientRequest).toBeDefined();
    expect(vendorRequest).toBeDefined();
    if (clientRequest === undefined || vendorRequest === undefined) return;

    // Identity, digest and CONTENT all come from the same resolved definition. Asserting the text as
    // well as the identity is the whole point: before ADR-0073 a request could truthfully name a
    // version whose bytes it was not sending.
    expect(clientRequest.promptId).toBe(CLIENT_PROMPT.promptId);
    expect(clientRequest.promptDigest).toBe(CLIENT_PROMPT.contentDigest);
    expect(systemTextOf(clientRequest)).toBe(CLIENT_PROMPT.systemTemplate);

    expect(vendorRequest.promptId).toBe(VENDOR_PROMPT.promptId);
    expect(vendorRequest.promptDigest).toBe(VENDOR_PROMPT.contentDigest);
    expect(systemTextOf(vendorRequest)).toBe(VENDOR_PROMPT.systemTemplate);

    // And neither turn saw the other agent's instructions.
    expect(systemTextOf(clientRequest)).not.toBe(VENDOR_PROMPT.systemTemplate);
    expect(systemTextOf(vendorRequest)).not.toBe(CLIENT_PROMPT.systemTemplate);
  });
});

// ---------------------------------------------------------------------------
// (C, D) An unbound or mis-bound scope refuses. No borrowing, no fallback.
// ---------------------------------------------------------------------------

describe('(C, D) an unconfigured scope fails closed', () => {
  it('(C) a VENDOR turn with only a CLIENT binding refuses and never reaches the gateway', async () => {
    const invoker = capturingInvoker();
    const result = await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
        gatewayInvoker: invoker,
        promptBindings: {
          CLIENT: {
            promptFamily: CLIENT_PROMPT.promptId,
            promptVersion: CLIENT_PROMPT.promptVersion,
            evaluationRef: 'evref-client',
            evaluationPromptDigest: CLIENT_PROMPT.contentDigest,
          },
        },
      }),
      'VENDOR',
    );
    expect(result.outcome).toBe('REFUSED');
    // The refusal is what matters; borrowing CLIENT's prompt would have "worked" and been wrong.
    expect(invoker.requests()).toHaveLength(0);
    expect(result.proposalId).toBeUndefined();
  });

  it('(D) a CLIENT turn whose binding names a VENDOR-scoped prompt refuses', async () => {
    const invoker = capturingInvoker();
    const result = await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: invoker,
        promptBindings: {
          // Well-formed, resolvable, and bound to the WRONG scope. Resolution is scope-exact, so this
          // is a refusal rather than a CLIENT turn executing vendor instructions.
          CLIENT: {
            promptFamily: VENDOR_PROMPT.promptId,
            promptVersion: VENDOR_PROMPT.promptVersion,
            evaluationRef: 'evref-client',
            evaluationPromptDigest: VENDOR_PROMPT.contentDigest,
          },
        },
      }),
      'CLIENT',
    );
    expect(result.outcome).toBe('REFUSED');
    expect(invoker.requests()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (E, F) The evaluation pair is per scope, and half a pair is refused.
// ---------------------------------------------------------------------------

describe('(E, F) evaluation binding is per scope', () => {
  it('(E) each scope carries its own evaluation reference into the request', async () => {
    const clientInvoker = capturingInvoker();
    await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: clientInvoker,
      }),
      'CLIENT',
    );
    const vendorInvoker = capturingInvoker();
    await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
        gatewayInvoker: vendorInvoker,
      }),
      'VENDOR',
    );
    expect(clientInvoker.requests()[0]?.metadata['evaluationRef']).toBe('evref-client');
    expect(vendorInvoker.requests()[0]?.metadata['evaluationRef']).toBe('evref-vendor');
  });

  it('(F) a scope whose evaluation digest names other bytes refuses', async () => {
    const invoker = capturingInvoker();
    const result = await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: invoker,
        promptBindings: {
          CLIENT: {
            promptFamily: CLIENT_PROMPT.promptId,
            promptVersion: CLIENT_PROMPT.promptVersion,
            evaluationRef: 'evref-client',
            // A real digest of real bytes — just not the bytes about to run. An evaluation that
            // attests a different prompt is exactly the gap this ADR closes.
            evaluationPromptDigest: VENDOR_PROMPT.contentDigest,
          },
        },
      }),
      'CLIENT',
    );
    expect(result.outcome).toBe('REFUSED');
    expect(invoker.requests()).toHaveLength(0);
  });

  it('(F) a half-supplied evaluation pair refuses rather than being half-trusted', async () => {
    const invoker = capturingInvoker();
    const result = await runTurn(
      multiAgentConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: invoker,
        promptBindings: {
          CLIENT: {
            promptFamily: CLIENT_PROMPT.promptId,
            promptVersion: CLIENT_PROMPT.promptVersion,
            // A reference with no digest does not say WHICH bytes it covers.
            evaluationRef: 'evref-client',
          },
        },
      }),
      'CLIENT',
    );
    expect(result.outcome).toBe('REFUSED');
    expect(invoker.requests()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (G) The two configuration shapes are exclusive, and the legacy one still works.
// ---------------------------------------------------------------------------

describe('(G) exactly one prompt configuration shape', () => {
  it('(G) a config mixing per-scope bindings with the legacy fields is refused at composition', () => {
    expect(() =>
      createJarvisRuntime({
        ...multiAgentConfig({
          authoritativeState: scriptedAuthoritativeState(clearControlState()),
        }),
        // Legacy fields alongside `promptBindings`. Merging would have to pick a winner for CLIENT,
        // and every answer silently sends some agent a prompt its deployer did not choose.
        promptFamily: CLIENT_PROMPT.promptId,
        promptVersion: CLIENT_PROMPT.promptVersion,
      }),
    ).toThrow();
  });

  it('(G) an empty bindings object configures no agent and is refused', () => {
    expect(() =>
      createJarvisRuntime(
        multiAgentConfig({
          authoritativeState: scriptedAuthoritativeState(clearControlState()),
          promptBindings: {},
        }),
      ),
    ).toThrow();
  });

  it('(G) the LEGACY single-prompt shape still serves its one scope unchanged', async () => {
    // Backwards compatibility is not incidental here: every existing deployment and every other spec
    // in this package uses the legacy shape, and ADR-0073 does not retire it.
    const invoker = capturingInvoker();
    const result = await runTurn(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState()),
        gatewayInvoker: invoker,
      }),
      'CLIENT',
    );
    expect(result.outcome).not.toBe('REFUSED');
    const request = invoker.requests()[0];
    expect(request?.promptId).toBe(CLIENT_PROMPT.promptId);
    expect(systemTextOf(request)).toBe(CLIENT_PROMPT.systemTemplate);
  });
});
