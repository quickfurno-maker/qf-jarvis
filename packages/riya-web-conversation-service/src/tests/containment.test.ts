/**
 * Containment for the private Riya web conversation service (RWC-P2C, ADR-0094).
 *
 * The behaviour spec proves what a turn does. These prove what the package cannot do at all: no
 * transport, no server, no route, no database, no streaming, no transcript, no reducer, and no
 * business authority — plus no drift in the contracts it reuses rather than replaces.
 *
 * Scans read production source with comments stripped: this package necessarily NAMES the things it
 * refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
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

/**
 * The TEXT-TURN capability only (RWC-P6B restatement).
 *
 * Several locks below count call SITES — one availability read per turn, at most two compare-and-sets.
 * RWC-P6B added a second, independent capability to this package with its own bounds, so a
 * package-wide count would now be the sum of two unrelated budgets and would mean nothing about
 * either. The counts are therefore scoped to the file they were always about, and the structured
 * capability's own equivalents live in `structured-containment.test.ts`.
 *
 * Nothing is relaxed: every count is the same number it was, about the same code.
 */
const textTurnCode = (): string =>
  codeOnly(readFileSync(join(SRC, 'service/create-service.ts'), 'utf8'));

// ---------------------------------------------------------------------------
// RWC-P2D (ADR-0096) — the content boundary this slice moved, and the ones it did not.
// ---------------------------------------------------------------------------

describe('RWC-P2D containment', () => {
  it('composes nothing: no orchestrator, no agent turn, no adapter is imported', () => {
    const code = productionCode();
    // The service reaches the runtime through its published capability only. Importing the
    // composition itself would make this package a second orchestrator, which is the one thing
    // RWC-P2C's design note says it is not.
    for (const forbidden of [
      'composeAndProcess',
      'composeAndProcessDetailed',
      'runAgentTurn',
      'createOrchestrator',
      'createJarvisRuntime',
      'createCoreDecisionAdapter',
      'createModelReplyAdapter',
      'materializeCoreAuthorizedReply',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // And no deep import into another package's internals.
    expect(code).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal|composition|adapter)\//u);
  });

  it('the ordinary runtime result still carries no content field', () => {
    // The whole reason P2D is a separate capability. If a body ever appears on the ordinary result,
    // every existing whole-result log starts retaining model output at no call site anybody edited.
    const runtimeSrc = readFileSync(
      join(REPO_ROOT, 'packages/jarvis-runtime/src/contracts/runtime-result.ts'),
      'utf8',
    );
    for (const forbidden of ['replyText', 'replyBody', 'authorizedReply', 'draft', 'promptText']) {
      expect({ forbidden, present: codeOnly(runtimeSrc).includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('materialization is authorization, never delivery', () => {
    const code = productionCode();
    // No verb here may claim something happened that did not. `PROCESSED` stays the served
    // disposition; there is no RESPONDED, SENT or DELIVERED anywhere in production source.
    //
    // RESTATED as WHOLE WORDS for RWC-P6B, not relaxed. The Riya phase vocabulary frozen by RWC-P2A
    // contains `CONSENT`, and a bare substring scan reads the last four letters of that as a delivery
    // claim. Word boundaries keep the lock saying what it always meant -- no verb asserting a message
    // reached anybody -- while letting a conversational phase be named.
    for (const forbidden of ['RESPONDED', 'SENT', 'DELIVERED', 'PUBLISHED', 'DISPATCHED']) {
      expect({
        forbidden,
        present: new RegExp(`\\b${forbidden}\\b`, 'u').test(code),
      }).toEqual({ forbidden, present: false });
    }
    // And the phase really is the only reason the substring appears at all.
    expect(code.match(/SENT/gu) ?? []).toStrictEqual(
      (code.match(/CONSENT/gu) ?? []).map(() => 'SENT'),
    );
  });

  it('the authorized body is transient: it reaches no store, event or column', () => {
    const code = productionCode();
    // RESTATED, not dropped (RWC-P4B). RWC-P2D forbade `compareAndSet` outright because nothing on
    // this path wrote anything. P4B authorizes exactly ONE thing to be written — the evolved
    // continuity — so the lock narrows to what is still forbidden rather than disappearing: the
    // REPLY BODY must still reach no store, no event and no column.
    //
    // The body is `authorizedReply.replyBody`. The scan below proves no `compareAndSet` argument
    // mentions it, and the surrounding suites prove the persisted value is the reducer's output.
    expect(code).not.toMatch(/compareAndSet\s*\(\s*\{[^}]*replyBody/u);
    expect(code).not.toMatch(/nextState\s*:\s*[^,}]*authorizedReply/u);
    expect(code).not.toMatch(/INSERT|UPDATE\s+qf_jarvis|state_json/u);
    expect(code).not.toMatch(/\bappend\s*\(|publish\s*\(|emitEvent\s*\(/u);
  });

  it('persistence is bounded: at most two compare-and-set calls, and no retry loop', () => {
    const code = textTurnCode();
    // Exactly two invocation sites, and no more. A third would be a third attempt; a loop would be
    // an unbounded one, holding a client's turn open while other writers keep moving the state.
    const attempts = code.match(/continuityStore\s*\.\s*compareAndSet\s*\(/gu) ?? [];
    expect(attempts).toHaveLength(2);
    // No looping construct anywhere in production source -- still PACKAGE-WIDE, because this one is
    // not a budget that splits per capability. The reconciliations are straight-line by construction,
    // which is what makes every "at most N" in this package readable off the page rather than
    // reasoned about.
    expect(productionCode()).not.toMatch(/\bwhile\s*\(|\bfor\s*\(|\bdo\s*\{/u);
    // And nothing expensive runs a second time inside the reconciliation: everything after the first
    // conflict is one reload, one PURE re-merge and one final attempt. Scoped to the service file,
    // because `store-port.ts` names the outcome in its own frozen list.
    const service = codeOnly(readFileSync(join(SRC, 'service/create-service.ts'), 'utf8'));
    const reconciliation = service.slice(
      service.indexOf("first === 'NOT_FOUND'"),
      service.indexOf('async function handleChannelTurn'),
    );
    expect(reconciliation).not.toMatch(/processInbound/u);
    expect(reconciliation).not.toMatch(
      /buildRiyaClientInboundEnvelope|materializationAgreesWithRun/u,
    );
    // Exactly ONE reload in the reconciliation, and exactly one re-merge.
    expect(reconciliation.match(/continuityStore\s*\.\s*load\s*\(/gu) ?? []).toHaveLength(1);
    expect(reconciliation.match(/evolveRiyaConversation\s*\(/gu) ?? []).toHaveLength(1);
  });

  it('(RWC-P5) it owns the authority READ, and still owns no transport', () => {
    const code = productionCode();
    // The service CALLS the injected reader -- that is the one outbound thing this slice added.
    expect(code).toContain('availabilityReader.readCurrent');
    // Exactly one call site PER TURN, scoped to the text-turn file. A second would be a second
    // business read for one turn, and the obvious place for it to appear is inside the
    // compare-and-set reconciliation. RWC-P6B's structured actions have their own one-per-action
    // bound, asserted in their own containment spec.
    expect(textTurnCode().match(/availabilityReader\s*\.\s*readCurrent\s*\(/gu) ?? []).toHaveLength(
      1,
    );
    // Every answer is re-proved. A service that trusted the port's declared type would be trusting a
    // system this repository does not compile.
    expect(code).toContain('parseCoreServiceAvailabilitySnapshotV1');
    // But it implements NOTHING behind the port: no transport, no endpoint, no credential.
    for (const forbidden of [
      'fetch(',
      'node:http',
      'node:https',
      'undici',
      'axios',
      'https://',
      '/api/cities',
      '/api/services',
      'apiKey',
      'Bearer',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(RWC-P5) it invents no city, no service and no fallback', () => {
    const code = productionCode().toLowerCase();
    for (const forbidden of [
      'pune',
      'mumbai',
      'bengaluru',
      'bangalore',
      'delhi',
      'hyderabad',
      'modular',
      'wardrobe',
      'defaultcity',
      'fallbackcity',
      'assumeavailable',
      'allowallcities',
      'cachedsnapshot',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(RWC-P5) the reconciliation performs no availability read', () => {
    // The snapshot belongs to the ONE model turn. A reread during reconciliation would be a second
    // business read whose fresher answer could invalidate text no second model call may replace.
    const service = codeOnly(readFileSync(join(SRC, 'service/create-service.ts'), 'utf8'));
    const reconciliation = service.slice(
      service.indexOf("first === 'NOT_FOUND'"),
      service.indexOf('async function handleChannelTurn'),
    );
    expect(reconciliation).not.toMatch(
      /availabilityReader|readCurrent|parseCoreServiceAvailability/u,
    );
  });

  it('the migration set is untouched by this slice', () => {
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toHaveLength(12);
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((n) => n.startsWith('0013'))).toBe(false);
    // The RWC-P2B hash, unchanged: P2D needs no schema at all.
    expect(
      createHash('sha256')
        .update(readFileSync(join(dir, '0011_riya_conversation_continuity.sql')))
        .digest('hex'),
    ).toBe('80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93');
  });
});

describe('the public surface is nine runtime values', () => {
  it('exports exactly the approved runtime symbols', () => {
    // Four for the text turn, three for RWC-P6B's structured capability, and TWO for RWC-P8's
    // channel-neutral surface. The action SCHEMAS, the deterministic key helper and the discovery
    // projection are all internal -- a caller able to derive a key could submit under one this
    // service never checked.
    //
    // RWC-P8 (ADR-0104): 7 -> 9, and both additions are closed VOCABULARIES. The channel turn schema
    // stays internal for the reason the web turn schema does -- a caller able to compose it would
    // build a half-validated turn -- and the coordinator port is a TYPE with no implementation in
    // this package at all. `createRiyaWebConversationService` is still the ONE factory.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_CONVERSATION_CHANNELS',
      'RIYA_STRUCTURED_ACTION_DISPOSITIONS',
      'RIYA_STRUCTURED_ACTION_REASON_CODES',
      'RIYA_TURN_BEGIN_OUTCOMES',
      'RIYA_WEB_CONVERSATION_DISPOSITIONS',
      'RIYA_WEB_CONVERSATION_ERROR_CODES',
      'RiyaWebConversationError',
      'createRiyaStructuredActionService',
      'createRiyaWebConversationService',
    ]);
  });

  it('exports no schema, fake, envelope builder, mapper, handler or key helper', () => {
    for (const forbidden of [
      'webConversationTurnSchema',
      'buildRiyaClientInboundEnvelope',
      'riyaConversationTurnSchema',
      'InMemoryContinuityStore',
      'UnavailableContinuityStore',
      'dispositionFor',
      'initialContinuity',
      'keyOf',
      'RIYA_CONTINUITY_CAS_OUTCOMES',
      'handler',
      'route',
      'createServer',
      'riyaIntakeIdempotencyKey',
      'riyaSummaryEditActionSchema',
      'needDiscoveryInputOf',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('(41) exposes no streaming symbol of any kind', () => {
    const code = productionCode();
    for (const forbidden of [
      'AsyncIterable',
      'AsyncGenerator',
      'ReadableStream',
      'EventSource',
      'WebSocket',
      'text/event-stream',
      'onToken',
      'onChunk',
      'onDelta',
      'partial',
      'stream',
      'chunk',
      'delta',
      'yield ',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(barrel).some((key) => /stream|chunk|token|delta/iu.test(key))).toBe(false);
  });

  it('(48, 49) exports no reducer, extraction, canSubmit, lead or consent capability', () => {
    for (const forbidden of [
      'determineNextPhase',
      'advancePhase',
      'mergeProvenance',
      'applyFieldUpdate',
      'applyExtraction',
      'extractRequirements',
      'classifyIntent',
      'computeCanSubmit',
      'canSubmit',
      'createLead',
      'recordConsent',
      'assignVendor',
      'submit',
      'send',
      'execute',
      'authorize',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });
});

describe('(42-46) the service reaches nothing', () => {
  it('(42, 51) contains no HTTP server, route or public endpoint', () => {
    const code = productionCode();
    for (const forbidden of [
      'createServer',
      'listen(',
      'express',
      'fastify',
      'hono',
      'app.post',
      'app.get',
      'router.post',
      'router.get',
      'NextRequest',
      'NextResponse',
      'http://',
      'https://',
      'cors',
      'Access-Control',
      'cookie',
      'setHeader',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // `Request` and `Response` were substring-banned to catch the Fetch and Next.js types. RESTATED
    // as the CONSTRUCTS rather than the letters, because RWC-P6B names a Core intake submission
    // REQUEST -- a domain object with no transport anywhere near it. What must stay absent is an HTTP
    // request or response being built, thrown or typed here.
    for (const forbidden of [
      /\bnew\s+Request\s*\(/u,
      /\bnew\s+Response\s*\(/u,
      /\bResponse\s*\.\s*json\s*\(/u,
      /:\s*Request\b/u,
      /:\s*Response\b/u,
      /\bRequestInit\b/u,
      /\bResponseInit\b/u,
    ]) {
      expect(code, forbidden.source).not.toMatch(forbidden);
    }
  });

  it('(43) contains no network client', () => {
    const code = productionCode();
    for (const forbidden of ['fetch(', 'axios', 'undici', 'node-fetch', 'XMLHttpRequest', 'got(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('(44, 45, 52) touches no database, cache or managed configuration', () => {
    const code = productionCode();
    for (const forbidden of [
      "'pg'",
      'Pool',
      'PoolClient',
      'supabase',
      'redis',
      'SELECT ',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'CREATE TABLE',
      'migration',
      'DATABASE_URL',
      'connectionString',
      'process.env',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('(46) reaches no provider, n8n or model gateway', () => {
    const code = productionCode();
    for (const forbidden of [
      'n8n',
      'twilio',
      'graph.facebook',
      'webhook',
      'model-gateway',
      'promptRef',
      'draftReply',
      'apiKey',
      'credential',
      'Bearer',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // `whatsapp` was substring-banned to catch a WhatsApp CLIENT. RESTATED as the constructs for
    // RWC-P8 (ADR-0104), because `WHATSAPP` is now a legitimate CHANNEL literal in a channel-neutral
    // turn contract -- the same governed Riya, reached from a second surface. What must stay absent
    // is anything that could TALK to WhatsApp: a client, a token, a phone number, a template, a
    // media handler or a send.
    for (const forbidden of [
      /whatsappClient/iu,
      /metaClient/iu,
      /phoneNumberId/iu,
      /accessToken/iu,
      /waba/iu,
      /templateName/iu,
      /mediaId/iu,
      /sendMessage/iu,
      /deliverMessage/iu,
    ]) {
      expect(code, forbidden.source).not.toMatch(forbidden);
    }
  });

  it('(47) holds no transcript, history or rolling summary', () => {
    const code = productionCode();
    // `messages` alone is deliberately NOT in this list: `MESSAGES` is the fixed error-message table
    // in `errors.ts`, and banning the word would ban the very thing that keeps errors content-free.
    // What must stay absent is a CONVERSATION transcript.
    for (const forbidden of [
      'transcript',
      'chatMessages',
      'messageList',
      'previousTurns',
      'recentTurns',
      'priorTurns',
      'conversationHistory',
      'messageHistory',
      'rollingSummary',
      'conversationSummary',
      'contextWindow',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('reads no clock and no randomness', () => {
    // `receivedAt` arrives on the turn. A clock here would be a second opinion about when a message
    // arrived, and the runtime already treats the envelope instant as the truth.
    const code = productionCode();
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'randomUUID', 'hrtime']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('depends on exactly the nine workspace packages and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    // RWC-P4B added ONE: the pure RWC-P4A reducer. RWC-P5 adds ONE more: the Core-owned availability
    // READ CONTRACT and its injected reader port -- a contract that reaches nothing itself. RWC-P6B
    // adds THREE, and each is a contract rather than a capability: the PURE post-summary semantics,
    // the POWERLESS Core intake boundary whose port has no implementation anywhere in this
    // repository, and `contracts` for the ONE idempotency-key grammar. Nothing else — still no model
    // client, no gateway, no HTTP library, no QuickFurno package, and still no adapter of any kind.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/contracts',
      '@qf-jarvis/core-riya-intake',
      '@qf-jarvis/core-service-availability-read',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-completion',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
  });

  it('the dependency direction is one-way: nothing it depends on depends back', () => {
    // PRODUCTION source only. A containment spec in one of those packages legitimately NAMES this
    // one -- that is how it pins the exact set of packages allowed to import it -- and scanning
    // those specs would report the lock as the violation it exists to prevent.
    for (const pkg of [
      'riya-agent',
      'contracts',
      'core-riya-intake',
      'riya-conversation-completion',
      'riya-conversation-continuity',
      'riya-conversation-evolution',
      'core-service-availability-read',
      'agent-runtime',
      'jarvis-runtime',
    ]) {
      const code = walk(join(REPO_ROOT, 'packages', pkg, 'src'), true)
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
      expect(code, pkg).not.toContain('riya-web-conversation-service');
    }
  });

  it('imports no private module of another package', () => {
    // Deep-importing an orchestrator file would be composing a second orchestration path with extra
    // steps, and it would do it below the public API that governs the first.
    const code = productionCode();
    expect(code).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal)\//u);
    expect(code).not.toContain('orchestrate-inbound');
    expect(code).not.toContain('createOrchestrator');
    expect(code).not.toContain('runAgentTurn');
    expect(code).not.toContain('composeAndProcess');
  });
});

describe('(50, 53-57) the repository invariants this slice must not move', () => {
  it('(50) no QuickFurno adapter or browser client exists anywhere', () => {
    const offenders: string[] = [];
    for (const root of ['packages', 'apps']) {
      for (const file of walk(join(REPO_ROOT, root), false)) {
        const normalised = file.replace(/\\/gu, '/');
        if (/riya-ui|jarvisClient|quickfurno-adapter/u.test(normalised)) {
          offenders.push(normalised);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('(51) the only HTTP routes remain the three operator-plane routes', () => {
    const routes = walk(join(REPO_ROOT, 'apps', 'jarvis-os', 'src', 'app'), false)
      .map((file) => file.replace(/\\/gu, '/'))
      .filter((file) => /\/route\.tsx?$/u.test(file))
      .map((file) => file.split('/src/app/')[1] ?? file)
      .sort();
    expect(routes).toStrictEqual([
      'api/auth/login/route.ts',
      'api/auth/logout/route.ts',
      'api/control-plane/v1/snapshot/route.ts',
    ]);
    // And apps/api still runs no server.
    const apiIndex = readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts'), 'utf8');
    expect(codeOnly(apiIndex).trim()).toBe('export {};');
  });

  it('(53) migrations are still exactly 0001-0012, byte-identical, with no 0013', () => {
    const LOCKED: Readonly<Record<string, string>> = {
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
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toStrictEqual(Object.keys(LOCKED));
    for (const [name, hash] of Object.entries(LOCKED)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
        name,
      ).toBe(hash);
    }
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition.
    expect(sql.some((name) => Number.parseInt(name.slice(0, 4), 10) > 12)).toBe(false);
  });

  it('(54, 55) the two channel vocabularies are exactly as JRW-0B left them', () => {
    // Read from SOURCE rather than imported: `@qf-jarvis/contracts` is deliberately not a dependency
    // of this package, and the point of the check is that this slice did not touch either.
    const runtime = readFileSync(
      join(REPO_ROOT, 'packages/agent-runtime/src/contracts/vocabularies.ts'),
      'utf8',
    );
    const contracts = readFileSync(
      join(REPO_ROOT, 'packages/contracts/src/communications/communication-channel.ts'),
      'utf8',
    );
    expect(runtime).toContain(
      "export const RUNTIME_CHANNELS = ['WHATSAPP', 'INTERNAL', 'WEB'] as const;",
    );
    expect(contracts).toContain(
      "export const COMMUNICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'voice'] as const;",
    );
  });

  it('(56, 57) the P2A and jarvis-runtime public APIs are unchanged', async () => {
    const continuity =
      (await import('@qf-jarvis/riya-conversation-continuity')) as unknown as Record<
        string,
        unknown
      >;
    expect(Object.keys(continuity).sort()).toStrictEqual([
      'RIYA_CONVERSATION_CONTINUITY_ERROR_CODES',
      'RIYA_CONVERSATION_PHASES',
      'RIYA_FIELD_PROVENANCE_SOURCES',
      'RiyaConversationContinuityError',
      'createRiyaConversationContinuityState',
    ]);

    const runtime = (await import('@qf-jarvis/jarvis-runtime')) as unknown as Record<
      string,
      unknown
    >;
    // Zero VALUE-API growth, restated rather than dropped for RWC-P2D (ADR-0096).
    //
    // P2C could claim more than this: it opened no seam at all. P2D does open one — the runtime
    // gained a fourth method, `processInboundForCoreAuthorizedReply`, and this package now calls
    // it. What did NOT change is the exported value surface: the new capability is reached through
    // the SAME `createJarvisRuntime` factory, and everything P2D added to the barrel is a TYPE,
    // which erases at runtime. So the count below is still six, and it still means what it says:
    // no second factory, no exported composition helper, no exported materializer.
    expect(Object.keys(runtime)).toHaveLength(6);
    expect(Object.keys(runtime).sort()).toStrictEqual([
      'JARVIS_RUNTIME_ERROR_CODES',
      'JARVIS_RUNTIME_EVENT_TYPES',
      'JARVIS_RUNTIME_OUTCOMES',
      'JarvisRuntimeError',
      'NOOP_JARVIS_RUNTIME_OBSERVABILITY',
      'createJarvisRuntime',
    ]);
  });

  it('exactly one package and one application may reach this service, each in one way', () => {
    // The history of this lock is the history of the slice.
    //
    // P2C delivered the service and its proof, and the guarantee was simply "nothing imports it".
    // RWC-P2B (ADR-0095) changed that once: the durable continuity store implements the
    // `RiyaContinuityStorePort` this package OWNS, so it imports the port's TYPES. An adapter
    // implementing a declared port is not a composition, so the lock was narrowed rather than
    // dropped.
    //
    // ADR-0097 changes it a second time, and this one IS a composition: the private Riya web
    // ingress adapter in `apps/api` injects an already-built service and calls `handleTurn`. That
    // is the entire purpose of that slice -- a service nothing could reach was, until now, a
    // capability nobody could use.
    //
    // So the lock is narrowed again rather than deleted, and it still says something worth saying:
    //   * the importing PACKAGE set is pinned exactly to one, and takes TYPES ONLY;
    //   * the importing APPLICATION set is pinned exactly to one;
    //   * that application must reach the service through the private ingress and nowhere else;
    //   * and the store importer must still not CONSTRUCT it -- a store that called the service
    //     would have inverted the dependency it exists to serve.
    // RWC-P8 (ADR-0104) narrows it a third time rather than dropping it. The durable turn
    // coordinator implements the `RiyaTurnCoordinatorPort` this package OWNS, so it imports the
    // port's TYPES -- an adapter implementing a declared port is not a composition, exactly as the
    // continuity store was not. Both remain TYPE-ONLY and neither may CONSTRUCT the service.
    const ALLOWED_PACKAGE_IMPORTERS = [
      'postgres-riya-conversation-continuity-store',
      'postgres-riya-turn-coordinator',
    ];
    const ALLOWED_APP_IMPORTERS = ['api'];
    const importingPackages = new Set<string>();
    const importingApps = new Set<string>();

    for (const [root, sink] of [
      ['packages', importingPackages],
      ['apps', importingApps],
    ] as const) {
      for (const entry of readdirSync(join(REPO_ROOT, root))) {
        if (entry === 'riya-web-conversation-service' || NOT_SOURCE.has(entry)) continue;
        const srcDir = join(REPO_ROOT, root, entry, 'src');
        let files: string[];
        try {
          files = walk(srcDir, false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-web-conversation-service')) {
            sink.add(entry);
          }
        }
      }
    }

    expect([...importingPackages].sort()).toStrictEqual(ALLOWED_PACKAGE_IMPORTERS);
    expect([...importingApps].sort()).toStrictEqual(ALLOWED_APP_IMPORTERS);

    // The application reaches it from the private ingress ONLY. If any other module in `apps/api`
    // ever named this package, the service would have acquired a second entry point without anybody
    // deciding it should have one.
    const apiSrc = join(REPO_ROOT, 'apps/api/src');
    for (const file of walk(apiSrc, false)) {
      const normalised = file.replace(/\\/gu, '/');
      if (!readFileSync(file, 'utf8').includes('@qf-jarvis/riya-web-conversation-service'))
        continue;
      expect(
        normalised.includes('/src/private-riya-web-ingress/') || normalised.includes('/src/tests/'),
        file,
      ).toBe(true);
    }

    // Type-only, and specifically NOT a construction of the service.
    for (const importer of ALLOWED_PACKAGE_IMPORTERS) {
      const importerSrc = join(REPO_ROOT, 'packages', importer, 'src');
      for (const file of walk(importerSrc, false)) {
        if (file.replaceAll('\\', '/').includes('/src/tests/')) continue;
        const text = readFileSync(file, 'utf8');
        expect(text, file).not.toContain('createRiyaWebConversationService');
      }
    }
    const storeSrc = join(REPO_ROOT, 'packages/postgres-riya-conversation-continuity-store/src');
    // PRODUCTION files only. The store's own specs necessarily NAME this package — they read its
    // port and its in-memory fake to prove the two implementations answer to the same words — and
    // scanning them would report that proof as its own violation.
    for (const file of walk(storeSrc, false)) {
      if (file.replace(/\\/gu, '/').includes('/src/tests/')) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('createRiyaWebConversationService');
      if (text.includes('@qf-jarvis/riya-web-conversation-service')) {
        expect(text, file).toMatch(
          /import type \{[\s\S]*?\} from '@qf-jarvis\/riya-web-conversation-service';/u,
        );
      }
    }
  });
});
