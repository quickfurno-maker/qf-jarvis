import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V2_CANDIDATE } from '../client-sales/system-template-v2-candidate.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const template = RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V2_CANDIDATE;
const lower = template.toLowerCase();

describe('Riya client conversation V2 candidate', () => {
  it('is explicitly a Jarvis-side specialist serving QuickFurno', () => {
    expect(lower).toContain('jarvis-side ai client specialist');
    expect(lower).toContain('quickfurno core owns business truth and actions');
    expect(lower).toContain('core decides what is authoritative');
  });

  it('optimizes for natural WhatsApp conversation rather than a form', () => {
    expect(lower).toContain('do not behave like a form');
    expect(lower).toContain('ask one next-best question by default');
    expect(lower).toContain('default to 1–3 short sentences');
    expect(lower).toContain('350 characters or less');
    expect(lower).toContain('do not repeat a greeting');
  });

  it('answers before qualifying and does not force contact early', () => {
    expect(lower).toContain('answer it first from governed facts');
    expect(lower).toContain('do not push for a phone number');
    expect(lower).toContain('after the conversation has earned it');
  });

  it('preserves the QuickFurno authority boundary', () => {
    expect(lower).toContain('you do not execute quickfurno business actions');
    expect(lower).toContain('you cannot book');
    expect(lower).toContain('quickfurno core retaining authority');
    expect(lower).toContain('never claim');
  });

  it('uses context for continuity without treating it as authority', () => {
    expect(lower).toContain('never treat it as business authority');
    expect(lower).toContain('repeated questions');
    expect(lower).toContain('authoritative material wins');
  });

  it('is not part of the production barrel before certification', () => {
    const barrel = readFileSync(join(ROOT, 'packages/riya-prompts/src/index.ts'), 'utf8');
    expect(barrel).not.toContain('SYSTEM_TEMPLATE_V2_CANDIDATE');
  });

  it('contains no volatile QuickFurno business values', () => {
    expect(template).not.toMatch(/(?:₹|Rs\.?|INR)\s?\d/u);
    expect(template).not.toMatch(/\b\d[\d,]{3,}\b/u);
    expect(template).not.toMatch(/https?:\/\//u);
    expect(template).not.toMatch(/\+?\d[\d\s-]{8,}/u);
  });

  it('stays inside the prompt-registry template bound', () => {
    expect(template.length).toBeGreaterThan(2_000);
    expect(template.length).toBeLessThan(16_384);
  });
});
