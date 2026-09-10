/**
 * JF-4 — customer orchestration containment (ADR-0149).
 *
 * Matrix A3–A8 (Mastra surface), C20–C22 (no model reach), J71–J84 (boundaries).
 *
 * These scan source rather than behaviour, because the guarantees are about what the customer
 * orchestration CANNOT reach. A behavioural test proves a path was not taken on the inputs tried; a
 * scan proves the path is not there.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const ORCHESTRATION_DIR = fileURLToPath(new URL('../riya-customer-orchestration', import.meta.url));
const API_PKG = fileURLToPath(new URL('../../package.json', import.meta.url));

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
/** Repository source only. `node_modules` and build output are not this repository's code. */
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}
/**
 * Tokens this spec must LOOK for but must not CONTAIN.
 *
 * apps/api's own containment specs scan every file here for a literal environment read and a
 * literal network call, and a forbidden-token list that spelled either would be indistinguishable
 * from a file that used it. Composing them keeps both scans honest -- the repository's existing
 * idiom, which words production comments around a banned specifier for the same reason.
 */
const ENV_READ = ['process', '.env'].join('');
const NETWORK_CALL = ['fetch', '('].join('');

const orchestrationFiles = (): string[] => walk(ORCHESTRATION_DIR);
const orchestrationCode = (): string =>
  orchestrationFiles()
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

describe('JF-4 (A) the Mastra surface is minimal', () => {
  it('(A3) packages/** contain ZERO Mastra imports', () => {
    // The hard architecture line. Domain packages stay framework-neutral, so Riya, the gateway and
    // the governed boundaries remain reusable and testable without an orchestration framework.
    const offenders: string[] = [];
    for (const file of walk(repoPath('packages'))) {
      if (readFileSync(file, 'utf8').includes('@mastra/')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('(A4) the JAO worker Mastra files are untouched by JF-4', () => {
    // Operations Mastra and customer Mastra are separate lanes. JF-4 neither moved JAO into apps/api
    // nor imported it: an operations workflow reachable from the customer path would put founder
    // tooling behind a customer request.
    for (const jao of [
      'apps/worker/src/jao/mastra-supervisor/workflow.ts',
      'apps/worker/src/jao/governed-specialist-delegation/workflow.ts',
    ]) {
      const text = readFileSync(repoPath(jao), 'utf8');
      expect(text).toContain("from '@mastra/core/workflows'");
    }
    const code = orchestrationCode();
    for (const forbidden of ['jao', 'Jao', 'JAO', 'mastra-supervisor', 'specialist']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(A5) the customer orchestration imports the workflows surface and nothing else from Mastra', () => {
    const imported = new Set<string>();
    for (const file of orchestrationFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from '(@mastra\/[^']+)'/gu)) {
        imported.add(match[1] ?? '');
      }
    }
    expect([...imported].sort()).toEqual(['@mastra/core/workflows']);
  });

  it('(A6,A7,A8) no agent, no memory, no storage, no scheduler, no MCP, no server', () => {
    const code = orchestrationCode();
    for (const forbidden of [
      'Agent',
      'createAgent',
      'Memory',
      'createMemory',
      'storage',
      'Storage',
      'LibSQL',
      'PostgresStore',
      'suspend',
      'resume',
      'scheduler',
      'schedule',
      'cron',
      'mcp',
      'MCP',
      'createServer',
      'listen(',
      'telemetry',
      'vector',
      'embed',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the exact Mastra version matches the one already in the repository lock', () => {
    const api = JSON.parse(readFileSync(API_PKG, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const worker = JSON.parse(readFileSync(repoPath('apps/worker/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    // The SAME exact version, pinned in both. No second Mastra, no range, no `latest`.
    expect(api.dependencies?.['@mastra/core']).toBe('1.61.0');
    expect(worker.dependencies?.['@mastra/core']).toBe('1.61.0');
    expect(api.dependencies?.['@mastra/core']).toBe(worker.dependencies?.['@mastra/core']);
  });
});

describe('JF-4 (C) the orchestration reaches no model and no provider', () => {
  it('(C20,C21,C22) no gateway, no provider adapter, no model id, no retry budget', () => {
    const code = orchestrationCode();
    for (const forbidden of [
      'model-gateway',
      'ModelGateway',
      'gatewayInvoker',
      'providers/groq',
      'providers/nara',
      'groq',
      'Groq',
      'nara',
      'Nara',
      'local-openai',
      'openai',
      'ProviderMode',
      'providerId',
      'modelId',
      'retryBudget',
      'apiKey',
      'Authorization',
      ENV_READ,
      NETWORK_CALL,
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the orchestration imports only the workspace packages it genuinely uses', () => {
    const imported = new Set<string>();
    for (const file of orchestrationFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from '(@qf-jarvis\/[^']+)'/gu)) {
        imported.add(match[1] ?? '');
      }
    }
    // The service it orchestrates, the runtime type the RAG port satisfies, the JF-3 provisioning
    // boundary it calls, and the governed request/result types it adapts between. Nothing else --
    // and in particular no continuity store, no Core adapter and no gateway.
    expect([...imported].sort()).toEqual([
      '@qf-jarvis/governed-knowledge',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/rag-provisioning',
      '@qf-jarvis/riya-web-conversation-service',
    ]);
    expect(orchestrationCode()).not.toMatch(
      /@qf-jarvis\/[a-z-]+\/(src|dist|internal|composition|adapter|service)\//u,
    );
  });
});

describe('JF-4 (J) boundaries', () => {
  it('(J71,J72,J73) no QuickFurno, no OneDecore, no live delivery transport', () => {
    const code = orchestrationCode().toLowerCase();
    for (const forbidden of [
      'quickfurno',
      'onedecore',
      'meta.com',
      'graph.facebook',
      'wa.me',
      'whatsapp.com',
      'n8n',
      'twilio',
      'sendmessage',
      'deliver',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(J73) the channel vocabulary is imported, never respelled, and nothing can send', () => {
    // The orchestration names no channel literal at all: the vocabulary type comes from RWC-P8,
    // which owns it. That keeps apps/api's existing repository-wide transport ban intact AND
    // removes a second definition of which channels exist -- two things one import buys.
    const code = orchestrationCode();
    expect(code.toLowerCase()).not.toContain('whatsapp');
    expect(code).toContain('RiyaConversationChannel');
    for (const forbidden of [
      'phoneNumber',
      'waId',
      'templateName',
      'accessToken',
      'businessAccount',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(J74,J75) no migration, no database, no schema', () => {
    // The migration COUNT is locked in three other suites already, and naming the persistence package
    // here would break apps/api's exact two-file lock for no additional proof. What this spec adds is
    // the part that is specific to JF-4: the customer orchestration owns no schema and no connection.
    const code = orchestrationCode().toLowerCase();
    for (const forbidden of [
      'pg',
      'postgres',
      'createpool',
      'select ',
      'insert into',
      'migration',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(J76) the orchestration starts nothing and reads no environment or filesystem', () => {
    const code = orchestrationCode();
    for (const forbidden of [
      'node:fs',
      'node:net',
      'node:http',
      'node:https',
      'node:child_process',
      'createServer',
      '.listen(',
      ENV_READ,
      'readFileSync',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(J80) the orchestration reaches no training or evaluation package', () => {
    const code = orchestrationCode();
    for (const forbidden of [
      'model-evaluation',
      'riya-ai-synthetic',
      'riya-candidate',
      'dataset',
      'training',
      'benchmark',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the orchestration holds no business authority and cannot act', () => {
    const code = orchestrationCode();
    for (const forbidden of [
      'coreDecision',
      'CoreDecision',
      'createLead',
      'consent',
      'Consent',
      'authorizeReply',
      'canSend',
      'submitIntake',
      'continuityStore',
      'turnCoordinator',
      'JarvisRuntime',
      'processInbound',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});
