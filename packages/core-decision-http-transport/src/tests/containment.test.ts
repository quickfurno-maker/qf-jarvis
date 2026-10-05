import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../transport.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

describe('QuickFurno Core transport containment', () => {
  it('contains no environment, database, QuickFurno Core Automation, provider or QuickFurno business-table access', () => {
    for (const forbidden of [
      'process.env',
      'postgres',
      'supabase',
      'quickfurno-core-automation',
      'whatsapp',
      'groq',
      'nara',
      'openai',
      'anthropic',
      'service_role',
    ]) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('delegates network isolation to the shared Phase 11 transport with no local retry/fallback loop', () => {
    expect(source).toContain('@qf-jarvis/cross-system-scale-contract');
    expect(source).toContain('executeQfjScaleRequest');
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toContain('new AbortController()');
    expect(source).not.toMatch(/\bretry\b|\bfallback\b|for\s*\([^)]*attempt|while\s*\(/u);
  });

  it('never reads response JSON or decides ACCEPTED itself', () => {
    expect(source).not.toContain('.json(');
    expect(source).not.toContain('ACCEPTED');
    expect(source).not.toContain('CoreCommandResponse');
  });
});
