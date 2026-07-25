/**
 * QFJ-M5 — fail-closed dependencies, rejections, and citations (ADR-0059 §D, §F, §G).
 *
 * A missing mandatory dependency fails closed at construction; a missing optional integration
 * dependency fails closed at runtime; a rejected Promise (state / model / Core) is normalized with no
 * raw error or unhandled rejection; exact knowledge citations flow through while a fabricated citation
 * fails closed and RAG stays disabled.
 */
import { describe, expect, it } from 'vitest';

import { scriptedKnowledgePort, syntheticCitation } from '@qf-jarvis/agent-runtime/testing';
import {
  scriptedCoreTransport,
  throwingCoreTransport,
} from '@qf-jarvis/core-decision-adapter/testing';
import {
  scriptedGatewayInvoker,
  structuredReply,
  throwingGatewayInvoker,
} from '@qf-jarvis/model-reply-adapter/testing';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import { JarvisRuntimeError } from '../contracts/errors.js';
import type { AuthoritativeConversationStatePort } from '../contracts/authoritative-state.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

describe('fail-closed dependencies', () => {
  it('a missing mandatory dependency fails closed at construction', () => {
    const base = syntheticRuntimeConfig();
    for (const broken of [
      { ...base, authoritativeState: undefined },
      { ...base, policy: undefined },
      { ...base, release: undefined },
      { ...base, clock: undefined },
    ]) {
      expect(() => createJarvisRuntime(broken as unknown as JarvisRuntimeConfig)).toThrow(
        JarvisRuntimeError,
      );
    }
  });

  it('a missing gateway invoker fails closed at runtime (no draft, Core never reached)', async () => {
    const transport = scriptedCoreTransport('ACCEPTED');
    const base = syntheticRuntimeConfig();
    const config: JarvisRuntimeConfig = {
      authoritativeState: base.authoritativeState,
      policy: base.policy,
      clock: base.clock,
      release: base.release,
      promptFamily: base.promptFamily,
      promptVersion: base.promptVersion,
      capabilityProfileRef: base.capabilityProfileRef,
      coreTransport: transport,
    };
    const result = await createJarvisRuntime(config).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(transport.invoked()).toBe(0);
  });
});

describe('rejected Promises are normalized', () => {
  it('a rejected authoritative-state read fails closed with no raw error', async () => {
    const rejectingSource: AuthoritativeConversationStatePort = {
      read: () => Promise.reject(new Error('SECRET-STATE-FAULT')),
    };
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({ authoritativeState: rejectingSource }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-invariant');
    expect(JSON.stringify(result)).not.toContain('SECRET-STATE-FAULT');
  });

  it('a rejected gateway invocation fails closed with no raw leak', async () => {
    const invoker = throwingGatewayInvoker();
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({ gatewayInvoker: invoker }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(invoker.invoked()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic gateway fault');
  });

  it('a rejected Core transport is normalized to CORE_UNAVAILABLE with no raw leak', async () => {
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({ coreTransport: throwingCoreTransport() }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('CORE_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('synthetic transport failure');
  });
});

describe('exact citations only, RAG disabled', () => {
  it('exact knowledge citations flow through to CORE_ACCEPTED', async () => {
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        knowledgePort: scriptedKnowledgePort({
          ok: true,
          citations: [syntheticCitation('kb.fact', 1)],
        }),
        knowledgeTopics: ['sla'],
        gatewayInvoker: scriptedGatewayInvoker(
          structuredReply({ citations: [{ knowledgeId: 'kb.fact', version: 1 }] }),
        ),
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('CORE_ACCEPTED');
  });

  it('a fabricated citation fails closed before Core', async () => {
    const transport = scriptedCoreTransport('ACCEPTED');
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        knowledgePort: scriptedKnowledgePort({
          ok: true,
          citations: [syntheticCitation('kb.fact', 1)],
        }),
        gatewayInvoker: scriptedGatewayInvoker(
          structuredReply({ citations: [{ knowledgeId: 'kb.ghost', version: 1 }] }),
        ),
        coreTransport: transport,
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(transport.invoked()).toBe(0);
  });
});
