/**
 * QFJ-P08 — public API, dependency and side-effect containment (ADR-0080).
 *
 * An approval request is powerless, and this package must be too. Its safety argument rests on what
 * it CANNOT reach — Core, a database, a queue, a transport — so that is asserted against the source,
 * not against intent.
 *
 * The API lock matters most here of anywhere: a fourth root export is how a package that asks for
 * approval quietly grows one that grants it.
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

describe('public API', () => {
  it('exports exactly three root runtime symbols and no default', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'APPROVAL_RUNTIME_ERROR_CODES',
      'ApprovalRuntimeError',
      'createApprovalRuntime',
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
      'nextApprovalRequestId',
      'approvalRequestRuntimeInputSchema',
      'approvalDecisionValidationInputSchema',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('locks the public type set at six', () => {
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
      'ApprovalDecisionCorrelation',
      'ApprovalDecisionValidationInput',
      'ApprovalRequestRuntimeInput',
      'ApprovalRuntime',
      'ApprovalRuntimeErrorCode',
      'ApprovalRuntimeIdentityPort',
    ]);
  });

  it('exposes exactly two runtime methods, and nothing that grants or acts', () => {
    const runtime = barrel.createApprovalRuntime();
    expect(Object.keys(runtime).sort()).toEqual(['createRequest', 'validateDecision']);
    expect(Object.isFrozen(runtime)).toBe(true);
    const surface = runtime as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approve',
      'reject',
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
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('exposes exactly six error codes with fixed, content-free messages', () => {
    expect([...barrel.APPROVAL_RUNTIME_ERROR_CODES].sort()).toEqual([
      'binding-mismatch',
      'decision-invalid',
      'decision-mismatch',
      'identity-failure',
      'invalid-input',
      'request-invalid',
    ]);
    expect(Object.isFrozen(barrel.APPROVAL_RUNTIME_ERROR_CODES)).toBe(true);
    for (const code of barrel.APPROVAL_RUNTIME_ERROR_CODES) {
      const error = new barrel.ApprovalRuntimeError(code);
      expect(error.name).toBe('ApprovalRuntimeError');
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

  it('is imported by no lower package, and by no application at runtime', () => {
    const importers = [
      'packages/jarvis-runtime/package.json',
      'packages/agent-runtime/package.json',
      'packages/recommendation-runtime/package.json',
      'packages/conversation-control/package.json',
      'packages/core-decision-adapter/package.json',
      'packages/event-backbone/package.json',
      'packages/postgres-conversation-state/package.json',
    ];
    for (const relative of importers) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/approval-runtime');
    }

    // QFJ-P08 (ADR-0082): `apps/api` names this package, and ONLY as a test-only fixture edge --
    // the operator-boundary specs build a REAL approval request rather than hand-assembling one.
    // The application's production dependencies still do not contain it, so no runtime path in any
    // application reaches this package. The assertion narrowed; it did not relax.
    const api = JSON.parse(
      readFileSync(fileURLToPath(new URL('apps/api/package.json', REPO_ROOT)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(api.dependencies ?? {})).not.toContain('@qf-jarvis/approval-runtime');
    expect(Object.keys(api.devDependencies ?? {})).toContain('@qf-jarvis/approval-runtime');
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
    // No `createHash` here: the fingerprint is verified through recommendation-runtime's PUBLIC
    // `fingerprintProposedAction`, because a second implementation of a canonicalization is a
    // second implementation that can drift.
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

  it('names no persistence, transport, provider or Core-client capability', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'webhook',
        'twilio',
        'groq',
        'openai',
        'supabase',
        'postgres',
        'migration',
        'coredecisionport',
        'executionintent',
        'idempotencykey',
        'queue',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('holds no local approved/pending state, and no authority list', () => {
    // An unanswered request is "a request exists and a decision does not". The moment Jarvis holds
    // a `status: 'pending'` or an `approved` boolean, part of the authorization state lives here.
    // And Core owns RBAC: there is no founder list, admin list or role lookup to disagree with it.
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        "'pending'",
        'isApproved',
        'isAuthorized',
        'canExecute',
        'canSend',
        'communicationAuthorized',
        'consentValid',
        'FOUNDER_IDS',
        'ADMIN_IDS',
        'roleLookup',
        'authorityCache',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('emits no canonical event: Core owns that', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/qf\.approval|qf\.recommendation/);
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

  it('adds no migration: the set is still 0001-0010 with no 0011', () => {
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
    ]);
  });
});
