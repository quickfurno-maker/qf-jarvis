/**
 * JAO-2 governed specialist delegation, asserted as a DELEGATION GOVERNANCE proof (ADR-0116).
 *
 * Success is not "Riya's function was called". Success is that a supervisor could only reach an
 * independently governed specialist through a registry that checks availability first, an authority
 * ceiling that cannot be widened, and a bounded envelope — and that nothing about the specialist's
 * answer could turn into effect.
 *
 * Every Riya fixture below is synthetic structured signals. No transcript, no private text, and no
 * live Riya runtime is reachable from anything under test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISCOVERY_COMPLETENESS_FROZEN,
  RIYA_ACTOR,
  RIYA_SUPPORTED_PARTY,
} from '@qf-jarvis/riya-agent';
import { describe, expect, it } from 'vitest';

import {
  JAO2_DELEGATION_BOUNDS,
  JAO2_PRODUCTION_SPECIALISTS,
  JAO2_RIYA_SPECIALIST,
  createJao2RiyaSpecialistAdapter,
  createJao2SpecialistRegistry,
  evaluateDelegationAuthority,
  jao2DelegationEnvelopeSchema,
  jao2RiyaSpecialistInputSchema,
  jao2SpecialistDescriptorSchema,
  runJao2GovernedDelegation,
  type Jao2Clock,
  type Jao2DelegationEnvelope,
  type Jao2SpecialistAdapter,
  type Jao2SpecialistDescriptor,
  type Jao2TelemetryEvent,
} from '../jao/governed-specialist-delegation/index.js';

class FixedClock implements Jao2Clock {
  private value = 1_000;
  nowMs(): number {
    this.value += 5;
    return this.value;
  }
}

const NO_SIGNALS = {
  hasPriorSalesContext: false,
  requestedHumanAssistance: false,
  requestedQuoteOrConsultation: false,
  providedRequirementDetail: false,
  askedAboutReadiness: false,
  outOfSalesScope: false,
  missingDiscoveryFieldCount: 3,
};

function envelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delegationId: 'jao2-delegation-001',
    runId: 'jao2-run-001',
    specialistId: 'RIYA',
    capabilityId: 'riya.analyze-client-sales-signals',
    requestedAutonomyLevel: 'L0_REASON',
    parentAutonomyLevel: 'L1_READ',
    businessEffectAllowed: false,
    maxCalls: 1,
    input: {
      partyType: 'CLIENT',
      currentActor: 'RIYA',
      signals: NO_SIGNALS,
      promptRef: 'riya.client-sales.v1',
      humanTakeover: false,
      aiPaused: false,
      ...(over['input'] ?? {}),
    },
    ...Object.fromEntries(Object.entries(over).filter(([key]) => key !== 'input')),
  };
}

/**
 * Source with comments stripped.
 *
 * JAO-2 documents at length the paths it refuses to reach -- `createRiyaProposal`, the live Riya
 * runtime, specialist spawning. Scanning raw text would report every one of those prohibitions as a
 * violation of itself, so the containment specs read CODE and the prose is left to be prose.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

function descriptorWith(availability: 'ACTIVE' | 'PLANNED' | 'DISABLED'): Jao2SpecialistDescriptor {
  return jao2SpecialistDescriptorSchema.parse({ ...JAO2_RIYA_SPECIALIST, availability });
}

/** Counts every specialist invocation, so "zero calls" is a counted fact rather than an absence. */
function countingAdapter(inner: Jao2SpecialistAdapter = createJao2RiyaSpecialistAdapter()): {
  readonly adapter: Jao2SpecialistAdapter;
  calls: () => number;
} {
  let calls = 0;
  return {
    adapter: {
      descriptor: inner.descriptor,
      invoke(input, signal) {
        calls += 1;
        return inner.invoke(input, signal);
      },
    },
    calls: () => calls,
  };
}

function deps(
  adapter: Jao2SpecialistAdapter,
  descriptors: readonly Jao2SpecialistDescriptor[] = JAO2_PRODUCTION_SPECIALISTS,
  events: Jao2TelemetryEvent[] = [],
) {
  return {
    registry: createJao2SpecialistRegistry(descriptors),
    specialist: adapter,
    clock: new FixedClock(),
    telemetry: {
      record(event: Jao2TelemetryEvent): void {
        events.push(event);
      },
    },
  };
}

describe('JAO-2 governed specialist delegation', () => {
  it('delegates once to the ACTIVE Riya specialist and returns a bounded advisory result', async () => {
    const spy = countingAdapter();
    const events: Jao2TelemetryEvent[] = [];

    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-001', envelope: envelope() },
      deps(spy.adapter, JAO2_PRODUCTION_SPECIALISTS, events),
    );

    expect(result.outcome).toBe('DELEGATION_COMPLETED');
    expect(spy.calls()).toBe(1);
    expect(result.delegationCalls).toBe(1);
    expect(result.delegatedAutonomyLevel).toBe('L0_REASON');
    expect(result.parentAutonomyLevel).toBe('L1_READ');
    expect(result.businessEffect).toBe(false);
    expect(result.modelCalls).toBe(0);
    expect(result.specialistsInvoked).toStrictEqual(['RIYA']);
    expect(result.governanceRef).toBe('ADR-0067.riya-client-sales-behaviour');

    // Real Riya behaviour, not a stub: no signals and incomplete discovery continues discovery.
    expect(result.advisory?.intent).toBe('INSUFFICIENT_CONTEXT');
    expect(result.advisory?.disposition).toBe('CONTINUE_DISCOVERY');
    expect(result.advisory?.advisoryOnly).toBe(true);
    expect(result.advisory?.proposalCreated).toBe(false);
    expect(result.advisory?.executionRequested).toBe(false);
    expect(result.advisory?.businessEffect).toBe(false);

    expect(events).toHaveLength(1);
    expect(events[0]?.availabilityDecision).toBe('ACTIVE');
    expect(events[0]?.modelCalls).toBe(0);
  });

  it('treats modelReplyEligible=true as DATA and still performs zero model work', async () => {
    // The specific hazard: Riya legitimately says the model-reply boundary MAY be invoked. JAO-2
    // must carry that as a fact about her decision and do nothing with it.
    const spy = countingAdapter();
    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-eligible', envelope: envelope() },
      deps(spy.adapter),
    );

    expect(result.advisory?.modelReplyEligible).toBe(true);
    expect(result.outcome).toBe('DELEGATION_COMPLETED');
    // Zero model work, and structurally so: nothing in this slice can reach a gateway at all.
    expect(result.modelCalls).toBe(0);
    expect(JAO2_DELEGATION_BOUNDS.maxModelCalls).toBe(0);
    expect(result.advisory?.executionRequested).toBe(false);
    expect(result.advisory?.proposalCreated).toBe(false);
    // No reply text of any kind exists on the result surface.
    expect(JSON.stringify(result)).not.toContain('replyBody');
  });

  it('refuses a PLANNED specialist BEFORE invoking it', async () => {
    const spy = countingAdapter();
    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-planned', envelope: envelope() },
      deps(spy.adapter, [descriptorWith('PLANNED')]),
    );

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('SPECIALIST_PLANNED');
    expect(spy.calls()).toBe(0);
    expect(result.delegationCalls).toBe(0);
    expect(result.advisory).toBeNull();
  });

  it('refuses a DISABLED specialist BEFORE invoking it', async () => {
    const spy = countingAdapter();
    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-disabled', envelope: envelope() },
      deps(spy.adapter, [descriptorWith('DISABLED')]),
    );

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('SPECIALIST_DISABLED');
    expect(spy.calls()).toBe(0);
    expect(result.advisory).toBeNull();
  });

  it('refuses an UNKNOWN specialist and a mismatched capability, with no substitute', async () => {
    const unknown = countingAdapter();
    const unknownResult = await runJao2GovernedDelegation(
      { runId: 'jao2-run-unknown', envelope: envelope({ specialistId: 'ANISHA' }) },
      deps(unknown.adapter),
    );
    expect(unknownResult.outcome).toBe('NO_ELIGIBLE_SPECIALIST');
    expect(unknownResult.refusalReason).toBe('SPECIALIST_UNKNOWN');
    expect(unknown.calls()).toBe(0);

    // Registered, but not governed for what was asked. No nearest match is substituted.
    const mismatch = countingAdapter();
    const mismatchResult = await runJao2GovernedDelegation(
      { runId: 'jao2-run-capability', envelope: envelope({ capabilityId: 'riya.draft-reply' }) },
      deps(mismatch.adapter),
    );
    expect(mismatchResult.outcome).toBe('REFUSED');
    expect(mismatchResult.refusalReason).toBe('CAPABILITY_MISMATCH');
    expect(mismatch.calls()).toBe(0);
    expect(mismatchResult.advisory).toBeNull();
  });

  it('refuses every authority escalation before the specialist is reached', async () => {
    // Requesting MORE than the supervisor holds.
    const escalate = countingAdapter();
    const escalated = await runJao2GovernedDelegation(
      {
        runId: 'jao2-run-escalate',
        envelope: envelope({ requestedAutonomyLevel: 'L1_READ', parentAutonomyLevel: 'L0_REASON' }),
      },
      deps(escalate.adapter),
    );
    expect(escalated.refusalReason).toBe('AUTHORITY_ESCALATION');
    expect(escalate.calls()).toBe(0);

    // Requesting the SUPERVISOR's own level, which still outranks the specialist's governed ceiling.
    const ceiling = countingAdapter();
    const overCeiling = await runJao2GovernedDelegation(
      { runId: 'jao2-run-ceiling', envelope: envelope({ requestedAutonomyLevel: 'L1_READ' }) },
      deps(ceiling.adapter),
    );
    expect(overCeiling.refusalReason).toBe('AUTHORITY_ESCALATION');
    expect(ceiling.calls()).toBe(0);

    // Effect, model use, execution and a second call cannot even be expressed: the envelope schema
    // refuses them, so they never become a policy question.
    for (const forbidden of [
      { businessEffectAllowed: true },
      { maxCalls: 2 },
      { mayCallModel: true },
      { mayExecute: true },
      { requestedAutonomyLevel: 'L2_WRITE' },
    ]) {
      const spy = countingAdapter();
      const result = await runJao2GovernedDelegation(
        { runId: 'jao2-run-forbidden', envelope: envelope(forbidden) },
        deps(spy.adapter),
      );
      expect(result.refusalReason, JSON.stringify(forbidden)).toBe('ENVELOPE_INVALID');
      expect(spy.calls(), JSON.stringify(forbidden)).toBe(0);
    }
  });

  it('leaves Riya own role guard superior: a VENDOR party is refused BY RIYA', async () => {
    const spy = countingAdapter();
    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-vendor', envelope: envelope({ input: { partyType: 'VENDOR' } }) },
      deps(spy.adapter),
    );

    // The delegation itself was well-formed and permitted, so the specialist WAS asked...
    expect(spy.calls()).toBe(1);
    expect(result.outcome).toBe('DELEGATION_COMPLETED');
    // ...and Riya refused it on her own scope boundary. JAO-2 preserves that rather than overriding.
    expect(result.advisory?.disposition).toBe('REFUSE');
    expect(result.advisory?.reason).toBe('runtime-scope-violation');
    expect(result.advisory?.modelReplyEligible).toBe(false);
    expect(RIYA_SUPPORTED_PARTY).toBe('CLIENT');
  });

  it('preserves a Riya refusal on human takeover and on AI pause, without override', async () => {
    for (const [label, over] of [
      ['takeover', { humanTakeover: true }],
      ['paused', { aiPaused: true }],
      ['human owns the turn', { currentActor: 'HUMAN' }],
    ] as const) {
      const spy = countingAdapter();
      const result = await runJao2GovernedDelegation(
        { runId: 'jao2-run-pause', envelope: envelope({ input: over }) },
        deps(spy.adapter),
      );
      expect(result.outcome, label).toBe('DELEGATION_COMPLETED');
      expect(result.advisory?.disposition, label).toBe('REFUSE');
      expect(result.advisory?.modelReplyEligible, label).toBe(false);
      expect(result.advisory?.proposalCreated, label).toBe(false);
    }
  });

  it('refuses a malformed envelope and a malformed specialist input before invocation', async () => {
    const spy = countingAdapter();
    for (const bad of [
      {},
      { ...envelope(), delegationId: 'has space' },
      { ...envelope(), extraKey: true },
      { ...envelope(), input: { ...(envelope()['input'] as object), signals: { nope: true } } },
      { ...envelope(), input: { ...(envelope()['input'] as object), promptRef: '' } },
    ]) {
      const result = await runJao2GovernedDelegation(
        { runId: 'jao2-run-malformed', envelope: bad },
        deps(spy.adapter),
      );
      expect(result.refusalReason).toBe('ENVELOPE_INVALID');
      expect(result.advisory).toBeNull();
    }
    expect(spy.calls()).toBe(0);
  });

  it('refuses malformed specialist OUTPUT rather than passing it on', async () => {
    const rogue: Jao2SpecialistAdapter = {
      descriptor: JAO2_RIYA_SPECIALIST,
      invoke: () => ({ specialistId: 'RIYA', businessEffect: true, executionRequested: true }),
    };
    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-bad-output', envelope: envelope() },
      deps(rogue),
    );

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('SPECIALIST_OUTPUT_INVALID');
    expect(result.advisory).toBeNull();
  });

  it('normalizes a specialist exception without leaking what it carried', async () => {
    const exploding: Jao2SpecialistAdapter = {
      descriptor: JAO2_RIYA_SPECIALIST,
      invoke: () => {
        throw new Error('SPECIALIST-INTERNAL-DETAIL-MUST-NOT-LEAK');
      },
    };
    const events: Jao2TelemetryEvent[] = [];
    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-throw', envelope: envelope() },
      deps(exploding, JAO2_PRODUCTION_SPECIALISTS, events),
    );

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('SPECIALIST_FAILED');
    expect(JSON.stringify(result)).not.toContain('SPECIALIST-INTERNAL-DETAIL-MUST-NOT-LEAK');
    expect(JSON.stringify(events)).not.toContain('SPECIALIST-INTERNAL-DETAIL-MUST-NOT-LEAK');
  });

  it('performs zero delegation when cancelled before any work', async () => {
    const spy = countingAdapter();
    const controller = new AbortController();
    controller.abort();

    const result = await runJao2GovernedDelegation(
      { runId: 'jao2-run-cancelled', envelope: envelope() },
      deps(spy.adapter),
      controller.signal,
    );

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('CANCELLED');
    expect(spy.calls()).toBe(0);
    expect(result.delegationCalls).toBe(0);
    expect(result.modelCalls).toBe(0);
  });

  it('locks the specialist descriptor to read-only, no-effect, no-model, no-proposal, no-execute', () => {
    expect(JAO2_RIYA_SPECIALIST).toStrictEqual({
      specialistId: 'RIYA',
      capabilityId: 'riya.analyze-client-sales-signals',
      governanceRef: 'ADR-0067.riya-client-sales-behaviour',
      availability: 'ACTIVE',
      maxAutonomyLevel: 'L0_REASON',
      dataClass: 'SYNTHETIC_CLIENT_SALES_SIGNALS',
      readOnly: true,
      businessEffect: false,
      maxCallsPerRun: 1,
      timeoutMs: 1_000,
      mayCallModel: false,
      mayCreateProposal: false,
      mayExecute: false,
    });

    // The absolutes are enforced by PARSING, not by a comparison a future edit could remove.
    for (const forbidden of [
      { businessEffect: true },
      { mayCallModel: true },
      { mayCreateProposal: true },
      { mayExecute: true },
      { readOnly: false },
      { maxCallsPerRun: 2 },
      { maxAutonomyLevel: 'L1_READ' },
    ]) {
      expect(
        jao2SpecialistDescriptorSchema.safeParse({ ...JAO2_RIYA_SPECIALIST, ...forbidden }).success,
        JSON.stringify(forbidden),
      ).toBe(false);
    }

    // The production registry ships exactly one specialist, and it is the ACTIVE Riya adapter.
    expect(JAO2_PRODUCTION_SPECIALISTS).toHaveLength(1);
    expect(JAO2_PRODUCTION_SPECIALISTS[0]?.availability).toBe('ACTIVE');
  });

  it('states ACTIVE as adapter availability, never as Riya channel rollout', () => {
    // A reader must not mistake this registry for rollout truth. The descriptor carries no channel,
    // no rollout flag and no transport of any kind for that reason.
    const keys = Object.keys(JAO2_RIYA_SPECIALIST);
    for (const rolloutish of ['channel', 'rollout', 'whatsapp', 'enabled', 'live', 'production']) {
      expect(
        keys.some((key) => key.toLowerCase().includes(rolloutish)),
        rolloutish,
      ).toBe(false);
    }
    expect(JAO2_RIYA_SPECIALIST.governanceRef).toContain('ADR-');
  });

  it('enforces the ceiling by RANK on parsed data, not by TypeScript literals', () => {
    const parsed = jao2DelegationEnvelopeSchema.parse(envelope()) satisfies Jao2DelegationEnvelope;
    expect(evaluateDelegationAuthority(parsed, JAO2_RIYA_SPECIALIST).ok).toBe(true);

    const escalating = jao2DelegationEnvelopeSchema.parse(
      envelope({ requestedAutonomyLevel: 'L1_READ' }),
    );
    const verdict = evaluateDelegationAuthority(escalating, JAO2_RIYA_SPECIALIST);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? undefined : verdict.refusal).toBe('AUTHORITY_ESCALATION');
  });

  it('keeps the envelope completeness vocabulary identical to Riya own', () => {
    // Spelled out in the JAO-2 schema, pinned here so the two cannot drift apart unnoticed.
    const jaoValues = [
      'SUFFICIENT_FOR_CORE_REVIEW',
      'MORE_DISCOVERY_REQUIRED',
      'HUMAN_REVIEW_REQUIRED',
    ];
    expect([...jaoValues].sort()).toStrictEqual([...DISCOVERY_COMPLETENESS_FROZEN].sort());
    for (const completeness of DISCOVERY_COMPLETENESS_FROZEN) {
      expect(
        jao2RiyaSpecialistInputSchema.safeParse({
          partyType: 'CLIENT',
          signals: NO_SIGNALS,
          promptRef: 'riya.client-sales.v1',
          humanTakeover: false,
          aiPaused: false,
          needDiscoveryCompleteness: completeness,
        }).success,
        completeness,
      ).toBe(true);
    }
  });

  it('reaches no proposal, no live Riya runtime and no execution path', () => {
    const root = fileURLDir();
    const sources = fs
      .readdirSync(root)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => codeOnly(fs.readFileSync(path.join(root, entry), 'utf8')));

    // Asserted on IMPORT/CALL shape rather than on any mention, so the explanatory comments that
    // name these paths as forbidden do not flag themselves.
    for (const source of sources) {
      const imports = [...source.matchAll(/from '([^']+)'/gu)].map((match) => match[1] ?? '');
      for (const specifier of imports) {
        expect(specifier).not.toContain('riya-web-conversation-service');
        expect(specifier).not.toContain('jarvis-runtime');
        expect(specifier).not.toContain('model-gateway');
        expect(specifier).not.toContain('event-backbone');
        expect(specifier).not.toContain('postgres');
        expect(specifier).not.toMatch(/^node:(fs|http|https|net|child_process)$/u);
      }
      expect(source).not.toMatch(/createRiyaProposal\s*\(/u);
      expect(source).not.toMatch(/processInbound\s*\(/u);
      expect(source).not.toMatch(/\.invoke\s*\(\s*validation/u);
      expect(source).not.toMatch(/[^a-zA-Z]fetch\s*\(/u);
      expect(source).not.toContain('process.env');
    }

    // The only Riya surface JAO-2 imports is the pure behaviour one.
    const adapter = codeOnly(fs.readFileSync(path.join(root, 'riya-adapter.ts'), 'utf8'));
    expect(adapter).toContain('decideRiyaTurn');
    expect(adapter).not.toContain('createRiyaProposal');
    expect(RIYA_ACTOR).toBe('RIYA');
  });

  it('keeps Mastra bounded and the production worker non-activating', () => {
    const root = fileURLDir();
    const mastra: string[] = [];
    for (const entry of fs.readdirSync(root).filter((one) => one.endsWith('.ts'))) {
      const text = codeOnly(fs.readFileSync(path.join(root, entry), 'utf8'));
      for (const match of text.matchAll(/from '(@mastra\/[^']+)'/gu)) {
        mastra.push(match[1] ?? '');
      }
    }
    expect([...new Set(mastra)]).toStrictEqual(['@mastra/core/workflows']);

    const appRoot = path.resolve(root, '..', '..');
    for (const entry of ['index.ts', 'worker-entry.ts']) {
      const text = codeOnly(fs.readFileSync(path.join(appRoot, entry), 'utf8'));
      expect(text, entry).not.toContain('governed-specialist-delegation');
      expect(text, entry).not.toContain('jao2');
    }

    // No dynamic registration, spawning or fallback exists to be reached.
    const registry = codeOnly(fs.readFileSync(path.join(root, 'registry.ts'), 'utf8'));
    for (const forbidden of ['register(', 'spawn', 'fallback(', 'eval(', 'new Function']) {
      expect(registry, forbidden).not.toContain(forbidden);
    }
    expect(JAO2_DELEGATION_BOUNDS.fallbackSpecialist).toBe(false);
    expect(JAO2_DELEGATION_BOUNDS.dynamicSpecialistSpawning).toBe(false);
    expect(JAO2_DELEGATION_BOUNDS.maxDelegationCalls).toBe(1);
  });
});

/** The JAO-2 source directory. `fileURLToPath` handles the spaces a raw pathname would percent-encode. */
function fileURLDir(): string {
  return path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    'jao',
    'governed-specialist-delegation',
  );
}
