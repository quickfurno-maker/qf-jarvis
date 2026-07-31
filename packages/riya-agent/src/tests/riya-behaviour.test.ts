/**
 * QFJ-S3-C — Riya client-sales behaviour (ADR-0067).
 *
 * The matrix that matters: Riya is fixed to RIYA/CLIENT and refuses everything else BEFORE any model
 * could be reached; every action-like result goes through the merged proposal boundary and stays
 * `PENDING_CORE_VALIDATION`; and nothing executable, no prompt text and no provider detail can leave
 * this package.
 *
 * Every test is offline and deterministic. There is no model, no port, no network, no filesystem, no
 * environment read — this package has no code path to any of them.
 */
import {
  AgentRuntimeError,
  PROPOSAL_AUTHORITY_STATUS,
  RUNTIME_ACTORS,
  RUNTIME_PARTY_TYPES,
  RUNTIME_PROPOSAL_KINDS,
  RUNTIME_REASONS,
  createProposal,
  isActorPartyCompatible,
} from '@qf-jarvis/agent-runtime';
import type { RuntimeActor, RuntimePartyType } from '@qf-jarvis/agent-runtime';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CLIENT_SALES_INTENTS_FROZEN,
  RIYA_BEHAVIOUR_VERSION,
  classifyClientSalesIntent,
  isClientSalesSignals,
} from '../contracts/sales-intent.js';
import type { ClientSalesSignals } from '../contracts/sales-intent.js';
import {
  DISCOVERY_COMPLETENESS_FROZEN,
  DISCOVERY_FIELDS_FROZEN,
  createNeedDiscovery,
} from '../contracts/need-discovery.js';
import type { NeedDiscoveryInput } from '../contracts/need-discovery.js';
import { RiyaBehaviourError } from '../contracts/errors.js';
import {
  RIYA_ACTOR,
  RIYA_DISPOSITIONS_FROZEN,
  RIYA_SUPPORTED_PARTY,
  decideRiyaTurn,
} from '../behaviour/decide-riya-turn.js';
import type { RiyaTurnInput } from '../behaviour/decide-riya-turn.js';
import {
  RIYA_PROPOSAL_INTENTS_FROZEN,
  createRiyaProposal,
  proposalKindFor,
} from '../behaviour/riya-proposals.js';

const PROMPT_REF = 'prompt.riya.sales.v1';

const signals = (over: Partial<ClientSalesSignals> = {}): ClientSalesSignals => ({
  hasPriorSalesContext: false,
  requestedHumanAssistance: false,
  requestedQuoteOrConsultation: false,
  providedRequirementDetail: false,
  askedAboutReadiness: false,
  outOfSalesScope: false,
  missingDiscoveryFieldCount: 0,
  ...over,
});

const turn = (over: Partial<RiyaTurnInput> = {}): RiyaTurnInput => ({
  partyType: 'CLIENT',
  signals: signals(),
  promptRef: PROMPT_REF,
  humanTakeover: false,
  aiPaused: false,
  ...over,
});

const discovery = (over: Partial<NeedDiscoveryInput> = {}) =>
  createNeedDiscovery({ completeness: 'SUFFICIENT_FOR_CORE_REVIEW', ...over });

describe('(1-5) identity, version and role boundary', () => {
  it('(1, 2) behaviour version is 1 and the actor is fixed to RIYA', () => {
    expect(RIYA_BEHAVIOUR_VERSION).toBe(1);
    expect(RIYA_ACTOR).toBe('RIYA');
    expect(RIYA_SUPPORTED_PARTY).toBe('CLIENT');
    const d = decideRiyaTurn(turn());
    expect(d.actor).toBe('RIYA');
    expect(d.behaviourVersion).toBe(1);
    // The actor is not a field a caller can set: it is absent from the input type entirely.
    expect(Object.keys(turn())).not.toContain('actor');
  });

  it('(3) a CLIENT turn is accepted', () => {
    const d = decideRiyaTurn(turn({ signals: signals({ providedRequirementDetail: true }) }));
    expect(d.disposition).toBe('DRAFT_REPLY');
    expect(d.modelReplyEligible).toBe(true);
  });

  it('(4) a VENDOR turn is refused, and is refused as a SCOPE violation', () => {
    const d = decideRiyaTurn(turn({ partyType: 'VENDOR' }));
    expect(d.disposition).toBe('REFUSE');
    expect(d.reason).toBe('runtime-scope-violation');
    // The decisive property: no model may be reached for a vendor turn.
    expect(d.modelReplyEligible).toBe(false);
  });

  it('(5) UNKNOWN is not Riya work — it defers to the merged Jarvis/Human policy', () => {
    const d = decideRiyaTurn(turn({ partyType: 'UNKNOWN' }));
    expect(d.disposition).toBe('REFUSE');
    expect(d.reason).toBe('runtime-scope-violation');
    expect(d.modelReplyEligible).toBe(false);
    // Riya does not decide where UNKNOWN goes; `assignAgent` already owns that.
    expect(isActorPartyCompatible('RIYA', 'UNKNOWN')).toBe(false);
  });

  it('another AI agent owning the turn, or a HUMAN/SYSTEM owner, is refused', () => {
    for (const currentActor of ['ANISHA', 'JARVIS'] as const) {
      const d = decideRiyaTurn(turn({ currentActor }));
      expect(d.disposition).toBe('REFUSE');
      expect(d.reason).toBe('runtime-scope-violation');
      expect(d.modelReplyEligible).toBe(false);
    }
    for (const currentActor of ['HUMAN', 'SYSTEM'] as const) {
      const d = decideRiyaTurn(turn({ currentActor }));
      expect(d.disposition).toBe('REFUSE');
      expect(d.reason).toBe('runtime-human-takeover');
      expect(d.modelReplyEligible).toBe(false);
    }
  });
});

describe('(6-13) the closed sales-intent vocabulary', () => {
  it('(6) the vocabulary is exactly eight frozen values', () => {
    expect(CLIENT_SALES_INTENTS_FROZEN).toHaveLength(8);
    expect(Object.isFrozen(CLIENT_SALES_INTENTS_FROZEN)).toBe(true);
    expect([...CLIENT_SALES_INTENTS_FROZEN]).toEqual([
      'INITIAL_SERVICE_DISCOVERY',
      'REQUIREMENT_DISCOVERY',
      'QUOTE_OR_CONSULTATION_INTEREST',
      'SALES_FOLLOW_UP',
      'PROJECT_READINESS_CLARIFICATION',
      'HUMAN_SALES_ASSISTANCE_REQUEST',
      'UNSUPPORTED_NON_SALES_REQUEST',
      'INSUFFICIENT_CONTEXT',
    ]);
  });

  it('(7-11) each intent is reachable from closed signals', () => {
    expect(classifyClientSalesIntent(signals())).toBe('INITIAL_SERVICE_DISCOVERY');
    expect(classifyClientSalesIntent(signals({ providedRequirementDetail: true }))).toBe(
      'REQUIREMENT_DISCOVERY',
    );
    expect(classifyClientSalesIntent(signals({ requestedQuoteOrConsultation: true }))).toBe(
      'QUOTE_OR_CONSULTATION_INTEREST',
    );
    expect(classifyClientSalesIntent(signals({ hasPriorSalesContext: true }))).toBe(
      'SALES_FOLLOW_UP',
    );
    expect(classifyClientSalesIntent(signals({ askedAboutReadiness: true }))).toBe(
      'PROJECT_READINESS_CLARIFICATION',
    );
    expect(classifyClientSalesIntent(signals({ requestedHumanAssistance: true }))).toBe(
      'HUMAN_SALES_ASSISTANCE_REQUEST',
    );
  });

  it('(12, 13) out-of-scope and insufficient context are handled, not guessed', () => {
    expect(classifyClientSalesIntent(signals({ outOfSalesScope: true }))).toBe(
      'UNSUPPORTED_NON_SALES_REQUEST',
    );
    expect(classifyClientSalesIntent(signals({ missingDiscoveryFieldCount: 3 }))).toBe(
      'INSUFFICIENT_CONTEXT',
    );
  });

  it('safety outranks commerce: a human request beats every commercial signal', () => {
    const loud = signals({
      requestedHumanAssistance: true,
      requestedQuoteOrConsultation: true,
      hasPriorSalesContext: true,
      providedRequirementDetail: true,
      askedAboutReadiness: true,
    });
    expect(classifyClientSalesIntent(loud)).toBe('HUMAN_SALES_ASSISTANCE_REQUEST');
    expect(classifyClientSalesIntent({ ...loud, outOfSalesScope: true })).toBe(
      'UNSUPPORTED_NON_SALES_REQUEST',
    );
  });

  it('there is no confidence or score field anywhere in the signals or the decision', () => {
    const d = decideRiyaTurn(turn());
    for (const forbidden of ['confidence', 'score', 'probability', 'certainty']) {
      expect(Object.keys(signals())).not.toContain(forbidden);
      expect(Object.keys(d)).not.toContain(forbidden);
    }
    expect(isClientSalesSignals(signals())).toBe(true);
    expect(isClientSalesSignals({ ...signals(), confidence: 0.9 })).toBe(false);
  });
});

describe('(14-18) the need-discovery contract', () => {
  it('(15) the completeness states are exactly three and frozen', () => {
    expect([...DISCOVERY_COMPLETENESS_FROZEN]).toEqual([
      'SUFFICIENT_FOR_CORE_REVIEW',
      'MORE_DISCOVERY_REQUIRED',
      'HUMAN_REVIEW_REQUIRED',
    ]);
    expect(Object.isFrozen(DISCOVERY_COMPLETENESS_FROZEN)).toBe(true);
  });

  it('(14) every reference and note is bounded', () => {
    expect(() => discovery({ serviceInterestRef: 'a'.repeat(65) })).toThrow(RiyaBehaviourError);
    expect(() => discovery({ scopeSummary: 'x'.repeat(501) })).toThrow(RiyaBehaviourError);
    expect(() => discovery({ budgetNote: 'x'.repeat(121) })).toThrow(RiyaBehaviourError);
    expect(() => discovery({ locationRef: 'has space' })).toThrow(RiyaBehaviourError);
    expect(() => discovery({ locationRef: '19.0760,72.8777' })).toThrow(RiyaBehaviourError);
    expect(() => discovery({ propertyTypeRef: 'https://example.test/x' })).toThrow(
      RiyaBehaviourError,
    );
  });

  it('(16) the missing-field list is closed, deduplicated and consistent with completeness', () => {
    expect([...DISCOVERY_FIELDS_FROZEN]).toHaveLength(7);
    expect(() =>
      createNeedDiscovery({
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: ['unknownField'] as never,
      }),
    ).toThrow(RiyaBehaviourError);
    expect(() =>
      createNeedDiscovery({
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: ['budget', 'budget'],
      }),
    ).toThrow(RiyaBehaviourError);
    // Claiming Core-ready while fields are missing is the one combination that would be a lie.
    expect(() =>
      createNeedDiscovery({
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        missingFields: ['budget'],
      }),
    ).toThrow(RiyaBehaviourError);
    const ok = createNeedDiscovery({
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: ['budget', 'timeline'],
    });
    expect(ok.missingFields).toEqual(['budget', 'timeline']);
    expect(Object.isFrozen(ok)).toBe(true);
  });

  it('(17, 18) no metadata bag, and no contact or precise-location duplication', () => {
    const d = discovery({ serviceInterestRef: 'svc.modular-kitchen' });
    expect(Object.keys(d).sort()).toEqual([
      'behaviourVersion',
      'budgetNote',
      'completeness',
      'consultationPreferenceRef',
      'locationRef',
      'missingFields',
      'propertyTypeRef',
      'scopeSummary',
      'serviceInterestRef',
      'timelineNote',
    ]);
    for (const forbidden of [
      'metadata',
      'phone',
      'phoneNumber',
      'email',
      'contact',
      'latitude',
      'longitude',
      'coordinates',
      'address',
      'clientName',
    ]) {
      expect(() => discovery({ [forbidden]: 'x' })).toThrow(RiyaBehaviourError);
      expect(Object.keys(d)).not.toContain(forbidden);
    }
  });
});

describe('(19-24) decisions, dispositions and proposal semantics', () => {
  it('the disposition vocabulary is exactly five frozen values', () => {
    expect([...RIYA_DISPOSITIONS_FROZEN]).toEqual([
      'DRAFT_REPLY',
      'CONTINUE_DISCOVERY',
      'PROPOSE_SALES_FOLLOW_UP',
      'REQUEST_HUMAN_SALES_CONTACT',
      'REFUSE',
    ]);
    expect(Object.isFrozen(RIYA_DISPOSITIONS_FROZEN)).toBe(true);
  });

  it('(19) a discovery turn plans a reply; an incomplete quote turn continues discovery', () => {
    const draft = decideRiyaTurn(turn({ signals: signals({ providedRequirementDetail: true }) }));
    expect(draft.disposition).toBe('DRAFT_REPLY');

    const incomplete = decideRiyaTurn(
      turn({
        signals: signals({ requestedQuoteOrConsultation: true }),
        needDiscovery: createNeedDiscovery({
          completeness: 'MORE_DISCOVERY_REQUIRED',
          missingFields: ['budget'],
        }),
      }),
    );
    // A lead is never manufactured from guesses.
    expect(incomplete.disposition).toBe('CONTINUE_DISCOVERY');
  });

  it('(20) a Core-ready quote or follow-up requests a follow-up proposal', () => {
    for (const s of [
      signals({ requestedQuoteOrConsultation: true }),
      signals({ hasPriorSalesContext: true }),
    ]) {
      const d = decideRiyaTurn(turn({ signals: s, needDiscovery: discovery() }));
      expect(d.disposition).toBe('PROPOSE_SALES_FOLLOW_UP');
    }
  });

  it('(21) human assistance and human-review discovery both request a human', () => {
    expect(
      decideRiyaTurn(turn({ signals: signals({ requestedHumanAssistance: true }) })).disposition,
    ).toBe('REQUEST_HUMAN_SALES_CONTACT');
    const review = decideRiyaTurn(
      turn({
        signals: signals({ providedRequirementDetail: true }),
        needDiscovery: createNeedDiscovery({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      }),
    );
    expect(review.disposition).toBe('REQUEST_HUMAN_SALES_CONTACT');
    expect(review.modelReplyEligible).toBe(false);
  });

  it('(22) every Riya proposal stays PENDING_CORE_VALIDATION', () => {
    for (const proposalIntent of RIYA_PROPOSAL_INTENTS_FROZEN) {
      const p = createRiyaProposal({
        proposalIntent,
        proposalId: 'prop.1',
        proposalVersion: 1,
        conversationId: 'conv.1',
      });
      expect(p.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
      expect(p.authorityStatus).toBe('PENDING_CORE_VALIDATION');
      expect(p.actor).toBe('RIYA');
      expect(p.partyType).toBe('CLIENT');
      expect(Object.isFrozen(p)).toBe(true);
    }
  });

  it('(23) a proposal has no field an executable instruction could occupy', () => {
    const p = createRiyaProposal({
      proposalIntent: 'SALES_FOLLOW_UP',
      proposalId: 'prop.1',
      proposalVersion: 1,
      conversationId: 'conv.1',
    });
    expect(Object.keys(p).sort()).toEqual([
      'actor',
      'authorityStatus',
      'conversationId',
      'kind',
      'partyType',
      'proposalId',
      'proposalVersion',
    ]);
    const serialised = JSON.stringify(p);
    for (const forbidden of [
      'executor',
      'webhook',
      'workflowId',
      'http',
      'SELECT',
      'INSERT',
      'command',
      'credential',
      'apiKey',
      'send',
      'authorize',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    for (const method of ['execute', 'send', 'authorize', 'callN8n']) {
      expect((p as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  });

  it('the proposal mapping reuses existing generic kinds and adds none', () => {
    expect(proposalKindFor('SALES_FOLLOW_UP')).toBe('FOLLOW_UP');
    expect(proposalKindFor('HUMAN_SALES_CONTACT')).toBe('ESCALATION');
    for (const intent of RIYA_PROPOSAL_INTENTS_FROZEN) {
      expect(RUNTIME_PROPOSAL_KINDS).toContain(proposalKindFor(intent));
    }
    // The merged vocabulary was not grown by this package.
    expect(RUNTIME_PROPOSAL_KINDS).toHaveLength(5);
  });

  it('(24) an invalid decision or proposal request is refused, never partially built', () => {
    expect(() => decideRiyaTurn({ ...turn(), promptRef: 'has space' })).toThrow(RiyaBehaviourError);
    expect(() => decideRiyaTurn({ ...turn(), extra: 1 } as RiyaTurnInput)).toThrow(
      RiyaBehaviourError,
    );
    expect(() =>
      createRiyaProposal({
        proposalIntent: 'SALES_FOLLOW_UP',
        proposalId: '',
        proposalVersion: 1,
        conversationId: 'conv.1',
      }),
    ).toThrow(RiyaBehaviourError);
    expect(() =>
      createRiyaProposal({
        proposalIntent: 'NOT_A_KIND' as never,
        proposalId: 'p.1',
        proposalVersion: 1,
        conversationId: 'conv.1',
      }),
    ).toThrow(RiyaBehaviourError);
  });
});

describe('(25-31) call budget: nothing here can reach a model', () => {
  it('(25, 26, 27) pause, takeover and role violation are all model-ineligible', () => {
    expect(decideRiyaTurn(turn({ aiPaused: true })).modelReplyEligible).toBe(false);
    expect(decideRiyaTurn(turn({ aiPaused: true })).reason).toBe('runtime-ai-paused');
    expect(decideRiyaTurn(turn({ humanTakeover: true })).modelReplyEligible).toBe(false);
    expect(decideRiyaTurn(turn({ humanTakeover: true })).reason).toBe('runtime-human-takeover');
    expect(decideRiyaTurn(turn({ partyType: 'VENDOR' })).modelReplyEligible).toBe(false);
  });

  it('pause outranks every commercial signal', () => {
    const d = decideRiyaTurn(
      turn({
        aiPaused: true,
        signals: signals({ requestedQuoteOrConsultation: true, hasPriorSalesContext: true }),
        needDiscovery: discovery(),
      }),
    );
    expect(d.disposition).toBe('REFUSE');
    expect(d.modelReplyEligible).toBe(false);
  });

  it('(28-31) this package invokes nothing - it has no port, no retry and no fallback', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !full.includes('tests')) {
          files.push(full);
        }
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10))
        .filter((line) => !/^\s*\/\//.test(line))
        .join(String.fromCharCode(10));
      for (const forbidden of [
        'ModelReplyPort',
        'model-reply-adapter',
        'model-gateway',
        'orchestrateInbound',
        'runAgentTurn',
        'fetch(',
        'node:fs',
        'node:http',
        'child_process',
        'process.env',
        'retry',
        'fallback',
        'console.',
        'groq',
        'gpt-oss',
        'whatsapp',
        'n8n',
      ]) {
        expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });
});

describe('(32-40) privacy, prompt boundary and no-execution', () => {
  it('(32, 33, 34, 35) no decision carries output, prompt text, provider detail or a credential', () => {
    const d = decideRiyaTurn(
      turn({
        signals: signals({ requestedQuoteOrConsultation: true }),
        needDiscovery: discovery(),
      }),
    );
    const serialised = JSON.stringify(d);
    for (const forbidden of [
      'modelOutput',
      'draft',
      'completion',
      'You are',
      'Bearer',
      'authorization',
      'credential',
      'apiKey',
      '.key',
      'http',
      '400',
      'stack',
      'cause',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    // Only the opaque reference survives — never text.
    expect(d.promptRef).toBe(PROMPT_REF);
    expect(serialised).toContain('prompt.riya.sales.v1');
    expect(d.promptRef.length).toBeLessThanOrEqual(128);
  });

  it('the promptRef is opaque, bounded and versioned — no text can be passed as one', () => {
    for (const bad of [
      '',
      'a'.repeat(129),
      'You are Riya, a helpful sales assistant.',
      'prompt with spaces',
      'https://prompts.example/riya',
    ]) {
      expect(() => decideRiyaTurn({ ...turn(), promptRef: bad })).toThrow(RiyaBehaviourError);
    }
  });

  it('(36-38) provenance inputs stay compatible with the merged, stamped envelope', () => {
    // This package supplies the actor and an opaque promptRef; `createRuntimeProvenance` stamps
    // authority and retention, and neither is settable from here.
    const d = decideRiyaTurn(turn());
    expect(d.actor).toBe('RIYA');
    expect(RUNTIME_ACTORS).toContain(d.actor);
    expect(Object.keys(d)).not.toContain('authority');
    expect(Object.keys(d)).not.toContain('modelOutputRetention');
  });

  it('(39) the decision is frozen and carries no executable instruction', () => {
    const d = decideRiyaTurn(turn());
    expect(Object.isFrozen(d)).toBe(true);
    for (const method of ['execute', 'send', 'persist', 'write', 'assign', 'schedule']) {
      expect((d as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  });

  it('every reason is a merged closed runtime reason — this package invents none', () => {
    const cases: RiyaTurnInput[] = [
      turn(),
      turn({ aiPaused: true }),
      turn({ humanTakeover: true }),
      turn({ partyType: 'VENDOR' }),
      turn({ signals: signals({ outOfSalesScope: true }) }),
      turn({ signals: signals({ requestedHumanAssistance: true }) }),
    ];
    for (const c of cases) {
      expect(RUNTIME_REASONS).toContain(decideRiyaTurn(c).reason);
    }
  });
});

describe('(40) the merged role invariants are unchanged by this package', () => {
  it('the full actor x party cross-product still matches the merged rule', () => {
    const expected: Record<RuntimeActor, readonly RuntimePartyType[]> = {
      RIYA: ['CLIENT'],
      ANISHA: ['VENDOR'],
      JARVIS: ['CLIENT', 'VENDOR', 'UNKNOWN'],
      HUMAN: ['CLIENT', 'VENDOR', 'UNKNOWN'],
      SYSTEM: ['CLIENT', 'VENDOR', 'UNKNOWN'],
    };
    for (const actor of RUNTIME_ACTORS) {
      for (const party of RUNTIME_PARTY_TYPES) {
        expect(`${actor}/${party}=${String(isActorPartyCompatible(actor, party))}`).toBe(
          `${actor}/${party}=${String(expected[actor].includes(party))}`,
        );
      }
    }
    expect([...RUNTIME_PARTY_TYPES]).toEqual(['CLIENT', 'VENDOR', 'UNKNOWN']);
  });

  it('the merged boundary independently refuses a RIYA proposal on a vendor conversation', () => {
    // Proved by calling the merged constructor directly: even if this package were refactored to
    // pass VENDOR, `createProposal` throws. The boundary does not depend on Riya behaving.
    expect(() =>
      createProposal({
        proposalId: 'p.1',
        proposalVersion: 1,
        kind: 'FOLLOW_UP',
        actor: 'RIYA',
        partyType: 'VENDOR',
        conversationId: 'conv.1',
      }),
    ).toThrow(AgentRuntimeError);
  });
});

describe('(44) the public API lock', () => {
  it('the root surface is exactly sixteen symbols, and none is provider- or transport-specific', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel).sort()).toEqual([
      'CLIENT_SALES_INTENTS_FROZEN',
      'DISCOVERY_COMPLETENESS_FROZEN',
      'DISCOVERY_FIELDS_FROZEN',
      'RIYA_ACTOR',
      'RIYA_BEHAVIOUR_VERSION',
      'RIYA_DISPOSITIONS_FROZEN',
      'RIYA_ERROR_CODES',
      'RIYA_PROPOSAL_INTENTS_FROZEN',
      'RIYA_SUPPORTED_PARTY',
      'RiyaBehaviourError',
      'classifyClientSalesIntent',
      'createNeedDiscovery',
      'createRiyaProposal',
      'decideRiyaTurn',
      'isClientSalesSignals',
      'proposalKindFor',
    ]);
    expect(Object.keys(barrel)).toHaveLength(16);
    for (const forbidden of ['groq', 'whatsapp', 'n8n', 'http', 'sql', 'gateway', 'prompttext']) {
      expect(Object.keys(barrel).filter((k) => k.toLowerCase().includes(forbidden))).toEqual([]);
    }
    // A PORT symbol, not merely the letters: `RIYA_SUPPORTED_PARTY` legitimately contains "port".
    expect(Object.keys(barrel).filter((k) => /Port$|^.*ModelReply/.test(k))).toEqual([]);
    // No default export, and no runtime mechanism was re-exported from here.
    expect((barrel as { default?: unknown }).default).toBeUndefined();
    for (const merged of ['createProposal', 'assignAgent', 'orchestrateInbound', 'runAgentTurn']) {
      expect(barrel[merged]).toBeUndefined();
    }
  });
});
