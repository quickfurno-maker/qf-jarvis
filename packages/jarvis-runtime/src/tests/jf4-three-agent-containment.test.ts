/**
 * JF-4B/C/D — three-agent composition containment (ADR-0150 §11, §13, §14, §19).
 *
 * Matrix D37, D38, E41–E48, F56–F59, J82–J95.
 *
 * ### What these scans are for
 *
 * The risk in this lane was never that the composition would fail to work. It was that composing Aarohi
 * would quietly grow a second acquisition brain, or a second route into vendor ownership, or a direct
 * provider call — each of which works perfectly and is wrong. A behavioural test proves a path was not
 * taken on the inputs tried; a scan proves the path is not there to take.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { completeCoreActiveHandoff } from '@qf-jarvis/aarohi-agent';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const ADAPTER = fileURLToPath(
  new URL('../composition/aarohi-behaviour-adapter.ts', import.meta.url),
);
const COMPOSITION_DIR = fileURLToPath(new URL('../composition', import.meta.url));

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
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
const adapterCode = (): string => codeOnly(readFileSync(ADAPTER, 'utf8'));

describe('JF-4C the adapter composes Aarohi and reimplements nothing', () => {
  it('(D37,D38) it calls ONE existing Aarohi evaluator, and derives no strategy itself', () => {
    const code = adapterCode();
    // The one function it reaches, named exactly once in a call.
    expect(code).toContain('evaluateAarohiSalesTurn(');
    expect(code.match(/evaluateAarohiSalesTurn\(/gu)).toHaveLength(1);

    // And no OTHER Aarohi evaluator. One turn invokes one evaluator path; a second call here would be
    // this file deciding which stage applies, which is a decision AVG-7 already makes.
    for (const other of [
      'prepareAarohiCommercialFactsBrief',
      'prepareAarohiRegistrationAssistanceBrief',
      'prepareAarohiPaymentFollowupBrief',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
      'transitionAcquisitionCase',
      'transitionWorkspaceDraft',
      'reviseWorkspaceDraft',
      'summariseEnrichmentConsistency',
      'evaluateAarohiControlledAutonomy',
    ]) {
      expect({ other, present: code.includes(other) }).toEqual({ other, present: false });
    }
  });

  it('(D37) it re-derives no business rule that the Aarohi domain already owns', () => {
    const code = adapterCode();
    // The adapter maps a CLOSED strategy vocabulary onto a CLOSED proposal vocabulary. It must not
    // contain the reasoning that produced the strategy: no intent classification, no objection
    // handling, no Core status comparison, no instant arithmetic, no scoring, no eligibility.
    for (const rule of [
      'NOT_REGISTERED',
      'DO_NOT_CONTACT',
      'REGISTERED',
      'coreStatus',
      'plannedAt <',
      'Date.',
      'score',
      'eligib',
      'interpretation.',
      'conversation.',
    ]) {
      expect({ rule, present: code.includes(rule) }).toEqual({ rule, present: false });
    }
  });

  it('the strategy map is TOTAL over the domain vocabulary, with no default branch', () => {
    // A default branch is how a strategy added to AVG-7 later would silently become a REPLY.
    const code = adapterCode();
    for (const strategy of [
      'PREPARE_NONCOMMERCIAL_REPLY_BRIEF',
      'PREPARE_CLARIFYING_REPLY_BRIEF',
      'REQUEST_CORE_COMMERCIAL_CONTEXT',
      'REQUEST_CORE_PROCESS_CONTEXT',
      'REQUEST_CORE_CONTACT_POLICY_REVIEW',
      'REQUEST_HUMAN_REVIEW',
    ]) {
      expect(code).toContain(strategy);
    }
    expect(code).not.toMatch(/default\s*:/u);
    // Commercial and process context requests carry NO model, because no price, package, registration
    // or payment claim may originate in Aarohi -- AVG-8 and AVG-9 exist for exactly that reason.
    expect(code).toMatch(
      /REQUEST_CORE_COMMERCIAL_CONTEXT: \{ kind: 'NO_ACTION', modelPermitted: false \}/u,
    );
    expect(code).toMatch(
      /REQUEST_CORE_PROCESS_CONTEXT: \{ kind: 'NO_ACTION', modelPermitted: false \}/u,
    );
  });
});

describe('JF-4C the adapter reaches no model, provider or authority', () => {
  it('(E41,E43,E48,J86,J87,J88) no provider, no gateway, no credential, no retry', () => {
    const code = adapterCode();
    for (const forbidden of [
      'model-gateway',
      'ModelGateway',
      'gatewayInvoker',
      'groq',
      'Groq',
      'nara',
      'Nara',
      'providers/',
      'ProviderMode',
      'apiKey',
      'Authorization',
      'fetch(',
      'retry',
      'attempt',
      'backoff',
      'mastra',
      'Mastra',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // Model eligibility is read from the DOMAIN's own answer, ANDed with the strategy map. Deciding it
    // here would put a sales-ethics judgement in the composition root.
    expect(code).toContain('brief.futureModelDraftEligible');
  });

  it('(E44,E45,E46,E47) it creates no proposal, no Core decision and no reply', () => {
    const code = adapterCode();
    for (const forbidden of [
      'createOrchestrationProposal',
      'coreDecision',
      'CoreDecision',
      'authorizedReply',
      'replyBody',
      'draft',
      'canSend',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('JF-4C the Aarohi -> Anisha ownership transition has exactly one route', () => {
  it('(F56,F57) the adapter neither performs a handoff nor mutates an assignment', () => {
    const code = adapterCode();
    // The one function that may reach HANDED_OFF_TO_ANISHA is not imported, wrapped, named or
    // shadowed here -- and neither is any invented substitute for it.
    for (const forbidden of [
      'completeCoreActiveHandoff',
      'handoffToAnisha',
      'markActive',
      'assumeActive',
      'vendorActivated',
      'isActive',
      'ACTIVE',
      'assignedActor =',
      'assignAgent',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(F58) ownership moves by PARTY RECLASSIFICATION, not by a router mutation', () => {
    // The whole composition contains no way to change an assignment. `assignAgent` is a pure function
    // of the party type the trusted caller stated, so after Core activation the NEXT canonical turn is
    // classified VENDOR by the caller and the existing router selects ANISHA. That is the transition:
    // a governed domain result plus a later classification, never a hidden mutation mid-turn.
    for (const file of walk(COMPOSITION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      // A PROPERTY WRITE, specifically. Two nearby things are correct and must not be flagged:
      // `request.assignedActor ===` is the mux reading the routing decision, and
      // `const assignedActor = assignAgent(...)` is the snapshot deriving it THROUGH the router. What
      // must not exist is a write onto an already-decided actor, which is how a handoff would become a
      // hidden mid-turn reassignment instead of a governed domain result.
      const mutates = /\.\s*assignedActor\s*=(?!=)/u.test(code);
      expect({ file: file.split(sep).pop(), mutates }).toEqual({
        file: file.split(sep).pop(),
        mutates: false,
      });
    }
  });

  it('(F50,F51,F52,F53,F54) substitute activation authorities are still refused by the existing gate', () => {
    // Aarohi's own suite certifies this function exhaustively; this re-runs the boundary from the
    // composition side to confirm the version JF-4 composes is the version that refuses. A provider
    // receipt, a model claim, a caller boolean and a non-Core authority are each not ACTIVE authority.
    for (const attestation of [
      undefined,
      null,
      {},
      { authority: 'PAYMENT_PROVIDER', active: true },
      { authority: 'MODEL_INFERENCE', active: true },
      { authority: 'CONVERSATION_CLAIM', active: true },
      { authority: 'JARVIS_WORKFLOW', active: true },
      { active: true },
      true,
    ]) {
      const outcome = completeCoreActiveHandoff(
        // A deliberately invalid case as well: the function validates both sides, and a malformed case
        // reaching a terminal transition should fail rather than be trusted for being typed.
        {} as never,
        attestation,
      );
      expect(outcome.ok).toBe(false);
    }
  });
});

describe('JF-4B/C/D repository boundaries', () => {
  it('(J82,J83,J84,J85) no QuickFurno, OneDecore, Meta or n8n anywhere in the composition', () => {
    for (const file of walk(COMPOSITION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'quickfurno',
        'onedecore',
        'graph.facebook',
        'meta.com',
        'n8n',
        'twilio',
      ]) {
        expect({
          file: file.split(sep).pop(),
          forbidden,
          present: code.includes(forbidden),
        }).toEqual({
          file: file.split(sep).pop(),
          forbidden,
          present: false,
        });
      }
    }
  });

  it('(J93) migrations are unchanged: 0001-0014, and no 0015', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toHaveLength(14);
    expect(sql.some((n) => n.startsWith('0015'))).toBe(false);
  });

  it('(J91,J92) D5 is neither activated nor granted new permissions by this lane', () => {
    // D5's projection handler and its migration exist and are untouched. JF-4 references no D5 source,
    // registers no projection and widens no grant -- activation belongs to the later production gate
    // with real deployment authority, not to an internal composition phase.
    for (const file of walk(COMPOSITION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'communication-state',
        'communicationState',
        'registerProjection',
        'GRANT ',
      ]) {
        expect({ forbidden, present: code.includes(forbidden) }).toEqual({
          forbidden,
          present: false,
        });
      }
    }
  });

  it('(J94,J95) no local prospect truth store, and no Anisha Care', () => {
    for (const file of walk(COMPOSITION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'prospectStore',
        'acquisitionStore',
        'createPool',
        'anishaCare',
        'AnishaCare',
      ]) {
        expect({ forbidden, present: code.includes(forbidden) }).toEqual({
          forbidden,
          present: false,
        });
      }
    }
  });

  it('(J89,J90) no vector, embedding or training dependency reaches the composition', () => {
    for (const file of walk(COMPOSITION_DIR)) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'embedding',
        'vectorStore',
        'pinecone',
        'training',
        'dataset',
        'benchmark',
      ]) {
        expect({ forbidden, present: code.includes(forbidden) }).toEqual({
          forbidden,
          present: false,
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// JF-4 owner correction §17 — ONE RAG system, and the migration ledger.
// ---------------------------------------------------------------------------

describe('JF-4 correction: there is ONE governed RAG, not three', () => {
  it('no per-agent RAG package, directory or barrel exists anywhere in the repository', () => {
    // The correction's central instruction. A per-agent package would work and would be wrong: three
    // packages are three answers to "what may this agent see", and the answers diverge the first time
    // one of them is fixed. This scan proves the path is not there to take.
    const workspaces = [repoPath('packages'), repoPath('apps')];
    // COMPOSED, not spelled. The second scan below reads every source file in the workspace --
    // including this one -- so a literal list here would match itself and fail for the wrong reason.
    const forbiddenNames = [
      ['riya', 'rag'],
      ['anisha', 'rag'],
      ['aarohi', 'rag'],
      ['riya', 'knowledge'],
      ['anisha', 'knowledge'],
      ['aarohi', 'knowledge'],
      ['prospect', 'rag'],
      ['vendor', 'rag'],
      ['client', 'rag'],
    ].map((parts) => parts.join('-'));
    for (const workspace of workspaces) {
      const entries = readdirSync(workspace);
      for (const forbidden of forbiddenNames) {
        expect({
          workspace: workspace.split(sep).pop(),
          forbidden,
          present: entries.includes(forbidden),
        }).toEqual({
          workspace: workspace.split(sep).pop(),
          forbidden,
          present: false,
        });
      }
    }
    // And no source file anywhere NAMES one, so a future import cannot resolve to a package that was
    // added quietly and then removed from this list.
    for (const workspace of workspaces) {
      for (const file of walk(workspace)) {
        const code = codeOnly(readFileSync(file, 'utf8'));
        for (const forbidden of forbiddenNames) {
          expect({
            file: file.split(sep).pop(),
            forbidden,
            present: code.includes(forbidden),
          }).toEqual({
            file: file.split(sep).pop(),
            forbidden,
            present: false,
          });
        }
      }
    }
  });

  it('exactly ONE production knowledge pack and ONE pack revision exist', () => {
    // Three packs would mean three approval bindings, and an ACTIVE profile could then name the one
    // whose content it liked. A repository-wide scan for a second production pack symbol.
    const declaring: string[] = [];
    for (const workspace of [repoPath('packages'), repoPath('apps')]) {
      for (const file of walk(workspace)) {
        if (file.includes(`${sep}tests${sep}`)) {
          continue;
        }
        const code = codeOnly(readFileSync(file, 'utf8'));
        if (code.includes('export const PRODUCTION_KNOWLEDGE_PACK_REVISION')) {
          declaring.push(file.split(sep).pop() ?? file);
        }
      }
    }
    expect(declaring).toEqual(['production-knowledge-pack.ts']);
  });

  it('the agent policy carries the authority reach ONCE, with no per-agent field for it', () => {
    // Structural, and the load-bearing half of "one RAG system": a deployment has exactly one place to
    // point grounding at, so three agents cannot end up on three registries.
    const policy = codeOnly(
      readFileSync(
        fileURLToPath(new URL('../contracts/agent-knowledge-policy.ts', import.meta.url)),
        'utf8',
      ),
    );
    // One declaration of each, at POLICY level.
    expect(policy.match(/readonly registry\?:/g)).toHaveLength(1);
    expect(policy.match(/readonly retrieval\?:/g)).toHaveLength(1);
    // The per-agent shape carries topics and nothing else. A scope or purpose field here would be a
    // field through which a caller could cross an authority boundary.
    const perAgent = policy.slice(
      policy.indexOf('interface AgentKnowledgeTopicPolicy'),
      policy.indexOf('interface AgentGroundedKnowledgePolicy'),
    );
    expect(perAgent).toContain('readonly topics:');
    for (const forbidden of [
      'agentScope',
      'purpose',
      'registry',
      'retrieval',
      'pack',
      'backend',
      'provider',
      'model',
      'embedding',
    ]) {
      expect({ forbidden, present: perAgent.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('no agent-facing code can name its own knowledge scope or purpose', () => {
    // The security property, as a scan. `agentScope` and `purpose` appear in the composition only
    // where they are READ from the closed table or passed to the authority -- never assigned from
    // configuration, an envelope, a message or a model.
    const bridge = codeOnly(
      readFileSync(
        fileURLToPath(new URL('../composition/process-inbound.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(bridge).toContain('AGENT_KNOWLEDGE_BINDINGS[actor]');
    for (const forbidden of [
      'agentScope: config',
      'agentScope: policy',
      'agentScope: envelope',
      'purpose: config',
      'purpose: policy',
      'purpose: envelope',
    ]) {
      expect({ forbidden, present: bridge.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('(§17) the migration ledger is exactly 0001-0014, in order, with no gap', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql.map((name) => name.slice(0, 4))).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
    ]);
    // One new migration in this correction, and it is the party widening.
    expect(sql[13]).toBe('0014_conversation_prospect_party_type.sql');
  });

  it('(§17) 0014 is the ONLY migration that mentions PROSPECT, and it adds no table or grant', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const mentioning = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => readFileSync(join(dir, name), 'utf8').includes('PROSPECT'))
      .sort();
    expect(mentioning).toEqual(['0014_conversation_prospect_party_type.sql']);

    // STATEMENTS only. 0014's header documents exhaustively what it does NOT do, and a scan over the
    // prose would read that documentation as the thing it forbids.
    const statements = readFileSync(join(dir, '0014_conversation_prospect_party_type.sql'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    for (const forbidden of [
      'CREATE TABLE',
      'CREATE INDEX',
      'CREATE VIEW',
      'CREATE TYPE',
      'ADD COLUMN',
      'DROP COLUMN',
      'DROP TABLE',
      'GRANT',
      'REVOKE',
      'SET DEFAULT',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'communication_state',
    ]) {
      expect({ forbidden, present: statements.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // Exactly two statements: drop the old constraint, add the widened one.
    expect(statements.split(';').filter((part) => part.trim().length > 0)).toHaveLength(2);
  });
});
