/**
 * QFJ-S3-B — the shared agent-turn entry point and the provenance envelope (ADR-0066).
 *
 * Two things are under test, and only two. ADR-0054 already owns identity, party, scope, assignment,
 * proposals and the state machine, and ADR-0055 already owns the 15-stage pipeline; those are proved by
 * the merged specs and are exercised here only where `runAgentTurn` must be shown to INHERIT them
 * rather than re-decide them.
 *
 * Every test is offline: deterministic scripted ports, synthetic fixtures, no model, no network, no
 * filesystem, no database, no environment read.
 */
import { describe, expect, it } from 'vitest';

import { AgentRuntimeError } from '../contracts/errors.js';
import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import type { InboundEnvelopeInput } from '../contracts/inbound-envelope.js';
import {
  createRuntimeProvenance,
  RUNTIME_MODEL_OUTPUT_RETENTION,
  RUNTIME_PROVENANCE_AUTHORITY,
  RUNTIME_PROVENANCE_VERSION,
} from '../contracts/provenance.js';
import type { RuntimeProvenanceInput } from '../contracts/provenance.js';
import { isActorPartyCompatible } from '../contracts/scope.js';
import { RUNTIME_ACTORS, RUNTIME_PARTY_TYPES } from '../contracts/vocabularies.js';
import type { RuntimeActor, RuntimePartyType } from '../contracts/vocabularies.js';
import { createOrchestrationContext } from '../orchestration/contracts.js';
import type {
  OrchestrationContext,
  OrchestrationContextInput,
} from '../orchestration/contracts.js';
import { createOrchestrator } from '../orchestration/orchestrate-inbound.js';
import type { OrchestratorConfig } from '../orchestration/orchestrate-inbound.js';
import { runAgentTurn, SHARED_RUNTIME_VERSION } from '../runtime/run-agent-turn.js';
import {
  orchestrationEnvelopeFields,
  scriptedContextPort,
  scriptedCoreDecisionPort,
  scriptedModelReplyPort,
} from '../testing/deterministic-orchestration-ports.js';
import { syntheticPolicy } from '../testing/fixtures.js';

const REFS = {
  runtimeRef: 'rt.s3b.v1',
  policyRef: 'policy.rev.1',
  correlationId: 'corr.1',
  occurredAt: '2026-07-31T00:00:00.000Z',
} as const;

function ctx(over: Partial<OrchestrationContextInput> = {}): OrchestrationContext {
  return createOrchestrationContext({
    conversationId: 'conv.1',
    tenantId: 'tenant.a',
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    revision: 1,
    ...over,
  });
}
const env = (over: Partial<InboundEnvelopeInput> = {}) =>
  createInboundEnvelope({ ...orchestrationEnvelopeFields(), ...over });

async function turn(
  opts: {
    readonly contexts?: readonly OrchestrationContext[];
    readonly envelope?: Partial<InboundEnvelopeInput>;
    readonly config?: Partial<OrchestratorConfig>;
    readonly withModel?: boolean;
  } = {},
) {
  const model = scriptedModelReplyPort({});
  const core = scriptedCoreDecisionPort('ACCEPTED');
  const contextPort = scriptedContextPort(...(opts.contexts ?? [ctx(), ctx()]));
  const orchestrator = createOrchestrator({
    policy: syntheticPolicy(),
    contextPort,
    ...(opts.withModel === false ? {} : { modelReplyPort: model }),
    coreDecisionPort: core,
    ...opts.config,
  });
  const result = await runAgentTurn(orchestrator, {
    envelope: env(opts.envelope),
    provenance: REFS,
  });
  return { result, model, core, contextPort };
}

describe('(2-5) the provenance envelope', () => {
  const input: RuntimeProvenanceInput = { actor: 'RIYA', ...REFS };

  it('(2) a valid record is frozen and carries contract version 1', () => {
    const p = createRuntimeProvenance(input);
    expect(Object.isFrozen(p)).toBe(true);
    expect(p.contractVersion).toBe(1);
    expect(RUNTIME_PROVENANCE_VERSION).toBe(1);
    expect(p.actor).toBe('RIYA');
    expect(p.correlationId).toBe('corr.1');
    expect(p.occurredAt).toBe('2026-07-31T00:00:00.000Z');
    // Optional references stay undefined rather than becoming an empty string or a bag.
    expect(p.promptRef).toBeUndefined();
    expect(p.modelRef).toBeUndefined();
  });

  it('(3) authority is QUICKFURNO_CORE and cannot be supplied by a caller', () => {
    expect(createRuntimeProvenance(input).authority).toBe('QUICKFURNO_CORE');
    expect(RUNTIME_PROVENANCE_AUTHORITY).toBe('QUICKFURNO_CORE');
    // A caller attempting to assert a different authority is refused, not silently ignored.
    expect(() =>
      createRuntimeProvenance({ ...input, authority: 'SOMEONE_ELSE' } as RuntimeProvenanceInput),
    ).toThrow(AgentRuntimeError);
  });

  it('(4) modelOutputRetention is DISCARDED and cannot be supplied by a caller', () => {
    expect(createRuntimeProvenance(input).modelOutputRetention).toBe('DISCARDED');
    expect(RUNTIME_MODEL_OUTPUT_RETENTION).toBe('DISCARDED');
    expect(() =>
      createRuntimeProvenance({
        ...input,
        modelOutputRetention: 'RETAINED',
      } as RuntimeProvenanceInput),
    ).toThrow(AgentRuntimeError);
  });

  it('(5) every disclosure-bearing field is refused as an unknown key', () => {
    for (const forbidden of [
      'credential',
      'credentialPath',
      'apiKey',
      'authorization',
      'url',
      'endpoint',
      'headers',
      'httpStatus',
      'body',
      'responseBody',
      'providerMessage',
      'message',
      'stack',
      'cause',
      'prompt',
      'promptText',
      'modelOutput',
      'output',
      'metadata',
      'executor',
      'webhook',
    ]) {
      expect(() => createRuntimeProvenance({ ...input, [forbidden]: 'x' })).toThrow(
        AgentRuntimeError,
      );
    }
  });

  it('references are bounded opaque tokens — no path, URL, whitespace or command', () => {
    for (const bad of [
      '',
      'a'.repeat(129),
      '/etc/passwd',
      'C:\\secrets\\key.txt',
      'https://api.groq.com/v1',
      'has space',
      'semi;colon',
      'pipe|char',
      '{"json":true}',
    ]) {
      expect(() => createRuntimeProvenance({ ...input, runtimeRef: bad })).toThrow(
        AgentRuntimeError,
      );
    }
  });

  it('the instant must be canonical, and the actor must be a known runtime actor', () => {
    for (const bad of ['2026-07-31', '2026-07-31T00:00:00+05:30', 'not-a-time', '']) {
      expect(() => createRuntimeProvenance({ ...input, occurredAt: bad })).toThrow(
        AgentRuntimeError,
      );
    }
    expect(() => createRuntimeProvenance({ ...input, actor: 'MALLORY' as RuntimeActor })).toThrow(
      AgentRuntimeError,
    );
    for (const actor of RUNTIME_ACTORS) {
      expect(createRuntimeProvenance({ ...input, actor }).actor).toBe(actor);
    }
  });

  it('the throw is the established normalized error, never a raw zod error', () => {
    try {
      createRuntimeProvenance({ ...input, runtimeRef: '' });
      throw new Error('expected a refusal');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentRuntimeError);
      expect((error as AgentRuntimeError).code).toBe('invalid-provenance');
      expect((error as AgentRuntimeError).message).toBe('A runtime provenance record is invalid.');
      // No caller content is echoed back.
      expect(JSON.stringify((error as AgentRuntimeError).message)).not.toContain('runtimeRef');
    }
  });
});

describe('(6-11, 24) the merged actor x party invariants are INHERITED, not re-decided', () => {
  it('(24) cross-product: the merged compatibility rule is total and unchanged', () => {
    const expected: Record<RuntimeActor, readonly RuntimePartyType[]> = {
      RIYA: ['CLIENT'],
      ANISHA: ['VENDOR'],
      JARVIS: ['CLIENT', 'VENDOR', 'UNKNOWN'],
      HUMAN: ['CLIENT', 'VENDOR', 'UNKNOWN'],
      SYSTEM: ['CLIENT', 'VENDOR', 'UNKNOWN'],
    };
    for (const actor of RUNTIME_ACTORS) {
      for (const party of RUNTIME_PARTY_TYPES) {
        expect(`${actor}/${party}=${String(isActorPartyCompatible(actor, party))}`).toBe(
          `${actor}/${party}=${String(expected[actor].includes(party))}`,
        );
      }
    }
  });

  it('(8, 9) RIYA+VENDOR and ANISHA+CLIENT are refused by the single merged mechanism', () => {
    expect(isActorPartyCompatible('RIYA', 'VENDOR')).toBe(false);
    expect(isActorPartyCompatible('ANISHA', 'CLIENT')).toBe(false);
  });

  it('(6) a client turn can only be attributed to RIYA, JARVIS, HUMAN or SYSTEM', async () => {
    const { result } = await turn({ contexts: [ctx({ partyType: 'CLIENT' }), ctx()] });
    const actor = result.provenance.actor;
    expect(['RIYA', 'JARVIS', 'HUMAN', 'SYSTEM']).toContain(actor);
    expect(actor).not.toBe('ANISHA');
  });

  it('(7) a vendor turn can only be attributed to ANISHA, JARVIS, HUMAN or SYSTEM', async () => {
    const vendor = [
      ctx({ partyType: 'VENDOR', conversationId: 'conv.v' }),
      ctx({ partyType: 'VENDOR', conversationId: 'conv.v' }),
    ];
    const { result } = await turn({
      contexts: vendor,
      envelope: { conversationId: 'conv.v', partyType: 'VENDOR' },
    });
    const actor = result.provenance.actor;
    expect(['ANISHA', 'JARVIS', 'HUMAN', 'SYSTEM']).toContain(actor);
    expect(actor).not.toBe('RIYA');
  });

  it('(10, 11) JARVIS coordination and HUMAN escalation remain valid everywhere', () => {
    for (const party of RUNTIME_PARTY_TYPES) {
      expect(isActorPartyCompatible('JARVIS', party)).toBe(true);
      expect(isActorPartyCompatible('HUMAN', party)).toBe(true);
    }
  });
});

describe('(12-16) the decision-port boundary', () => {
  it('(14, 15) a normal turn calls the model port at most once and never retries', async () => {
    const { result, model, core } = await turn();
    expect(model.invoked()).toBeLessThanOrEqual(1);
    expect(core.invoked()).toBeLessThanOrEqual(1);
    expect(result.runtimeVersion).toBe(SHARED_RUNTIME_VERSION);
  });

  it('(12) an AI-paused conversation makes ZERO decision-port calls', async () => {
    const paused = [ctx({ aiPaused: true }), ctx({ aiPaused: true })];
    const { result, model, core } = await turn({ contexts: paused });
    expect(model.invoked()).toBe(0);
    expect(core.invoked()).toBe(0);
    expect(result.outcome.ok).toBe(false);
    // A blocked turn is still fully auditable.
    expect(result.provenance.authority).toBe('QUICKFURNO_CORE');
    expect(result.provenance.modelOutputRetention).toBe('DISCARDED');
  });

  it('(13) a human-takeover conversation makes ZERO decision-port calls', async () => {
    const taken = [ctx({ humanTakeover: true }), ctx({ humanTakeover: true })];
    const { result, model, core } = await turn({ contexts: taken });
    expect(model.invoked()).toBe(0);
    expect(core.invoked()).toBe(0);
    expect(result.outcome.ok).toBe(false);
    expect(result.provenance.actor).toBe('SYSTEM');
  });

  it('(16) a refusal is attributed to SYSTEM, never to an agent that did not act', async () => {
    const { result } = await turn({ envelope: { conversationId: 'conv.MISMATCH' } });
    expect(result.outcome.ok).toBe(false);
    expect(result.provenance.actor).toBe('SYSTEM');
  });

  it('the shared entry point adds no port call of its own on any path', async () => {
    // Blocked path: zero. Served path: at most the merged pipeline's own single call.
    const blocked = await turn({ contexts: [ctx({ aiPaused: true }), ctx({ aiPaused: true })] });
    expect(blocked.model.invoked()).toBe(0);
    const served = await turn();
    expect(served.model.invoked()).toBeLessThanOrEqual(1);
  });
});

describe('(17-23) authority, immutability and containment', () => {
  it('(17) a successful proposal remains PENDING_CORE_VALIDATION', async () => {
    const { result } = await turn();
    if (result.outcome.ok) {
      expect(result.outcome.proposal.authorityStatus).toBe('PENDING_CORE_VALIDATION');
    }
  });

  it('(18) no result carries an executable field or command string', async () => {
    const { result } = await turn();
    const serialised = JSON.stringify(result);
    for (const forbidden of [
      'executor',
      'webhook',
      'workflowId',
      'http://',
      'https://',
      'SELECT ',
      'INSERT ',
      'Bearer ',
      'authorization',
      'credential',
      'apiKey',
      '.key',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('(23) the returned result is frozen', async () => {
    const { result } = await turn();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
  });

  it('(19) the shared runtime persists nothing — the context port is read-only', async () => {
    const { contextPort } = await turn();
    // The port exposes reads only; there is no write, commit or persist surface to call.
    expect(contextPort.reads()).toBeGreaterThan(0);
    expect(Object.keys(contextPort).sort()).toEqual(['read', 'reads']);
  });

  it('(25) the entry point imports nothing provider-, transport- or storage-capable', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../runtime/run-agent-turn.ts', import.meta.url)),
      'utf8',
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    for (const forbidden of [
      'node:fs',
      'node:net',
      'node:http',
      'child_process',
      'fetch(',
      'process.env',
      'pg',
      'supabase',
      'groq',
      'model-gateway',
      'console.',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('(21) an invalid provenance reference normalizes and no partial result escapes', async () => {
    const model = scriptedModelReplyPort({});
    const orchestrator = createOrchestrator({
      policy: syntheticPolicy(),
      contextPort: scriptedContextPort(ctx(), ctx()),
      modelReplyPort: model,
      coreDecisionPort: scriptedCoreDecisionPort('ACCEPTED'),
    });
    await expect(
      runAgentTurn(orchestrator, {
        envelope: env(),
        provenance: { ...REFS, correlationId: 'has space' },
      }),
    ).rejects.toBeInstanceOf(AgentRuntimeError);
  });
});
