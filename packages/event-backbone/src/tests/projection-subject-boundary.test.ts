/**
 * QFJ-P03.09 — proof that subject visibility is bounded by MODULE BOUNDARY (ADR-0044).
 *
 * The opaque subject is resolved only by `projection-subject-reader`, and ONLY the `subject-activity`
 * reducer may import it. Three proofs:
 *   1. the restricted-import RULE flags an import of the subject reader (base ESLint `Linter`);
 *   2. the rule is WIRED so metadata reducers are covered but `subject-activity` is exempt (assert the
 *      real `eslint.config.mjs` block scope + pattern);
 *   3. the subject reader is not part of the package-root surface, and `ProjectionEvent` is unchanged.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../../', import.meta.url);

function readRepo(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), 'utf8');
}

describe('subject-reader restricted-import — the rule catches the import', () => {
  it('flags an import of the subject reader under a no-restricted-imports pattern', () => {
    const linter = new Linter();
    const messages = linter.verify(
      "import { readSubjectReferenceAtPosition } from '../projection-subject-reader.js';",
      {
        languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                { group: ['**/projection-subject-reader.js'], message: 'subject boundary' },
              ],
            },
          ],
        },
      },
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });
});

describe('subject-reader restricted-import — the rule is wired to the metadata reducers only', () => {
  const config = readRepo('eslint.config.mjs');

  it('scopes the boundary block to the reducer handlers and exempts subject-activity', () => {
    expect(config).toContain("files: ['packages/event-backbone/src/projections/handlers/**/*.ts']");
    expect(config).toContain(
      "ignores: ['packages/event-backbone/src/projections/handlers/subject-activity.ts']",
    );
  });

  it('restricts importing the subject reader in that block', () => {
    expect(config).toContain("'**/projection-subject-reader.js'");
  });
});

describe('subject reader stays internal; ProjectionEvent unchanged', () => {
  it('is not referenced by the package-root barrel', () => {
    const barrel = readRepo('packages/event-backbone/src/index.ts');
    expect(barrel).not.toContain('projection-subject-reader');
    expect(barrel).not.toContain('subject-activity');
  });

  it('ProjectionEvent remains metadata-only (no subject/payload field in the definition contract)', () => {
    const definition = readRepo('packages/event-backbone/src/projections/projection-definition.ts');
    const interfaceMatch = /export interface ProjectionEvent \{([\s\S]*?)\n\}/.exec(definition);
    expect(interfaceMatch).not.toBeNull();
    const body = interfaceMatch?.[1] ?? '';
    expect(body).toContain('position');
    expect(body).toContain('eventType');
    expect(body).not.toMatch(/\bsubject\b\s*:/);
    expect(body).not.toMatch(/\bpayload\b\s*:/);
  });
});
