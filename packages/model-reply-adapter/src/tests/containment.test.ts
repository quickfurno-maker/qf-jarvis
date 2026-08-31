/**
 * QFJ-M4 — containment and repository guardrails (ADR-0057 §C, §M, §N).
 *
 * Matrix 66–84: no direct provider SDK/fetch/network/`process.env`/transport/n8n/DB import in the
 * adapter package (agent-runtime + model-gateway are the only workspace dependencies); no live Core;
 * the package depends solely on agent-runtime + model-gateway + zod and exposes only the root and
 * `./testing`; the public API is locked; migrations 0001–0011 are byte-exact with no 0013; the
 * event-backbone public-api lock remains 39; production source holds no NUL/control byte; the test
 * fakes never leak into the root barrel.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const PKG_DIR = new URL('../../', import.meta.url);

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
function readRepo(rel: string): string {
  return readFileSync(repoPath(rel), 'utf8');
}
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

// eslint-disable-next-line no-control-regex
const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');

const LOCKED_MIGRATION_HASHES: Record<string, string> = {
  '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
  '0002_event_runtime_grants.sql':
    '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
  '0003_ingestion_rejection_and_event_conflict.sql':
    '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
  '0004_projection_foundation.sql':
    '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
  '0005_projection_event_positions.sql':
    '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
  '0006_projection_failure_operations.sql':
    'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
  '0007_subject_activity_projection.sql':
    '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
  '0008_conversation_control_persistence.sql':
    'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
  '0009_durable_approval_queue.sql':
    'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
  '0010_execution_replay_claim.sql':
    '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
  '0011_riya_conversation_continuity.sql':
    '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
  // RWC-P8 (ADR-0104): the ONE authorized addition. Durable logical-turn idempotency, sitting
  // BELOW the ingress transport replay guard rather than replacing it. Repository and
  // LOCAL/CI only; nothing is applied to a managed database.
  '0012_riya_logical_turn_idempotency.sql':
    '5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e',
};

describe('containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as { dependencies?: Record<string, string>; exports: Record<string, unknown> };

  it('(70,71,72,73,74) production source imports no provider SDK/network/env/transport/DB', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|axios|undici|whatsapp-web\.js|@whiskeysockets\/baileys|n8n)['"]/,
      );
    }
  });

  it('(ADR-0058 §5) production source uses no sync-over-async blocking primitive', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/Atomics\s*\.\s*wait\b/);
      expect(text).not.toMatch(/\b(execSync|spawnSync|deasync)\b/);
      expect(text).not.toMatch(/from ['"]deasync['"]/);
    }
  });

  it('(69,73) agent-runtime and model-gateway are the only workspace deps used', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(
        /from ['"]@qf-jarvis\/(governed-knowledge|model-evaluation|rag-provisioning|capability-registry|core-decision-adapter|event-backbone)['"]/,
      );
    }
  });

  it('(ADR-0099) the structured-output profile seam names no agent, domain or state concept', () => {
    // The profile exists so ONE caller can ask for a richer single answer. It must not teach this
    // package what that caller's answer means: a seam that knew about Riya would make every other
    // agent's adapter carry Riya's vocabulary, and would put a conversation's semantics inside
    // infrastructure that has no business holding them.
    //
    // Prose is scanned too, deliberately, and this is the exception to the usual codeOnly rule: the
    // seam's own documentation must not explain itself in one agent's terms either.
    //
    // No DOMAIN vocabulary anywhere in production source.
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const forbidden of [
        'continuity',
        'discovery',
        'observation',
        'summaryconfirmed',
        'questionplan',
        'web-conversation',
        'quickfurno',
        'riya-model-interaction',
      ]) {
        expect({ file, forbidden, present: text.includes(forbidden) }).toStrictEqual({
          file,
          forbidden,
          present: false,
        });
      }
    }

    // And no AGENT NAME in the seam contract itself. The rest of the package legitimately maps the
    // M2 `assignedActor` enum -- `RIYA`, `ANISHA` -- onto a gateway scope, and always has; that is a
    // routing fact, not a semantic one. This one file is the seam's whole vocabulary, so it is the
    // file where an agent's name would actually mean the seam had learned about that agent.
    const seam = readFileSync(
      fileURLToPath(new URL('src/contracts/structured-output-profile.ts', PKG_DIR)),
      'utf8',
    ).toLowerCase();
    for (const forbidden of ['riya', 'anisha', 'jarvis-runtime', 'client']) {
      expect({ forbidden, present: seam.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(81) depends only on agent-runtime + model-gateway + prompt-registry + zod, exposes root + ./testing', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/model-gateway',
      // QFJ-S3-I-B (ADR-0073): the injected prompt registry. Still an EXACT set match.
      '@qf-jarvis/prompt-registry',
      'zod',
    ]);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(81) locks the root barrel surface', () => {
    const EXPECTED = [
      'MODEL_REPLY_ADAPTER_ERROR_CODES',
      'MODEL_REPLY_ADAPTER_EVENT_TYPES',
      'MODEL_REPLY_ADAPTER_REASONS',
      'ModelReplyAdapterError',
      'NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY',
      'STRUCTURED_REPLY_KINDS',
      'createModelReplyAdapter',
      'structuredReplySchema',
    ];
    expect(Object.keys(barrel).sort()).toEqual([...EXPECTED].sort());
    const b = barrel as Record<string, unknown>;
    for (const testOnly of [
      'scriptedGatewayInvoker',
      'replyPlan',
      'scriptedReplyStateReader',
      'fixedClock',
    ]) {
      expect(b[testOnly]).toBeUndefined();
    }
  });

  it('(75,76) migrations 0001–0012 are byte-exact and there is no 0013', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((n) => n.startsWith('0013'))).toBe(false);
  });

  it('(77) the event-backbone public-api lock remains 38', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(38)',
    );
  });

  it('(84) production source contains no NUL/control byte', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});
