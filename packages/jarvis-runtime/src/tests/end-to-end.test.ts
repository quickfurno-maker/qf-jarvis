/**
 * QFJ-M5 — end-to-end composed reply flow (ADR-0059 §A, §E, §F).
 *
 * A valid client/vendor inbound reaches the M4 draft, the M2 PENDING_CORE_VALIDATION proposal, and the
 * M3 Core decision; the result is frozen and revision-bound; the model and Core are each invoked at
 * most once; CORE_ACCEPTED is never sent/delivered/executed/persisted; the same inputs are
 * deterministic; every lower reader delegates to ONE authoritative source; a valid draft with no Core
 * transport yields MODEL_DRAFTED.
 */
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import {
  clearControlState,
  scriptedAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
  syntheticPromptDefinition,
  syntheticPromptRegistry,
} from '../testing/deterministic-runtime-fixture.js';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import {
  scriptedGatewayInvoker,
  structuredReply,
  syntheticRelease,
} from '@qf-jarvis/model-reply-adapter/testing';

describe('end-to-end composition', () => {
  it('a valid CLIENT inbound reaches the model draft, the proposal, and CORE_ACCEPTED', async () => {
    const source = scriptedAuthoritativeState(clearControlState());
    const invoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const transport = scriptedCoreTransport('ACCEPTED');
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: source,
        gatewayInvoker: invoker,
        coreTransport: transport,
      }),
    );
    const result = await runtime.processInbound(syntheticInboundEnvelope());

    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.assignedActor).toBe('RIYA');
    expect(result.modelDrafted).toBe(true);
    expect(result.coreConsulted).toBe(true);
    expect(result.boundRevision).toBe(1);
    expect(result.proposalId).toBeTruthy();
    expect(Object.isFrozen(result)).toBe(true);
    // Model once, Core once.
    expect(invoker.invoked()).toBe(1);
    expect(transport.invoked()).toBe(1);
    // Every lower reader delegated to the ONE authoritative source (pre/post model + Core reads).
    expect(source.reads()).toBeGreaterThanOrEqual(4);
    // CORE_ACCEPTED exposes no send/deliver/execute/persist surface.
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'persist', 'callN8n', 'transmit']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it('a valid VENDOR inbound routes to Anisha', async () => {
    // A prompt definition is scope-bound, so a runtime serving VENDOR turns is configured with a
    // VENDOR prompt -- a CLIENT-scoped prompt would (correctly) refuse to resolve here (ADR-0073).
    const vendorPrompt = syntheticPromptDefinition('reply.vendor', 'VENDOR');
    const config = syntheticRuntimeConfig({
      authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
      release: syntheticRelease(),
      promptFamily: vendorPrompt.promptId,
      promptVersion: vendorPrompt.promptVersion,
      promptRegistry: syntheticPromptRegistry('reply.vendor', 'VENDOR'),
      evaluationPromptDigest: vendorPrompt.contentDigest,
    });
    const runtime = createJarvisRuntime(config);
    const result = await runtime.processInbound(syntheticInboundEnvelope({ partyType: 'VENDOR' }));
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.assignedActor).toBe('ANISHA');
  });

  it('the same inputs and fakes are deterministic', async () => {
    const a = await createJarvisRuntime(syntheticRuntimeConfig()).processInbound(
      syntheticInboundEnvelope(),
    );
    const b = await createJarvisRuntime(syntheticRuntimeConfig()).processInbound(
      syntheticInboundEnvelope(),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.outcome).toBe('CORE_ACCEPTED');
  });

  it('a valid draft with no Core transport wired yields MODEL_DRAFTED (Core deferred, not faked)', async () => {
    const config = syntheticRuntimeConfig();
    // Remove the Core transport by rebuilding config without it.
    const runtime = createJarvisRuntime({
      authoritativeState: config.authoritativeState,
      policy: config.policy,
      clock: config.clock,
      release: config.release,
      ...(config.promptFamily === undefined ? {} : { promptFamily: config.promptFamily }),
      ...(config.promptVersion === undefined ? {} : { promptVersion: config.promptVersion }),
      capabilityProfileRef: config.capabilityProfileRef,
      ...(config.promptRegistry === undefined ? {} : { promptRegistry: config.promptRegistry }),
      ...(config.evaluationPromptDigest === undefined
        ? {}
        : { evaluationPromptDigest: config.evaluationPromptDigest }),
      ...(config.evaluationRef === undefined ? {} : { evaluationRef: config.evaluationRef }),
      ...(config.gatewayInvoker === undefined ? {} : { gatewayInvoker: config.gatewayInvoker }),
    });
    const result = await runtime.processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('MODEL_DRAFTED');
    expect(result.modelDrafted).toBe(true);
    expect(result.coreConsulted).toBe(false);
  });

  it('each Core outcome maps to the closed runtime outcome', async () => {
    const cases = [
      ['REJECTED', 'CORE_REJECTED'],
      ['HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW_REQUIRED'],
      ['RETRY_LATER', 'RETRY_LATER'],
    ] as const;
    for (const [coreOutcome, runtimeOutcome] of cases) {
      const result = await createJarvisRuntime(
        syntheticRuntimeConfig({ coreTransport: scriptedCoreTransport(coreOutcome) }),
      ).processInbound(syntheticInboundEnvelope());
      expect(result.outcome).toBe(runtimeOutcome);
    }
  });
});
