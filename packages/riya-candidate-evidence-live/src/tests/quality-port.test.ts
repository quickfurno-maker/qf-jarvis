/**
 * The P10 candidate port, against the real 72-fixture corpus.
 *
 * ### What is proved here
 *
 * Where each turn goes and what it is shown: one execution per fixture, one provider attempt each,
 * grounded input passing through the production retrieval authority before anything reaches a model,
 * and the exact prompt identity chosen from the situation rather than from the answer key.
 *
 * ### What is deliberately not simulated
 *
 * A good reply. Fabricating one would mean inventing provenance, usage and a schema-valid structured
 * answer, and the fake would become the thing under test. The invoker below refuses, which is enough
 * to observe every routing and admission fact — and a refused turn correctly produces a BLOCKED
 * capture, which is itself one of the properties worth proving.
 */
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { createQualityCandidatePort } from '../candidate-ports.js';
import type { BaseTurnDeps } from '../candidate-ports.js';
import { captureRiyaQualityCandidates } from '@qf-jarvis/riya-candidate-evaluation-runner';
import {
  RIYA_QUALITY_GOLDEN_FIXTURES,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
  RIYA_QUALITY_GOLDEN_SUITE_VERSION,
} from '@qf-jarvis/riya-quality-evaluation/testing';
import {
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
} from '@qf-jarvis/riya-model-interaction';
import { describe, expect, it } from 'vitest';

import { admitGroundedInput } from '../governed-grounded-input.js';
import { measureReplyLanguage } from '../measurement/reply-language.js';
import { taskClassFor, toGroundedContext } from '../riya-turn.js';

const GROUNDED = RIYA_QUALITY_GOLDEN_FIXTURES.filter(
  (one) => one.syntheticGroundedKnowledge !== undefined,
);
const UNGROUNDED = RIYA_QUALITY_GOLDEN_FIXTURES.filter(
  (one) => one.syntheticGroundedKnowledge === undefined,
);

/** Counts real attempts and refuses. See the file header for why it does not fabricate a reply. */
function countingInvoker(): { readonly invoker: ModelGatewayInvoker; calls: () => number } {
  let calls = 0;
  return {
    invoker: {
      invoke: (): Promise<ModelGatewayInvocation> => {
        calls += 1;
        return Promise.resolve({ ok: false as const, transient: false });
      },
    },
    calls: () => calls,
  };
}

function harness() {
  const counting = countingInvoker();
  const blocked: string[] = [];
  const executed: string[] = [];
  const base: BaseTurnDeps = {
    invoker: counting.invoker,
    clock: () => '2026-08-12T00:00:00.000Z',
  };
  const port = createQualityCandidatePort({
    turnDeps: (caseId) => {
      executed.push(caseId);
      return base;
    },
    invocationsFor: () => counting.calls(),
    admissionBlocked: (caseId) => blocked.push(caseId),
  });
  return { port, calls: counting.calls, blocked, executed };
}

// ---------------------------------------------------------------------------
// A. Corpus identity.
// ---------------------------------------------------------------------------

describe('the governed corpus is consumed exactly as it ships', () => {
  it('is manifest 2 / suite 1, 72 fixtures, 18 grounded and 54 ungrounded', () => {
    expect(RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION).toBe(2);
    expect(RIYA_QUALITY_GOLDEN_SUITE_VERSION).toBe(1);
    expect(RIYA_QUALITY_GOLDEN_FIXTURES).toHaveLength(72);
    expect(GROUNDED).toHaveLength(18);
    expect(UNGROUNDED).toHaveLength(54);
  });
});

// ---------------------------------------------------------------------------
// B. Execution: one turn, one attempt, per fixture.
// ---------------------------------------------------------------------------

describe('every fixture executes exactly once, with exactly one provider attempt', () => {
  it('72 executions and 72 attempts across a full pass', async () => {
    const { port, calls, executed } = harness();
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      await port.execute({
        caseId: fixture.fixtureId,
        syntheticUserText: fixture.syntheticUserText,
        continuityPhaseBefore: fixture.scenario.phase,
        ...(fixture.syntheticGroundedKnowledge === undefined
          ? {}
          : { groundedKnowledge: fixture.syntheticGroundedKnowledge }),
      });
    }
    expect(executed).toHaveLength(72);
    expect(new Set(executed).size).toBe(72);
    // One attempt each. No retry anywhere: a retried case is a different case.
    expect(calls()).toBe(72);
  });

  it('the bridge drives all 72 through the port, in corpus order', async () => {
    const { port, executed } = harness();
    const result = await captureRiyaQualityCandidates({ port });
    // Every reply was refused by the fake, so the capture is INCOMPLETE — which is the correct
    // outcome and proves a refused turn cannot become a quality measurement.
    expect(result.ok).toBe(false);
    expect(executed).toHaveLength(72);
    expect(executed).toStrictEqual(RIYA_QUALITY_GOLDEN_FIXTURES.map((one) => one.fixtureId));
  });
});

// ---------------------------------------------------------------------------
// C. Grounded input passes through the production authority.
// ---------------------------------------------------------------------------

describe('grounded input reaches the model only through governed retrieval', () => {
  it('all 18 grounded fixtures are admitted, and their RETRIEVED records are what would be shown', () => {
    for (const fixture of GROUNDED) {
      const input = fixture.syntheticGroundedKnowledge;
      expect(input, fixture.fixtureId).toBeDefined();
      if (input === undefined) {
        continue;
      }
      const admission = admitGroundedInput(input, fixture.fixtureId);
      expect(admission.ok, fixture.fixtureId).toBe(true);
      if (!admission.ok) {
        continue;
      }
      const context = toGroundedContext(admission.records);
      expect(context?.records, fixture.fixtureId).toHaveLength(input.records.length);
      // The five model-visible fields and nothing else. No lifecycle, no permissions, no `state`.
      for (const record of context?.records ?? []) {
        expect(Object.keys(record).sort()).toStrictEqual([
          'content',
          'contentFormat',
          'knowledgeId',
          'topic',
          'version',
        ]);
      }
    }
  });

  it('the 54 ungrounded fixtures carry no context at all — absent, not empty', () => {
    for (const fixture of UNGROUNDED) {
      expect(Object.keys(fixture), fixture.fixtureId).not.toContain('syntheticGroundedKnowledge');
      expect(toGroundedContext([])).toBeUndefined();
    }
  });

  it('NO EXPECTATION FIELD IS EVER CANDIDATE INPUT', () => {
    // The corpus authors input and expectation independently; this proves the operator reads only the
    // first. A grounded record whose id matched `passingShape` by coincidence would still be a
    // coincidence — the values come from `syntheticGroundedKnowledge`.
    for (const fixture of GROUNDED) {
      const input = fixture.syntheticGroundedKnowledge;
      const admission = admitGroundedInput(input ?? { state: 'CURRENT', records: [] }, 'case.x');
      const serialized = JSON.stringify(admission.ok ? admission.records : []);
      expect(serialized).not.toContain('passingShape');
      expect(serialized).not.toContain('expectedObservations');
      expect(serialized).not.toContain('requiredQualityDimensions');
      expect(serialized).not.toContain('maxReplyChars');
    }
  });
});

// ---------------------------------------------------------------------------
// D. Task class comes from the situation.
// ---------------------------------------------------------------------------

describe('the exact governed prompt identity is chosen from phase and grounding', () => {
  const classFor = (fixture: (typeof RIYA_QUALITY_GOLDEN_FIXTURES)[number]): string =>
    taskClassFor({
      phase: fixture.scenario.phase,
      hasGroundedKnowledge: fixture.syntheticGroundedKnowledge !== undefined,
    });

  it.each([
    ['GROUNDING_QA', RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS],
    ['POST_SUMMARY_QA', RIYA_GROUNDED_REPLY_TASK_CLASS],
    ['COMPLETE_QA', RIYA_GROUNDED_REPLY_TASK_CLASS],
    ['DISCOVERY', RIYA_CONVERSATION_EVOLUTION_TASK_CLASS],
    ['OBJECTION_PRICE', RIYA_CONVERSATION_EVOLUTION_TASK_CLASS],
    ['NEXT_STEP', RIYA_GROUNDED_REPLY_TASK_CLASS],
  ])('%s resolves to %s', (kind, expected) => {
    const matching = RIYA_QUALITY_GOLDEN_FIXTURES.filter((one) => one.interactionKind === kind);
    expect(matching.length).toBeGreaterThan(0);
    for (const fixture of matching) {
      expect(classFor(fixture), fixture.fixtureId).toBe(expected);
    }
  });

  it('every fixture resolves to one of exactly the three governed identities', () => {
    const resolved = new Set(RIYA_QUALITY_GOLDEN_FIXTURES.map((one) => classFor(one)));
    for (const value of resolved) {
      expect([
        RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
        RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
        RIYA_GROUNDED_REPLY_TASK_CLASS,
      ]).toContain(value);
    }
  });

  it('the phase decides reply-only, regardless of what a fixture expects', () => {
    // Reply-only is a property of where the conversation reached, not of the expected answer.
    expect(taskClassFor({ phase: 'SUMMARY', hasGroundedKnowledge: true })).toBe(
      RIYA_GROUNDED_REPLY_TASK_CLASS,
    );
    expect(taskClassFor({ phase: 'COMPLETE', hasGroundedKnowledge: false })).toBe(
      RIYA_GROUNDED_REPLY_TASK_CLASS,
    );
    expect(taskClassFor({ phase: 'NEED', hasGroundedKnowledge: false })).toBe(
      RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
    );
  });
});

// ---------------------------------------------------------------------------
// F/G. Measured facts, and blocked execution.
// ---------------------------------------------------------------------------

describe('a turn that produced nothing usable is BLOCKED, never a quality record', () => {
  it('a refused adapter result yields UNKNOWN language and holds the starting phase', async () => {
    const { port } = harness();
    const fixture = RIYA_QUALITY_GOLDEN_FIXTURES[0];
    expect(fixture).toBeDefined();
    if (fixture === undefined) {
      return;
    }
    const record = await port.execute({
      caseId: fixture.fixtureId,
      syntheticUserText: fixture.syntheticUserText,
      continuityPhaseBefore: fixture.scenario.phase,
    });
    expect(record.structuredOutputWellFormed).toBe(false);
    expect(record.replyBody).toBe('');
    // UNKNOWN is the honest value and the bridge fails the case on it. Recording the fixture's hoped
    // -for mode instead is exactly the fabrication the classifier exists to prevent.
    expect(record.replyLanguageMode).toBe('UNKNOWN');
    expect(record.continuityPhaseAfter).toBe(fixture.scenario.phase);
    expect(record.observations).toStrictEqual([]);
    expect(record.citations).toStrictEqual([]);
  });

  it('a ceiling refusal blocks rather than silently skipping', async () => {
    const port = createQualityCandidatePort({
      // `undefined` is how the ledger says "no more calls".
      turnDeps: () => undefined,
      invocationsFor: () => 0,
      admissionBlocked: () => undefined,
    });
    const fixture = RIYA_QUALITY_GOLDEN_FIXTURES[0];
    if (fixture === undefined) {
      return;
    }
    const record = await port.execute({
      caseId: fixture.fixtureId,
      syntheticUserText: fixture.syntheticUserText,
      continuityPhaseBefore: fixture.scenario.phase,
    });
    expect(record.structuredOutputWellFormed).toBe(false);
    expect(record.replyLanguageMode).toBe('UNKNOWN');
  });

  it('a governed refusal blocks the case AND reports it', async () => {
    const { port, blocked, calls } = harness();
    const record = await port.execute({
      caseId: 'case.p10.superseded',
      syntheticUserText: 'anything',
      continuityPhaseBefore: 'NEED',
      groundedKnowledge: {
        state: 'SUPERSEDED',
        records: [
          {
            knowledgeId: 'knowledge.spec.superseded.alpha',
            version: 1,
            topic: 'synthetic.spec',
            contentFormat: 'text/plain',
            content: 'For this synthetic evaluation only: a retired test-only fact.',
          },
        ],
      },
    });
    expect(blocked).toStrictEqual(['case.p10.superseded']);
    expect(record.structuredOutputWellFormed).toBe(false);
    // Refused before anything was sent.
    expect(calls()).toBe(0);
  });

  it('the measured language is the classifier applied to the actual body', () => {
    // The port calls `measureReplyLanguage(replyBody)`; this pins the contract that the value is
    // computed rather than copied, using a body no fixture contains.
    const body = 'Ji bilkul, aapko poori detail bhej deti hoon agar aapke paas thoda time hai.';
    expect(measureReplyLanguage(body)).toBe('HINGLISH');
    expect(
      measureReplyLanguage('Happy to help — the full scope is included in what we discussed.'),
    ).toBe('ENGLISH');
  });
});
