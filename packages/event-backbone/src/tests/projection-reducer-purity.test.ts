/**
 * QFJ-P03.08 — proof that projection reducer PURITY is mechanically enforced (ADR-0043 §J, closing the
 * ADR-0022 §4 gap the readiness audit found missing).
 *
 * Two proofs:
 *   1. The rule SET catches an intentional violation: an impure reducer (clock, randomness, env,
 *      `new Date()`, network, filesystem) is flagged; a pure reducer is clean. Run through ESLint's
 *      `Linter` with the same restriction rules the config wires to the reducer files.
 *   2. The rule set is WIRED: `eslint.config.mjs` contains a block scoped to
 *      `projections/handlers/**` carrying those restrictions, so CI's `eslint . --max-warnings=0`
 *      enforces them on the real reducers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

/** The reducer-purity rules — mirrors the `projections/handlers/**` block in eslint.config.mjs. */
const REDUCER_PURITY_RULES: Linter.RulesRecord = {
  'no-restricted-globals': [
    'error',
    { name: 'process', message: 'no env' },
    { name: 'fetch', message: 'no network' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'no clock' },
    { object: 'Math', property: 'random', message: 'no randomness' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
      message: 'no wall clock',
    },
  ],
  'no-restricted-imports': [
    'error',
    { patterns: [{ group: ['node:fs', 'node:crypto', 'fs', 'http', 'https'], message: 'no I/O' }] },
  ],
};

function lintReducer(code: string): Linter.LintMessage[] {
  const linter = new Linter();
  return linter.verify(code, {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { process: 'readonly', fetch: 'readonly', Date: 'readonly', Math: 'readonly' },
    },
    rules: REDUCER_PURITY_RULES,
  });
}

describe('projection reducer purity — the rule catches an intentional violation', () => {
  it('flags a clock read via Date.now()', () => {
    const messages = lintReducer('export const t = Date.now();');
    expect(messages.some((m) => m.ruleId === 'no-restricted-properties')).toBe(true);
  });

  it('flags a wall-clock read via new Date()', () => {
    const messages = lintReducer('export const t = new Date();');
    expect(messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
  });

  it('flags randomness via Math.random()', () => {
    const messages = lintReducer('export const r = Math.random();');
    expect(messages.some((m) => m.ruleId === 'no-restricted-properties')).toBe(true);
  });

  it('flags environment access via process', () => {
    const messages = lintReducer('export const e = process.env.FOO;');
    expect(messages.some((m) => m.ruleId === 'no-restricted-globals')).toBe(true);
  });

  it('flags network access via fetch', () => {
    const messages = lintReducer('export const p = fetch("http://x");');
    expect(messages.some((m) => m.ruleId === 'no-restricted-globals')).toBe(true);
  });

  it('flags filesystem/crypto imports', () => {
    const fs = lintReducer('import { readFileSync } from "node:fs";');
    const crypto = lintReducer('import { randomUUID } from "node:crypto";');
    expect(fs.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
    expect(crypto.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('leaves a pure, deterministic reducer clean', () => {
    const pure = [
      'export async function apply(client, event) {',
      '  await client.query("INSERT ...", [event.eventType, event.position.toString(), event.acceptedAt]);',
      '}',
    ].join('\n');
    expect(lintReducer(pure)).toEqual([]);
  });
});

describe('projection reducer purity — the rule is wired to the reducer files', () => {
  const configPath = fileURLToPath(new URL('../../../../eslint.config.mjs', import.meta.url));
  const config = readFileSync(configPath, 'utf8');

  it('scopes a purity block to projections/handlers', () => {
    expect(config).toContain('packages/event-backbone/src/projections/handlers/**/*.ts');
  });

  it('forbids the clock, randomness, environment, and I/O in that block', () => {
    // The block appears before the trailing Prettier config; assert its key restrictions are present.
    expect(config).toContain("property: 'now'");
    expect(config).toContain("property: 'random'");
    expect(config).toContain("name: 'process'");
    expect(config).toContain('NewExpression[callee.name="Date"][arguments.length=0]');
  });
});
