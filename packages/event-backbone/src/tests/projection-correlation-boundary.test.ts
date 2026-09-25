import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const HANDLERS = join(REPO_ROOT, 'packages', 'event-backbone', 'src', 'projections', 'handlers');

describe('correlation visibility stays narrow', () => {
  it('only the correlation-timeline handler imports the narrow correlation reader', () => {
    const importers = readdirSync(HANDLERS)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) =>
        readFileSync(join(HANDLERS, name), 'utf8').includes('projection-correlation-reader'),
      )
      .sort();

    expect(importers).toEqual(['correlation-timeline.ts']);
  });

  it('keeps correlation identity out of the generic ProjectionEvent contract', () => {
    const definition = readFileSync(
      join(
        REPO_ROOT,
        'packages',
        'event-backbone',
        'src',
        'projections',
        'projection-definition.ts',
      ),
      'utf8',
    );
    const interfaceMatch = /export interface ProjectionEvent \{([\s\S]*?)\n\}/.exec(definition);
    expect(interfaceMatch).not.toBeNull();
    const body = interfaceMatch?.[1] ?? '';
    expect(body).not.toMatch(/\bcorrelation(Id)?\b\s*:/iu);
    expect(body).not.toMatch(/\bpayload\b\s*:/iu);
    expect(body).not.toMatch(/\bsubject\b\s*:/iu);
  });

  it('keeps the correlation reader and timeline reducer out of the public package root', () => {
    const barrel = readFileSync(
      join(REPO_ROOT, 'packages', 'event-backbone', 'src', 'index.ts'),
      'utf8',
    );
    expect(barrel).not.toContain('projection-correlation-reader');
    expect(barrel).not.toContain('correlation-timeline');
  });
});
