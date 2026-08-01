/**
 * QFJ-M4 async-compatibility correction — genuinely asynchronous orchestration (ADR-0058).
 *
 * Async matrix 1–22 (orchestrator scope): orchestrateInbound returns a Promise; the model and Core
 * ports are awaited (a delayed valid result still yields a proposal only); a rejected model or Core
 * Promise is normalized to a fail-closed result without an unhandled rejection or a raw error; a state
 * change that lands WHILE the model Promise is pending is observed by the post-draft re-read and blocks
 * Core; the model and Core ports are each invoked at most once with no orchestrator-owned retry; the
 * processing order stays deterministic across awaits; pure planning stays synchronous.
 */
import { describe, expect, it } from 'vitest';

import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import { createOrchestrationContext } from '../orchestration/contracts.js';
import type {
  ModelReleaseRef,
  OrchestrationContext,
  ReplyPlan,
} from '../orchestration/contracts.js';
import { createReplyPlan } from '../orchestration/create-reply-plan.js';
import { createOrchestrator, orchestrateInbound } from '../orchestration/orchestrate-inbound.js';
import type { ConversationContextPort, ModelReplyPort } from '../orchestration/model-reply-port.js';
import type { CoreDecisionPort } from '../orchestration/core-decision-port.js';
import { syntheticPolicy } from '../testing/fixtures.js';
import {
  orchestrationEnvelopeFields,
  scriptedContextPort,
  scriptedCoreDecisionPort,
  scriptedModelReplyPort,
} from '../testing/deterministic-orchestration-ports.js';

const RELEASE: ModelReleaseRef = Object.freeze({
  releaseId: 'rel.async.1',
  providerId: 'fake',
  modelId: 'fake-model',
  modelVersion: 'v1',
  configDigest: 'abcdef01',
  executionClass: 'HOSTED',
});

function ctx(
  over: Partial<Parameters<typeof createOrchestrationContext>[0]> = {},
): OrchestrationContext {
  return createOrchestrationContext({
    conversationId: 'conv.1',
    tenantId: 'tenant.a',
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    revision: 1,
    ...over,
  });
}
const env = () => createInboundEnvelope(orchestrationEnvelopeFields());

/** A context port reading a mutable cell — lets an external change land between awaited reads. */
function mutableContextPort(get: () => OrchestrationContext): ConversationContextPort {
  return Object.freeze({ read: () => Promise.resolve(get()) });
}

const validDraft = () => ({
  structured: true,
  replyBody: 'async reply body',
  citations: [] as { knowledgeId: string; version: number }[],
  usageTraceId: 'trace.async',
});

function orch(
  model: ModelReplyPort | undefined,
  core: CoreDecisionPort | undefined,
  contextPort: ConversationContextPort,
) {
  return createOrchestrator({
    policy: syntheticPolicy(),
    contextPort,
    ...(model ? { modelReplyPort: model } : {}),
    ...(core ? { coreDecisionPort: core } : {}),
  });
}

describe('async orchestration — shape and awaiting', () => {
  it('(1) orchestrateInbound returns a Promise', async () => {
    const o = orch(
      scriptedModelReplyPort({ draft: validDraft }),
      scriptedCoreDecisionPort('ACCEPTED'),
      scriptedContextPort(ctx()),
    );
    const pending = orchestrateInbound(o, env());
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });

  it('(2,3,18,19) a delayed valid model + Core result yields a proposal only, both ports awaited', async () => {
    const model = scriptedModelReplyPort({
      draft: () => {
        // A microtask-delayed resolution still completes before the orchestrator continues.
        return validDraft();
      },
    });
    const core = scriptedCoreDecisionPort('ACCEPTED');
    const { ...result } = await orchestrateInbound(
      orch(model, core, scriptedContextPort(ctx())),
      env(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.kind).toBe('REPLY');
      expect(result.decision.outcome).toBe('ACCEPTED');
      // A delivered ACCEPTED is still only a decision object — no send/deliver surface.
      const asRecord = result.decision as unknown as Record<string, unknown>;
      for (const m of ['send', 'deliver', 'execute']) {
        expect(asRecord[m]).toBeUndefined();
      }
    }
    expect(model.invoked()).toBe(1);
    expect(core.invoked()).toBe(1);
  });
});

describe('async orchestration — rejection is normalized', () => {
  it('(4) a rejected model Promise fails closed without an unhandled rejection or raw error', async () => {
    const rejectingModel: ModelReplyPort = Object.freeze({
      release: RELEASE,
      promptFamily: 'reply.client',
      promptVersion: 1,
      capabilityProfileRef: 'cap.a',
      draftReply: () => Promise.reject(new Error('SECRET-MODEL-FAULT')),
    });
    const core = scriptedCoreDecisionPort('ACCEPTED');
    const result = await orchestrateInbound(
      orch(rejectingModel, core, scriptedContextPort(ctx())),
      env(),
    );
    expect(result.ok ? '' : result.reason).toBe('orchestration-model-unavailable');
    expect(core.invoked()).toBe(0);
    expect(JSON.stringify(result)).not.toContain('SECRET-MODEL-FAULT');
  });

  it('(5) a rejected Core Promise fails closed to CORE_UNAVAILABLE without a raw error', async () => {
    const rejectingCore: CoreDecisionPort = Object.freeze({
      decide: () => Promise.reject(new Error('SECRET-CORE-FAULT')),
    });
    const result = await orchestrateInbound(
      orch(
        scriptedModelReplyPort({ draft: validDraft }),
        rejectingCore,
        scriptedContextPort(ctx()),
      ),
      env(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.outcome).toBe('CORE_UNAVAILABLE');
    }
    expect(JSON.stringify(result)).not.toContain('SECRET-CORE-FAULT');
  });
});

describe('async orchestration — a change while the model Promise is pending blocks Core', () => {
  it('(12,13,16) a revision bump landing during draftReply is seen by the post-draft re-read', async () => {
    let cell = ctx({ revision: 1 });
    const core = scriptedCoreDecisionPort('ACCEPTED');
    // The model resolves its draft, but a revision change lands during the awaited call; the
    // orchestrator's second (awaited) context read observes it and refuses before Core.
    const model = scriptedModelReplyPort({
      draft: () => {
        cell = ctx({ revision: 2 });
        return validDraft();
      },
    });
    const result = await orchestrateInbound(
      orch(
        model,
        core,
        mutableContextPort(() => cell),
      ),
      env(),
    );
    expect(result.ok ? '' : result.reason).toBe('orchestration-stale-revision');
    expect(model.invoked()).toBe(1);
    expect(core.invoked()).toBe(0);
  });

  it('(13,14) a takeover landing during draftReply blocks the Core request', async () => {
    let cell = ctx();
    const core = scriptedCoreDecisionPort('ACCEPTED');
    const model = scriptedModelReplyPort({
      draft: () => {
        cell = ctx({ humanTakeover: true });
        return validDraft();
      },
    });
    const result = await orchestrateInbound(
      orch(
        model,
        core,
        mutableContextPort(() => cell),
      ),
      env(),
    );
    expect(result.ok ? '' : result.reason).toBe('orchestration-human-takeover');
    expect(core.invoked()).toBe(0);
  });
});

describe('async orchestration — determinism and purity', () => {
  it('(20) the awaited processing order is deterministic across runs', async () => {
    const a = await orchestrateInbound(
      orch(
        scriptedModelReplyPort({ draft: validDraft }),
        scriptedCoreDecisionPort('ACCEPTED'),
        scriptedContextPort(ctx()),
      ),
      env(),
    );
    const b = await orchestrateInbound(
      orch(
        scriptedModelReplyPort({ draft: validDraft }),
        scriptedCoreDecisionPort('ACCEPTED'),
        scriptedContextPort(ctx()),
      ),
      env(),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('(22) pure reply planning stays synchronous (not a Promise)', () => {
    const model = scriptedModelReplyPort({ draft: validDraft });
    const plan: ReplyPlan = createReplyPlan({
      context: ctx(),
      envelope: env(),
      assignedActor: 'RIYA',
      modelPort: model,
      promptIdentity: { promptFamily: 'prompt.family.a', promptVersion: 1 },
      policyRevision: 'policy.rev.1',
      taskClass: 'RESPONSE_GENERATION',
      citations: [],
    });
    expect(plan).not.toBeInstanceOf(Promise);
    expect(plan.runId).toBeTruthy();
  });
});
