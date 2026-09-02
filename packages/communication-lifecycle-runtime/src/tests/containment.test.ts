/**
 * QFJ-P09.05 — public API, dependency and side-effect containment (ADR-0110).
 *
 * The safety argument of this package is what it CANNOT do. It cannot send, cannot persist, cannot
 * reach Core, n8n, WhatsApp, Meta or a provider, cannot read a clock, and — the one that matters
 * most here — **cannot create authority**.
 *
 * That last prohibition is what separates a lifecycle POLICY from a lifecycle ENGINE. An engine
 * would have `setState`, `advanceTo` or `markDelivered`, and the moment one existed, the answer to
 * "is this communication delivered?" would come from a package that has never spoken to a provider.
 * "No provider state becomes authoritative until Core records it" (communication-model.md), so this
 * package validates records somebody else produced and produces none of its own.
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
  it('exports exactly two root runtime symbols and no default', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'COMMUNICATION_LIFECYCLE_REFUSAL_REASONS',
      'evaluateCommunicationLifecycleTransition',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps the transition table, the start state and the verdict constructors internal', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'COMMUNICATION_LIFECYCLE_TRANSITIONS',
      'COMMUNICATION_LIFECYCLE_START_STATE',
      'LIFECYCLE_CONSISTENT',
      'refuse',
      'identityRefusal',
      'isRecord',
      'COMMUNICATION_STATES',
      'communicationStateRecordV1Schema',
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
      'CommunicationLifecycleConsistent',
      'CommunicationLifecycleRefusalReason',
      'CommunicationLifecycleRefused',
      'CommunicationLifecycleTransitionInput',
      'CommunicationLifecycleTransitionResult',
    ]);
  });

  it('exposes no mutator, and no method that could originate a state', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const forbidden of [
      'setState',
      'advanceTo',
      'markDelivered',
      'authorize',
      'send',
      'execute',
      'transitionTo',
      'apply',
      'record',
    ]) {
      expect(b[forbidden], forbidden).toBeUndefined();
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

  it('declares exactly one workspace edge and no dev dependency', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(['@qf-jarvis/contracts']);
    // Not even `zod`: every schema this package needs is one `@qf-jarvis/contracts` already owns,
    // and a schema library here would be the tool for declaring a rival state vocabulary.
    expect(Object.keys(manifest.devDependencies ?? {})).toEqual([]);
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
        expect(['@qf-jarvis/contracts'], `${file}: ${name}`).toContain(name);
      }
      expect(code, file).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src|internal)\//);
    }
  });

  it('names no workspace package anywhere in its manifest except contracts and itself', () => {
    // An ALLOWLIST over every `@qf-jarvis/*` mention in the manifest, rather than a denylist of
    // persistence, transport, application and execution packages by name.
    //
    // Two reasons, and the second is not cosmetic. It is stronger: a denylist only refuses the
    // packages somebody remembered to list, so the next persistence package would be reachable by
    // default. And a denylist has to WRITE the forbidden names -- which several sibling packages
    // detect, correctly, as this package importing them. `execution-dispatch-runtime`'s own
    // containment spec sweeps every `packages/*/src` file for its scoped name and asserts an exact
    // set of importers; a denylist here would have registered as an import that does not exist and
    // eroded a real control in another package to decorate one here.
    const manifestText = readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8');
    const mentioned = new Set(
      [...manifestText.matchAll(/@qf-jarvis\/[a-z0-9-]+/g)].map((m) => m[0]),
    );
    expect([...mentioned].sort()).toEqual([
      '@qf-jarvis/communication-lifecycle-runtime',
      '@qf-jarvis/contracts',
    ]);
    // No driver, no client, no schema library.
    for (const forbidden of ['"pg"', '"zod"', '"redis"', '"ioredis"', '"undici"', '"axios"']) {
      expect(manifestText, forbidden).not.toContain(forbidden);
    }
  });

  it('is imported by no other package and wired into no application', () => {
    for (const relative of [
      'packages/contracts/package.json',
      'packages/communication-authorization-runtime/package.json',
      'packages/execution-intent-runtime/package.json',
      'packages/execution-dispatch-runtime/package.json',
      'packages/execution-dispatch-composition/package.json',
      'packages/jarvis-runtime/package.json',
      'packages/agent-runtime/package.json',
      'apps/api/package.json',
      'apps/worker/package.json',
    ]) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/communication-lifecycle-runtime');
    }
  });

  it('is referenced by the root solution and excludes its specs from the emitting build', () => {
    const root = readFileSync(fileURLToPath(new URL('tsconfig.json', REPO_ROOT)), 'utf8');
    expect(root).toContain('./packages/communication-lifecycle-runtime/tsconfig.build.json');
    const build = readFileSync(fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)), 'utf8');
    expect(build).toMatch(/"exclude"\s*:\s*\[\s*"src\/tests\/\*\*"\s*\]/);
  });
});

describe('no authority creation', () => {
  it('declares no mutator, no permission flag and no delivery claim', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'setState',
        'advanceTo',
        'markDelivered',
        'canSend',
        'canExecute',
        'isAuthorized',
        'consentValid',
        'isEligible',
        'providerSucceeded',
        'permissionGranted',
        'hasConsent',
        'optedOut',
        'doNotContact',
        'suppressionList',
        'validUntil',
        'attemptCount',
        'idempotencyKey',
        'ExecutionIntent',
        'executionIntent',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('builds no record: nothing here constructs a CommunicationStateRecordV1', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // The candidate is read, never written to and never rebuilt with fields filled in.
      expect(code, file).not.toMatch(/contractVersion\s*:/);
      expect(code, file).not.toMatch(/previousState\s*:/);
      expect(code, file).not.toMatch(/recordedAt\s*:/);
      // No assignment into either supplied record. The `[^=]` tail is what keeps this an
      // ASSIGNMENT scan: without it, every `record.field === value` comparison would read as a
      // write, and the check would fail on the very comparisons it exists to permit.
      expect(code, file).not.toMatch(/\b(next|current)\.[a-zA-Z]+\s*=[^=]/);
      expect(code, file).not.toMatch(/\bdelete\b/);
      expect(code, file).not.toMatch(/Object\s*\.\s*assign/);
    }
  });

  it('re-implements no canonical evidence rule', () => {
    // The state-record schema owns which state needs which artifact. A second copy here would be
    // free to drift, and the drift would show up as a lifecycle accepting an unevidenced `delivered`.
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const canonical of [
        'approvalDecisionId',
        'executionIntentId',
        'executionResultId',
        'STATES_REQUIRING_DECISION',
        'STATES_REQUIRING_INTENT',
        'STATES_REQUIRING_RESULT',
      ]) {
        expect(code, `${file}: ${canonical}`).not.toContain(canonical);
      }
    }
  });

  it('declares no rival state vocabulary and no nineteenth state', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // The eighteen values appear only as KEYS and destinations of the transition table, which is
      // derived from the authoritative document and asserted against it. No second enum, and no
      // invented start member.
      expect(code, file).not.toMatch(/z\s*\.\s*enum/);
      expect(code, file).not.toMatch(/'(start|initial|none|pending|opted-out|unknown)'/);
      expect(code, file).not.toMatch(/COMMUNICATION_STATES\s*=/);
    }
  });

  it('uses no permissive fallback that could authorize an unknown state', () => {
    const policy = readFileSync(
      fileURLToPath(new URL('src/evaluate-communication-lifecycle-transition.ts', PKG_DIR)),
      'utf8',
    );
    const code = codeOnly(policy);
    expect(code).not.toMatch(/TRANSITIONS\s*\[[^\]]*\]\s*\?\?/);
    expect(code).not.toMatch(/\bdefault\s*:/);
    // And no nullish coalescing on the START MARKER. `input['current'] ?? null` would silently
    // convert an omitted or `undefined` field into an explicit start declaration, which is the one
    // fallback in this package that could begin a lifecycle nobody asked to begin.
    expect(code).not.toMatch(/\[\s*'current'\s*\]\s*\?\?/);
    expect(code).toContain("hasOwnProperty.call(input, 'current')");
    expect(code).toContain(
      'COMMUNICATION_LIFECYCLE_TRANSITIONS[current.state].includes(next.state)',
    );
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
        /from ['"](axios|undici|node-fetch|got|ky|pg|redis|ioredis|zod)['"]/,
      );
      // No clock and no local time arithmetic: ordering goes through the canonical comparator, so a
      // replayed transition answers the same way tomorrow as it did today.
      expect(code, file).not.toMatch(/\bDate\b/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random|randomUUID/);
      expect(code, file).not.toMatch(/setTimeout|setInterval|setImmediate/);
      expect(code, file).not.toMatch(/console\s*\./);
      expect(code, file).not.toMatch(/\basync\b|\bawait\b|Promise/);
    }
  });

  it('names no provider, execution fabric, transport or Core endpoint', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      // Note what is NOT in this list: `deliver` and `provider`. `delivered` and `provider-accepted`
      // are canonical STATE VALUES this package must name, and forbidding the substring would
      // forbid the vocabulary itself. The identifiers below are the ones a developer would write
      // while building a transport, and none of them is a state.
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'twilio',
        'webhook',
        'supabase',
        'sendmessage',
        'apikey',
        'bearer',
        'credential',
        'endpoint',
        'transport',
        'dispatch',
        'queue',
        'scheduler',
        'phonenumber',
        'emailaddress',
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
  it('adds no migration: the set is still 0001-0012 with no 0014', () => {
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
      '0012_riya_logical_turn_idempotency.sql',
      '0013_communication_state_projection.sql',
    ]);
  });

  it('leaves apps/api with an empty root API and no HTTP surface', () => {
    const index = readFileSync(fileURLToPath(new URL('apps/api/src/index.ts', REPO_ROOT)), 'utf8');
    expect(codeOnly(index).trim()).toBe('export {};');
  });

  it('leaves the communication state contracts untouched', () => {
    // The contracts are REUSED, not extended. In particular `previousState` stays OPTIONAL on the
    // record: this slice makes it required at the TRANSITION boundary, which is a coordination rule,
    // and moving it into the schema would break every legitimately stored point-in-time record.
    const record = readFileSync(
      fileURLToPath(
        new URL('packages/contracts/src/communications/communication-state-record.ts', REPO_ROOT),
      ),
      'utf8',
    );
    expect(record).toContain('previousState: communicationStateSchema.optional()');
    const states = readFileSync(
      fileURLToPath(
        new URL('packages/contracts/src/communications/communication-state.ts', REPO_ROOT),
      ),
      'utf8',
    );
    expect(states).toContain('export const COMMUNICATION_STATE_COUNT = 18;');
  });
});
