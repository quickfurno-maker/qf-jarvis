/**
 * QFJ-P08 — public API, dependency and side-effect containment (ADR-0083).
 *
 * The safety argument of this package is what it CANNOT do. It cannot ask Core, cannot send, cannot
 * persist, cannot reach Meta or n8n, cannot build an execution intent, and — the one that matters
 * most — **cannot hold a single byte of consent state**.
 *
 * That last prohibition is not a style rule. *"Jarvis must not create parallel consent, preference,
 * suppression, STOP/START or delivery state. Not as a flag, not as a list, not as a cache, and not
 * as a 'courtesy' copy that a later feature will inevitably start trusting"*
 * (communication-model.md). A consent cache here would be the courtesy copy, and the feature that
 * eventually trusts it would contact somebody who asked never to be contacted.
 *
 * Scans read CODE, not documentation: these modules describe at length what they refuse to do, and a
 * raw-text scan would flag the description as the violation.
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
      'COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES',
      'CommunicationAuthorizationRuntimeError',
      'createCommunicationAuthorizationRuntime',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps every schema, comparator, classifier and freezer internal', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'knownRefusalReason',
      'deepFreeze',
      'proveApproval',
      'communicationRequestV1Schema',
      'communicationAuthorizationV1Schema',
      'COMMUNICATION_REFUSAL_REASONS',
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
      'CommunicationAuthorizationEvidence',
      'CommunicationAuthorizationObservation',
      'CommunicationAuthorizationRuntime',
      'CommunicationAuthorizationRuntimeErrorCode',
      'CommunicationAuthorizationValidationInput',
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
    // Not even `zod`: every schema this package needs is one `@qf-jarvis/contracts` already owns, and
    // a schema library here would be the tool for declaring one of its own.
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

  it('reaches no persistence, transport, application or execution package', () => {
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
      'packages/approval-core-adapter/package.json',
      'packages/postgres-approval-queue/package.json',
      'packages/jarvis-runtime/package.json',
      'packages/agent-runtime/package.json',
      'apps/api/package.json',
      'apps/worker/package.json',
    ]) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/communication-authorization-runtime');
    }
  });

  it('excludes the fixtures from the emitting build', () => {
    const build = readFileSync(fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)), 'utf8');
    expect(build).toMatch(/"exclude"\s*:\s*\[\s*"src\/tests\/\*\*"\s*\]/);
  });
});

describe('no local consent, eligibility or suppression state', () => {
  /**
   * The scan that matters most.
   *
   * It targets LOCAL state and permission identifiers, not prose and not the canonical constants.
   * `COMMUNICATION_REFUSAL_REASONS` legitimately contains the strings `recipient-opted-out` and
   * `do-not-contact` — it is Core's vocabulary, imported and never redefined — so the scan looks for
   * identifiers a developer would write when building a store, not for the words themselves.
   */
  it('declares no consent flag, opt-out record, STOP state, suppression list or eligibility cache', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'hasConsent',
        'consentGiven',
        'optedIn',
        'optedOut',
        'optInState',
        'doNotContact',
        'stopState',
        'startState',
        'suppressionList',
        'suppressions',
        'consentCache',
        'consentSnapshot',
        'eligibilityCache',
        'cachedEligibility',
        'eligibilityWindow',
        'validUntil',
        'authorizedUntil',
        'expiresAtLocal',
        'recipientState',
        'contactHistory',
        'attemptCount',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('imports Core’s refusal vocabulary rather than redefining it', () => {
    // One import, no local copy: the day Core adds a reason, this package must not be the thing that
    // says it does not exist.
    const classifier = readFileSync(
      fileURLToPath(new URL('src/internal/known-refusal.ts', PKG_DIR)),
      'utf8',
    );
    expect(classifier).toContain(
      "import { COMMUNICATION_REFUSAL_REASONS } from '@qf-jarvis/contracts'",
    );
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // No second list, and no default bucket that would launder an unknown refusal into a known one.
      expect(code, file).not.toMatch(/=\s*\[[^\]]*'recipient-opted-out'/);
      expect(code, file).not.toMatch(/'other'|'unknown-refusal'|DEFAULT_REFUSAL/);
    }
  });

  it('builds no permission, execution intent or communication state record', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'canSend',
        'canExecute',
        'isAuthorized',
        'communicationAllowed',
        'consentValid',
        'isEligible',
        'permitted',
        'ExecutionIntent',
        'executionIntent',
        'idempotencyKey',
        'CommunicationStateV1',
        'communicationState',
        'deliveryState',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
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
        /from ['"](axios|undici|node-fetch|got|ky|pg|redis|ioredis)['"]/,
      );
      // No clock: every instant comes from the supplied contracts, so a replayed correlation is
      // deterministic and no answer ages between one call and the next.
      expect(code, file).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random|randomUUID/);
      expect(code, file).not.toMatch(/setTimeout|setInterval|setImmediate/);
      expect(code, file).not.toMatch(/console\s*\./);
      expect(code, file).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
      expect(code, file).not.toMatch(/\basync\b|\bawait\b|Promise/);
    }
  });

  it('names no provider, execution fabric, transport or Core endpoint', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'meta',
        'twilio',
        'webhook',
        'supabase',
        'sendmessage',
        'dispatch',
        'deliver',
        'transport',
        'endpoint',
        'bearer',
        'apikey',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('persists nothing and emits nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/);
      expect(code, file).not.toMatch(/storeValidatedEvent|eventBackbone|qf\.communication/);
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
  it('adds no migration: the set is still 0001-0009 with no 0010', () => {
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
    ]);
  });

  it('leaves apps/api with an empty root API and no HTTP surface', () => {
    const index = readFileSync(fileURLToPath(new URL('apps/api/src/index.ts', REPO_ROOT)), 'utf8');
    expect(codeOnly(index).trim()).toBe('export {};');
  });

  it('leaves the communication contracts untouched by this package', () => {
    // The contracts are REUSED, not extended. A `validUntil`, a consent snapshot or a Jarvis-side
    // field added to either artifact would be this slice quietly acquiring the authority it exists
    // to keep in Core.
    const authorization = readFileSync(
      fileURLToPath(
        new URL('packages/contracts/src/communications/communication-authorization.ts', REPO_ROOT),
      ),
      'utf8',
    );
    expect(codeOnly(authorization)).not.toMatch(/\bvalidUntil\b|\bconsentSnapshot\b/);
    const request = readFileSync(
      fileURLToPath(
        new URL('packages/contracts/src/communications/communication-request.ts', REPO_ROOT),
      ),
      'utf8',
    );
    expect(codeOnly(request)).not.toMatch(/\bhasConsent\b|\bconsent\s*:/);
  });
});
