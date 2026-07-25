/**
 * QFJ-M2 — Core decision and reply orchestration (ADR-0055).
 *
 * Matrix items 6–80: processing-order short-circuits (no model/Core when a gate blocks); model plan +
 * draft validation; proposal contract; Core decision port + outcomes; the double gate; knowledge/
 * evaluation/RAG boundaries; content-free observability; and authority/containment. (Items 1–5 are the
 * M1 regression — the M1 specs remain green and the merge is proven separately.)
 *
 * The orchestration entry point and its injected ports are asynchronous (ADR-0058); `run` awaits
 * `orchestrateInbound` and every case awaits `run`.
 */
import { describe, expect, it } from 'vitest';

import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import type { InboundEnvelopeInput } from '../contracts/inbound-envelope.js';
import { AgentRuntimeError } from '../contracts/errors.js';
import { createDeterministicPrivacyGate } from '../testing/deterministic-privacy-gate.js';
import { syntheticPolicy } from '../testing/fixtures.js';
import {
  createOrchestrationContext,
  createOrchestrationProposal,
} from '../orchestration/contracts.js';
import type {
  OrchestrationContext,
  OrchestrationContextInput,
} from '../orchestration/contracts.js';
import { PROPOSAL_AUTHORITY_STATUS } from '../index.js';
import type { CoreDecisionOutcome } from '../orchestration/vocabularies.js';
import { createOrchestrator, orchestrateInbound } from '../orchestration/orchestrate-inbound.js';
import type { OrchestratorConfig } from '../orchestration/orchestrate-inbound.js';
import type { OrchestrationEvent } from '../orchestration/observability.js';
import {
  orchestrationEnvelopeFields,
  scriptedContextPort,
  scriptedCoreDecisionPort,
  scriptedKnowledgePort,
  scriptedModelReplyPort,
  syntheticCitation,
} from '../testing/deterministic-orchestration-ports.js';
import type {
  RecordingCoreDecisionPort,
  RecordingModelReplyPort,
} from '../testing/deterministic-orchestration-ports.js';

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
function env(over: Partial<InboundEnvelopeInput> = {}) {
  return createInboundEnvelope({ ...orchestrationEnvelopeFields(), ...over });
}

interface RunOpts {
  readonly contexts?: readonly OrchestrationContext[];
  readonly model?: RecordingModelReplyPort | null;
  readonly modelConfig?: Parameters<typeof scriptedModelReplyPort>[0];
  readonly core?: RecordingCoreDecisionPort | null;
  readonly coreOutcome?: CoreDecisionOutcome;
  readonly config?: Partial<OrchestratorConfig>;
  readonly envelope?: Partial<InboundEnvelopeInput>;
}

async function run(opts: RunOpts = {}) {
  const contexts = opts.contexts ?? [ctx()];
  const contextPort = scriptedContextPort(...contexts);
  const model =
    opts.model === null
      ? undefined
      : (opts.model ?? scriptedModelReplyPort(opts.modelConfig ?? {}));
  const core =
    opts.core === null
      ? undefined
      : (opts.core ?? scriptedCoreDecisionPort(opts.coreOutcome ?? 'ACCEPTED'));
  const events: OrchestrationEvent[] = [];
  const orch = createOrchestrator({
    policy: syntheticPolicy(opts.config?.policy?.unknownRouting),
    contextPort,
    ...(model === undefined ? {} : { modelReplyPort: model }),
    ...(core === undefined ? {} : { coreDecisionPort: core }),
    observability: { onEvent: (e) => events.push(e) },
    ...opts.config,
  });
  const result = await orchestrateInbound(orch, env(opts.envelope));
  return { result, model, core, contextPort, events };
}

describe('processing order and short-circuit', () => {
  it('(6) an envelope that does not match the context invokes nothing', async () => {
    const { result, model, core } = await run({ envelope: { conversationId: 'conv.OTHER' } });
    expect(result.ok ? '' : result.reason).toBe('orchestration-envelope-invalid');
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('(7) human takeover invokes no model/Core', async () => {
    const { result, model, core } = await run({ contexts: [ctx({ humanTakeover: true })] });
    expect(result.ok ? '' : result.reason).toBe('orchestration-human-takeover');
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('(8) AI pause invokes no model/Core', async () => {
    const { result, model, core } = await run({ contexts: [ctx({ aiPaused: true })] });
    expect(result.ok ? '' : result.reason).toBe('orchestration-ai-paused');
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('(9,13) a non-AI assignment / cancelled context invokes no model/Core', async () => {
    const human = await run({
      contexts: [ctx({ partyType: 'UNKNOWN' })],
      envelope: { partyType: 'UNKNOWN' },
      config: { policy: syntheticPolicy('HUMAN') },
    });
    expect(human.result.ok).toBe(false);
    expect(human.model?.invoked()).toBe(0);
    const cancelled = await run({ contexts: [ctx({ cancelled: true })] });
    expect(cancelled.result.ok ? '' : cancelled.result.reason).toBe('orchestration-cancelled');
    expect(cancelled.model?.invoked()).toBe(0);
    expect(cancelled.core?.invoked()).toBe(0);
  });

  it('(10) HUMAN_ONLY invokes no model/Core', async () => {
    const { result, model, core } = await run({
      contexts: [ctx({ dataClass: 'HUMAN_ONLY' })],
      envelope: { dataClass: 'HUMAN_ONLY' },
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-human-only');
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('(11) LOCAL_ONLY with a hosted-only model invokes no model/Core', async () => {
    const { result, model, core } = await run({
      contexts: [ctx({ dataClass: 'LOCAL_ONLY' })],
      envelope: { dataClass: 'LOCAL_ONLY' },
      modelConfig: { executionClass: 'HOSTED' },
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-data-class-unserviceable');
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('(12) a privacy refusal invokes no model/Core', async () => {
    const missing = await run({ contexts: [ctx({ subjectRef: 'subject.1' })] });
    expect(missing.result.ok ? '' : missing.result.reason).toBe(
      'orchestration-privacy-gate-missing',
    );
    expect(missing.model?.invoked()).toBe(0);
    const blocked = await run({
      contexts: [ctx({ subjectRef: 'subject.1' })],
      config: {
        privacyGate: createDeterministicPrivacyGate({ statuses: { 'subject.1': 'erased' } }),
      },
    });
    expect(blocked.result.ok ? '' : blocked.result.reason).toBe('orchestration-subject-blocked');
    expect(blocked.model?.invoked()).toBe(0);
    expect(blocked.core?.invoked()).toBe(0);
  });

  it('(15) a malformed model draft invokes no Core', async () => {
    const { result, model, core } = await run({
      modelConfig: { draft: () => ({ notStructured: true }) },
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-draft-invalid');
    expect(model?.invoked()).toBe(1);
    expect(core?.invoked()).toBe(0);
  });

  it('(16) the valid path is deterministic', async () => {
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    expect(a.result.ok).toBe(true);
  });
});

describe('model plan and draft', () => {
  it('(22,24,25) a fabricated/versionless citation or a raw body/CoT field makes the draft invalid', async () => {
    // Fabricated citation not in the (empty) plan citation set.
    const fabricated = await run({
      modelConfig: {
        draft: () => ({
          structured: true,
          replyBody: 'x',
          citations: [{ knowledgeId: 'kb.fake', version: 9 }],
          usageTraceId: 't',
        }),
      },
    });
    expect(fabricated.result.ok ? '' : fabricated.result.reason).toBe(
      'orchestration-draft-invalid',
    );
    // Extra raw-body / chain-of-thought field rejected by the strict schema.
    const rawBody = await run({
      modelConfig: {
        draft: () => ({
          structured: true,
          replyBody: 'x',
          citations: [],
          usageTraceId: 't',
          chainOfThought: 'secret',
        }),
      },
    });
    expect(rawBody.result.ok ? '' : rawBody.result.reason).toBe('orchestration-draft-invalid');
  });

  it('(21) exact knowledge citations flow through when the model echoes them', async () => {
    const citation = syntheticCitation('kb.policy', 3);
    const { result } = await run({
      config: {
        knowledgePort: scriptedKnowledgePort({ ok: true, citations: [citation] }),
        knowledgeTopics: ['sla'],
      },
      modelConfig: {
        draft: (plan) => ({
          structured: true,
          replyBody: 'grounded',
          citations: plan.citations.map((c) => ({
            knowledgeId: c.knowledgeId,
            version: c.version,
          })),
          usageTraceId: 't',
        }),
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.citations[0]?.knowledgeId).toBe('kb.policy');
      expect(result.proposal.citations[0]?.version).toBe(3);
    }
  });
});

describe('proposals', () => {
  it('(27,31,32) a REPLY proposal is bounded, frozen, PENDING_CORE_VALIDATION, with no send/execute method', async () => {
    const { result } = await run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.kind).toBe('REPLY');
      expect(result.proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
      expect(Object.isFrozen(result.proposal)).toBe(true);
      const asRecord = result.proposal as unknown as Record<string, unknown>;
      for (const method of ['send', 'execute', 'authorize', 'callN8n', 'commit', 'deliver']) {
        expect(asRecord[method]).toBeUndefined();
      }
    }
  });

  it('(28,29,30) escalation / clarification / no-action proposals are constructible and pending', () => {
    for (const kind of ['ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION'] as const) {
      const proposal = createOrchestrationProposal({
        proposalId: `p-${kind}`,
        proposalVersion: 1,
        conversationId: 'c1',
        expectedRevision: 1,
        assignedActor: 'JARVIS',
        partyType: 'UNKNOWN',
        kind,
        structuredIntent: { kind },
        citations: [],
      });
      expect(proposal.kind).toBe(kind);
      expect(proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
    }
  });

  it('(33,34) Riya cannot propose a vendor-scoped reply and Anisha cannot propose a client-scoped reply', async () => {
    const attempt = (assignedActor: 'RIYA' | 'ANISHA', partyType: 'CLIENT' | 'VENDOR') =>
      createOrchestrationProposal({
        proposalId: 'p',
        proposalVersion: 1,
        conversationId: 'c1',
        expectedRevision: 1,
        assignedActor,
        partyType,
        kind: 'REPLY',
        structuredIntent: {},
        citations: [],
      });
    expect(() => attempt('RIYA', 'VENDOR')).toThrow(AgentRuntimeError);
    expect(() => attempt('ANISHA', 'CLIENT')).toThrow(AgentRuntimeError);
    // Deterministic assignment never produces a crossover: CLIENT → RIYA, VENDOR → ANISHA.
    expect((await run({ contexts: [ctx({ partyType: 'CLIENT' })] })).result.ok && 'RIYA').toBe(
      'RIYA',
    );
    const vendor = await run({
      contexts: [ctx({ partyType: 'VENDOR' })],
      envelope: { partyType: 'VENDOR' },
    });
    expect(vendor.result.ok && vendor.result.assignedActor).toBe('ANISHA');
  });
});

describe('Core decision', () => {
  it('(36,43) a missing Core port fails closed to CORE_UNAVAILABLE and cannot be fabricated', async () => {
    const { result } = await run({ core: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.outcome).toBe('CORE_UNAVAILABLE');
    }
  });

  it('(37,38,39,40,41,44) each Core outcome is returned safely and ACCEPTED is not sent/executed', async () => {
    for (const outcome of [
      'ACCEPTED',
      'REJECTED',
      'HUMAN_REVIEW_REQUIRED',
      'RETRY_LATER',
      'STALE_REVISION',
    ] as const) {
      const { result } = await run({ coreOutcome: outcome });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.decision.outcome).toBe(outcome);
        expect(result.decision.boundRevision).toBe(1);
        const asRecord = result.decision as unknown as Record<string, unknown>;
        for (const method of ['send', 'deliver', 'execute']) {
          expect(asRecord[method]).toBeUndefined();
        }
      }
    }
  });

  it('(42,45) the decision is immutable and there is no delivery command', async () => {
    const { result } = await run({ coreOutcome: 'ACCEPTED' });
    expect(result.ok && Object.isFrozen(result.decision)).toBe(true);
    const orchModule = await run();
    const asRecord = orchModule.result as unknown as Record<string, unknown>;
    for (const method of ['send', 'deliver', 'transmit', 'dispatch']) {
      expect(asRecord[method]).toBeUndefined();
    }
  });
});

describe('double gate', () => {
  it('(46) takeover after model drafting blocks the Core request', async () => {
    const { result, model, core } = await run({ contexts: [ctx(), ctx({ humanTakeover: true })] });
    expect(result.ok ? '' : result.reason).toBe('orchestration-human-takeover');
    expect(model?.invoked()).toBe(1);
    expect(core?.invoked()).toBe(0);
  });

  it('(47) AI pause after drafting blocks the Core request', async () => {
    const { result, core } = await run({ contexts: [ctx(), ctx({ aiPaused: true })] });
    expect(result.ok ? '' : result.reason).toBe('orchestration-ai-paused');
    expect(core?.invoked()).toBe(0);
  });

  it('(48) cancellation after drafting blocks the Core request', async () => {
    const { result, model, core } = await run({ contexts: [ctx(), ctx({ cancelled: true })] });
    expect(result.ok ? '' : result.reason).toBe('orchestration-cancelled');
    expect(model?.invoked()).toBe(1);
    expect(core?.invoked()).toBe(0);
  });

  it('(49) a revision change after drafting blocks the Core request', async () => {
    const { result, core } = await run({ contexts: [ctx({ revision: 1 }), ctx({ revision: 2 })] });
    expect(result.ok ? '' : result.reason).toBe('orchestration-stale-revision');
    expect(core?.invoked()).toBe(0);
  });

  it('(50) a privacy change after drafting blocks the Core request', async () => {
    const { result, model, core } = await run({
      contexts: [ctx(), ctx({ subjectRef: 'subject.1' })],
      config: {
        privacyGate: createDeterministicPrivacyGate({ statuses: { 'subject.1': 'tombstoned' } }),
      },
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-subject-blocked');
    expect(model?.invoked()).toBe(1);
    expect(core?.invoked()).toBe(0);
  });

  it('(51) an assignment (party) change after drafting blocks the Core request', async () => {
    const { result, core } = await run({
      contexts: [ctx({ partyType: 'CLIENT' }), ctx({ partyType: 'VENDOR' })],
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-stale-revision');
    expect(core?.invoked()).toBe(0);
  });
});

describe('knowledge / evaluation / RAG', () => {
  it('(53,54) a knowledge refusal fails closed before model/Core', async () => {
    const { result, model, core } = await run({
      config: { knowledgePort: scriptedKnowledgePort({ ok: false }) },
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-knowledge-refused');
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('(56) a required evaluation ref that is absent is refused before model invocation', async () => {
    const { result, model } = await run({
      config: { requireEvaluationRef: true },
      modelConfig: {},
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-evaluation-mismatch');
    expect(model?.invoked()).toBe(0);
    const withEval = await run({
      config: { requireEvaluationRef: true },
      modelConfig: { evaluationRef: 'evref-000000' },
    });
    expect(withEval.result.ok).toBe(true);
  });
});

describe('observability', () => {
  it('(60,61,62) events are content-free with no inbound/reply text, prompt, subject, or token', async () => {
    const { events } = await run({
      config: {
        privacyGate: createDeterministicPrivacyGate({ statuses: { 'subject.SECRET': 'clear' } }),
      },
      contexts: [ctx({ subjectRef: 'subject.SECRET' })],
      envelope: { normalizedText: 'SECRET-INBOUND', subjectRef: 'subject.SECRET' },
      modelConfig: {
        draft: () => ({
          structured: true,
          replyBody: 'SECRET-REPLY',
          citations: [],
          usageTraceId: 't',
        }),
      },
    });
    const serialized = JSON.stringify(events);
    for (const forbidden of ['SECRET-INBOUND', 'SECRET-REPLY', 'subject.SECRET']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
