/**
 * QFJ-P05.05 — public API, dependency and side-effect containment (ADR-0079).
 *
 * A recommendation is inert, and this package must be too. Its whole safety argument is that it
 * CANNOT reach a database, a provider, Core, n8n or a transport — so that is asserted rather than
 * assumed, on the source, not on intent.
 *
 * The API lock matters for the same reason as everywhere else in this repository: a fifth root
 * export is how a package that creates proposals quietly grows one that approves them.
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
  it('exports exactly four root runtime symbols and no default', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'RECOMMENDATION_RUNTIME_ERROR_CODES',
      'RecommendationRuntimeError',
      'createRecommendationRuntime',
      'fingerprintProposedAction',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps every schema, canonicalizer and helper internal', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'canonicalJson',
      'deepFreezeJsonClone',
      'defaultIdentityPort',
      'recommendationRuntimeInputSchema',
      'proposedActionDraftSchema',
      'actionContentPreimage',
      'ACTION_CONTENT_DOMAIN_SEPARATOR',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('locks the type-export count at seven', () => {
    const source = readFileSync(fileURLToPath(new URL('src/index.ts', PKG_DIR)), 'utf8');
    // Every `export type { … }` block, single-line or wrapped.
    const typeNames = new Set(
      [...source.matchAll(/export type \{([^}]*)\}/g)].flatMap((match) =>
        (match[1] ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    );
    expect([...typeNames].sort()).toEqual([
      'ProposedActionDraft',
      'RecommendationActionBinding',
      'RecommendationRuntime',
      'RecommendationRuntimeErrorCode',
      'RecommendationRuntimeIdentityPort',
      'RecommendationRuntimeInput',
      'RecommendationRuntimeResult',
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

  it('declares exactly @qf-jarvis/contracts and zod, and no dev dependency', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/contracts',
      'zod',
    ]);
    expect(manifest.dependencies?.['zod']).toBe('4.4.3');
    expect(manifest.devDependencies).toBeUndefined();
    // One entry point. No `./testing`, because there is no fake worth shipping: the runtime is
    // already deterministic given an identity port.
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('imports no workspace package other than contracts, and no third-party but zod', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const specifier of code.match(/from '([^']+)'/g) ?? []) {
        const name = specifier.slice(6, -1);
        if (name.startsWith('.')) {
          continue;
        }
        expect(['@qf-jarvis/contracts', 'zod', 'node:crypto'], `${file}: ${name}`).toContain(name);
      }
    }
  });

  it('is referenced by no lower package, and by no application at runtime', () => {
    // A recommendation producer that the runtime imported would put proposal creation on the
    // inbound path, which is not what QFJ-P05.05 authorises. That edge still does not exist.
    const importers = [
      'packages/jarvis-runtime/package.json',
      'packages/agent-runtime/package.json',
      'packages/conversation-control/package.json',
      'packages/core-decision-adapter/package.json',
      'packages/event-backbone/package.json',
      'packages/postgres-conversation-state/package.json',
    ];
    for (const relative of importers) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/recommendation-runtime');
    }

    // QFJ-P08 (ADR-0082): `apps/api` names this package, and ONLY as a test-only fixture edge --
    // the operator-boundary specs build a REAL governed recommendation rather than hand-assembling
    // one, which would prove only that the service agrees with a fixture. Proposal creation is
    // still on no application's runtime path. The assertion narrowed; it did not relax.
    const api = JSON.parse(
      readFileSync(fileURLToPath(new URL('apps/api/package.json', REPO_ROOT)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(api.dependencies ?? {})).not.toContain('@qf-jarvis/recommendation-runtime');
    expect(Object.keys(api.devDependencies ?? {})).toContain('@qf-jarvis/recommendation-runtime');
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
      expect(code, file).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random/);
    }
  });

  it('uses node:crypto for exactly randomUUID and createHash', () => {
    const uses = productionFiles().flatMap((file) => {
      const code = codeOnly(readFileSync(file, 'utf8'));
      return [...code.matchAll(/import \{ ([^}]+) \} from 'node:crypto'/g)].flatMap((m) =>
        (m[1] ?? '').split(',').map((s) => s.trim()),
      );
    });
    expect([...new Set(uses)].sort()).toEqual(['createHash', 'randomUUID']);
  });

  it('names no execution, transport, provider or approval capability', () => {
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
        'approvalrequest',
        'approvaldecision',
        'executionintent',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('emits no canonical event: Core owns that, after it records the submission', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toContain('qf.recommendation.created');
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

  it('adds no migration: the set is still 0001-0011 with no 0012', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
    );
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toEqual([
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
});
