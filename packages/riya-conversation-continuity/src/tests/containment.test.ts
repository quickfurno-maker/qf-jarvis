/**
 * Containment for the Riya conversational continuity contract (RWC-P2A, ADR-0093).
 *
 * The behaviour spec proves what a caller may build. These prove what the package cannot do at all:
 * no reducer, no extraction, no persistence, no transport, no clock, no memory — and no drift in
 * the contracts it deliberately reuses rather than replaces.
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
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block comments and whole-line `//` comments so a scan reads CODE, not documentation. */
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

describe('the public surface is five values and nothing else', () => {
  it('exports exactly the approved runtime symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_CONVERSATION_CONTINUITY_ERROR_CODES',
      'RIYA_CONVERSATION_PHASES',
      'RIYA_FIELD_PROVENANCE_SOURCES',
      'RiyaConversationContinuityError',
      'createRiyaConversationContinuityState',
    ]);
  });

  it('exports no schema, rank map, field mapping, validator or fake', () => {
    for (const forbidden of [
      'provenanceMapSchema',
      'envelopeSchema',
      'PROVENANCE_PRECEDENCE_RANK',
      'DISCOVERY_VALUE_KEY',
      'SUMMARY_REQUIRED_DISCOVERY_FIELDS',
      'PHASES_BEFORE_SUMMARY',
      'PHASES_AFTER_SUMMARY',
      'IDENTIFIER',
      'CONTINUITY_REVISION',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('(48, 49) exports no phase reducer, extraction or provenance merge', () => {
    // RWC-P4 owns all three. Half a reducer here would be finished by whoever needed it next.
    for (const forbidden of [
      'determineNextPhase',
      'advancePhase',
      'nextPrimaryField',
      'isReadyForSummary',
      'isReadyForContact',
      'computeCanSubmit',
      'mergeProvenance',
      'mergeField',
      'applyFieldUpdate',
      'applyExtraction',
      'applyUserCorrection',
      'overwriteField',
      'updateFromModel',
      'extractRequirements',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('the summary-readiness set is internal, exact, and excludes the optional fields', async () => {
    // Internal on purpose: it is a validation input, not a vocabulary a caller composes against.
    // Exporting it would invite a consumer to build its own readiness check beside this one, and two
    // readiness checks disagree the moment one of them is updated.
    const internal = (await import('../internal/field-map.js')) as unknown as {
      SUMMARY_REQUIRED_DISCOVERY_FIELDS: readonly string[];
    };
    expect([...internal.SUMMARY_REQUIRED_DISCOVERY_FIELDS]).toStrictEqual([
      'serviceInterest',
      'location',
      'budget',
      'timeline',
    ]);
    for (const optional of ['propertyType', 'scope', 'consultationPreference']) {
      expect([...internal.SUMMARY_REQUIRED_DISCOVERY_FIELDS], optional).not.toContain(optional);
    }
    expect(Object.isFrozen(internal.SUMMARY_REQUIRED_DISCOVERY_FIELDS)).toBe(true);
  });

  it('(47) exposes no method that could act', () => {
    for (const forbidden of [
      'submit',
      'send',
      'execute',
      'authorize',
      'assign',
      'matchVendor',
      'createLead',
      'persist',
      'save',
      'load',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });
});

describe('(41-46) the package is pure and reaches nothing', () => {
  it('reads no clock and no randomness', () => {
    const code = productionCode();
    for (const forbidden of [
      'Date.now',
      'new Date',
      'performance.now',
      'hrtime',
      'Math.random',
      'randomUUID',
      'randomBytes',
      'getRandomValues',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no environment and opens no connection', () => {
    const code = productionCode();
    for (const forbidden of [
      'process.env',
      'DATABASE_URL',
      'connectionString',
      'fetch(',
      'axios',
      'undici',
      'WebSocket',
      'EventSource',
      'node:http',
      'node:https',
      'node:net',
      'node:fs',
      'createServer',
      'listen(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('touches no database, migration or persistence', () => {
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
      'repository',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('reaches no model, provider, transport or n8n', () => {
    const code = productionCode();
    for (const forbidden of [
      'model-gateway',
      'promptRef',
      'draftReply',
      'n8n',
      'whatsapp',
      'twilio',
      'webhook',
      'apiKey',
      'credential',
      'jarvisClient',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('depends on exactly riya-agent and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-agent',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
  });

  it('the dependency direction is one-way: riya-agent never learns about continuity', () => {
    // The behaviour kernel must stay pure. A reverse import would make Riya's decisions depend on
    // the working state a composition happens to be carrying.
    const riyaCode = walk(join(REPO_ROOT, 'packages', 'riya-agent', 'src'), true)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(riyaCode).not.toContain('riya-conversation-continuity');
  });
});

describe('(50-54) the ADR-0016 memory boundary is untouched', () => {
  const memoryDir = join(REPO_ROOT, 'packages', 'contracts', 'src', 'memory');

  it('(50) the agent-memory contracts still carry their governing literals', () => {
    const memory = readFileSync(join(memoryDir, 'agent-memory.ts'), 'utf8');
    // The two literals that make memory derived and safe to delete. If either became a mutable
    // boolean, this slice would have weakened the contract it claims to be separate from.
    expect(memory).toContain('rebuildable: z.literal(true)');
    expect(memory).toContain('authoritative: z.literal(false)');
    expect(memory).toContain('sourceEventIds');
  });

  it('(51) training eligibility is still an explicit decision, not a default', () => {
    const memory = readFileSync(join(memoryDir, 'agent-memory.ts'), 'utf8');
    expect(memory).not.toMatch(/trainingEligible\s*:\s*z\.boolean\(\)\.default\(true\)/u);
  });

  it('(52) operational state does NOT borrow the memory literals', () => {
    // Putting `rebuildable`/`authoritative`/`sourceEventIds` here would disguise working state as
    // agent memory: it would claim to be derived from events it was never derived from, and it
    // would let a reader conclude the ADR-0016 deletion guarantees apply to it. They do not.
    const code = productionCode();
    for (const forbidden of [
      'sourceEventIds',
      'rebuildable',
      'authoritative',
      'trainingEligible',
      'MemoryRecord',
      'AgentMemory',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    const state = barrel.createRiyaConversationContinuityState({
      version: 1,
      tenantId: 'tenant.a',
      conversationId: 'conv.1',
      continuityRevision: 0,
      phase: 'INTRO',
      discovery: { completeness: 'MORE_DISCOVERY_REQUIRED' },
      summaryConfirmed: false,
    });
    for (const forbidden of [
      'sourceEventIds',
      'rebuildable',
      'authoritative',
      'trainingEligible',
    ]) {
      expect(Object.keys(state), forbidden).not.toContain(forbidden);
    }
  });

  it('(53, 54) there is no cross-conversation or shared memory interface', () => {
    const code = productionCode();
    for (const forbidden of [
      'crossConversation',
      'sharedMemory',
      'memoryStore',
      'customerProfile',
      'clientProfile',
      'recall',
      'remember',
      'forget',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // The key is (tenant, conversation). There is no reader that could span conversations.
    expect(Object.keys(barrel).filter((key) => /find|list|query|all|search/iu.test(key))).toEqual(
      [],
    );
  });
});

describe('the contracts this slice reuses are unchanged', () => {
  it('riya-agent still exports its 16 runtime symbols', async () => {
    const riya = (await import('@qf-jarvis/riya-agent')) as unknown as Record<string, unknown>;
    expect(Object.keys(riya)).toHaveLength(16);
    for (const required of [
      'createNeedDiscovery',
      'DISCOVERY_FIELDS_FROZEN',
      'DISCOVERY_COMPLETENESS_FROZEN',
    ]) {
      expect(Object.keys(riya), required).toContain(required);
    }
  });

  it('the seven discovery fields and three completeness values are unchanged', async () => {
    const riya = (await import('@qf-jarvis/riya-agent')) as unknown as {
      DISCOVERY_FIELDS_FROZEN: readonly string[];
      DISCOVERY_COMPLETENESS_FROZEN: readonly string[];
    };
    expect([...riya.DISCOVERY_FIELDS_FROZEN]).toStrictEqual([
      'serviceInterest',
      'location',
      'propertyType',
      'scope',
      'budget',
      'timeline',
      'consultationPreference',
    ]);
    expect([...riya.DISCOVERY_COMPLETENESS_FROZEN]).toStrictEqual([
      'SUFFICIENT_FOR_CORE_REVIEW',
      'MORE_DISCOVERY_REQUIRED',
      'HUMAN_REVIEW_REQUIRED',
    ]);
  });

  it('the runtime and communication channel vocabularies are exactly as JRW-0B left them', () => {
    // Read from SOURCE rather than imported. Importing them here would give this package a phantom
    // dependency on two packages it deliberately does not depend on -- and the point of the check is
    // that this slice did not touch them, which a file read proves just as well.
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
    // And WEB stayed out of the delivery vocabulary.
    expect(contracts).not.toContain("'web'");
  });

  it('no APPLICATION consumes this contract, and only the three permitted packages do', () => {
    // When P2A landed, nothing imported it. RWC-P2C (ADR-0094) changed that fact and no other: the
    // private web conversation service loads and returns this state, and returns it UNCHANGED.
    // RWC-P2B (ADR-0095) added the second: the durable store, which re-proves every state through
    // THIS constructor on the way in and on the way out.
    //
    // RWC-P4A (ADR-0098) adds the third, and it is the one this package always expected. Its own
    // note says it implements no phase reducer, no extraction and no provenance merge because
    // RWC-P4 owns them; `riya-conversation-evolution` is that owner. It consumes the contract and
    // produces states through this same constructor -- the reducer lives THERE precisely so that
    // this package can stay a contract.
    //
    // RWC-P4B (ADR-0099) adds the last two, and both are consequences of the reducer finally being
    // composed. `riya-model-interaction` projects a state into the ONE model call and checks the
    // answer against it; `jarvis-runtime` re-proves the state a caller hands its Riya-aware
    // capability, because a hand-assembled one must not become the context a model reasons from.
    // Neither stores anything, and neither implements a rule — they read the contract.
    //
    // The guarantee is restated rather than dropped, and it did not weaken: the importer set is
    // pinned EXACTLY, and no APPLICATION may import the contract at all — an app importing it would
    // mean something is composing conversational state outside the packages that may.
    // RWC-P6A (ADR-0101) adds the sixth, and it is the one this contract's own phase vocabulary
    // anticipated: `riya-conversation-completion` owns the transitions past SUMMARY that this package
    // deliberately left as bare labels. It consumes the contract and produces states through this
    // same constructor -- the transitions live THERE precisely so that this package can stay a
    // contract.
    //
    // The guarantee is restated rather than dropped, and it did not weaken: the importer set is
    // pinned EXACTLY, and no APPLICATION may import the contract at all.
    //
    // RWC-P10 (ADR-0106) adds the seventh, and it is the only one that neither stores a state nor
    // produces one. `riya-quality-evaluation` reads the PHASE VOCABULARY so a quality fixture can say
    // which continuity phases a correct answer may leave the conversation in. It deliberately does
    // not recompute a transition: an evaluator holding its own copy of the reducer would, the day the
    // two disagreed, report a model failure for a reducer change.
    //
    // The guarantee is restated rather than dropped, and it did not weaken: the importer set is
    // pinned EXACTLY, and no APPLICATION may import the contract at all.
    //
    // RID-F1 (ADR-0107) adds the eighth, and like the seventh it neither stores a state nor produces
    // one. `riya-intelligence-dataset` reads the PHASE and PROVENANCE vocabularies so a training
    // example can say where a conversation had reached and how strongly each fact was known.
    // Provenance in particular is why: a corpus that omitted it would teach a model to read its own
    // guesses back to people as though they had said them, which is the exact failure this contract
    // was built to prevent.
    //
    // The guarantee is restated rather than dropped, and it did not weaken: the importer set is
    // pinned EXACTLY, and no APPLICATION may import the contract at all.
    //
    // MVP-P2A.1 adds the ninth, and it is the second that neither stores a state nor produces one.
    // `riya-candidate-evaluation-runner` reads the PHASE vocabulary so a captured candidate turn can
    // say which phase the conversation was left in, which is the value P10 then judges. It is offline
    // evaluation infrastructure behind an injected port: it serves no turn, and no runtime imports it.
    //
    // The guarantee is restated rather than dropped, and it did not weaken: the importer set is
    // pinned EXACTLY, and no APPLICATION may import the contract at all.
    // MVP-P2A.2 adds the tenth, and it is the offline operator that finally sits the exam.
    // `riya-candidate-evidence-live` builds the SYNTHETIC continuity state each evaluation turn
    // starts from -- through this package's own constructor, so an evaluation turn cannot carry a
    // state production could never produce. It serves no turn, activates nothing, and no package or
    // app imports it; its own spec proves that.
    //
    // The guarantee is restated rather than dropped, and it did not weaken: the importer set is
    // pinned EXACTLY, and no APPLICATION may import the contract at all.
    const ALLOWED_PACKAGE_IMPORTERS = [
      'jarvis-runtime',
      'postgres-riya-conversation-continuity-store',
      'riya-candidate-evaluation-runner',
      'riya-candidate-evidence-live',
      'riya-conversation-completion',
      'riya-conversation-evolution',
      'riya-intelligence-dataset',
      'riya-model-interaction',
      'riya-quality-evaluation',
      'riya-web-conversation-service',
    ];
    const importingPackages = new Set<string>();
    const importingApps = new Set<string>();

    for (const [root, sink] of [
      ['packages', importingPackages],
      ['apps', importingApps],
    ] as const) {
      for (const entry of readdirSync(join(REPO_ROOT, root))) {
        if (entry === 'riya-conversation-continuity' || NOT_SOURCE.has(entry)) continue;
        const srcDir = join(REPO_ROOT, root, entry, 'src');
        let files: string[];
        try {
          files = walk(srcDir, false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-conversation-continuity')) {
            sink.add(entry);
          }
        }
      }
    }

    expect([...importingApps]).toStrictEqual([]);
    expect([...importingPackages].sort()).toStrictEqual(ALLOWED_PACKAGE_IMPORTERS);
  });
});

describe('(55-57) the migration set is untouched', () => {
  it('is exactly 0001-0012, byte-identical, with no 0013', () => {
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

  it('migration 0008 is not extended with continuity columns', () => {
    // The conversation-control revision and the continuity revision are different domains. Reusing
    // one integer for both would make a takeover bump a discovery revision, and a discovery update
    // bump the safety revision every M3/M4 gate compares.
    const migration = readFileSync(
      join(
        REPO_ROOT,
        'packages/event-backbone/src/persistence/migrations/0008_conversation_control_persistence.sql',
      ),
      'utf8',
    );
    // Column-shaped names only. The bare word "phase" appears in 0008's own prose ("the phase
    // exists to remove"), and banning a word a migration is allowed to explain itself with would be
    // a scan that fails for the wrong reason.
    for (const forbidden of [
      'continuity_revision',
      'conversation_phase',
      'need_discovery',
      'field_provenance',
      'summary_confirmed',
      'completion_evidence',
    ]) {
      expect(migration.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
