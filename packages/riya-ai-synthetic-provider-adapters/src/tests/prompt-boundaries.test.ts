/**
 * The model visibility boundaries, asserted on the SERIALIZED bytes (AS3A, ADR-0143 §9, §24).
 *
 * ### Why the bytes and not the types
 *
 * A TypeScript type proves what a value is DECLARED to be. It proves nothing about what a caller
 * actually passed through an `unknown` parameter, and `structuredInput` is `unknown` by design. The
 * only honest question is: what did this package put on the wire? So every assertion here runs
 * against the rendered request body, and the forbidden values are searched for as substrings of the
 * exact string a provider would receive.
 *
 * A leak here is not a bug that shows up as a failure later. It is a corpus that quietly knows its
 * own split, or a teacher that was told what the customer was about to say — and both look like
 * unusually good data right up until the model is deployed.
 */
import { RiyaSyntheticGenerationError } from '@qf-jarvis/riya-ai-synthetic-generation';
import { describe, expect, it } from 'vitest';

import { buildAnthropicMessagesRequest } from '../adapters/anthropic-messages-invoker.js';
import { buildOpenAiResponsesRequest } from '../adapters/openai-responses-invoker.js';
import {
  RIYA_SYNTHETIC_INSTRUCTION_INVENTORY,
  riyaSyntheticInstructionFor,
} from '../prompts/instruction-inventory.js';
import { renderRiyaSyntheticRequest } from '../prompts/role-prompts.js';
import { sha256Hex } from '../internal/digest.js';
import { customerInput, requestFor, teacherInput } from './fixtures.js';

/** Everything a request carries, as one searchable string. Used for VALUE checks. */
function serializedOpenAi(role: Parameters<typeof requestFor>[0], input: unknown): string {
  return JSON.stringify(buildOpenAiResponsesRequest(requestFor(role, 'cfg.x'), input, 'model.x'));
}

/**
 * Just the projected role view, as the provider receives it. Used for FIELD-NAME checks.
 *
 * Field names are searched as quoted JSON keys rather than as bare substrings, because a bare one
 * lies in both directions: `persona` matches the word "personal" in an instruction, and a test that
 * passes only because the prose was reworded is not a boundary test.
 */
function projectedOpenAi(role: Parameters<typeof requestFor>[0], input: unknown): string {
  return buildOpenAiResponsesRequest(requestFor(role, 'cfg.x'), input, 'model.x').input;
}

function projectedAnthropic(role: Parameters<typeof requestFor>[0], input: unknown): string {
  const body = buildAnthropicMessagesRequest(requestFor(role, 'cfg.x'), input, 'model.x');
  return body.messages[0]?.content ?? '';
}

const key = (name: string): string => `"${name}"`;

describe('the customer simulator is split-blind and lineage-blind', () => {
  it('is never handed a split, a lineage root or an acceptance state', () => {
    const leaky = {
      ...(customerInput() as Record<string, unknown>),
      split: 'HOLDOUT',
      lineageRootRef: 'lineage.secret',
      acceptanceState: 'ACCEPTED',
    };

    // FAIL-CLOSED. A caller that supplied more than the role may see gets a rejected invocation and
    // zero provider calls -- not a quietly redacted request.
    expect(() => serializedOpenAi('CUSTOMER_SIMULATOR', leaky)).toThrow(
      RiyaSyntheticGenerationError,
    );
  });

  it('carries its own hidden state, because revealing it on schedule is its job', () => {
    const body = serializedOpenAi('CUSTOMER_SIMULATOR', customerInput());

    const projected = projectedOpenAi('CUSTOMER_SIMULATOR', customerInput());

    expect(projected).toContain(key('plannedCustomerFacts'));
    expect(projected).toContain(key('customerBehaviorCodes'));
    expect(projected).toContain(key('mayConclude'));
    // ...and nothing about the dataset it will end up in.
    for (const forbidden of ['split', 'lineageRootRef', 'acceptanceState', 'reviewMode']) {
      expect(projected, forbidden).not.toContain(key(forbidden));
    }
    // Split VALUES, searched across the whole request rather than the projection alone.
    for (const value of ['HOLDOUT', 'TRAIN', 'VALIDATION']) {
      expect(body, value).not.toContain(value);
    }
  });
});

describe('the teacher is blind to the customer plan and to the future', () => {
  it('is handed no plannedCustomerFacts and no behaviour codes', () => {
    for (const projected of [
      projectedOpenAi('RIYA_TEACHER', teacherInput()),
      projectedAnthropic('RIYA_TEACHER', teacherInput()),
    ]) {
      for (const forbidden of [
        'plannedCustomerFacts',
        'customerBehaviorCodes',
        'requiredConversationEvents',
        'persona',
        'difficulty',
        'targetAssistantTurns',
        'primaryInteractionKind',
        'secondaryInteractionKinds',
        'split',
        'lineageRootRef',
        'scenarioRef',
      ]) {
        expect(projected, forbidden).not.toContain(key(forbidden));
      }
    }
  });

  it('IS handed the governed authority ref, class and value', () => {
    // A teacher given only a ref can label a citation but not answer with it, which pushes it toward
    // inventing the number or refusing to use authority at all. The value is the point.
    const body = projectedOpenAi('RIYA_TEACHER', teacherInput());

    expect(body).toContain(key('availableAuthorityFacts'));
    expect(body).toContain('fact.delivery.pune');
    expect(body).toContain('Pune delivery in 12 days');
    expect(body).toContain('factClass');
  });

  it('rejects a teacher input that smuggled the customer plan in', () => {
    const leaky = {
      ...(teacherInput() as Record<string, unknown>),
      plannedCustomerFacts: [{ field: 'BUDGET', value: 'two lakh' }],
    };

    expect(() => serializedOpenAi('RIYA_TEACHER', leaky)).toThrow(RiyaSyntheticGenerationError);
  });
});

describe('no role is told what it will be measured against', () => {
  it('carries no acceptance or diversity threshold, and no protected exam', () => {
    // Models generate behaviour; deterministic validators measure it. A model told the bar starts
    // writing to the metric, and the metric stops describing anything.
    for (const entry of RIYA_SYNTHETIC_INSTRUCTION_INVENTORY) {
      const text = entry.text.toLowerCase();
      // `training` is deliberately NOT on this list: telling a model it is producing synthetic
      // training data is honest framing, and it says nothing about the bar. What must never appear
      // is the bar itself, or any dataset-governance fact a generator could write toward.
      for (const forbidden of [
        'threshold',
        'basis point',
        'pass rate',
        'acceptance rate',
        'diversity',
        'holdout',
        'validation split',
        'lineage',
        'p10',
        'exam',
      ]) {
        expect(text, `${entry.identity.instructionRef} must not name ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it('forbids reasoning in every instruction', () => {
    for (const entry of RIYA_SYNTHETIC_INSTRUCTION_INVENTORY) {
      expect(entry.identity.forbids).toContain('CHAIN_OF_THOUGHT');
      expect(entry.text.toLowerCase()).toContain('never include your reasoning');
    }
  });

  it('gives GPT and Claude the SAME instruction for a role', () => {
    // Family belongs in the config inventory and in the API binding, never in what a model is told to
    // do. Two prompts would make a quality difference between families uninterpretable.
    const request = requestFor('RIYA_TEACHER', 'cfg.x');
    const openai = buildOpenAiResponsesRequest(request, teacherInput(), 'model.gpt');
    const anthropic = buildAnthropicMessagesRequest(request, teacherInput(), 'model.claude');

    expect(openai.instructions).toBe(anthropic.system);
    expect(openai.input).toBe(anthropic.messages[0]?.content);
  });
});

describe('every rendering is bound to a versioned instruction identity', () => {
  it('binds ref, digest, schema ref, role and model', () => {
    const rendered = renderRiyaSyntheticRequest(
      requestFor('CRITIC', 'cfg.critic.gpt'),
      {
        scenario: (teacherInput() as { scenario: unknown }).scenario,
        visibleHistory: [],
        requestedQualityDimensions: ['CLARITY'],
      },
      'gpt-5.6-sol',
    );

    expect(rendered.role).toBe('CRITIC');
    expect(rendered.modelRef).toBe('gpt-5.6-sol');
    expect(rendered.configRef).toBe('cfg.critic.gpt');
    expect(rendered.outputSchemaRef).toBe('CRITIC.v1');
    expect(rendered.instructionRef).toBe('riya.as3a.critic.v1');
    // The digest is computed from the TEXT, so editing a word moves it. A hand-written digest would
    // be a claim about bytes nobody checked.
    expect(rendered.instructionSha256).toBe(sha256Hex(rendered.systemText));
  });

  it('digests every instruction from its own text', () => {
    for (const entry of RIYA_SYNTHETIC_INSTRUCTION_INVENTORY) {
      expect(entry.identity.instructionSha256).toBe(sha256Hex(entry.text));
    }
  });

  it('serves no scenario-planner instruction, because the scheduler is deterministic', () => {
    expect(() => riyaSyntheticInstructionFor('SCENARIO_PLANNER')).toThrow();
  });
});

describe('the request itself carries no provider affordance', () => {
  it('disables storage and declares no tool on the OpenAI side', () => {
    const body = buildOpenAiResponsesRequest(
      requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'),
      customerInput(),
      'gpt-5.6-sol',
    );

    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.type).toBe('json_schema');
    for (const forbidden of [
      'tools',
      'tool_choice',
      'conversation',
      'previous_response_id',
      'metadata',
      'user',
    ]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
  });

  it('declares no tool and no thinking field on the Anthropic side', () => {
    const body = buildAnthropicMessagesRequest(
      requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.claude'),
      customerInput(),
      'claude-sonnet-5',
    );

    expect(body.messages).toHaveLength(1);
    expect(body.output_config.format.type).toBe('json_schema');
    for (const forbidden of [
      'tools',
      'tool_choice',
      'mcp_servers',
      'container',
      'metadata',
      'thinking',
      // Removed on the current Claude generation and rejected outright there.
      'temperature',
      'top_p',
      'top_k',
    ]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
  });

  it('refuses a role this package serves no schema for', () => {
    expect(() =>
      buildOpenAiResponsesRequest(requestFor('SCENARIO_PLANNER', 'cfg.sim.gpt'), {}, 'gpt-5.6-sol'),
    ).toThrow();
  });
});
