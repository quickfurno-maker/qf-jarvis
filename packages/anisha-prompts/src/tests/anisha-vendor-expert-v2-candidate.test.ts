import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createAnishaPromptRegistryV1, ANISHA_PRODUCTION_PROMPTS } from '../index.js';
import { ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE } from '../vendor-journey/definition-v2-candidate.js';
import { ANISHA_VENDOR_EXPERT_SYSTEM_TEMPLATE_V2_CANDIDATE as body } from '../vendor-journey/system-template-v2-candidate.js';

describe('Anisha vendor-expert v2 offline candidate', () => {
  it('uses a distinct version and stable digest without entering the production registry', () => {
    expect(ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE.promptId).toBe('anisha.vendor-journey');
    expect(ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE.promptVersion).toBe(2);
    expect(ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE.agentScope).toBe('VENDOR');
    expect(ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE.taskClass).toBe('RESPONSE_GENERATION');
    expect(ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE.resultMode).toBe('STRUCTURED');
    expect(ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE.contentDigest).toBe(
      createHash('sha256').update(body, 'utf8').digest('hex'),
    );
    expect(ANISHA_PRODUCTION_PROMPTS).toHaveLength(1);
    expect(ANISHA_PRODUCTION_PROMPTS[0]?.promptVersion).toBe(1);
    expect(
      createAnishaPromptRegistryV1().resolve({
        promptId: 'anisha.vendor-journey',
        promptVersion: 2,
        agentScope: 'VENDOR',
        taskClass: 'RESPONSE_GENERATION',
        resultMode: 'STRUCTURED',
      }),
    ).toBeUndefined();
  });

  it('represents QuickFurno officially while disclosing it is an AI', () => {
    expect(body).toContain('official AI Vendor Support Specialist');
    expect(body).toContain('never a human employee');
    expect(body).toContain("I'm Anisha, QuickFurno's AI vendor support assistant.");
    expect(body).toContain('Act with the ownership');
  });

  it('pins English and Roman-letter Hinglish as the only response languages', () => {
    expect(body).toContain('Reply only in English or natural Hinglish written in Roman letters.');
    expect(body).toContain('Never output Marathi, Devanagari text or pure/formal Hindi.');
    expect(body).not.toMatch(/[\u0900-\u097F]/u);
  });

  it('maintains vendor, Core, escalation, privacy and authorization boundaries', () => {
    for (const requirement of [
      'Riya handles clients',
      'Aarohi handles unregistered prospective vendors',
      'QuickFurno Core is the only authority',
      'You propose wording only',
      'Never perform or claim a mutation',
      'never a human employee',
      'Never ask for or repeat OTPs',
      'authenticated QuickFurno portal',
      'approved VENDOR-scope reference records',
      'consent, frequency checks, provider templates and sending',
      'use it only when relevant',
    ]) {
      expect(body).toContain(requirement);
    }
    expect(body).not.toMatch(/₹\s*\d|guaranteed\s+\d+\s+leads/iu);
  });
});
