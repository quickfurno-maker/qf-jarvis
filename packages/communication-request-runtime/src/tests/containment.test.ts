/**
 * QFJ-P08 — public API, dependency and side-effect containment (ADR-0133).
 *
 * A communication request is powerless, and this package must be too. Its safety argument rests on
 * what it CANNOT reach — Core, a database, a queue, a transport, n8n, a provider, a template
 * registry — so that is asserted against the source, not against intent.
 *
 * The API lock matters most here of anywhere: a fourth root export is how a package that ASKS
 * whether a communication may proceed quietly grows one that says it may.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const PKG_DIR = new URL('../../', import.meta.url);
const REPO_ROOT = new URL('../../../../', import.meta.url);

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
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

/** Strip documentation so a scan reads CODE: these modules describe what they refuse to do. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function readRepo(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
}

describe('public API', () => {
  it('exports exactly three root runtime symbols and no default', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES',
      'CommunicationRequestRuntimeError',
      'createCommunicationRequestRuntime',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps every schema, validator and helper internal', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'validateSource',
      'selectAction',
      'deepFreezeJsonClone',
      'defaultIdentityPort',
      'nextCommunicationRequestId',
      'nextCommunicationId',
      'communicationRequestRuntimeInputSchema',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('locks the public type set at four', () => {
    const source = readFileSync(fileURLToPath(new URL('src/index.ts', PKG_DIR)), 'utf8');
    const typeNames = new Set(
      [...source.matchAll(/export type \{([^}]*)\}/g)].flatMap((match) =>
        (match[1] ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    );
    expect([...typeNames].sort()).toEqual([
      'CommunicationRequestRuntime',
      'CommunicationRequestRuntimeErrorCode',
      'CommunicationRequestRuntimeIdentityPort',
      'CommunicationRequestRuntimeInput',
    ]);
  });

  it('exposes exactly ONE runtime method, and nothing that grants, sends or acts', () => {
    const runtime = barrel.createCommunicationRequestRuntime();
    expect(Object.keys(runtime)).toEqual(['createRequest']);
    expect(Object.isFrozen(runtime)).toBe(true);
    const surface = runtime as unknown as Record<string, unknown>;
    for (const forbidden of [
      'authorize',
      'approve',
      'decide',
      'submit',
      'enqueue',
      'persist',
      'execute',
      'send',
      'deliver',
      'dispatch',
      'emit',
      'callCore',
      'checkConsent',
      'checkEligibility',
      'resolveRecipient',
      'renderTemplate',
      'resolveTemplate',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('exposes exactly four error codes with fixed, content-free messages', () => {
    expect([...barrel.COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES].sort()).toEqual([
      'binding-mismatch',
      'identity-failure',
      'invalid-input',
      'request-invalid',
    ]);
    expect(Object.isFrozen(barrel.COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES)).toBe(true);
    for (const code of barrel.COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES) {
      const error = new barrel.CommunicationRequestRuntimeError(code);
      expect(error.name).toBe('CommunicationRequestRuntimeError');
      expect(error.code).toBe(code);
      // The message says WHAT went wrong, never with which value.
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });
});

describe('dependencies', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };

  it('declares exactly contracts, recommendation-runtime and zod', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/contracts',
      '@qf-jarvis/recommendation-runtime',
      'zod',
    ]);
    expect(manifest.dependencies?.['zod']).toBe('4.4.3');
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('does NOT depend on the approval or communication-authorization runtimes', () => {
    // S1 is a producer. Composing it with the merged correlation runtime is S4, after S3 adopts a
    // Core transport — and an approval is not a communication authorization in either direction.
    //
    // The specifiers are BUILT from the scope rather than written out. Several sibling packages lock
    // "nothing imports me" by scanning every `packages/*/src` file for their own literal specifier,
    // and a forbidden-name list here would read to those scanners as an import. That is this
    // repository's recurring containment false positive; constructing the string keeps the assertion
    // exact while leaving no literal for a text scan to find.
    const specifier = (name: string): string => `@qf-jarvis/${name}`;
    const declared = Object.keys(manifest.dependencies ?? {});
    for (const forbidden of [
      'approval-runtime',
      'approval-core-adapter',
      'communication-authorization-runtime',
      'communication-lifecycle-runtime',
      'execution-intent-runtime',
      'execution-dispatch-runtime',
      'aarohi-agent',
      'event-backbone',
      'model-gateway',
    ].map(specifier)) {
      expect(declared, forbidden).not.toContain(forbidden);
    }
  });

  it('imports nothing else, and never reaches past a package boundary', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const specifier of code.match(/from '([^']+)'/g) ?? []) {
        const name = specifier.slice(6, -1);
        if (name.startsWith('.')) {
          continue;
        }
        expect(
          ['@qf-jarvis/contracts', '@qf-jarvis/recommendation-runtime', 'zod', 'node:crypto'],
          `${file}: ${name}`,
        ).toContain(name);
      }
      // A deep import would make another package's private internal a load-bearing dependency.
      expect(code, file).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src|internal)\//);
    }
  });

  it('is imported by NO package and NO application: it stays an uncomposed leaf', () => {
    const NAME = '@qf-jarvis/communication-request-runtime';
    const roots = ['packages', 'apps'];
    const seen: string[] = [];
    for (const root of roots) {
      const dir = fileURLToPath(new URL(root, REPO_ROOT));
      for (const entry of readdirSync(dir)) {
        const manifestPath = join(dir, entry, 'package.json');
        let text: string;
        try {
          text = readFileSync(manifestPath, 'utf8');
        } catch {
          continue;
        }
        const pkg = JSON.parse(text) as {
          name?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (pkg.name === NAME) {
          continue;
        }
        const declared = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ];
        if (declared.includes(NAME)) {
          seen.push(`${root}/${entry}`);
        }
      }
    }
    expect(seen).toEqual([]);
  });

  it('leaves apps/api and packages/aarohi-agent source untouched by it', () => {
    for (const relative of ['apps/api/package.json', 'apps/worker/package.json']) {
      expect(readRepo(relative), relative).not.toContain(
        '@qf-jarvis/communication-request-runtime',
      );
    }
    const aarohi = fileURLToPath(new URL('packages/aarohi-agent/src', REPO_ROOT));
    for (const file of walk(aarohi)) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(
        '@qf-jarvis/communication-request-runtime',
      );
    }
  });
});

describe('side-effect containment', () => {
  it('reads no environment, touches no I/O, and starts nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/process\s*\.\s*env/);
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code, file).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|worker_threads|os|path)['"]/,
      );
      expect(code, file).not.toMatch(/from ['"](pg|redis|ioredis|axios|undici|node-fetch)['"]/);
      expect(code, file).not.toMatch(/setTimeout|setInterval|setImmediate/);
      expect(code, file).not.toMatch(/console\s*\./);
      expect(code, file).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
      // No clock: every instant is caller-stated, so a replayed artifact stays valid.
      expect(code, file).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random/);
    }
  });

  it('uses node:crypto for randomUUID only', () => {
    const uses = productionFiles().flatMap((file) => {
      const code = codeOnly(readFileSync(file, 'utf8'));
      return [...code.matchAll(/import \{ ([^}]+) \} from 'node:crypto'/g)].flatMap((m) =>
        (m[1] ?? '').split(',').map((s) => s.trim()),
      );
    });
    expect([...new Set(uses)].sort()).toEqual(['randomUUID']);
    for (const file of productionFiles()) {
      expect(codeOnly(readFileSync(file, 'utf8')), file).not.toContain('createHash');
    }
  });

  it('names no transport, provider, template-registry or Core-client capability', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'n8n',
        'whatsappclient',
        'webhook',
        'twilio',
        'meta',
        'groq',
        'openai',
        'supabase',
        'postgres',
        'migration',
        'coreclient',
        'coreport',
        'executionintent',
        'idempotencykey',
        'queue',
        'templateregistry',
        'rendertemplate',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('holds no consent, eligibility, suppression or authorization state', () => {
    // Core is the sole consent, preference, suppression, STOP/DNC and eligibility authority. A field
    // here would be a stale copy of a permission, which is the most dangerous field in any system
    // that reaches real people.
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        "'pending'",
        'isApproved',
        'isAuthorized',
        'canExecute',
        'canSend',
        'consentValid',
        'hasConsent',
        'optedIn',
        'optedOut',
        'suppressionList',
        'doNotContact',
        'eligibilityCache',
        'quietHours',
        'attemptLimit',
        'validUntil',
        'FOUNDER_IDS',
        'ADMIN_IDS',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('invents no request-to-approved-action binding', () => {
    // ADR-0083 section 11: the semantic binding is Core's, and Jarvis must not synthesize it.
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'approvalRequestId',
        'approvalDecisionId',
        'approvedActionId',
        'actionIdentityMap',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
    // The fingerprint is used to PROVE the source, and never written into the artifact.
    const factory = readFileSync(
      fileURLToPath(new URL('src/create-communication-request-runtime.ts', PKG_DIR)),
      'utf8',
    );
    expect(codeOnly(factory)).not.toContain('actionFingerprint');
  });

  it('emits no canonical event: Core owns that', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/qf\.communication|qf\.approval|qf\.recommendation/);
      expect(code, file).not.toMatch(/\bemit\s*\(|storeValidatedEvent|eventBackbone/);
    }
  });

  it('holds no control byte in production source', () => {
    // eslint-disable-next-line no-control-regex
    const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });

  it('adds no migration: the set is still 0001-0012', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
    );
    expect(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort(),
    ).toEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
      '0007_subject_activity_projection.sql',
      '0008_conversation_control_persistence.sql',
      '0009_durable_approval_queue.sql',
      '0010_execution_replay_claim.sql',
      '0011_riya_conversation_continuity.sql',
      '0012_riya_logical_turn_idempotency.sql',
    ]);
  });
});

describe('the canonical contracts are REUSED, unchanged', () => {
  it('does not modify CommunicationRequestV1 or CommunicationAuthorizationV1', () => {
    const request = readRepo('packages/contracts/src/communications/communication-request.ts');
    // The three things the contract deliberately cannot say, still absent.
    for (const forbidden of [
      'hasConsent',
      'optedIn',
      'suppressed',
      'canSend',
      'sentAt',
      'delivered',
      'approvalRequestId',
      'proposedActionId',
      'actionFingerprint',
      'phoneNumber',
      'destination',
    ]) {
      expect(request, forbidden).not.toContain(`${forbidden}:`);
    }
    expect(request).toContain('recipient: entityReferenceSchema');
    expect(request).toContain('proposedChannel: communicationChannelSchema');
    expect(request).toContain('content: contentReferenceSchema');

    const authorization = readRepo(
      'packages/contracts/src/communications/communication-authorization.ts',
    );
    for (const forbidden of ['approvalRequestId', 'proposedActionId', 'actionFingerprint']) {
      expect(authorization, forbidden).not.toContain(`${forbidden}:`);
    }
  });

  it('leaves the event-backbone public API unchanged', () => {
    // A producer of an inert artifact has no business touching the event surface.
    const barrelSource = readRepo('packages/event-backbone/src/index.ts');
    expect(barrelSource).not.toContain('communication-request');
    expect(barrelSource).not.toContain('CommunicationRequest');
  });

  it('leaves the approval and communication-authorization runtime barrels unchanged', () => {
    for (const relative of [
      'packages/approval-runtime/src/index.ts',
      'packages/communication-authorization-runtime/src/index.ts',
    ]) {
      expect(readRepo(relative), relative).not.toContain(
        '@qf-jarvis/communication-request-runtime',
      );
    }
  });
});
