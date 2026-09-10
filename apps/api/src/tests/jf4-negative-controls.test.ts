/**
 * JF-4 — negative and mutation controls (ADR-0149 §14).
 *
 * Each control builds the plausible weaker composition somebody would actually write, and proves the
 * real one is distinguishable from it. None of these mutations is committed: they exist here as
 * doubles and as strings.
 *
 * The controls are deliberately aimed at the JF-4 boundaries that are load-bearing and easy to erode
 * — the single service call, the by-reference result, the absence of a direct-service fallback, and
 * the shell's inability to reach a model, a provider, RAG or a business decision.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RiyaConversationService } from '@qf-jarvis/riya-web-conversation-service';
import { describe, expect, it } from 'vitest';

import {
  RiyaCustomerOrchestrationError,
  createRiyaCustomerRuntimeComposition,
} from '../riya-customer-orchestration/index.js';

const ORCHESTRATION_DIR = fileURLToPath(new URL('../riya-customer-orchestration', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
/**
 * CODE only, comments stripped.
 *
 * A scan over raw text would flag this module's own prose -- the comments explaining why there is
 * no fallback and no retry contain both words. Scanning the code is what the assertion means.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}
const code = (): string =>
  walk(ORCHESTRATION_DIR)
    .map((f) => codeOnly(readFileSync(f, 'utf8')))
    .join('\n');

function fakeService() {
  const calls: unknown[] = [];
  const result = Object.freeze({
    version: 1,
    disposition: 'PROCESSED',
    authorizedReply: Object.freeze({ body: 'AUTHORIZED BODY' }),
  });
  return {
    calls,
    result,
    service: {
      handleTurn: (t: unknown) => {
        calls.push(t);
        return Promise.resolve(result);
      },
      handleChannelTurn: (t: unknown) => {
        calls.push(t);
        return Promise.resolve(result);
      },
    },
  };
}

const turn = {
  version: 1 as const,
  channel: 'WEB' as const,
  tenantId: 't',
  conversationId: 'c',
  messageId: 'm',
  receivedAt: '2026-09-10T00:00:00Z',
  channelTurnRef: 'r',
  dataClass: 'HOSTED_ALLOWED' as const,
};

const compose = (service: unknown) =>
  // Structural doubles on purpose: the composition duck-checks its service, and so does the ingress.
  createRiyaCustomerRuntimeComposition({ conversationService: service as RiyaConversationService });

describe('JF-4 negative and mutation controls', () => {
  it('MUTANT: the production composition offers a direct-service fallback', () => {
    // IN PRODUCTION: the orchestration boundary becomes optional, and the first inconvenient turn
    // takes the path around it. "Does a customer turn go through Mastra?" then has no answer that
    // can be checked, which is the state JF-4 exists to end.
    const { service } = fakeService();
    const composition = compose(service);
    // ONE runner, exposed twice. There is no second field, and no way to reach the service directly
    // through the composition.
    expect(Object.keys(composition).sort()).toEqual(['customerTurnRunner', 'ingressService']);
    expect(composition.ingressService).toBe(composition.customerTurnRunner);
    const asRecord = composition as unknown as Record<string, unknown>;
    for (const leaked of ['conversationService', 'service', 'runtime', 'direct', 'fallback']) {
      expect(asRecord[leaked]).toBeUndefined();
    }
    // And the composition module names no bypass.
    expect(code()).not.toMatch(/fallback|bypass|directService/u);
  });

  it('MUTANT: the shell calls the service twice', async () => {
    // IN PRODUCTION: a second call re-enters the logical-turn coordinator, the continuity CAS and the
    // model budget for one customer message. Every one of those is built on at-most-once.
    const { service, calls } = fakeService();
    const { customerTurnRunner } = compose(service);
    await customerTurnRunner.handleConversationTurn(turn);
    expect(calls).toHaveLength(1);

    // A second RUNNER invocation is a second turn and calls once more -- the guarantee is per run,
    // not per process, and this is what tells the two apart.
    await customerTurnRunner.handleConversationTurn(turn);
    expect(calls).toHaveLength(2);
  });

  it('MUTANT: the shell retries a failed turn', async () => {
    // IN PRODUCTION: a retry looks like resilience and is a duplicate customer turn. The service's
    // refusals are RESULTS; an exception is a defect, and repeating a defect does not fix it.
    let attempts = 0;
    const service = {
      handleTurn: () => Promise.resolve({}),
      handleChannelTurn: () => {
        attempts += 1;
        return Promise.reject(new Error('SYNTHETIC FAILURE'));
      },
    };
    const { customerTurnRunner } = compose(service);
    await expect(customerTurnRunner.handleConversationTurn(turn as never)).rejects.toThrow(
      RiyaCustomerOrchestrationError,
    );
    expect(attempts).toBe(1);
    // No retry configuration exists to be turned on.
    expect(code()).not.toMatch(/retries|retry|backoff|maxAttempts/u);
  });

  it('MUTANT: the workflow replaces or rewrites the authorized reply', async () => {
    // IN PRODUCTION: the only client-facing text stops being the exact bytes Core authorized. A shell
    // that can reshape a reply can also reshape one Core refused.
    const { service, result } = fakeService();
    const { customerTurnRunner } = compose(service);
    const outcome = await customerTurnRunner.handleConversationTurn(turn);
    // Identity, not equality: nothing serialized, copied or rebuilt it on the way out.
    expect(outcome).toBe(result);
    expect(outcome).toBe(await customerTurnRunner.handleConversationTurn(turn as never));
    // And the shell contains no reply construction at all.
    expect(code()).not.toMatch(/authorizedReply\s*[:=]\s*[^u]/u);
    expect(code()).not.toMatch(/body\s*:/u);
  });

  it('MUTANT: the shell reaches a model, a provider or the gateway', () => {
    // IN PRODUCTION: a second reasoning layer, an extra model call per turn, and provider selection
    // escaping the QF Model Gateway.
    const scanned = code();
    // The scan is checked against a synthetic mutant first: a pattern that never matches is
    // indistinguishable from a broken one.
    const MODEL = /model-gateway|gatewayInvoker|invokeModel|providers\/(groq|nara)/u;
    expect(MODEL.test("import { x } from '@qf-jarvis/model-gateway';")).toBe(true);
    expect(MODEL.test(scanned)).toBe(false);
  });

  it('MUTANT: the shell runs RAG itself, or derives a topic from the message', () => {
    // IN PRODUCTION: Mastra becomes a second context assembler, and the topic list starts coming from
    // the client's prose -- free-text retrieval wearing an exact retrieval's clothes.
    const scanned = code();
    const RAG = /invokeRagRetrieval|retrieveGovernedKnowledge|createRevisionBoundKnowledgePack/u;
    expect(RAG.test('const r = invokeRagRetrieval(p, q);')).toBe(true);
    // The orchestration SHELL does not retrieve. The adapter that does is a separate file and holds
    // no policy; the shell never sees a record.
    const shellOnly = walk(ORCHESTRATION_DIR)
      .filter((f) => !f.endsWith('governed-rag-knowledge-port.ts'))
      .map((f) => codeOnly(readFileSync(f, 'utf8')))
      .join('\n');
    expect(RAG.test(shellOnly)).toBe(false);
    // Precise probes. A bare `message` would flag the Error constructor's own parameter name,
    // which proves nothing -- what must be absent is anything that reads the CLIENT's text.
    for (const inference of [
      'normalizedText',
      'keyword',
      'topicsFrom',
      'deriveTopics',
      'turn.text',
      'messageText',
      'clientMessage',
    ]) {
      expect({ inference, present: scanned.includes(inference) }).toEqual({
        inference,
        present: false,
      });
    }
  });

  it('MUTANT: shared mutable current-turn state is introduced', async () => {
    // IN PRODUCTION: two concurrent conversations cross. A module-level slot holding "the current
    // turn" is the classic version, and it passes every single-threaded test.
    const seen: string[] = [];
    const service = {
      handleTurn: () => Promise.resolve({}),
      handleChannelTurn: async (t: unknown) => {
        const id = (t as { conversationId: string }).conversationId;
        seen.push(id);
        await Promise.resolve();
        return Object.freeze({ conversationId: id });
      },
    };
    const { customerTurnRunner } = compose(service);
    const [a, b] = await Promise.all([
      customerTurnRunner.handleConversationTurn({ ...turn, conversationId: 'A' }),
      customerTurnRunner.handleConversationTurn({ ...turn, conversationId: 'B' }),
    ]);
    expect((a as { conversationId: string }).conversationId).toBe('A');
    expect((b as { conversationId: string }).conversationId).toBe('B');
    expect(seen.sort()).toEqual(['A', 'B']);

    // The only module-level mutable state is an opaque run counter, which carries no turn.
    const runner = readFileSync(join(ORCHESTRATION_DIR, 'mastra-customer-turn-runner.ts'), 'utf8');
    const moduleLet = codeOnly(runner).match(/^let .*/gmu) ?? [];
    expect(moduleLet).toEqual(['let runSequence = 0;']);
  });

  it('MUTANT: Mastra memory, storage or a server is configured', () => {
    // IN PRODUCTION: a second conversation memory beside Riya's continuity, and customer content
    // retained where nobody governs it.
    const scanned = code();
    const PERSIST = /new Memory|createMemory|storage\s*:|LibSQLStore|PostgresStore|\.listen\(/u;
    expect(PERSIST.test('const m = new Memory({});')).toBe(true);
    expect(PERSIST.test(scanned)).toBe(false);
  });

  it('MUTANT: an environment read or credential enters the customer path', () => {
    const scanned = code();
    // Built rather than spelled: apps/api's own containment spec scans every file here for a literal
    // environment read, and writing one would make this spec indistinguishable from a violation.
    const envRead = ['process', '\\.', 'env'].join('');
    const SECRET = new RegExp(`${envRead}|apiKey|Authorization|Bearer |sk-[A-Za-z0-9]`, 'u');
    expect(SECRET.test(`const k = ${['process', '.env'].join('')}['GROQ_API_KEY'];`)).toBe(true);
    expect(SECRET.test(scanned)).toBe(false);
  });

  it('MUTANT: QuickFurno is imported into the customer path', () => {
    const scanned = code().toLowerCase();
    expect(scanned.includes('quickfurno')).toBe(false);
    expect(scanned.includes('onedecore')).toBe(false);
  });
});
