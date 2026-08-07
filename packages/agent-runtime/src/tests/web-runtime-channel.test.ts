/**
 * JRW-0B — the governed WEB runtime channel (ADR-0092).
 *
 * WEB is the QuickFurno web concierge surface reaching the SAME governed Riya. This slice adds a
 * vocabulary member and nothing else, so these specs are mostly proofs of ABSENCE: that adding a
 * channel added no behaviour, no transport, no prompt, no memory and no authority.
 *
 * The load-bearing one is channel-blindness. `channel` is carried on an envelope so a turn can say
 * where it came from; the moment anything branches on it, "the same Riya on another surface" stops
 * being a fact about the code and becomes a claim somebody has to keep re-checking.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import type { InboundEnvelopeInput } from '../contracts/inbound-envelope.js';
import { AgentRuntimeError } from '../contracts/errors.js';
import { RUNTIME_CHANNELS } from '../contracts/vocabularies.js';
import { PROPOSAL_AUTHORITY_STATUS } from '../index.js';
import { createOrchestrationContext } from '../orchestration/contracts.js';
import type { OrchestrationContextInput } from '../orchestration/contracts.js';
import { createOrchestrator, orchestrateInbound } from '../orchestration/orchestrate-inbound.js';
import type { OrchestrationEvent } from '../orchestration/observability.js';
import { syntheticPolicy } from '../testing/fixtures.js';
import {
  orchestrationEnvelopeFields,
  scriptedContextPort,
  scriptedCoreDecisionPort,
  scriptedModelReplyPort,
} from '../testing/deterministic-orchestration-ports.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

// ---------------------------------------------------------------------------
// 1, 4, 5. The vocabulary, and what an envelope may declare.
// ---------------------------------------------------------------------------

describe('(1) the runtime channel vocabulary is closed and ordered', () => {
  it('is exactly WHATSAPP, INTERNAL, WEB', () => {
    expect([...RUNTIME_CHANNELS]).toStrictEqual(['WHATSAPP', 'INTERNAL', 'WEB']);
  });

  it('carries no alias for the same surface', () => {
    // One spelling per concept. Two would let two envelopes describe the same surface and compare
    // unequal, and every downstream lock would then have to know both.
    for (const alias of ['web', 'WEBSITE', 'BROWSER', 'WEB_CHAT', 'HTTP', 'QUICKFURNO_WEB']) {
      expect([...RUNTIME_CHANNELS], alias).not.toContain(alias);
    }
  });
});

function webEnvelopeInput(over: Partial<InboundEnvelopeInput> = {}): InboundEnvelopeInput {
  return {
    ...orchestrationEnvelopeFields(),
    channel: 'WEB',
    partyType: 'CLIENT',
    direction: 'INBOUND',
    // An opaque web-turn reference. Not a provider id, not a URL, not a cookie.
    providerMessageRef: 'web.turn.opaque.ref',
    ...over,
  };
}

describe('(4) a WEB inbound envelope uses the EXISTING envelope', () => {
  it('parses with the existing fields and freezes', () => {
    // No second web-specific envelope exists, and this is why one is not needed: every field a web
    // turn has to state is already here, and `providerMessageRef` was already opaque.
    const envelope = createInboundEnvelope(webEnvelopeInput({ normalizedText: 'Hello Riya' }));
    expect(envelope.channel).toBe('WEB');
    expect(envelope.partyType).toBe('CLIENT');
    expect(envelope.direction).toBe('INBOUND');
    expect(envelope.providerMessageRef).toBe('web.turn.opaque.ref');
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it('parses without a subject reference, so an anonymous web visitor is representable', () => {
    const envelope = createInboundEnvelope(webEnvelopeInput());
    expect(envelope.subjectRef).toBeUndefined();
  });

  it('(5) refuses every alias and every casing variant', () => {
    for (const bad of ['web', 'Web', 'WEBSITE', 'BROWSER', 'WEB_CHAT', 'HTTP', 'QUICKFURNO_WEB']) {
      expect(() => createInboundEnvelope(webEnvelopeInput({ channel: bad as never })), bad).toThrow(
        AgentRuntimeError,
      );
    }
  });

  it('refuses a browser-authority field bolted onto a web turn', () => {
    // The envelope schema is `.strict()`, so this is already true -- but it is the exact attack a
    // web surface invites, and a browser that could set `dataClass` could route HUMAN_ONLY content
    // to a hosted model. Named here so the refusal is deliberate rather than incidental.
    for (const field of [
      'consent',
      'authorized',
      'canSubmit',
      'city',
      'vendorAvailability',
      'price',
      'customerIdentity',
      'role',
      'model',
      'prompt',
      'tools',
      'origin',
      'sessionToken',
    ]) {
      expect(() => createInboundEnvelope({ ...webEnvelopeInput(), [field]: 'x' }), field).toThrow(
        AgentRuntimeError,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 7, 8. Same Riya: identical governed behaviour on both surfaces.
// ---------------------------------------------------------------------------

function ctx(over: Partial<OrchestrationContextInput> = {}) {
  return createOrchestrationContext({
    conversationId: 'conv.1',
    tenantId: 'tenant.a',
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    revision: 1,
    ...over,
  });
}

interface TurnOpts {
  readonly context?: ReturnType<typeof ctx>;
  readonly envelope?: Partial<InboundEnvelopeInput>;
}

/** One governed turn on a given channel, through the SAME orchestrator wiring. */
async function turn(channel: 'WHATSAPP' | 'WEB', opts: TurnOpts = {}) {
  const model = scriptedModelReplyPort({});
  const core = scriptedCoreDecisionPort('ACCEPTED');
  const events: OrchestrationEvent[] = [];
  const orch = createOrchestrator({
    policy: syntheticPolicy(),
    contextPort: scriptedContextPort(opts.context ?? ctx()),
    modelReplyPort: model,
    coreDecisionPort: core,
    observability: { onEvent: (event) => events.push(event) },
  });
  const envelope = createInboundEnvelope({
    ...orchestrationEnvelopeFields(),
    channel,
    providerMessageRef: channel === 'WEB' ? 'web.turn.opaque.ref' : 'wamid.opaque.ref',
    ...opts.envelope,
  });
  const result = await orchestrateInbound(orch, envelope);
  return { result, model, core, events };
}

/** The governed decision, with the incidental parts (ids, instants) deliberately excluded. */
function governedShape(result: Awaited<ReturnType<typeof turn>>['result']): unknown {
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return {
    ok: true,
    assignedActor: result.assignedActor,
    kind: result.proposal.kind,
    authorityStatus: result.proposal.authorityStatus,
    partyType: result.proposal.partyType,
    citations: result.proposal.citations.map((c) => `${c.knowledgeId}@${String(c.version)}`),
    decisionOutcome: result.decision.outcome,
  };
}

describe('(7) WEB and WHATSAPP are the same governed Riya', () => {
  it('produce the same governed decision for the same conversation', async () => {
    const whatsapp = await turn('WHATSAPP');
    const web = await turn('WEB');

    expect(whatsapp.result.ok).toBe(true);
    // Equivalence at the GOVERNED DECISION layer. Ids and instants are allowed to differ; the actor,
    // the proposal kind, the authority status, the citations and the Core outcome are not.
    expect(governedShape(web.result)).toStrictEqual(governedShape(whatsapp.result));
  });

  it('assign the same actor and keep the same proposal authority', async () => {
    const web = await turn('WEB');
    expect(web.result.ok).toBe(true);
    if (!web.result.ok) return;
    expect(web.result.assignedActor).toBe('RIYA');
    expect(web.result.proposal.partyType).toBe('CLIENT');
    expect(web.result.proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
    expect(Object.isFrozen(web.result.proposal)).toBe(true);
  });

  it('expose no send/execute path on the WEB branch either', async () => {
    const web = await turn('WEB');
    expect(web.result.ok).toBe(true);
    if (!web.result.ok) return;
    const asRecord = web.result.proposal as unknown as Record<string, unknown>;
    for (const method of ['send', 'execute', 'authorize', 'deliver', 'commit', 'respond', 'push']) {
      expect(asRecord[method], method).toBeUndefined();
    }
  });

  it('call the model exactly once on each channel, through the same port', async () => {
    const whatsapp = await turn('WHATSAPP');
    const web = await turn('WEB');
    expect(web.model.invoked()).toBe(whatsapp.model.invoked());
    expect(web.model.invoked()).toBe(1);
  });

  it('emit the same governed observability sequence', async () => {
    const whatsapp = await turn('WHATSAPP');
    const web = await turn('WEB');
    const shape = (events: readonly OrchestrationEvent[]): string[] =>
      events.map((e) => `${e.type}:${e.reason}`);
    expect(shape(web.events)).toStrictEqual(shape(whatsapp.events));
    // And no event names the channel: a content-free event that leaked a surface would be the first
    // place channel-specific handling grew.
    expect(JSON.stringify(web.events)).not.toContain('WEB');
  });
});

describe('(8) WEB obeys every existing safety gate, with no separate web path', () => {
  const gates = [
    { name: 'humanTakeover', context: ctx({ humanTakeover: true }) },
    { name: 'aiPaused', context: ctx({ aiPaused: true }) },
    { name: 'cancelled', context: ctx({ cancelled: true }) },
  ] as const;

  for (const gate of gates) {
    it(`refuses a WEB turn under ${gate.name}, exactly as WhatsApp does`, async () => {
      const web = await turn('WEB', { context: gate.context });
      const whatsapp = await turn('WHATSAPP', { context: gate.context });

      expect(web.result.ok).toBe(false);
      expect(governedShape(web.result)).toStrictEqual(governedShape(whatsapp.result));
      // A blocked turn reaches no model and no Core on either surface.
      expect(web.model.invoked()).toBe(0);
      expect(web.core.invoked()).toBe(0);
    });
  }

  it('refuses a WEB turn whose envelope does not match its conversation', async () => {
    const web = await turn('WEB', { envelope: { conversationId: 'conv.OTHER' } });
    expect(web.result.ok).toBe(false);
    expect(web.model.invoked()).toBe(0);
  });

  it('applies the data-class gate to WEB identically', async () => {
    const context = ctx({ dataClass: 'HUMAN_ONLY' });
    const web = await turn('WEB', { context, envelope: { dataClass: 'HUMAN_ONLY' } });
    const whatsapp = await turn('WHATSAPP', { context, envelope: { dataClass: 'HUMAN_ONLY' } });
    expect(governedShape(web.result)).toStrictEqual(governedShape(whatsapp.result));
    expect(web.model.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6, 9, 10, 11, 12, 13. Proofs of absence.
// ---------------------------------------------------------------------------

/** Build output and installed packages are not this repository's source, and never scanned. */
const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && (entry === 'tests' || entry === 'testing')) continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments AND the one line that is allowed to name every channel: the vocabulary declaration.
 *
 * A channel-blindness scan that read the declaration would report the closed set as its own
 * violation — the recurring false positive in this repository's containment suites. Everything else
 * in production source is scanned.
 */
function scannableCode(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .filter((line) => !/^export const RUNTIME_CHANNELS\s*=/u.test(line))
    .join('\n');
}

/** Production source of the packages that decide what Riya does. */
function behaviourPackagesCode(): { file: string; code: string }[] {
  const roots = [
    join(REPO_ROOT, 'packages', 'agent-runtime', 'src'),
    join(REPO_ROOT, 'packages', 'riya-agent', 'src'),
    join(REPO_ROOT, 'packages', 'jarvis-runtime', 'src'),
  ];
  return roots
    .flatMap((root) => walk(root, true))
    .map((file) => ({ file, code: scannableCode(readFileSync(file, 'utf8')) }));
}

describe('(6) the behaviour layer stays channel-blind', () => {
  it('no production file branches on a channel value', () => {
    // The property JRW-0A measured on merged main, now locked. If WEB ever needs its own branch,
    // this fails first and the decision becomes a reviewed one instead of a quiet one.
    const offenders: string[] = [];
    for (const { file, code } of behaviourPackagesCode()) {
      const branching = [
        /\bchannel\s*===/u,
        /\bchannel\s*!==/u,
        /switch\s*\(\s*[A-Za-z0-9_.]*channel\s*\)/u,
        /case\s+'(WHATSAPP|INTERNAL|WEB)'/u,
        /\?\s*'(WHATSAPP|INTERNAL|WEB)'/u,
      ];
      if (branching.some((pattern) => pattern.test(code))) {
        offenders.push(file.replace(/\\/gu, '/').split('/packages/')[1] ?? file);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('no production file even MENTIONS a channel literal outside the vocabulary', () => {
    const offenders: string[] = [];
    for (const { file, code } of behaviourPackagesCode()) {
      if (/'(WHATSAPP|INTERNAL|WEB)'/u.test(code)) {
        offenders.push(file.replace(/\\/gu, '/').split('/packages/')[1] ?? file);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('the scan actually fires (positive control)', () => {
    // Without this, a scan that silently matched nothing would look exactly like a clean result.
    const wouldBeAdded = "if (envelope.channel === 'WEB') { return webPrompt(); }";
    expect(/\bchannel\s*===/u.test(scannableCode(wouldBeAdded))).toBe(true);
    // And the declaration line is genuinely excluded, so the exclusion is not silently doing nothing.
    expect(
      scannableCode("export const RUNTIME_CHANNELS = ['WHATSAPP', 'INTERNAL', 'WEB'];"),
    ).not.toContain('WHATSAPP');
  });

  it('there is no WEB-specific prompt, model policy, knowledge path or runtime', () => {
    const code = behaviourPackagesCode()
      .map((entry) => entry.code)
      .join('\n');
    for (const forbidden of [
      'webPrompt',
      'WEB_PROMPT',
      'webPromptFamily',
      'webModelPolicy',
      'webKnowledge',
      'webRuntime',
      'createWebRiya',
      'webBehaviour',
      'webReplyPort',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('(9, 11) adding WEB added no transport and no client', () => {
  it('the behaviour packages contain no network client of any kind', () => {
    const code = behaviourPackagesCode()
      .map((entry) => entry.code)
      .join('\n');
    for (const forbidden of [
      'fetch(',
      'axios',
      'undici',
      'node-fetch',
      'WebSocket',
      'EventSource',
      'text/event-stream',
      'node:http',
      'node:https',
      'node:net',
      'node:tls',
      'createServer',
      'listen(',
      'webhook',
      'n8n',
      'twilio',
      'graph.facebook',
      'ReadableStream',
      'jarvisClient',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('their manifests gained no dependency', () => {
    for (const pkg of ['agent-runtime', 'riya-agent']) {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { readonly dependencies?: Record<string, string> };
      const deps = Object.keys(manifest.dependencies ?? {}).sort();
      expect(deps, pkg).toStrictEqual(
        pkg === 'agent-runtime' ? ['zod'] : ['@qf-jarvis/agent-runtime', 'zod'],
      );
    }
  });

  it('no QuickFurno adapter or BROWSER client exists anywhere in the repository', () => {
    // When JRW-0B landed, this also forbade a `web-conversation-service` — because none was
    // authorized and any file matching that name would have been somebody building an ingress
    // early. RWC-P2C (ADR-0094) authorized exactly one, on the JARVIS side, and it is a private
    // application service with no HTTP server, route or browser reachability.
    //
    // So the guard moves to the new truth rather than being dropped, and it did not weaken: what it
    // forbids is a QuickFurno-side adapter or anything a BROWSER could hold. Those are still zero,
    // and the sibling assertions below still prove no application composes the channel and that the
    // only HTTP routes are the three operator-plane ones.
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
});

describe('(10) no application consumes the web channel', () => {
  it('apps/api still exports nothing and runs no server', () => {
    const index = readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts'), 'utf8');
    expect(scannableCode(index).trim()).toBe('export {};');
  });

  it('the only HTTP routes remain the three operator-plane routes', () => {
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
  });
});

describe('(12, 13) the repository invariants this slice must not move', () => {
  it('the agent-runtime public surface is unchanged at 46 runtime exports', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(46);
    expect(Object.keys(barrel)).toContain('RUNTIME_CHANNELS');
  });

  it('migrations are still exactly 0001-0011, byte-identical, with no 0012', () => {
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
        'c02e78d7b3ab1fce22ffa87af2a94f0edaf613004e3d3605e3fc1ef25caddb5c',
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
    expect(sql.some((name) => Number.parseInt(name.slice(0, 4), 10) > 11)).toBe(false);
  });

  it('no memory, transcript or session store was introduced', () => {
    const code = behaviourPackagesCode()
      .map((entry) => entry.code)
      .join('\n');
    // `summary` is deliberately NOT in this list. `scopeSummary` is a governed need-discovery field
    // -- a bounded 500-character description of a project scope that accompanies a proposal -- and
    // banning the word would ban a contract that predates this slice. What must stay absent is a
    // CONVERSATION memory: a stored history, a rolling summary, or an embedding of one.
    for (const forbidden of [
      'transcript',
      'messageHistory',
      'conversationHistory',
      'conversationSummary',
      'rollingSummary',
      'contextWindow',
      'embedding',
      'vectorStore',
      'localStorage',
      'sessionStorage',
      'sessionToken',
      'memoryStore',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
