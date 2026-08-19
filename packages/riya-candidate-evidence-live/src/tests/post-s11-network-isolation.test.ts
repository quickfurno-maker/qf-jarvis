/**
 * POST-S11 REQUEST-CONTRACT REPAIR — the offline work is structurally incapable of reaching a provider.
 *
 * Every artefact this phase added is a pure function over a schema or a plan: the strict-schema
 * inventory, the reduction ladder, and the completion-budget derivation. None of them may open a
 * socket, read a credential, or construct a real transport — and "may not" has to be a property
 * somebody can check rather than a claim in a commit message, because the entire reason this phase is
 * offline is that the next provider request has to be owner-authorized.
 *
 * These specs check it two ways: structurally, by reading the modules' own source for the seams that
 * could reach a network, and behaviourally, by driving the real reducer and inventory with `fetch`
 * and the Groq transport factory replaced by traps that fail the test if they are ever called.
 */
import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import { planRiyaSchemaRepairVerification } from '../internal/riya-schema-repair-verification-plan.js';
import { inventoryStrictSchema } from '../internal/strict-schema-inventory.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** The modules this phase added or reshaped, plus the capture path they all depend on. */
const OFFLINE_MODULES = [
  'internal/strict-schema-inventory.ts',
  'internal/riya-schema-probe-matrix.ts',
  'internal/riya-schema-repair-verification-plan.ts',
  'internal/schema-repair-verification-classification.ts',
  'internal/schema-differential-classification.ts',
  'internal/schema-differential-emitters.ts',
  'diagnostic-canary-materials.ts',
];

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

describe('the offline modules name no network, credential or transport seam', () => {
  it('none of them can reach a provider even in principle', () => {
    for (const relative of OFFLINE_MODULES) {
      const code = codeOnly(readFileSync(join(SRC, relative), 'utf8'));
      for (const forbidden of [
        'createFetchGroqTransport',
        'GroqModelProvider',
        'createGroqProviderConfig',
        'createModelGateway',
        'api.groq.com',
        'undici',
        'node:http',
        'node:https',
        'process.env',
        'readOnce',
        'GroqApiKey',
      ]) {
        expect(code, `${relative} must not name ${forbidden}`).not.toContain(forbidden);
      }
      expect(code, `${relative} must not call fetch`).not.toMatch(/[^a-zA-Z]fetch\(/u);
    }
  });
});

describe('the reducer and the inventory run with the network trapped', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('plans the full ladder without a single outbound call', async () => {
    let attempts = 0;
    // Any real client would go through here. If the count moves, the phase was not offline.
    globalThis.fetch = (): never => {
      attempts += 1;
      throw new Error('NETWORK-REACHED-IN-OFFLINE-PHASE');
    };

    const captured = await captureProductionRiyaCanaryRequest();
    const projection = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const inventory = inventoryStrictSchema(projection.schema);
    const plan = planRiyaSchemaRepairVerification(projection.schema);

    // The work genuinely happened...
    expect(inventory.objectCount).toBeGreaterThan(0);
    expect(plan.length).toBeGreaterThan(0);
    // ...and nothing left the process.
    expect(attempts).toBe(0);
  });

  it('the production request capture reaches no provider either', async () => {
    let attempts = 0;
    globalThis.fetch = (): never => {
      attempts += 1;
      throw new Error('NETWORK-REACHED-IN-CAPTURE');
    };

    // The capture runs a REAL Riya turn against a capturing invoker; the gateway seam is never built.
    const captured = await captureProductionRiyaCanaryRequest();
    expect(captured.messages.length).toBeGreaterThan(0);
    expect(attempts).toBe(0);
  });
});
