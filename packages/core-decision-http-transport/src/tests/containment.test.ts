import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../transport.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

describe('QuickFurno Core transport containment', () => {
  it('contains no environment, database, n8n, provider or QuickFurno business-table access', () => {
    for (const forbidden of [
      'process.env',
      'postgres',
      'supabase',
      'n8n',
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

  it('has exactly one fetch call, one AbortController and no retry/fallback loop', () => {
    expect(source.match(/\bfetch\s*\(/gu)).toHaveLength(1);
    expect(source.match(/new AbortController\(\)/gu)).toHaveLength(1);
    expect(source).not.toMatch(/\bretry\b|\bfallback\b|for\s*\([^)]*attempt|while\s*\(/u);
  });

  it('never reads response JSON or decides ACCEPTED itself', () => {
    expect(source).not.toContain('.json(');
    expect(source).not.toContain('ACCEPTED');
    expect(source).not.toContain('CoreCommandResponse');
  });
});
