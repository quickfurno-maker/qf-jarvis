/**
 * RWC-P6A — containment for `@qf-jarvis/riya-conversation-completion` (ADR-0101 §36).
 *
 * The companion specs prove what this reducer decides. This one proves what it cannot do at all, and
 * three of the rules are load-bearing rather than hygienic:
 *
 * - **It performs no I/O.** That is what lets RWC-P6B re-run it during a compare-and-set
 *   reconciliation, exactly as P4A's purity lets P4B re-merge a batch.
 * - **It cannot reach Core.** A reducer that could fetch a consent state would be a reducer that
 *   could decide one. Evidence arrives as an inert value or the transition does not happen.
 * - **It contains no second discovery reducer.** Every edit and confirmation delegates to the real
 *   RWC-P4A, so there is one set of merge rules rather than two that agree until one is corrected.
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
    if (entry === 'node_modules' || entry === 'dist') continue;
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

const productionCode = (): string =>
  walk(SRC, true)
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

const forbid = (code: string, values: readonly string[]): void => {
  for (const forbidden of values) {
    expect({
      forbidden,
      present: code.toLowerCase().includes(forbidden.toLowerCase()),
    }).toStrictEqual({ forbidden, present: false });
  }
};

describe('it is pure, which is what makes it re-runnable', () => {
  it('performs no I/O of any kind', () => {
    forbid(productionCode(), [
      'fetch(',
      'node:http',
      'node:https',
      'node:fs',
      'node:net',
      'undici',
      'axios',
      "'pg'",
      'DATABASE_URL',
      'process.env',
      'SELECT ',
      'INSERT INTO',
      'compareAndSet',
      'n8n',
      'webhook',
      'https://',
    ]);
  });

  it('reads no clock and no randomness', () => {
    // A transition that read a clock would produce a different state on a replay, and a replay is
    // exactly what a compare-and-set reconciliation is.
    forbid(productionCode(), [
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'hrtime',
      'createHash',
      'node:crypto',
    ]);
  });

  it('invokes no model', () => {
    // The whole point of a STRUCTURED action: confirmation authority never comes from an inference.
    forbid(productionCode(), [
      'model-gateway',
      'model-reply-adapter',
      'riya-model-interaction',
      'ModelGatewayInvoker',
      'structuredOutputProfile',
      'gatewayInvoker',
      'openai',
      'anthropic',
    ]);
  });

  it('cannot reach Core, and holds no Core port', () => {
    // Evidence arrives as an inert value or the transition does not happen. A reducer able to fetch a
    // consent state would be a reducer able to decide one.
    forbid(productionCode(), [
      'core-riya-intake',
      'CoreRiyaIntakePort',
      'readCurrent',
      'submitConfirmedIntake',
      'lookupSubmission',
      'core-decision-adapter',
      'CoreDecisionTransport',
    ]);
  });

  it('is not a composition: no runtime, no service, no application', () => {
    forbid(productionCode(), [
      'jarvis-runtime',
      'riya-web-conversation-service',
      'agent-runtime',
      'InboundEnvelope',
      'postgres',
      'event-backbone',
    ]);
  });
});

describe('it holds nothing that belongs to Core or to a person', () => {
  it('names no contact, consent or business concept', () => {
    forbid(productionCode(), [
      'phoneNumber',
      'emailAddress',
      'customerName',
      'consentGranted',
      'consentText',
      'consentState',
      'optedOut',
      'canSubmit',
      'leadId',
      'vendorId',
      'price',
      'package',
      'payment',
      'transcript',
      'latitude',
      'pincode',
    ]);
  });

  it('stores no consent boolean and mutates no consent', () => {
    forbid(productionCode(), ['grantConsent', 'setConsent', 'withdrawConsent', 'consent:']);
  });

  it('is ONE Riya: nothing here knows about a channel or a surface', () => {
    forbid(productionCode(), ['channel', 'WEB', 'WHATSAPP', 'browser', 'cookie', 'CORS', 'route']);
  });
});

describe('RWC-P4A remains the only discovery reducer', () => {
  it('delegates rather than re-implementing', () => {
    const code = productionCode();
    // It USES the real reducer...
    expect(code).toContain('evolveRiyaConversation');
    // ...and reimplements none of its internals. Any of these appearing here would be a second set of
    // merge rules for one conversation, and the two would drift on the first correction to either.
    forbid(code, [
      'PROVENANCE_RANK',
      'SUMMARY_REQUIRED_FIELDS',
      'mergeObservations',
      'completenessFor',
      'summaryReady',
      'nextPhase',
      'questionPlanFor',
      'DISCOVERY_VALUE_KEY',
    ]);
  });

  it('uses the SHARED Core availability policy, and reimplements no pair rule', () => {
    const code = productionCode();
    expect(code).toContain('core-service-availability-read/policy');
    // A local copy of the pair rule is the failure the shared subpath exists to prevent.
    forbid(code, ['function pairAvailable', 'cityRefs ===', "'ALL'"]);
  });
});

describe('it stays a leaf with a small surface', () => {
  it('depends on exactly four workspace packages and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/core-service-availability-read',
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
  });

  it('deep-imports no other package private module', () => {
    // `/policy` is a declared subpath export, not a private path, so it is not caught by this.
    expect(productionCode()).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal)\//u);
  });

  it('exposes exactly the seven runtime values it means to', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_CONVERSATION_COMPLETION_ERROR_CODES',
      'RiyaConversationCompletionError',
      'advanceRiyaAfterContactReady',
      'completeRiyaAfterCoreSubmission',
      'confirmRiyaSummary',
      'createRiyaSummaryEditV1',
      'evolveRiyaSummaryEdit',
    ]);
    const b = barrel as Record<string, unknown>;
    for (const internal of ['canonicalState', 'advancedState', 'discoveryInputOf']) {
      expect(b[internal], internal).toBeUndefined();
    }
  });
});
