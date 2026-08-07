/**
 * QFJ-P09.01 — public API, dependency and side-effect containment (ADR-0084).
 *
 * This is the first P09 package, and the boundary it must not cross is the sharpest one in the
 * architecture: **Jarvis recommends, QuickFurno Core authorizes, n8n executes, providers deliver.**
 * A correlation runtime that could reach n8n, a provider, a credential or a recipient would not be a
 * correlation runtime — it would be the beginning of a second execution path.
 *
 * So the scans below are about capability, not intent: no transport, no credential, no recipient
 * resolution, no persistence, no clock, no idempotency bookkeeping, no permission flag, and no
 * import of the communication-authorization package whose action identity ADR-0083 §11 forbade
 * inferring.
 *
 * Scans read CODE, not documentation: these modules describe at length what they refuse to do.
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

/**
 * Every file in the package EXCEPT this scanner.
 *
 * This spec necessarily names every string it forbids — the communication-authorization package, the
 * observation type, the dispatch vocabulary. Scanning itself would flag the prohibition as the
 * violation, which is the recurring false positive in this repository's containment suites.
 */
const SCANNER = 'src/tests/containment.test.ts';
const allFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').endsWith(`/${SCANNER}`),
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
      'EXECUTION_INTENT_RUNTIME_ERROR_CODES',
      'ExecutionIntentRuntimeError',
      'createExecutionIntentRuntime',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps the schemas, the structural comparator and the freezer internal', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'deepEqualJson',
      'deepFreeze',
      'proveApproval',
      'executionIntentV1Schema',
      'recommendationV1Schema',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('locks the public type set at five', () => {
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
      'ExecutionApprovalEvidence',
      'ExecutionIntentObservation',
      'ExecutionIntentRuntime',
      'ExecutionIntentRuntimeErrorCode',
      'ExecutionIntentValidationInput',
    ]);
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

  it('declares exactly two workspace edges, and recommendation-runtime only as dev', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/approval-runtime',
      '@qf-jarvis/contracts',
    ]);
    // Not even `zod`: every schema this package needs is one `@qf-jarvis/contracts` already owns.
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
          ['@qf-jarvis/contracts', '@qf-jarvis/approval-runtime'],
          `${file}: ${name}`,
        ).toContain(name);
      }
      expect(code, file).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src|internal)\//);
    }
  });

  it('reaches no persistence, transport, application or execution-fabric package', () => {
    const manifestText = readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8');
    for (const forbidden of [
      'pg',
      '@qf-jarvis/event-backbone',
      '@qf-jarvis/postgres-approval-queue',
      '@qf-jarvis/postgres-conversation-state',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/core-decision-adapter',
      '@qf-jarvis/approval-core-adapter',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/api',
    ]) {
      expect(manifestText, forbidden).not.toContain(`"${forbidden}"`);
    }
  });

  it('is imported by no other package and wired into no application', () => {
    for (const relative of [
      'packages/contracts/package.json',
      'packages/approval-runtime/package.json',
      'packages/recommendation-runtime/package.json',
      'packages/communication-authorization-runtime/package.json',
      'packages/approval-core-adapter/package.json',
      'packages/postgres-approval-queue/package.json',
      'packages/jarvis-runtime/package.json',
      'apps/api/package.json',
      'apps/worker/package.json',
    ]) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/execution-intent-runtime');
    }
  });

  it('excludes the fixtures from the emitting build', () => {
    const build = readFileSync(fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)), 'utf8');
    expect(build).toMatch(/"exclude"\s*:\s*\[\s*"src\/tests\/\*\*"\s*\]/);
  });
});

describe('no communication-eligibility heuristic', () => {
  it('never imports or names the communication authorization runtime', () => {
    // ADR-0083 §11 forbade inferring execution action identity from a communication authorization,
    // and §12 required P09 to start from Core's execution intent instead. Making that observation an
    // INPUT here would reopen exactly the bug that lock closed.
    // Documentation stripped: `input.ts` explains at length WHY that observation is not an input,
    // and scanning the explanation would flag the prohibition as the violation.
    for (const file of allFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toContain('@qf-jarvis/communication-authorization-runtime');
      expect(code, file).not.toContain('CommunicationAuthorizationObservation');
    }
  });

  it('infers no action from a template, purpose, channel or recipient', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'templateid',
        'purposecode',
        'proposedchannel',
        'authorizedchannel',
        'recipient',
        'communicationrequest',
        'communicationauthorization',
        'consent',
        'optout',
        'suppress',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('approval evidence is read exactly once', () => {
  /**
   * The structural pin for ADR-0084 §11.
   *
   * Not a substring count over the whole file -- that would break on a comment or a reformat. It
   * asserts the two facts that actually carry the property, over documentation-stripped code:
   *
   *   1. `input['approval']` is reached in exactly ONE place, and that place is the snapshot call;
   *   2. both the approval re-proof and the recommendation recovery consume `approvalEvidence`.
   *
   * If someone later reads the caller's raw evidence a second time -- which is the whole defect --
   * the first assertion fails.
   */
  const runtimeSource = (): string =>
    codeOnly(
      readFileSync(
        fileURLToPath(new URL('src/create-execution-intent-runtime.ts', PKG_DIR)),
        'utf8',
      ),
    );

  it('reaches the caller’s raw approval evidence in exactly one place: the snapshot', () => {
    const code = runtimeSource();
    const reads = code.match(/input\['approval'\]/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(code).toContain("snapshotApprovalEvidence(input['approval'])");
  });

  it('feeds the SAME snapshot to the approval proof and to the recommendation recovery', () => {
    const code = runtimeSource();
    expect(code).toContain('proveApproval(approvalEvidence)');
    // The recovery reads the snapshot, not the caller's object.
    expect(code).toMatch(/isRecord\(approvalEvidence\)/);
    expect(code).toMatch(/approvalEvidence\['source'\]\['recommendation'\]/);
  });

  it('snapshots by detaching, never by stringify or a shallow spread', () => {
    // `JSON.parse(JSON.stringify(x))` honours a `toJSON` hook, so a hostile object would still
    // choose what the snapshot sees; a spread copies one level and leaves every nested object
    // shared. Neither is a security snapshot.
    const snapshot = codeOnly(
      readFileSync(fileURLToPath(new URL('src/internal/snapshot.ts', PKG_DIR)), 'utf8'),
    );
    expect(snapshot).toContain('structuredClone(value)');
    expect(snapshot).not.toContain('JSON.parse');
    expect(snapshot).not.toContain('JSON.stringify');
    expect(snapshot).not.toMatch(/\.\.\.value/);
    // Every clone failure is one bounded code, and the thrown value is never inspected.
    expect(snapshot).toContain("ExecutionIntentRuntimeError('approval-invalid')");
    expect(snapshot).toMatch(/catch \{/);
  });
});

describe('side-effect containment', () => {
  it('opens no socket, reads no environment, touches no filesystem and holds no clock', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/process\s*\.\s*env/);
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code, file).not.toMatch(/https?:\/\//);
      expect(code, file).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|worker_threads|os|path|crypto)['"]/,
      );
      expect(code, file).not.toMatch(
        /from ['"](axios|undici|node-fetch|got|ky|pg|redis|ioredis|mongodb)['"]/,
      );
      // No clock: every instant comes from the artifacts, so the observation is a statement about
      // provenance that is true whenever it is evaluated -- never a claim about "now".
      expect(code, file).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random|randomUUID/);
      expect(code, file).not.toMatch(/setTimeout|setInterval|setImmediate/);
      expect(code, file).not.toMatch(/console\s*\./);
      expect(code, file).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
      expect(code, file).not.toMatch(/\basync\b|\bawait\b|Promise/);
    }
  });

  it('names no executor, provider, credential or dispatch capability', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'meta',
        'twilio',
        'webhook',
        'supabase',
        'apikey',
        'accesstoken',
        'bearer',
        'credential',
        'dispatch',
        'deliver',
        'transport',
        'endpoint',
        'workflow',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('creates no intent, no idempotency key and no execution state', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // Only Core issues execution intents. A BUILDER here would be that capability arriving --
      // `createExecutionIntentRuntime` is the factory for this validator and is deliberately not
      // matched, so the negative lookahead is doing real work rather than decorating.
      expect(code, file).not.toMatch(
        /\b(createExecutionIntent(?!Runtime)|buildExecutionIntent|issueIntent|mintIntent)\b/,
      );
      for (const forbidden of [
        'canExecute',
        'canSend',
        'isAuthorized',
        'isFresh',
        'currentlyValid',
        'freshUntil',
        'consentValid',
        'communicationAllowed',
        'retryAllowed',
        'isIdempotent',
        'usedKeys',
        'consumedKeys',
        'executionStatus',
        'dispatchState',
        'attemptCount',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('persists nothing and emits nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/);
      expect(code, file).not.toMatch(/storeValidatedEvent|eventBackbone|qf\.execution/);
      expect(code, file).not.toMatch(/localStorage|writeFile|appendFile/);
    }
  });

  it('compares parameters structurally, never by naive stringify', () => {
    // `JSON.stringify` preserves insertion order, so a stringify comparison would reject two
    // identical governed parameter objects built in different orders -- a false negative that
    // blocks a legitimate effect.
    const comparator = readFileSync(
      fileURLToPath(new URL('src/internal/deep-equal-json.ts', PKG_DIR)),
      'utf8',
    );
    expect(codeOnly(comparator)).not.toContain('JSON.stringify');
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/JSON\s*\.\s*stringify\([^)]*\)\s*===/);
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
    ]);
  });

  it('leaves apps/api with an empty root API', () => {
    const index = readFileSync(fileURLToPath(new URL('apps/api/src/index.ts', REPO_ROOT)), 'utf8');
    expect(codeOnly(index).trim()).toBe('export {};');
  });

  it('leaves the execution and communication contracts untouched by this package', () => {
    // The contracts are REUSED, not extended. No ExecutionIntentV2, and no recipient, provider,
    // credential, communication id or consent snapshot bolted onto V1.
    const intent = readFileSync(
      fileURLToPath(new URL('packages/contracts/src/execution/execution-intent.ts', REPO_ROOT)),
      'utf8',
    );
    const code = codeOnly(intent);
    for (const forbidden of [
      'recipient',
      'phoneNumber',
      'providerId',
      'credential',
      'communicationRequestId',
      'communicationAuthorizationId',
      'consentSnapshot',
      'subject',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).toContain("z.literal('at-most-once')");
    expect(
      readdirSync(fileURLToPath(new URL('packages/contracts/src/execution/', REPO_ROOT))),
    ).toEqual(['execution-intent.ts', 'execution-result.ts']);
  });
});
