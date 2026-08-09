/**
 * RWC-P4B — containment for `@qf-jarvis/riya-model-interaction` (ADR-0099 §38).
 *
 * The companion spec proves what this package decides. This one proves what it cannot do at all.
 *
 * The package exists because Riya's model vocabulary had to live SOMEWHERE, and the two obvious
 * homes were both wrong: inside the generic M4 adapter it would make every agent carry Riya's
 * semantics, and inside the web service it would tie one Riya to one surface. A leaf package is the
 * third answer — but only while it stays a leaf. These scans are what keep it one.
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

describe('it invokes nothing', () => {
  it('implements no gateway invoker and reaches no provider', () => {
    // The whole design is that ONE inference happens, inside the generic M4 adapter. A package that
    // could call a model itself would make "one call" a convention rather than a structural fact.
    const code = productionCode();
    for (const forbidden of [
      'ModelGatewayInvoker',
      'invoke(',
      'model-gateway',
      'openai',
      'anthropic',
      'gemini',
      'bedrock',
      'apiKey',
      'Authorization',
      'Bearer',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('performs no I/O of any kind', () => {
    const code = productionCode();
    for (const forbidden of [
      'fetch(',
      'node:http',
      'node:https',
      'node:fs',
      'node:net',
      'XMLHttpRequest',
      'WebSocket',
      'process.env',
      "'pg'",
      'Pool',
      'DATABASE_URL',
      'connectionString',
      'SELECT ',
      'INSERT INTO',
      'compareAndSet',
      'n8n',
      'webhook',
      'twilio',
      'whatsapp',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('reads no clock and no randomness, so one turn is reproducible', () => {
    // The user content must be byte-identical for the same inputs: a timestamp inside it would make
    // every request different and every digest meaningless.
    const code = productionCode();
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'randomUUID', 'hrtime']) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('consults no decision authority', () => {
    const code = productionCode();
    for (const forbidden of [
      'core-decision-adapter',
      'createCoreDecisionAdapter',
      'qfj.core.decision',
      'quickfurno',
      'QuickFurno',
      'ACCEPTED',
      'proposalDigest',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('it holds no content it has no business holding', () => {
  it('names no contact, consent or business-authority concept', () => {
    // The RWC-P6 PHASE NAMES are removed first. `CONTACT`, `CONSENT` and `COMPLETE` appear in the
    // output schema for exactly one reason -- it filters them OUT of the phases a model may claim --
    // and a scan that reported the exclusion as the violation would push the code to stop naming
    // what it forbids.
    const code = productionCode().replace(/'(CONTACT|CONSENT|COMPLETE)'/gu, "'<rwc-p6-phase>'");
    for (const forbidden of [
      'phone',
      'email',
      'whatsappNumber',
      'consent',
      'canSubmit',
      'lead',
      'vendor',
      'package',
      'price',
      'payment',
      'invoice',
      'completionEvidence',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });

  it('holds no transcript, history or raw provider response', () => {
    const code = productionCode();
    for (const forbidden of [
      'transcript',
      'conversationHistory',
      'messageHistory',
      'previousTurns',
      'recentTurns',
      'rollingSummary',
      'rawResponse',
      'providerResponse',
      'finishStatus',
      'chainOfThought',
      'reasoning',
      'confidence',
      'evidenceQuote',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });

  it('is ONE Riya: nothing here knows about a channel or a surface', () => {
    // The same rules must produce the same conversation on the web and on WhatsApp. A channel field
    // here would be the first place the two could diverge.
    const code = productionCode();
    for (const forbidden of [
      'channel',
      'WEB',
      'HTTP',
      'route',
      'cookie',
      'CORS',
      'browser',
      'riya-web-conversation-service',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('it stays a leaf', () => {
  it('depends on exactly five workspace packages and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    // RWC-P5 adds ONE: the Core-owned availability READ CONTRACT. It is a type-and-parser dependency
    // on a package that reaches nothing itself, which is exactly why this one can refuse a ref Core
    // does not list without ever holding a catalogue of its own.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/core-service-availability-read',
      '@qf-jarvis/model-reply-adapter',
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
  });

  it('imports agent-runtime nowhere, not even for a type', () => {
    // The profile needs exactly one field of `ReplyPlan`, and types it structurally instead. Taking
    // the dependency would give a Riya package a hold on the business-neutral kernel.
    const code = productionCode();
    expect(code).not.toContain('@qf-jarvis/agent-runtime');
    expect(code).not.toContain('ReplyPlan');
    expect(code).not.toContain('InboundEnvelope');
    expect(code).not.toContain('jarvis-runtime');
  });

  it('imports no private module of another package', () => {
    const code = productionCode();
    expect(code).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal)\//u);
  });

  it('exposes exactly the six runtime values a composition can use', () => {
    // The task class to bind, the profile to hand M4, and the guard to use instead of casting M4's
    // generic `unknown` detail. Nothing else: the schemas, the field map, the input projection, the
    // two bounds and the producer vocabulary are all POLICY this package enforces rather than
    // capabilities a caller invokes, and exporting them for the convenience of tests would put three
    // more values under change control with no production consumer.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_CONVERSATION_EVOLUTION_TASK_CLASS',
      // RWC-P7 (ADR-0103): 3 -> 6. Two dedicated GROUNDED prompt/orchestration identities and the
      // post-summary reply-only profile factory. The grounded context types are TYPE-only; the
      // context is built by the per-run bridge from a real governed retrieval, and a constructor
      // here would let any caller hand this package a hand-assembled "governed" record that never
      // passed QFJ-P04.03's lifecycle, permission, freshness or privacy rules.
      'RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS',
      'RIYA_GROUNDED_REPLY_TASK_CLASS',
      'createRiyaConversationModelProfile',
      'createRiyaGroundedReplyModelProfile',
      'parseRiyaModelProfileDetail',
    ]);
    const b = barrel as Record<string, unknown>;
    for (const internal of [
      'riyaStructuredOutputSchema',
      'buildRiyaUserContent',
      'isModelProducibleObservation',
      'RIYA_MODEL_PROVENANCES',
      'MAX_RIYA_USER_CONTENT_CHARS',
      'MAX_RIYA_REPLY_BODY_CHARS',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('there is no second Riya: this package defines no reducer of its own', () => {
    const code = productionCode();
    // Merging, ranking and phase advancement belong to RWC-P4A. A copy here would be a second set of
    // rules for one conversation, and the two would drift on the first correction to either.
    for (const forbidden of [
      'PROVENANCE_RANK',
      'SUMMARY_REQUIRED_FIELDS',
      'completenessFor',
      'summaryReady',
      'nextQuestion',
      'mergeDiscovery',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
    // The reducer is USED, not reimplemented.
    expect(code).toContain('evolveRiyaConversation');
    expect(code).toContain('createRiyaConversationObservationBatch');
  });
});
