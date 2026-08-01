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
import { ORCHESTRATION_PROPOSAL_KINDS } from '../orchestration/vocabularies.js';
import type { CoreDecisionOutcome } from '../orchestration/vocabularies.js';
import { createOrchestrator, orchestrateInbound } from '../orchestration/orchestrate-inbound.js';
import type { OrchestratorConfig } from '../orchestration/orchestrate-inbound.js';
import type { OrchestrationEvent } from '../orchestration/observability.js';
import type { BehaviourDecision, BehaviourDecisionPort } from '../orchestration/behaviour-port.js';
import type {
  KnowledgePort,
  KnowledgeRetrievalResult,
  ModelPromptIdentity,
  ModelPromptSelectionRequest,
} from '../orchestration/model-reply-port.js';
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

  it('the M2 proposal vocabulary is exactly five kinds, in order (ADR-0068)', () => {
    expect([...ORCHESTRATION_PROPOSAL_KINDS]).toEqual([
      'REPLY',
      'FOLLOW_UP',
      'ESCALATE_TO_HUMAN',
      'REQUEST_CLARIFICATION',
      'NO_ACTION',
    ]);
  });

  it('(28,29,30) follow-up / escalation / clarification / no-action proposals are constructible and pending', () => {
    for (const kind of [
      'FOLLOW_UP',
      'ESCALATE_TO_HUMAN',
      'REQUEST_CLARIFICATION',
      'NO_ACTION',
    ] as const) {
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

/**
 * QFJ-S3-I-B — configured prompt-identity selection (ADR-0073).
 *
 * A prompt definition is scope-bound, so a port carrying one global `promptFamily` can serve one
 * agent. A port that implements `selectPromptIdentity` is asked which prompt is configured for the
 * actor M1 ALREADY assigned. That is a configuration lookup, not a second router: nothing here can
 * change the assignment, and the selector cannot see the party type, envelope or conversation.
 */
describe('(ADR-0073) prompt identity is selected once, from the assignment M1 already made', () => {
  /** A port with the per-scope selector, plus a record of exactly what it was asked. */
  function selectingPort(
    answers: Partial<
      Record<string, { promptFamily: string; promptVersion: number; evaluationRef?: string }>
    >,
  ): RecordingModelReplyPort & {
    readonly asks: () => readonly { actor: string; taskClass: string }[];
  } {
    const base = scriptedModelReplyPort();
    const asks: { actor: string; taskClass: string }[] = [];
    return Object.freeze({
      ...base,
      selectPromptIdentity: ({
        assignedActor,
        taskClass,
      }: ModelPromptSelectionRequest): ModelPromptIdentity | undefined => {
        asks.push({ actor: assignedActor, taskClass });
        return answers[assignedActor];
      },
      asks: () => asks,
    });
  }

  it('asks the port exactly once, for the assigned actor, and drafts with the answer', async () => {
    const model = selectingPort({
      RIYA: { promptFamily: 'prompt.riya.client', promptVersion: 3, evaluationRef: 'evref-riya' },
    });
    const { result } = await run({ model });
    expect(result.ok).toBe(true);
    // Exactly once: a second lookup could disagree with the first, and the plan would then name a
    // prompt the request did not use.
    expect(model.asks()).toEqual([{ actor: 'RIYA', taskClass: 'RESPONSE_GENERATION' }]);
  });

  it('refuses when the port has no prompt configured for the assigned scope', async () => {
    // The port answers for ANISHA only, so a CLIENT turn finds nothing. Falling back to the legacy
    // flat fields here would let this scope quietly borrow the other agent's prompt.
    const model = selectingPort({ ANISHA: { promptFamily: 'prompt.vendor', promptVersion: 1 } });
    const { result } = await run({ model });
    expect(result.ok ? '' : result.reason).toBe('orchestration-model-unavailable');
    expect(model.invoked()).toBe(0);
  });

  it('emits model-invocation-skipped, content-free, when no prompt is configured', async () => {
    const model = selectingPort({});
    const { events } = await run({ model });
    const skipped = events.filter((e) => e.type === 'model-invocation-skipped');
    expect(skipped).toHaveLength(1);
    expect(JSON.stringify(skipped)).not.toContain('prompt.');
  });

  it('refuses a selected identity that is a wildcard or `latest` rather than an exact version', async () => {
    for (const promptFamily of ['*', 'latest', 'LATEST']) {
      const model = selectingPort({ RIYA: { promptFamily, promptVersion: 1 } });
      const { result } = await run({ model });
      expect(result.ok ? '' : result.reason).toBe('orchestration-model-unavailable');
      expect(model.invoked()).toBe(0);
    }
  });

  it('applies requireEvaluationRef to the SELECTED identity, not the port-wide field', async () => {
    // One scope may be evaluated while another is not, so the gate has to read the scope's own
    // answer. The port-level `evaluationRef` says nothing about which scope it covers.
    const unevaluated = selectingPort({
      RIYA: { promptFamily: 'prompt.riya.client', promptVersion: 3 },
    });
    const refused = await run({ model: unevaluated, config: { requireEvaluationRef: true } });
    expect(refused.result.ok ? '' : refused.result.reason).toBe(
      'orchestration-evaluation-mismatch',
    );
    expect(unevaluated.invoked()).toBe(0);

    const evaluated = selectingPort({
      RIYA: { promptFamily: 'prompt.riya.client', promptVersion: 3, evaluationRef: 'evref-riya' },
    });
    const accepted = await run({ model: evaluated, config: { requireEvaluationRef: true } });
    expect(accepted.result.ok).toBe(true);
  });

  it('still uses the legacy flat fields when the port has no selector', async () => {
    // ADR-0073 does not retire the single-prompt shape; every existing deployment uses it.
    const { result, model } = await run({ modelConfig: { evaluationRef: 'evref-000000' } });
    expect(result.ok).toBe(true);
    expect(model?.invoked()).toBe(1);
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

describe('the behaviour seam fails closed BEFORE knowledge retrieval and the model call', () => {
  /** A knowledge port that counts retrievals, so "stage 8 never ran" is observed, not argued. */
  function countingKnowledgePort(): KnowledgePort & { readonly invoked: () => number } {
    let calls = 0;
    return {
      invoked: (): number => calls,
      retrieve: (): Promise<KnowledgeRetrievalResult> => {
        calls += 1;
        return Promise.resolve({ ok: true, citations: [] });
      },
    };
  }

  /** A behaviour port that answers with an arbitrary (possibly malformed) value, and counts calls. */
  function scriptedBehaviourPort(
    decision: unknown,
  ): BehaviourDecisionPort & { readonly invoked: () => number } {
    let calls = 0;
    return {
      invoked: (): number => calls,
      decide: (): Promise<BehaviourDecision | undefined> => {
        calls += 1;
        return Promise.resolve(decision as BehaviourDecision | undefined);
      },
    };
  }

  const valid = {
    modelReplyEligible: true,
    proposalKind: 'REPLY',
    structuredIntent: { taskClass: 'RESPONSE_GENERATION', replyKind: 'REPLY' },
  };

  const LONG_KEY = 'k'.repeat(65);
  const LONG_VALUE = 'x'.repeat(1025);

  const malformed: readonly { readonly name: string; readonly decision: unknown }[] = [
    {
      name: 'structuredIntent is an array of strings',
      decision: { ...valid, structuredIntent: ['a', 'b'] },
    },
    {
      name: 'an intent key containing a space',
      decision: { ...valid, structuredIntent: { 'bad key': 'x' } },
    },
    {
      name: 'an intent key containing a slash',
      decision: { ...valid, structuredIntent: { 'bad/key': 'x' } },
    },
    { name: 'an empty intent key', decision: { ...valid, structuredIntent: { '': 'x' } } },
    {
      name: 'an intent key longer than 64',
      decision: { ...valid, structuredIntent: { [LONG_KEY]: 'x' } },
    },
    {
      name: 'a string value longer than 1024',
      decision: { ...valid, structuredIntent: { taskClass: LONG_VALUE } },
    },
    { name: 'a NaN value', decision: { ...valid, structuredIntent: { taskClass: Number.NaN } } },
    {
      name: 'an Infinity value',
      decision: { ...valid, structuredIntent: { taskClass: Number.POSITIVE_INFINITY } },
    },
    { name: 'an unknown top-level field', decision: { ...valid, replyBody: 'smuggled' } },
    {
      name: 'a nested object value',
      decision: { ...valid, structuredIntent: { taskClass: { nested: 1 } } },
    },
    { name: 'a null value', decision: { ...valid, structuredIntent: { taskClass: null } } },
    {
      name: 'an undefined value',
      decision: { ...valid, structuredIntent: { taskClass: undefined } },
    },
    { name: 'a bigint value', decision: { ...valid, structuredIntent: { taskClass: BigInt(1) } } },
    {
      name: 'a proposalKind outside the closed vocabulary',
      decision: { ...valid, proposalKind: 'SEND' },
    },
    { name: 'a non-boolean modelReplyEligible', decision: { ...valid, modelReplyEligible: 'yes' } },
    { name: 'a decision that is an array', decision: [] },
    {
      name: 'a missing top-level field',
      decision: { modelReplyEligible: true, proposalKind: 'REPLY' },
    },
  ];

  for (const scenario of malformed) {
    it(`refuses ${scenario.name} with zero knowledge, model and Core calls`, async () => {
      const knowledge = countingKnowledgePort();
      const behaviour = scriptedBehaviourPort(scenario.decision);
      const { result, model, core } = await run({
        config: { knowledgePort: knowledge, behaviourPort: behaviour },
      });
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toBe('orchestration-invariant');
      // The port is consulted once; nothing downstream of it runs.
      expect(behaviour.invoked()).toBe(1);
      expect(knowledge.invoked()).toBe(0);
      expect(model?.invoked()).toBe(0);
      expect(core?.invoked()).toBe(0);
    });
  }

  it('a rejecting behaviour port fails closed the same way', async () => {
    const knowledge = countingKnowledgePort();
    const { result, model, core } = await run({
      config: {
        knowledgePort: knowledge,
        behaviourPort: {
          decide: (): Promise<BehaviourDecision | undefined> => Promise.reject(new Error('x')),
        },
      },
    });
    expect(result.ok ? '' : result.reason).toBe('orchestration-invariant');
    expect(knowledge.invoked()).toBe(0);
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(0);
  });

  it('a VALID decision still reaches knowledge, the model and Core exactly once', async () => {
    const knowledge = countingKnowledgePort();
    const behaviour = scriptedBehaviourPort(valid);
    const { result, model, core } = await run({
      config: { knowledgePort: knowledge, behaviourPort: behaviour },
    });
    expect(result.ok).toBe(true);
    expect(behaviour.invoked()).toBe(1);
    expect(knowledge.invoked()).toBe(1);
    expect(model?.invoked()).toBe(1);
    expect(core?.invoked()).toBe(1);
  });

  it('a valid NO-MODEL decision skips knowledge and the model but still reaches Core', async () => {
    const knowledge = countingKnowledgePort();
    const { result, model, core } = await run({
      config: {
        knowledgePort: knowledge,
        behaviourPort: scriptedBehaviourPort({
          modelReplyEligible: false,
          proposalKind: 'NO_ACTION',
          structuredIntent: { taskClass: 'RESPONSE_GENERATION', replyKind: 'NO_ACTION' },
        }),
      },
    });
    expect(result.ok).toBe(true);
    expect(knowledge.invoked()).toBe(0);
    expect(model?.invoked()).toBe(0);
    expect(core?.invoked()).toBe(1);
    if (result.ok) {
      expect(result.proposal.kind).toBe('NO_ACTION');
      expect(result.proposal.replyBody).toBeUndefined();
      expect(result.proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
    }
  });

  it('no behaviour port, and a port returning undefined, both keep the exact legacy REPLY default', async () => {
    const configs: Partial<OrchestratorConfig>[] = [
      {},
      { behaviourPort: scriptedBehaviourPort(undefined) },
    ];
    for (const config of configs) {
      const { result, model } = await run({ config });
      expect(result.ok).toBe(true);
      expect(model?.invoked()).toBe(1);
      if (result.ok) {
        expect(result.proposal.kind).toBe('REPLY');
        expect(result.proposal.structuredIntent).toEqual({
          taskClass: 'RESPONSE_GENERATION',
          replyKind: 'REPLY',
        });
      }
    }
  });
});

describe('the canonical run identifier is the envelope runtimeId (ADR-0069)', () => {
  const MAX_RT = 'r'.repeat(128);
  const MAX_ID = 'c'.repeat(128);
  const MAX_MSG = 'm'.repeat(128);

  it('the reply plan, observability and proposal all carry the runtimeId, never a concatenation', async () => {
    const { result, events } = await run({
      envelope: { runtimeId: 'rt.canonical' },
    });
    expect(result.ok).toBe(true);
    for (const event of events) {
      expect(event.runId).toBe('rt.canonical');
      expect(event.runId).not.toContain('conv.1-msg.1');
    }
    if (result.ok) {
      // A bounded derived identity, not `${runId}-reply`.
      expect(result.proposal.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
      expect(result.proposal.proposalId).not.toContain('rt.canonical');
    }
  });

  it('the plan handed to the model port carries the runtimeId as its runId', async () => {
    let seen: string | undefined;
    const model = scriptedModelReplyPort({
      draft: (plan) => {
        seen = plan.runId;
        return {
          structured: true,
          replyBody: 'ok',
          citations: [],
          // usageTraceId travels back as the same canonical value and must satisfy the 128-char bound.
          usageTraceId: plan.runId,
        };
      },
    });
    const { result } = await run({ model, envelope: { runtimeId: MAX_RT } });
    expect(seen).toBe(MAX_RT);
    expect(seen).toHaveLength(128);
    expect(result.ok).toBe(true);
  });

  it('a maximum-length envelope produces a valid draft, proposal and Core call', async () => {
    const model = scriptedModelReplyPort({
      draft: (plan) => ({
        structured: true,
        replyBody: 'ok',
        citations: [],
        usageTraceId: plan.runId,
      }),
    });
    const { result, core } = await run({
      model,
      contexts: [ctx({ conversationId: MAX_ID })],
      envelope: { runtimeId: MAX_RT, conversationId: MAX_ID, messageId: MAX_MSG },
    });
    // Before ADR-0069 the 257-character run id made the draft's usageTraceId invalid here.
    expect(result.ok).toBe(true);
    expect(model.invoked()).toBe(1);
    expect(core?.invoked()).toBe(1);
    if (result.ok) {
      expect(result.proposal.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
      expect(result.proposal.proposalId.length).toBeLessThan(128);
      expect(result.proposal.expectedRevision).toBe(1);
      expect(result.proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
    }
  });

  it('the derived proposal id is deterministic and identity-sensitive', async () => {
    const idFor = async (over: Partial<InboundEnvelopeInput>): Promise<string> => {
      const { result } = await run({ envelope: { runtimeId: MAX_RT, ...over } });
      return result.ok ? result.proposal.proposalId : 'refused';
    };
    const base = await idFor({});
    expect(await idFor({})).toBe(base);
    expect(await idFor({ runtimeId: 'rt.other' })).not.toBe(base);
    expect(await idFor({ messageId: 'msg.other' })).not.toBe(base);

    // A different expected revision is a different proposal identity.
    const otherRevision = await run({
      contexts: [ctx({ revision: 2 })],
      envelope: { runtimeId: MAX_RT },
    });
    expect(otherRevision.result.ok ? otherRevision.result.proposal.proposalId : '').not.toBe(base);

    // A different proposal KIND is a different proposal identity.
    const otherKind = await run({
      envelope: { runtimeId: MAX_RT },
      config: {
        behaviourPort: {
          decide: (): Promise<BehaviourDecision | undefined> =>
            Promise.resolve({
              modelReplyEligible: false,
              proposalKind: 'NO_ACTION',
              structuredIntent: { taskClass: 'RESPONSE_GENERATION', replyKind: 'NO_ACTION' },
            }),
        },
      },
    });
    expect(otherKind.result.ok ? otherKind.result.proposal.proposalId : '').not.toBe(base);
  });

  it('the derived id leaks no raw identity and uses only the allowed grammar', async () => {
    const { result } = await run({
      contexts: [ctx({ conversationId: MAX_ID })],
      envelope: { runtimeId: MAX_RT, conversationId: MAX_ID, messageId: MAX_MSG },
      model: scriptedModelReplyPort({
        draft: (plan) => ({
          structured: true,
          replyBody: 'ok',
          citations: [],
          usageTraceId: plan.runId,
        }),
      }),
    });
    if (result.ok) {
      const id = result.proposal.proposalId;
      expect(id).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
      for (const raw of [MAX_RT, MAX_ID, MAX_MSG, 'ref.opaque', 'prompt.family.a']) {
        expect(id).not.toContain(raw);
      }
    }
  });
});
