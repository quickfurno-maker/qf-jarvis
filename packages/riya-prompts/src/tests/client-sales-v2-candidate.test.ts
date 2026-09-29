import { describe, expect, it } from 'vitest';

import * as productionBarrel from '../index.js';
import {
  createRiyaPromptRegistryV2Candidate,
  RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V2_CANDIDATE,
  RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V2_CANDIDATE,
  RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V2_CANDIDATE,
  RIYA_CLIENT_SALES_PROMPT_ID_V2_CANDIDATE,
  RIYA_CLIENT_SALES_PROMPT_VERSION_V2_CANDIDATE,
  RIYA_V2_CANDIDATE_PROMPTS,
} from '../client-sales-v2/definition.js';
import {\n  RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V2_CANDIDATE,\n} from '../client-sales-v2/system-template.js';

const template = RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V2_CANDIDATE;
const lower = template.toLowerCase();

describe('Riya v2 candidate identity and release isolation', () => {
  it('uses prompt version 2 for the same durable family', () => {
    expect(RIYA_CLIENT_SALES_PROMPT_ID_V2_CANDIDATE).toBe('riya.client-sales');
    expect(RIYA_CLIENT_SALES_PROMPT_VERSION_V2_CANDIDATE).toBe(2);
    expect(RIYA_V2_CANDIDATE_PROMPTS).toHaveLength(3);
  });

  it('keeps all three task variants on identical reviewed-candidate bytes', () => {
    expect(
      new Set(RIYA_V2_CANDIDATE_PROMPTS.map((definition) => definition.systemTemplate)).size,
    ).toBe(1);
    expect(
      new Set(RIYA_V2_CANDIDATE_PROMPTS.map((definition) => definition.contentDigest)).size,
    ).toBe(1);
    expect(RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V2_CANDIDATE.systemTemplate).toBe(template);
    expect(RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V2_CANDIDATE.systemTemplate).toBe(template);
    expect(RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V2_CANDIDATE.systemTemplate).toBe(template);
  });

  it('resolves as a candidate registry without entering the v1 production barrel', () => {
    expect(createRiyaPromptRegistryV2Candidate().definitions).toHaveLength(3);
    expect(Object.keys(productionBarrel).some((key) => key.includes('V2'))).toBe(false);
    expect(Object.keys(productionBarrel).some((key) => key.includes('CANDIDATE'))).toBe(false);
  });
});

describe('Riya v2 is a separate Jarvis-side entity serving only QuickFurno', () => {
  it('states the dedicated service boundary explicitly', () => {
    expect(lower).toContain('jarvis-side client-conversation specialist');
    expect(lower).toContain('dedicated exclusively to quickfurno');
    expect(lower).toContain('separate jarvis entity');
    expect(lower).toContain('quickfurno core remains the business and execution authority');
  });

  it('cannot impersonate Core, another agent, a vendor or a human', () => {
    for (const marker of [\n      'not quickfurno core',\n      'not anisha',\n      'not aarohi',\n      'not a vendor',\n      'not a human',\n    ]) {
      expect(lower).toContain(marker);
    }
  });

  it('keeps all execution authority outside Riya', () => {
    expect(lower).toContain('you cannot book');
    expect(lower).toContain('you cannot run tools or workflows');
    expect(lower).toContain('quickfurno core decides and executes; you propose');
    expect(lower).toContain(\n      'never say an action happened unless the turn explicitly says it happened',\n    );
  });
});

describe('Riya v2 conversation quality', () => {
  it('handles first contact naturally rather than as a menu', () => {
    expect(lower).toContain('if the client only greets you');
    expect(lower).toContain('ask what they would like help with at home');
    expect(lower).toContain('do not dump a service catalogue or a long menu');
    expect(lower).toContain('if the first message already contains a requirement');
  });

  it('answers first and minimizes interrogation', () => {
    expect(lower).toContain('answer first, then ask');
    expect(lower).toContain('ask one question by default');
    expect(lower).toContain('never turn one turn into an interview');
    expect(lower).toContain('never make them repeat themselves');
  });

  it('keeps WhatsApp replies short and avoids repetitive chatbot habits', () => {
    expect(lower).toContain('1 to 4 short sentences');
    expect(lower).toContain('prefer the shortest complete helpful answer');
    expect(lower).toContain('do not repeat "hi", "hello", "sure", "absolutely"');
    expect(lower).toContain('avoid brochures');
  });

  it('supports English, Hindi and natural Hinglish', () => {
    expect(lower).toContain('english, hindi or natural hinglish');
    expect(lower).toContain('follow their language changes');
  });

  it('handles objections without invented claims or pressure', () => {
    expect(lower).toContain('price, trust, quality or timing');
    expect(lower).toContain('do not argue, pressure, guilt');
    expect(lower).toContain('do not have an approved figure in front of you');
  });
});

describe('Riya v2 truth and containment', () => {
  it('keeps Core availability and governed knowledge authoritative', () => {
    expect(lower).toContain('"coreavailability"');
    expect(lower).toContain('"groundedknowledge"');
    expect(lower).toContain('training knowledge is never business truth about quickfurno');
    expect(lower).toContain('never invent a price');
    expect(lower).toContain('never infer that an active service plus an active city');
  });

  it('does not embed volatile QuickFurno business data', () => {
    expect(template).not.toMatch(/(?:₹|Rs\.?|INR)\s?\d/u);
    expect(template).not.toMatch(/https?:\/\//u);
    expect(template).not.toMatch(/\+?\d[\d\s-]{8,}/u);
    expect(template.length).toBeGreaterThan(4_000);
    expect(template.length).toBeLessThan(16_384);
  });

  it('keeps the model behind the structured-output boundary', () => {
    expect(lower).toContain('always follow the structured schema supplied for this turn');
    expect(lower).toContain('no extra keys');
    expect(lower).toContain('if the schema is reply-only');
    expect(lower).toContain('never manufacture a phase change');
  });
});
