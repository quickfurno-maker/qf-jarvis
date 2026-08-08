/**
 * Containment for the Riya conversation evolution package (RWC-P4A, ADR-0098).
 *
 * The behaviour specs prove what the reducer decides. These prove what the package cannot do at
 * all: no model, no I/O, no clock, no randomness, no persistence, no channel, no business authority
 * and no reach into any of the phases or slices it does not own.
 *
 * Scans read production source with comments stripped: this package necessarily NAMES the things it
 * refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));

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

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const productionFiles = (): string[] => walk(SRC, true);
const productionCode = (): string =>
  productionFiles()
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

describe('the public surface is five runtime values', () => {
  it('exports exactly the approved symbols', () => {
    // Exporting the rank map would be exporting half a reducer; exporting the phase table would
    // invite a second one beside it.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_CONVERSATION_EVOLUTION_ERROR_CODES',
      'RIYA_DISCOVERY_OBSERVATION_OPERATIONS',
      'RiyaConversationEvolutionError',
      'createRiyaConversationObservationBatch',
      'evolveRiyaConversation',
    ]);
  });

  it('exports no internal table, schema, fixture or reducer half', () => {
    for (const forbidden of [
      'PROVENANCE_RANK',
      'DISCOVERY_VALUE_KEY',
      'SUMMARY_REQUIRED_FIELDS',
      'USER_ORIGIN_PROVENANCES',
      'EVOLVABLE_PHASES',
      'OUT_OF_SCOPE_PHASES',
      'mergeObservations',
      'nextPhase',
      'questionPlanFor',
      'summaryReady',
      'observationSchema',
      'batchSchema',
      'stateWith',
      'synthetic',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('depends on exactly two workspace packages and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-continuity',
      'zod',
    ]);
    // One entry point. No `./testing` subpath: the fixtures are specs' own, and shipping them would
    // make a deterministic fake available to a composition that should build its own.
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('imports no package it does not depend on, and no deep path', () => {
    const imported = new Set<string>();
    for (const file of productionFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from '(@qf-jarvis\/[^']+)'/gu)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- group 1 always matches
        imported.add(match[1]!);
      }
    }
    expect([...imported].sort()).toEqual([
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-continuity',
    ]);
    expect(productionCode()).not.toMatch(
      /@qf-jarvis\/[a-z-]+\/(src|dist|internal|composition|adapter|service|testing)\//u,
    );
  });
});

describe('it is pure: no model, no I/O, no time, no randomness', () => {
  it('reaches no model, gateway, prompt or reply adapter', () => {
    const code = productionCode();
    for (const forbidden of [
      'model-gateway',
      'model-reply-adapter',
      'ModelReplyPort',
      'draftReply',
      'structuredSchema',
      'promptRegistry',
      'systemTemplate',
      'gateway',
      'inference',
      // Not the bare word "completion": `completionEvidenceRef` is a real state field this reducer
      // must PRESERVE, and scanning for a prefix of it would report carrying the state forward as a
      // model call. The API-shaped form is what a model client would name.
      'completions',
      'openai',
      'groq',
    ]) {
      expect({ forbidden, present: code.toLowerCase().includes(forbidden.toLowerCase()) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('performs no I/O of any kind', () => {
    const code = productionCode();
    for (const forbidden of [
      'node:fs',
      'node:http',
      'node:net',
      'node:crypto',
      'node:child_process',
      'fetch(',
      'process.env',
      'process.argv',
      'pg',
      'Pool',
      'SELECT ',
      'INSERT ',
      'UPDATE ',
      'qf_jarvis.',
      'compareAndSet',
      'createInitialIfAbsent',
      'await ',
      'Promise',
      'async ',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('reads no clock and no randomness — the property RWC-P4B re-merge depends on', () => {
    const code = productionCode();
    for (const forbidden of [
      'Date.now',
      'new Date',
      'Math.random',
      'crypto.randomUUID',
      'performance.now',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('reaches no runtime, service, application or Core adapter', () => {
    const code = productionCode();
    for (const forbidden of [
      'jarvis-runtime',
      'agent-runtime',
      'riya-web-conversation-service',
      'postgres-riya-conversation-continuity-store',
      'core-decision-adapter',
      'event-backbone',
      'apps/api',
      'createJarvisRuntime',
      'processInbound',
      'handleTurn',
      'InboundEnvelope',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('it holds no authority it does not own', () => {
  it('names no business truth, contact detail or delivery capability', () => {
    const code = productionCode();
    for (const forbidden of [
      // `consent` is deliberately NOT scanned as a bare word: `CONSENT` is a phase in the frozen
      // vocabulary, and this package has to NAME it in order to refuse to enter it. What must be
      // absent is a consent VALUE or decision, which the field-shaped tokens below catch.
      'consentGiven',
      'hasConsent',
      'consentRef',
      'canSubmit',
      'leadId',
      'createLead',
      'vendor',
      'package',
      'price',
      'payment',
      'wallet',
      'suppression',
      'phone',
      'email',
      'fullName',
      'coordinate',
      'latitude',
      'longitude',
      'pincode',
      'n8n',
      'whatsapp',
      'provider',
      'sendMessage',
      'deliver',
      'quickfurno',
    ]) {
      expect({ forbidden, present: code.toLowerCase().includes(forbidden.toLowerCase()) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('retains no transcript, quote or raw client text', () => {
    const code = productionCode();
    for (const forbidden of [
      'transcript',
      'history',
      'recentTurns',
      'rollingSummary',
      'evidenceSpan',
      'quote',
      'rawText',
      'normalizedText',
      'confidence',
      'reasoning',
      'chainOfThought',
      'messageId',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('carries no channel — WEB and WhatsApp are the same Riya', () => {
    const code = productionCode();
    for (const forbidden of [
      'channel',
      'WEB',
      'WHATSAPP',
      'web-',
      'browser',
      'cookie',
      'session',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('never fabricates ClientSalesSignals', () => {
    // They remain an external validated input (ADR-0067/0068). Discovery evolution is a separate
    // concern, and merging the two would let a reducer manufacture the input that activates the
    // behaviour kernel.
    const code = productionCode();
    for (const forbidden of [
      'ClientSalesSignals',
      'hasPriorSalesContext',
      'requestedHumanAssistance',
      'requestedQuoteOrConsultation',
      'providedRequirementDetail',
      'askedAboutReadiness',
      'outOfSalesScope',
      'missingDiscoveryFieldCount',
      'decideRiyaTurn',
      'classifyClientSalesIntent',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('owns no slice beyond its own: no P5 location validation, no P6 submission, no P7 RAG', () => {
    const code = productionCode();
    for (const forbidden of [
      // RWC-P5: whether a `locationRef` names a served city is not this package's question.
      'serviceArea',
      'cityCatalogue',
      'isServed',
      'availability',
      // RWC-P6. `completionEvidenceRef` is PRESERVED by this reducer -- carrying an existing value
      // forward is not minting one -- so what is scanned is the act of producing evidence or a
      // submission, not the field's name.
      'summaryConfirmed: true',
      'createCompletionEvidence',
      'submitLead',
      'submission',
      // RWC-P7 / RWC-P8.
      'retrieval',
      'embedding',
      'citation',
      'identityLink',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});
