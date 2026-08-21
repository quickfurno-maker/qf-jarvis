/**
 * What this package cannot become.
 *
 * Two bounded agents share the Anisha persona family. The whole value of that split is that neither
 * can quietly absorb the other, and that neither rebuilds infrastructure the platform already owns.
 * Both are absences, so both are asserted rather than trusted.
 *
 * Scans read source with comments stripped, because this package documents at length the things it
 * refuses to be and scanning the prose would report every prohibition as a violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

describe('the two Anisha agents are siblings that never see each other', () => {
  it('this package imports the VENDOR package nowhere', () => {
    // A care package that could import the vendor one would be one import away from answering for
    // it — which is exactly the widening this split exists to prevent.
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not import the vendor Anisha package`).not.toContain(
        '@qf-jarvis/anisha-agent',
      );
    }
  });

  it('the VENDOR package does not import this one either', () => {
    // Symmetry matters: the arrow must not point in either direction, or the two become one agent
    // with two entry points.
    for (const file of walk(join(REPO_ROOT, 'packages/anisha-agent/src'), false)) {
      expect(readFileSync(file, 'utf8')).not.toContain('@qf-jarvis/anisha-care-agent');
    }
  });

  it('neither Riya nor a runtime is imported', () => {
    // Composition is orchestration's job. A behaviour kernel that reached a runtime would be
    // deciding routing it cannot see.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        '@qf-jarvis/riya-agent',
        '@qf-jarvis/jarvis-runtime',
        '@qf-jarvis/riya-prompts',
        '@qf-jarvis/riya-model-interaction',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('it rebuilds no infrastructure the platform already owns', () => {
  it('composes no gateway, backbone, memory, provider or transport', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        '@qf-jarvis/model-gateway',
        '@qf-jarvis/model-reply-adapter',
        '@qf-jarvis/event-backbone',
        '@qf-jarvis/event-ingestion',
        '@qf-jarvis/governed-knowledge',
        'createModelGateway',
        'ModelProvider',
        'GroqApiKey',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('opens no network, reads no environment and touches no filesystem or database', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'node:fs',
        'node:http',
        'node:https',
        'node:net',
        'process.env',
        'postgres',
        'supabase',
        'axios',
        'undici',
        'whatsapp',
        'graph.facebook',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
      expect(code, `${file} must not call fetch`).not.toMatch(/[^a-zA-Z]fetch\(/u);
    }
  });

  it('declares exactly the dependencies it composes', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/agent-runtime',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
    // One entry point, so there is no deep-import route around the public surface.
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
  });
});

describe('it renders no prompt and takes no action', () => {
  it('carries no prompt TEXT — only an opaque reference', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['systemPrompt', 'promptText', 'renderPrompt', 'buildUserContent']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no executable action, approval, payment or state mutation', () => {
    // Care NOTICES and EXPLAINS. Refunds, credits, cancellations, assignment and money are
    // QuickFurno Core's, and a care package that named one of those verbs would be one edit away
    // from performing it.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'executeAction',
        'dispatchAction',
        'approve(',
        'issueRefund',
        'processPayment',
        'cancelOrder',
        'assignVendor',
        'updateOrder',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('the context contract carries BANDS and opaque refs, never amounts or identities', () => {
    const context = codeOnly(readFileSync(join(SRC, 'contracts/care-context.ts'), 'utf8'));
    for (const forbidden of [
      'amount',
      'balance',
      'total',
      'phone',
      'email',
      'address',
      'customerName',
    ]) {
      expect(context.toLowerCase(), `care context must not carry ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });
});

describe('nothing composes this leaf yet', () => {
  it('NO package or app imports it', () => {
    // It is a behaviour kernel with no consumer until orchestration wires it. Asserted so the first
    // consumer is a deliberate decision rather than an accident.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'anisha-care-agent') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/anisha-care-agent')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });
});
