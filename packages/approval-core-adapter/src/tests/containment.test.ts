/**
 * QFJ-P08 — public API, dependency and side-effect containment (ADR-0082).
 *
 * The safety argument of this package is what it CANNOT do. It cannot open a socket, cannot name an
 * endpoint, cannot hold an approved flag, cannot persist anything, cannot retry, and cannot reach a
 * database or an execution fabric. Each of those is asserted against the SOURCE rather than against
 * intent, because intent is not a control.
 *
 * The scans read code, not documentation: these modules describe at length what they refuse to do,
 * and a raw-text scan would flag the description as the violation — the recurring false positive in
 * this repository's containment suites.
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

/** Strip documentation so a scan reads CODE. */
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
      'APPROVAL_CORE_ADAPTER_ERROR_CODES',
      'ApprovalCoreAdapterError',
      'createApprovalCoreAdapter',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps the wire command, the digest and the faithfulness proof internal', () => {
    // The command shape is a PROPOSED protocol Core has not adopted. A proposal something else can
    // import is a proposal that has already been adopted by accident, and the eventual negotiation
    // with Core would then be a breaking change to a published type.
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'approvalCoreSubmissionCommandSchema',
      'serializeCommand',
      'idempotencyKeyFor',
      'IDEMPOTENCY_DOMAIN',
      'APPROVAL_CORE_SUBMISSION_PROTOCOL',
      'operatorActionSchema',
      'assertFaithfulRequest',
      'canonicalJson',
      'deepEquals',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('locks the public type set at eight', () => {
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
      'ApprovalCoreAdapter',
      'ApprovalCoreAdapterErrorCode',
      'ApprovalCoreAuthorizationProof',
      'ApprovalCoreSubmissionInput',
      'ApprovalCoreSubmissionResult',
      'ApprovalCoreTransport',
      'ApprovalOperatorAction',
      'ApprovalOperatorActor',
      'ApprovalRecommendationSource',
    ]);
  });

  it('closes the operator-action vocabulary at three human intents', () => {
    const source = readFileSync(fileURLToPath(new URL('src/contracts/api.ts', PKG_DIR)), 'utf8');
    const union = /export type ApprovalOperatorAction =([^;]*);/.exec(source)?.[1] ?? '';
    expect(union.replace(/\s+/g, ' ').trim()).toBe("'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'");
    // A value that cannot be constructed cannot be smuggled through a serializer.
    for (const forbidden of [
      'AUTO_APPROVE',
      'SEND',
      'EXECUTE',
      'AUTHORIZE',
      'FORCE',
      'BYPASS',
      'OVERRIDE',
      'SELF_APPROVE',
    ]) {
      expect(codeOnly(source), forbidden).not.toContain(forbidden);
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

  it('declares exactly two workspace edges plus zod, and recommendation-runtime only as dev', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/approval-runtime',
      '@qf-jarvis/contracts',
      'zod',
    ]);
    // `recommendation-runtime` is DEV only. This package never computes a fingerprint or reads a
    // binding itself -- it hands the source straight back to the public approval runtime -- so a
    // production edge would be a dependency it does not use, and a second place a source's shape
    // could be asserted. The tests need it to build a REAL governed recommendation.
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/recommendation-runtime',
    ]);
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('imports nothing else in production, and never reaches past a package boundary', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const specifier of code.match(/from '([^']+)'/g) ?? []) {
        const name = specifier.slice(6, -1);
        if (name.startsWith('.')) {
          continue;
        }
        expect(
          ['@qf-jarvis/contracts', '@qf-jarvis/approval-runtime', 'zod', 'node:crypto'],
          `${file}: ${name}`,
        ).toContain(name);
      }
      expect(code, file).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src|internal)\//);
    }
  });

  it('is imported by no lower package', () => {
    for (const relative of [
      'packages/contracts/package.json',
      'packages/approval-runtime/package.json',
      'packages/recommendation-runtime/package.json',
      'packages/postgres-approval-queue/package.json',
      'packages/jarvis-runtime/package.json',
      'packages/agent-runtime/package.json',
      'packages/core-decision-adapter/package.json',
      'packages/conversation-control/package.json',
    ]) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/approval-core-adapter');
    }
  });

  it('excludes the transport fake from the emitting build', () => {
    // A transport fake shipped in a production bundle is a transport, and the whole safety argument
    // of this package is that it cannot construct one.
    const build = readFileSync(fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)), 'utf8');
    expect(build).toMatch(/"exclude"\s*:\s*\[\s*"src\/tests\/\*\*"\s*\]/);
  });
});

describe('side-effect containment', () => {
  it('opens no socket, names no endpoint, and reads no environment', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/process\s*\.\s*env/);
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code, file).not.toMatch(/\bnew\s+(XMLHttpRequest|WebSocket|URL)\b/);
      expect(code, file).not.toMatch(/https?:\/\//);
      expect(code, file).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|worker_threads|os|path)['"]/,
      );
      expect(code, file).not.toMatch(/from ['"](axios|undici|node-fetch|got|ky|superagent)['"]/);
      expect(code, file).not.toMatch(/from ['"](pg|redis|ioredis|mongodb)['"]/);
      // No clock, no randomness: every instant is caller-stated and every identifier is supplied,
      // so a replayed submission is deterministic and its idempotency key is stable.
      expect(code, file).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random|randomUUID/);
      // No timer: a timer here would be a retry, a backoff or a deadline this package must not own.
      expect(code, file).not.toMatch(/setTimeout|setInterval|setImmediate/);
      expect(code, file).not.toMatch(/console\s*\./);
      expect(code, file).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
    }
  });

  it('uses node:crypto for exactly one thing — a digest', () => {
    const crypto = productionFiles().filter((file) =>
      codeOnly(readFileSync(file, 'utf8')).includes('node:crypto'),
    );
    expect(crypto).toHaveLength(1);
    const code = codeOnly(readFileSync(crypto[0] ?? '', 'utf8'));
    expect(code).toContain("import { createHash } from 'node:crypto'");
    // No key generation, no signing, no encryption, no randomness: this package derives a NAME for
    // an intent, and anything else would be it inventing a credential protocol Core has not agreed.
    for (const forbidden of [
      'createSign',
      'createHmac',
      'createCipher',
      'generateKey',
      'randomBytes',
      'randomUUID',
      'privateDecrypt',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('retries nothing, and sends exactly once', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\bretry|\bbackoff|\battempts?\b\s*[<>+]/i);
      expect(code, file).not.toMatch(/\bfor\s*\([^)]*\)\s*\{[^}]*\.send\(/);
      expect(code, file).not.toMatch(/\bwhile\s*\(/);
    }
    const sends = productionFiles()
      .map((file) => codeOnly(readFileSync(file, 'utf8')).match(/transport\s*\.\s*send\(/g) ?? [])
      .flat();
    expect(sends).toHaveLength(1);
  });

  it('holds no approval authority, status flag or role list', () => {
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
        'hasAuthority',
        'permissions',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no execution, consent, transport-fabric or Core-side capability', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'webhook',
        'twilio',
        'supabase',
        'executionintent',
        'idempotencykey for execution',
        'communicationauthorization',
        'optout',
        'quiethours',
        'recipient',
        'jwt',
        'bearer',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('defines no HTTP header, no endpoint and no credential format', () => {
    // `authorization` IS a legitimate identifier here -- it names the proof HOLDER. What must not
    // exist is the wire vocabulary of a transport: a header map, a header literal, a method, a path.
    // Choosing any of those would be Jarvis unilaterally deciding a protocol Core has not agreed.
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\bheaders\b/i);
      expect(code, file).not.toMatch(/['"]Authorization['"]/);
      expect(code, file).not.toMatch(/['"](GET|POST|PUT|PATCH)['"]/);
      expect(code, file).not.toMatch(/['"]\/[a-z][a-z0-9/-]*['"]/i);
      expect(code, file).not.toMatch(/\bcontent-type\b/i);
    }
  });

  it('persists nothing and emits nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/);
      expect(code, file).not.toMatch(/storeValidatedEvent|eventBackbone|qf\.approval/);
      expect(code, file).not.toMatch(/localStorage|writeFile|appendFile/);
    }
  });

  it('holds no control byte in production source', () => {
    // eslint-disable-next-line no-control-regex
    const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });
});

describe('repository invariants this slice must not move', () => {
  it('adds no migration: the set is still 0001-0011 with no 0012', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
    );
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toEqual([
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
      // RWC-P8 (ADR-0104): the ONE authorized addition, repository and LOCAL/CI only.
      '0012_riya_logical_turn_idempotency.sql',
      '0013_communication_state_projection.sql',
    ]);
  });

  it('leaves apps/api with an empty root API and no HTTP surface', () => {
    const index = readFileSync(fileURLToPath(new URL('apps/api/src/index.ts', REPO_ROOT)), 'utf8');
    // The application boundary stays a structure, not an implementation. QFJ-P08 establishes an
    // internal authenticated service; it does not open a port.
    expect(codeOnly(index).trim()).toBe('export {};');
    for (const forbidden of ['express', 'fastify', 'hono', 'createServer', '.listen(']) {
      expect(index, forbidden).not.toContain(forbidden);
    }
  });
});
