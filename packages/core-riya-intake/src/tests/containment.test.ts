/**
 * RWC-P6A — containment for `@qf-jarvis/core-riya-intake` (ADR-0101 §36).
 *
 * The companion spec proves what this contract accepts. This one proves what it cannot do at all.
 *
 * Two directions, and the upward one matters most here. Downward: it reaches nothing — no HTTP, no
 * QuickFurno, no database, no environment. A contract that could fetch would become the live adapter
 * by accident, and the live adapter is a later governed integration. Upward: it decides nothing —
 * there is no `grantConsent`, no `captureContact`, no `canSubmit` and no writable field, which is what
 * makes "Core owns consent" a property of the code rather than a sentence in a document.
 *
 * And one rule that is really a privacy rule: no raw contact, ever. The grammar cannot express an
 * email or a phone number, and no field is shaped to hold one.
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

function walk(dir: string, skip: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skip.includes(entry)) continue;
      out.push(...walk(full, skip));
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

const shippedCode = (): string =>
  walk(SRC, ['tests'])
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

describe('it reaches nothing', () => {
  it('holds no transport, client, endpoint or credential', () => {
    forbid(shippedCode(), [
      'fetch(',
      'node:http',
      'node:https',
      'node:net',
      'node:fs',
      'undici',
      'axios',
      'XMLHttpRequest',
      'WebSocket',
      'apiKey',
      'Authorization',
      'Bearer',
      'https://',
      'http://',
      '/api/',
      'quickfurno.',
      'supabase',
      'n8n',
      'webhook',
    ]);
  });

  it('touches no database, environment, cache, clock or randomness', () => {
    forbid(shippedCode(), [
      "'pg'",
      'DATABASE_URL',
      'connectionString',
      'process.env',
      'SELECT ',
      'INSERT INTO',
      'migration',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'createHash',
      'node:crypto',
    ]);
  });

  it('invokes no model and consults no other authority', () => {
    forbid(shippedCode(), [
      'model-gateway',
      'model-reply-adapter',
      'ModelGatewayInvoker',
      'core-decision-adapter',
      'CoreDecisionTransport',
      'openai',
      'anthropic',
      'groq',
    ]);
  });
});

describe('it decides nothing, and holds nothing personal', () => {
  it('has no mutating or authority-granting vocabulary', () => {
    forbid(shippedCode(), [
      'grantConsent',
      'captureContact',
      'createLead',
      'canSubmit',
      'isAuthorized',
      'decidedBy',
      'validUntil',
    ]);
  });

  it('holds no raw contact, consent wording or business payload', () => {
    forbid(shippedCode(), [
      'phoneNumber',
      'emailAddress',
      'customerName',
      'firstName',
      'consentText',
      'consentWording',
      'statementText',
      'policyText',
      'transcript',
      'leadId',
      'vendorId',
      'price',
      'package',
      'payment',
      'latitude',
      'longitude',
    ]);
  });

  it('does NOT reuse the contracts it was told not to reuse', () => {
    // `ClientConfirmationV1` is assignment-domain evidence with an open `statementCode`, so
    // reinterpretation would be easy and silent. `CommunicationAuthorizationV1` answers whether an
    // outbound message may be SENT, and says so while refusing to carry a consent snapshot. Neither
    // is lead-intake consent, and neither may be borrowed for the convenience of its shape.
    forbid(shippedCode(), [
      'ClientConfirmation',
      'clientConfirmationId',
      'CommunicationAuthorization',
      'LinkedLead',
      'linkedLeadId',
      'recommendationId',
      'decisionId',
      'eventIdSchema',
    ]);
  });

  it('knows nothing about a conversation', () => {
    forbid(shippedCode(), [
      'riya-conversation',
      'questionPlan',
      'observationBatch',
      'summaryEdit',
      'jarvis-runtime',
      'agent-runtime',
      'riya-web-conversation-service',
    ]);
  });
});

describe('it stays a leaf with a small surface', () => {
  it('depends on exactly @qf-jarvis/contracts, @qf-jarvis/riya-agent and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly exports?: Record<string, unknown>;
    };
    // `@qf-jarvis/contracts` is a PRODUCTION dependency, and deliberately so. Idempotency is a system
    // safety contract rather than a local convenience validation -- what it protects here is a real
    // person receiving one enquiry instead of two -- so this package imports the one authority. A
    // restated grammar plus a compatibility spec can only ever prove today's agreement.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/contracts',
      '@qf-jarvis/riya-agent',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual(['.', './testing']);
  });

  it('restates no idempotency grammar of its own', () => {
    const code = shippedCode();
    // Every mention of an idempotency key in production is either the field, its type or the ONE
    // imported schema. A local `z.string().min(16)` would be a second authority the day it appeared
    // and a divergent one the day either copy was corrected.
    expect(code).toContain("import { idempotencyKeySchema } from '@qf-jarvis/contracts'");
    expect(code).not.toMatch(/min\(\s*16\s*\)/u);
    expect(code).not.toMatch(/MIN_IDEMPOTENCY_KEY_LENGTH\s*=/u);
    expect(code).not.toMatch(/MAX_IDEMPOTENCY_KEY_LENGTH\s*=/u);
    // The one place a key schema may be named is where it is imported from `contracts`.
    const declarations = code.match(/^\s*(const|let|export const)\s+\w*[Ii]dempotency\w*\s*=/gmu);
    expect(declarations).toBeNull();
  });

  it('deep-imports no other package private module', () => {
    expect(shippedCode()).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal)\//u);
  });

  it('exposes exactly the seven runtime values it means to', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'CORE_RIYA_INTAKE_CONTRACT_VERSION',
      'CORE_RIYA_INTAKE_ERROR_CODES',
      'CoreRiyaIntakeError',
      'createCoreRiyaIntakeSubmissionRequestV1',
      'parseCoreRiyaIntakeStateV1',
      'parseCoreRiyaIntakeSubmissionLookupV1',
      'parseCoreRiyaIntakeSubmissionResultV1',
    ]);
    const b = barrel as Record<string, unknown>;
    for (const internal of [
      'coreRiyaIntakeEvidenceRefSchema',
      'syntheticIntakeState',
      'scriptedCoreRiyaIntakePort',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('the port is a TYPE only: no implementation is exported, from root or anywhere', () => {
    // A shipped default port is the failure this package is shaped to prevent -- it would answer
    // "contact ready, consent granted" and pass every test in the repository.
    const portSource = codeOnly(readFileSync(join(SRC, 'contract/port.ts'), 'utf8'));
    expect(portSource).not.toMatch(/^\s*export (const|function|class)\s/mu);
  });
});
