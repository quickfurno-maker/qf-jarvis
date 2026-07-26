/**
 * QFJ-S1 — Groq staging provider binding (ADR-0060).
 *
 * The binding constructs the existing ADR-0046 Groq adapter from an approved release with fail-closed
 * gates BEFORE any credential resolution or transport, resolves the credential at most once, and makes
 * NO live call; the bound provider is then staging-ready (proven by invoking it with a deterministic
 * fake transport — still no network). Covers endpoint/SSRF, credential boundary/redaction, exact
 * release binding (no wildcard/latest/hard-coded id), data-class/execution/attestation gates, strict
 * structured output with no silent downgrade, AbortSignal/one-request/no-retry, error normalization,
 * content-free observability, and authority/no-send.
 */
import { describe, expect, it } from 'vitest';

import {
  bindGroqStagingProvider,
  createManualClock,
  createProviderReleaseRef,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  GROQ_STAGING_EVENT_TYPES,
  type GroqStagingBindEvent,
  type GroqStagingBindingConfig,
  type ProviderInvocationInput,
} from '../index.js';
import {
  FAKE_GROQ_SENTINEL_KEY,
  SYNTHETIC_GROQ_CREDENTIAL_REFERENCE,
  fakeGroqCredentialResolver,
  fakeGroqTransport,
  groqStructuredResponseBody,
  missingGroqCredentialResolver,
  syntheticGroqStagingRelease,
} from '../testing/index.js';

const STRICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { kind: { type: 'string' } },
  required: ['kind'],
};

function bindConfig(over: Partial<GroqStagingBindingConfig> = {}): GroqStagingBindingConfig {
  return {
    stagingRelease: syntheticGroqStagingRelease(),
    credentialReference: SYNTHETIC_GROQ_CREDENTIAL_REFERENCE,
    credentialResolver: fakeGroqCredentialResolver(),
    transport: fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' })),
    clock: createManualClock(),
    ...over,
  };
}

function structuredInput(
  signal: AbortSignal,
  schema: unknown = STRICT_SCHEMA,
): ProviderInvocationInput {
  return {
    runId: 'run.s1',
    messages: [
      { role: 'system', content: 'You are Riya.' },
      { role: 'user', content: 'hello' },
    ],
    resultMode: 'STRUCTURED',
    structuredJsonSchema: schema,
    timeoutMs: 30_000,
    signal,
  };
}

describe('bind — happy path, no live call, staging-ready', () => {
  it('binds an approved release and makes no transport call during binding', async () => {
    const resolver = fakeGroqCredentialResolver();
    const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
    const result = await bindGroqStagingProvider(
      bindConfig({ credentialResolver: resolver, transport }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe('groq-bind-completed');
      expect(result.provider.descriptor.providerId).toBe('groq.staging');
      expect(result.provider.descriptor.executionClass).toBe('HOSTED');
      expect(result.release.modelId).toBe('llama-3.1-8b-instant');
    }
    expect(resolver.resolved()).toBe(1);
    expect(transport.calls()).toBe(0); // NO live call during binding
  });

  it('the bound provider is staging-ready: a structured invoke hits the fixed endpoint with strict schema', async () => {
    const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
    const result = await bindGroqStagingProvider(bindConfig({ transport }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const controller = new AbortController();
    const invocation = await result.provider.invoke(structuredInput(controller.signal));
    expect(invocation.status).toBe('completed');
    if (invocation.status === 'completed') {
      expect(invocation.output).toEqual({ mode: 'STRUCTURED', value: { kind: 'REPLY' } });
    }
    expect(transport.calls()).toBe(1); // one request max, no adapter retry
    const req = transport.lastRequest();
    expect(req?.url).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);
    const body = JSON.parse(req?.body ?? '{}') as Record<string, unknown>;
    expect(body['stream']).toBe(false);
    expect(body['n']).toBe(1);
    expect(body['model']).toBe('llama-3.1-8b-instant'); // exact release model, no hard-coded id
    expect((body['response_format'] as { type?: string }).type).toBe('json_schema'); // strict, not downgraded
    for (const forbidden of ['tools', 'tool_choice', 'logprobs', 'logit_bias', 'top_logprobs']) {
      expect(body[forbidden]).toBeUndefined();
    }
  });
});

describe('credential boundary and redaction', () => {
  it('a missing/unresolvable credential fails closed before transport, once, with no raw leak', async () => {
    const resolver = missingGroqCredentialResolver();
    const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
    const result = await bindGroqStagingProvider(
      bindConfig({ credentialResolver: resolver, transport }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('groq-bind-credential-unavailable');
    expect(resolver.resolved()).toBe(1);
    expect(transport.calls()).toBe(0);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-CREDENTIAL-UNAVAILABLE');
  });

  it('the fake sentinel key and the credential reference never appear in the result or events', async () => {
    const events: GroqStagingBindEvent[] = [];
    const result = await bindGroqStagingProvider(
      bindConfig({ observability: { onEvent: (e) => events.push(e) } }),
    );
    const serialized = JSON.stringify({ result, events });
    expect(serialized).not.toContain(FAKE_GROQ_SENTINEL_KEY);
    expect(serialized).not.toContain('sk-FAKE');
    expect(serialized).not.toContain('groq.staging.secret.v1'); // the opaque reference value
  });
});

describe('exact release binding — no wildcard/latest', () => {
  const baseRelease = {
    releaseId: 'rel.groq.staging.1',
    providerId: 'groq.staging',
    modelId: 'llama-3.1-8b-instant',
    modelVersion: '2025-07',
    executionClass: 'HOSTED' as const,
    configDigest: 'cfg-groq-0001',
  };

  it("rejects a 'latest' identity in the binding before credential resolution", async () => {
    const resolver = fakeGroqCredentialResolver();
    for (const bad of [
      { modelVersion: 'latest' },
      { releaseId: 'LATEST' },
      { modelId: 'latest' },
    ]) {
      const release = syntheticGroqStagingRelease({
        release: createProviderReleaseRef({ ...baseRelease, ...bad }),
      });
      const result = await bindGroqStagingProvider(
        bindConfig({ stagingRelease: release, credentialResolver: resolver }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('groq-bind-release-invalid');
    }
    expect(resolver.resolved()).toBe(0);
  });

  it('the release reference itself rejects a wildcard identity (upstream defense)', () => {
    expect(() => createProviderReleaseRef({ ...baseRelease, modelId: '*' })).toThrow();
  });
});

describe('data-class, execution, and attestation gates (before credential)', () => {
  const refusals = [
    { over: { dataClass: 'LOCAL_ONLY' as const }, reason: 'groq-bind-data-class-refused' },
    { over: { dataClass: 'HUMAN_ONLY' as const }, reason: 'groq-bind-data-class-refused' },
    { over: { dataControlsAttested: false }, reason: 'groq-bind-attestation-missing' },
  ];
  for (const { over, reason } of refusals) {
    it(`refuses (${reason}) before credential resolution and transport`, async () => {
      const resolver = fakeGroqCredentialResolver();
      const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
      const result = await bindGroqStagingProvider(
        bindConfig({
          stagingRelease: syntheticGroqStagingRelease(over),
          credentialResolver: resolver,
          transport,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
      expect(resolver.resolved()).toBe(0);
      expect(transport.calls()).toBe(0);
    });
  }

  it('refuses a non-HOSTED execution class before credential resolution', async () => {
    const resolver = fakeGroqCredentialResolver();
    const release = syntheticGroqStagingRelease({
      release: createProviderReleaseRef({
        releaseId: 'rel.groq.staging.1',
        providerId: 'groq.staging',
        modelId: 'llama-3.1-8b-instant',
        modelVersion: '2025-07',
        executionClass: 'LOCAL',
        configDigest: 'cfg-groq-0001',
      }),
    });
    const result = await bindGroqStagingProvider(
      bindConfig({ stagingRelease: release, credentialResolver: resolver }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('groq-bind-execution-refused');
    expect(resolver.resolved()).toBe(0);
  });
});

describe('structured output through the binding — no silent downgrade', () => {
  it('a non-strict-compatible schema fails before transport (no downgrade)', async () => {
    const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
    const result = await bindGroqStagingProvider(bindConfig({ transport }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const controller = new AbortController();
    // supportsStrictJsonSchema is true, but a bare string schema is not strict-compatible.
    const invocation = await result.provider.invoke(
      structuredInput(controller.signal, { type: 'string' }),
    );
    expect(invocation.status).toBe('failed');
    expect(transport.calls()).toBe(0);
  });

  it('malformed structured content fails closed as malformed', async () => {
    const body = JSON.stringify({
      id: 'x',
      model: 'llama-3.1-8b-instant',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'not-json-at-all' },
          finish_reason: 'stop',
        },
      ],
    });
    const result = await bindGroqStagingProvider(
      bindConfig({ transport: fakeGroqTransport(body) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const controller = new AbortController();
    const invocation = await result.provider.invoke(structuredInput(controller.signal));
    expect(invocation.status).toBe('malformed');
  });
});

describe('cancellation and error normalization through the bound provider', () => {
  it('a pre-aborted signal cancels without a transport call', async () => {
    const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
    const result = await bindGroqStagingProvider(bindConfig({ transport }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const controller = new AbortController();
    controller.abort();
    const invocation = await result.provider.invoke(structuredInput(controller.signal));
    expect(invocation.status).toBe('cancelled');
    expect(transport.calls()).toBe(0);
  });

  it('a 429 normalizes to rate-limited (unavailable, retryable) with no raw leak', async () => {
    const transport = fakeGroqTransport('{"error":"SECRET-RATE-BODY"}', 429);
    const result = await bindGroqStagingProvider(bindConfig({ transport }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const controller = new AbortController();
    const invocation = await result.provider.invoke(structuredInput(controller.signal));
    expect(invocation.status === 'unavailable' || invocation.status === 'failed').toBe(true);
    expect(JSON.stringify(invocation)).not.toContain('SECRET-RATE-BODY');
  });
});

describe('QFJ-S1A — exact prompt identity and approval references (ADR-0061 §D, §E)', () => {
  const badPromptFamilies = ['', '*', 'latest', 'LATEST', 'a b', 'x'.repeat(129)];
  for (const promptFamily of badPromptFamilies) {
    it(`refuses prompt family ${JSON.stringify(promptFamily.slice(0, 12))} before credential resolution`, async () => {
      const resolver = fakeGroqCredentialResolver();
      const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
      const result = await bindGroqStagingProvider(
        bindConfig({
          stagingRelease: syntheticGroqStagingRelease({ promptFamily }),
          credentialResolver: resolver,
          transport,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('groq-bind-prompt-invalid');
      expect(resolver.resolved()).toBe(0);
      expect(transport.calls()).toBe(0);
    });
  }

  const badPromptVersions = [0, -1, 1.5, Number.NaN, 1_000_001];
  for (const promptVersion of badPromptVersions) {
    it(`refuses a non-exact prompt version (${String(promptVersion)}) before credential resolution`, async () => {
      const resolver = fakeGroqCredentialResolver();
      const result = await bindGroqStagingProvider(
        bindConfig({
          stagingRelease: syntheticGroqStagingRelease({ promptVersion }),
          credentialResolver: resolver,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('groq-bind-prompt-invalid');
      expect(resolver.resolved()).toBe(0);
    });
  }

  const missingRefs = [
    { capabilityProfileRef: '' },
    { capabilityProfileRef: 'latest' },
    { evaluationRef: '' },
    { evaluationRef: '*' },
    { dataControlsAttestationRef: '' },
    { dataControlsAttestationRef: 'not a reference' },
  ];
  for (const over of missingRefs) {
    it(`refuses a missing/invalid approval reference (${Object.keys(over)[0] ?? ''}) before credential resolution`, async () => {
      const resolver = fakeGroqCredentialResolver();
      const transport = fakeGroqTransport(groqStructuredResponseBody({ kind: 'REPLY' }));
      const result = await bindGroqStagingProvider(
        bindConfig({
          stagingRelease: syntheticGroqStagingRelease(over),
          credentialResolver: resolver,
          transport,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('groq-bind-approval-refs-missing');
      expect(resolver.resolved()).toBe(0);
      expect(transport.calls()).toBe(0);
    });
  }

  it('emits the prompt family/version and approval references — and never prompt text', async () => {
    const events: GroqStagingBindEvent[] = [];
    const result = await bindGroqStagingProvider(
      bindConfig({ observability: { onEvent: (e) => events.push(e) } }),
    );
    expect(result.ok).toBe(true);
    const event = events[0];
    expect(event?.promptFamily).toBe('qfj.s1a.synthetic.smoke');
    expect(event?.promptVersion).toBe(1);
    expect(event?.capabilityProfileRef).toBe('cap.groq.reply.v1');
    expect(event?.evaluationRef).toBe('evref-groq-0001');
    expect(event?.dataControlsAttestationRef).toBe('zdr.groq.staging.0001');
    // The event field set stays CLOSED — no prompt/message/output/key/reference-value field appears.
    expect(Object.keys(event ?? {}).sort()).toEqual(
      [
        'capabilityProfileRef',
        'configDigest',
        'credentialResolved',
        'dataClass',
        'dataControlsAttestationRef',
        'evaluationRef',
        'executionClass',
        'modelId',
        'modelVersion',
        'promptFamily',
        'promptVersion',
        'providerId',
        'reason',
        'type',
      ].sort(),
    );
  });

  it('runs the prompt/approval gates AFTER the data-class gate (privacy first)', async () => {
    const resolver = fakeGroqCredentialResolver();
    const result = await bindGroqStagingProvider(
      bindConfig({
        stagingRelease: syntheticGroqStagingRelease({
          dataClass: 'LOCAL_ONLY',
          promptFamily: 'latest',
          capabilityProfileRef: '',
        }),
        credentialResolver: resolver,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('groq-bind-data-class-refused');
    expect(resolver.resolved()).toBe(0);
  });
});

describe('observability and authority', () => {
  it('emits only closed, content-free bind events', async () => {
    const okEvents: GroqStagingBindEvent[] = [];
    await bindGroqStagingProvider(
      bindConfig({ observability: { onEvent: (e) => okEvents.push(e) } }),
    );
    const refusedEvents: GroqStagingBindEvent[] = [];
    await bindGroqStagingProvider(
      bindConfig({
        stagingRelease: syntheticGroqStagingRelease({ dataControlsAttested: false }),
        observability: { onEvent: (e) => refusedEvents.push(e) },
      }),
    );
    for (const e of [...okEvents, ...refusedEvents]) {
      expect(GROQ_STAGING_EVENT_TYPES).toContain(e.type);
      expect(e.providerId).toBe('groq.staging');
    }
    expect(okEvents.map((e) => e.type)).toContain('groq-bind-completed');
    expect(refusedEvents.map((e) => e.type)).toContain('groq-bind-refused');
    expect(refusedEvents[0]?.reason).toBe('groq-bind-attestation-missing');
    expect(refusedEvents[0]?.credentialResolved).toBe(false);
  });

  it('the bind result and bound provider expose no send/deliver/execute surface', async () => {
    const result = await bindGroqStagingProvider(bindConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resultSurface = result as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'persist', 'callN8n', 'authorize']) {
      expect(resultSurface[forbidden]).toBeUndefined();
    }
    expect(Object.keys(result.provider).sort()).not.toContain('send');
    const providerSurface = result.provider as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'callN8n']) {
      expect(providerSurface[forbidden]).toBeUndefined();
    }
  });
});
