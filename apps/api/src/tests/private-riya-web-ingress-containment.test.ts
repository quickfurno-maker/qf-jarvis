/**
 * Containment for the private Riya web ingress adapter (ADR-0097).
 *
 * The behaviour spec proves what a request does. These prove what the adapter cannot do at all: it
 * starts nothing, composes nothing, reaches no runtime/Core/store/model directly, holds no signing
 * material, and adds no database, framework, browser affordance or business authority.
 *
 * Scans read production source with comments stripped. This module necessarily NAMES the things it
 * refuses to be — a scan over the prose would report every prohibition as its own violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as apiRoot from '../index.js';

const INGRESS_DIR = fileURLToPath(new URL('../private-riya-web-ingress/', import.meta.url));
const API_PKG = fileURLToPath(new URL('../../package.json', import.meta.url));

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

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const ingressFiles = (): string[] => walk(INGRESS_DIR);
const ingressCode = (): string =>
  ingressFiles()
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

describe('the ingress starts nothing', () => {
  it('production source never binds a listener, creates a server, or reads the environment', () => {
    const code = ingressCode();
    // The factory returns a `RequestListener`. Whether it is ever bound, and to which private
    // interface, is a later deployment decision -- not a side effect of importing this module.
    for (const forbidden of ['listen(', 'createServer', '.listen', 'setInterval', 'setTimeout']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // Environment reads are matched by PATTERN rather than by a literal token, so this spec does not
    // itself contain the string that `credential-containment.test.ts` scans the whole app for.
    expect(code).not.toMatch(/process\s*\.\s*env/u);
    expect(code).not.toMatch(/process\s*\.\s*argv/u);
  });

  it('importing the api package root still exposes no runtime capability', () => {
    expect(Object.keys(apiRoot)).toEqual([]);
  });

  it('the ingress reads no filesystem and holds no key file path', () => {
    const code = ingressCode();
    for (const forbidden of ['node:fs', 'readFileSync', 'writeFileSync', 'node:path']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('no framework, no browser affordance, no session', () => {
  it('adds no HTTP framework and no browser-facing header or credential', () => {
    const code = ingressCode();
    for (const forbidden of [
      'express',
      'Express',
      'fastify',
      'Fastify',
      'NextRequest',
      'NextResponse',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Credentials',
      'Set-Cookie',
      'setCookie',
      'Bearer',
      'Authorization',
      'OPTIONS',
      'session',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('apps/api depends on no web framework', () => {
    const manifest = JSON.parse(readFileSync(API_PKG, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(manifest.dependencies ?? {});
    for (const forbidden of ['express', 'fastify', 'koa', 'hapi', 'next', 'cors', 'body-parser']) {
      expect({ forbidden, present: deps.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // Only the two workspace packages this slice actually needs were added.
    expect(deps).toContain('@qf-jarvis/riya-web-conversation-service');
    expect(deps).toContain('@qf-jarvis/agent-runtime');
  });
});

describe('one delegation, and nothing deeper', () => {
  it('reaches the conversation SERVICE only — never the runtime, Core, store or gateway', () => {
    const code = ingressCode();
    for (const forbidden of [
      'JarvisRuntime',
      'createJarvisRuntime',
      'processInbound',
      'processInboundForCoreAuthorizedReply',
      'CoreDecisionAdapter',
      'createCoreDecisionAdapter',
      'coreDecisionPort',
      'postgres-riya-conversation-continuity-store',
      'continuityStore',
      'model-gateway',
      'createModelReplyAdapter',
      'riya-agent',
      'ClientSalesSignals',
      'runAgentTurn',
      'createOrchestrator',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // The single downstream call.
    expect(code).toContain('service.handleTurn');
  });

  it('imports exactly the two workspace packages it needs, and no deep path', () => {
    const imported = new Set<string>();
    for (const file of ingressFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/from '(@qf-jarvis\/[^']+)'/gu)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- group 1 always matches
        imported.add(match[1]!);
      }
    }
    expect([...imported].sort()).toEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/riya-web-conversation-service',
    ]);
    expect(ingressCode()).not.toMatch(
      /@qf-jarvis\/[a-z-]+\/(src|dist|internal|composition|adapter|service)\//u,
    );
  });
});

describe('no business authority, no delivery, no persistence', () => {
  it('names no provider, execution or delivery capability', () => {
    const code = ingressCode();
    for (const forbidden of [
      'n8n',
      'whatsapp',
      'WhatsApp',
      'Meta',
      'sendMessage',
      'deliver',
      'dispatch',
      'twilio',
      'provider',
      'webhook',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('names no business mutation and no QuickFurno credential', () => {
    const code = ingressCode();
    for (const forbidden of [
      'supabase',
      'Supabase',
      'service_role',
      'serviceRole',
      'SERVICE_ROLE',
      'createLead',
      'leadId',
      'vendorId',
      'consent',
      'suppression',
      'canSubmit',
      'approve',
      'wallet',
      'price',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('touches no database at all', () => {
    // The MIGRATION SET bound (exactly 0001-0011, byte-exact, no 0012) is already locked by several
    // existing specs and is deliberately not restated here: naming the persistence package would
    // make this file one of the "files that name event-backbone" that `shadow-containment` counts,
    // which is a lock about database reachability -- exactly what this spec is proving the absence
    // of. The property asserted here is the one that belongs to the ingress: it reaches no database.
    const code = ingressCode();
    for (const forbidden of ['pg', 'Pool', 'SELECT ', 'INSERT ', 'UPDATE ', 'qf_jarvis.']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('the wire surface omits continuity and holds no signing material', () => {
  it('the response contract names no continuity or internal operational field', () => {
    const contracts = codeOnly(readFileSync(join(INGRESS_DIR, 'contracts.ts'), 'utf8'));
    // The response INTERFACE is what a QuickFurno server parses. None of these may appear in it.
    const responseBlock = contracts.slice(contracts.indexOf('PrivateRiyaWebIngressResponseV1'));
    for (const forbidden of [
      'continuity',
      'discovery',
      'fieldProvenance',
      'summaryConfirmed',
      'completionEvidenceRef',
      'runId',
      'provenance',
      'modelDrafted',
      'coreConsulted',
      'proposalDigest',
      'idempotencyKey',
    ]) {
      expect({ forbidden, present: responseBlock.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the request contract has no dataClass and no authority field', () => {
    const contracts = codeOnly(readFileSync(join(INGRESS_DIR, 'contracts.ts'), 'utf8'));
    const schema = contracts.slice(contracts.indexOf('privateRiyaWebIngressRequestSchema'));
    for (const forbidden of [
      'dataClass',
      'channel',
      'partyType',
      'direction',
      'actor',
      'runtimeId',
      'model',
      'prompt',
    ]) {
      expect({ forbidden, present: schema.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('production source contains no private key material and never logs', () => {
    const code = ingressCode();
    for (const forbidden of [
      'PRIVATE KEY-----',
      'createPrivateKey',
      'generateKeyPair',
      'sign(',
      'console.log',
      'console.error',
      'console.warn',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // It verifies. It cannot sign.
    expect(code).toContain('verify(');
  });
});
