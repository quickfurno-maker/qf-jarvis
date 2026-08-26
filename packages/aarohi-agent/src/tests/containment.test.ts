/**
 * What this package cannot become.
 *
 * Aarohi's runtime status is PLANNED / DISABLED, and AVG-1 does not change that. The overlay's words
 * are "no Aarohi runtime, no outreach, no channel, no credential, and no Instagram, WhatsApp, n8n or
 * Meta integration in this repository". This slice adds a DOMAIN, and these specs are how that stays
 * true as the package grows.
 *
 * Scans read source with comments stripped, because this package documents at length the things it
 * refuses to be and scanning the prose would report every prohibition as a violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG5_CHANNEL,
  INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE,
  instagramOutboundCandidatePostureSchema,
} from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
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

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

describe('Aarohi remains a DOMAIN, not a runtime through AVG-5', () => {
  it('reaches no channel, provider, execution path or credential', () => {
    // ### Why these are SHAPES rather than bare words, from AVG-5 onward
    //
    // Through AVG-4 this list banned the substrings `instagram`, `meta`, `n8n` and `authorization`
    // outright, which worked because no file had cause to write them. AVG-5 does: its channel token
    // is `instagram`, and its outbound candidate declares `metaApiCalled: false`,
    // `n8nExecutionRequested: false` and `communicationAuthorizationCreated: false`.
    //
    // Those are DECLARATIONS OF ABSENCE. A scan that reads them as presence would force the public
    // contract to be renamed around a grep — making the contract less legible to keep a test quiet,
    // which is the wrong way round. So the ban is now on the shapes that would constitute actually
    // reaching a provider: a host, an endpoint, a client, a token, a header. The declarations are
    // separately asserted to be present and false further down, which is a stronger check than the
    // substring ever was.
    //
    // `whatsapp` stays a bare ban: AVG-5 must not do WhatsApp identity or handoff, and AVG-6 owns
    // that question.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'whatsapp',
        'linkedin',
        'twilio',
        'credential',
        'apikey',
        'api_key',
        'bearer',
        // Hosts and endpoints.
        'graph.facebook',
        'facebook.com',
        'instagram.com',
        'api.instagram',
        'webhook',
        // Clients, SDKs and callbacks.
        'instagramclient',
        'metaclient',
        'metagraph',
        'callmetaapi',
        'instagram-private-api',
        'n8nclient',
        'calln8n',
        'n8n_',
        // Secrets.
        'accesstoken',
        'appsecret',
        'authorizationheader',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      // No URL of any kind, anywhere. A domain package with a host in it is one edit from a call.
      expect(code, `${file} must not contain a URL`).not.toMatch(/https?:\/\//u);
    }
  });

  it('opens no network, reads no environment, touches no filesystem or database', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'node:fs',
        'node:http',
        'node:https',
        'node:net',
        'process.env',
        'process.argv',
        'postgres',
        'supabase',
        'axios',
        'undici',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      expect(code, `${file} must not call fetch`).not.toMatch(/[^a-zA-Z]fetch\(/u);
    }
  });

  it('names no send, execute, mutate or payment verb', () => {
    // A domain package that named one of these would be one edit away from performing it, and
    // approved execution goes Core/human -> n8n -> provider, never from here.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'sendMessage',
        'dispatch(',
        'executeAction',
        'processPayment',
        'createVendor',
        'updateVendor',
        'registerVendor',
        'activateVendor',
        'purchasePackage',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('declares the AVG-5 non-effects as literal falsehoods, not as prose', () => {
    // The replacement for the substring ban above, and a much better proof: the tokens a reader
    // might worry about appear in exactly one place, and in that place they are pinned to `false`.
    const posture = INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE as unknown as Readonly<
      Record<string, unknown>
    >;
    for (const declared of [
      'communicationRequestCreated',
      'approvalRequestCreated',
      'approvalDecisionCreated',
      'communicationAuthorizationCreated',
      'executionIntentCreated',
      'n8nExecutionRequested',
      'metaApiCalled',
      'providerSendRequested',
      'sent',
      'delivered',
      'businessEffect',
      'productionMutation',
    ]) {
      expect(posture[declared], declared).toBe(false);
    }
    expect(posture['candidateOnly']).toBe(true);
    expect(posture['requiresCoreExecutionTimeRevalidation']).toBe(true);
    // And the schema refuses a posture that said otherwise, so the value above is not merely the one
    // this package happens to build.
    expect(
      instagramOutboundCandidatePostureSchema.safeParse({ ...posture, sent: true }).success,
    ).toBe(false);
  });

  it('names Instagram ONLY as an Aarohi-local conversation token', () => {
    // The local literal exists. What must not exist is a second, executable meaning for it, and the
    // shared vocabulary is checked directly rather than described.
    expect(AAROHI_AVG5_CHANNEL).toBe('instagram');
    const shared = readFileSync(
      join(REPO_ROOT, 'packages', 'contracts', 'src', 'communications', 'communication-channel.ts'),
      'utf8',
    );
    const declared = /COMMUNICATION_CHANNELS = \[([^\]]*)\]/u.exec(shared)?.[1] ?? '';
    expect(declared).toContain("'whatsapp'");
    expect(declared).toContain("'sms'");
    expect(declared).toContain("'email'");
    expect(declared).toContain("'voice'");
    expect(declared).not.toContain('instagram');
  });

  it('generates nothing and prices nothing', () => {
    // AVG-7 owns the sales brain and AVG-8 owns commercial truth. AVG-5 normalizes inbound text and
    // carries an AVG-4 draft's words; it must not acquire a reply generator or a price on the way.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'modelgateway',
        'modelreply',
        'generatereply',
        'draftreply',
        'completion',
        'groq',
        'mastra',
        'openai',
        'anthropic',
        'embedding',
        'price',
        'pricing',
        'discount',
        'entitlement',
        'invoice',
        'razorpay',
        'checkout',
        'quota',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('persists nothing — there is no store, repository or migration', () => {
    // Durable acquisition-case storage is not governed at implementation level yet, so contracts
    // only and storage stays out.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'Repository',
        'createStore',
        'migration',
        'INSERT INTO',
        'UPDATE ',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('it duplicates no shared Jarvis infrastructure', () => {
  it('composes no gateway, backbone, memory, runtime or provider abstraction', () => {
    // Deliberately asserted by CONSTRUCTOR name rather than by listing workspace specifiers.
    //
    // Spelling `@qf-jarvis/<package>` literally here would make this file look like an importer to
    // the sibling containment specs that scan the whole repository for their own specifier — which
    // is a false positive I would then have to weaken THEIR lock to accommodate. The total
    // `@qf-jarvis/` ban below is strictly stronger than any enumeration anyway.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'createModelGateway',
        'createModelReplyAdapter',
        'createEventBackbone',
        'createJarvisRuntime',
        'retrieveGovernedKnowledge',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('depends on zod alone, and the dependency graph stays acyclic by having no edges', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    // No workspace dependency at all: AVG-1 is a pure domain. The absence IS the containment.
    expect(Object.keys(manifest.dependencies ?? {})).toStrictEqual(['zod']);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
  });

  it('imports no @qf-jarvis package whatsoever', () => {
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not import a workspace package`).not.toContain(
        ['@qf-jarvis', ''].join('/'),
      );
    }
  });

  it('does not touch the Anisha or Riya packages', () => {
    // Aarohi and Anisha are separate and always will be (ADR-0085). The arrow points nowhere.
    // The specifier is assembled rather than written, for the false-positive reason above.
    const scope = ['@qf-jarvis', ''].join('/');
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['anisha', 'riya']) {
        expect(code.toLowerCase(), `${file} must not import ${forbidden}`).not.toContain(
          `${scope}${forbidden}`,
        );
      }
    }
  });
});

describe('the public API is locked and nothing composes this leaf yet', () => {
  it('exports exactly the reviewed surface', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    // An exact set match, so a symbol cannot join the public surface without a decision.
    // AVG-2 adds enrichment review material; AVG-3 adds deterministic priority and the Core
    // contact gate; AVG-4 adds inert review/draft/readiness contracts; AVG-5 adds the offline
    // Instagram conversation domain. Every addition remains a closed vocabulary, bound, schema or
    // pure function; nothing here sends or executes.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'AAROHI_AGENT_ID',
      'AAROHI_AVG3_CONTRACT_VERSION',
      'AAROHI_AVG4_CONTRACT_VERSION',
      'AAROHI_AVG5_CHANNEL',
      'AAROHI_AVG5_CONTRACT_VERSION',
      'AAROHI_ENRICHMENT_CONTRACT_VERSION',
      'AAROHI_PROSPECT_CONTRACT_VERSION',
      'ACQUISITION_CASE_STATES',
      'ACQUISITION_CASE_TRANSITIONS',
      'ACQUISITION_REFUSAL_REASONS',
      'ACTIVATION_AUTHORITIES',
      'BLOCKED_CORE_STATUSES',
      'CASE_TRANSITION_REFUSALS',
      'CONTACT_ELIGIBILITY_OUTCOME',
      'CONTACT_ELIGIBILITY_REFUSALS',
      'CORE_PARTY_STATUSES',
      'CORE_STATUS_ROLE',
      'CORE_STATUS_ROLES',
      'ELIGIBLE_CORE_STATUSES',
      'ENRICHMENT_ATTRIBUTES',
      'ENRICHMENT_ATTRIBUTE_VALUE_KIND',
      'ENRICHMENT_CLAIM_REFUSALS',
      'ENRICHMENT_CONSISTENCY_VERDICTS',
      'ENRICHMENT_EVIDENCE_QUALITIES',
      'ENRICHMENT_PROFILE_REFUSALS',
      'ENRICHMENT_REVIEW_OUTCOME',
      'ENRICHMENT_REVIEW_REFUSALS',
      'ENRICHMENT_SOURCE_KINDS',
      'ENRICHMENT_VALUE_KINDS',
      'HANDOFF_REFUSAL_REASONS',
      'HANDOFF_REJECTED_AUTHORITIES',
      'HANDOFF_TRUSTED_AUTHORITY',
      'INSTAGRAM_BINDING_POSTURE',
      'INSTAGRAM_CONTINUATION_OUTCOMES',
      'INSTAGRAM_CONVERSATION_REFUSALS',
      'INSTAGRAM_OBSERVATION_REFUSALS',
      'INSTAGRAM_OBSERVATION_SOURCE_POSTURE',
      'INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME',
      'INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE',
      'INSTAGRAM_OUTBOUND_CANDIDATE_REFUSALS',
      'INSTAGRAM_TURN_DIRECTIONS',
      'MAX_ENRICHMENT_LABEL_LENGTH',
      'MAX_ENRICHMENT_PROFILE_CLAIMS',
      'MAX_INSTAGRAM_CONVERSATION_TURNS',
      'MAX_INSTAGRAM_MESSAGE_LENGTH',
      'MAX_WORKSPACE_DRAFT_LENGTH',
      'PRESENCE_SIGNALS',
      'PROSPECT_DISCOVERY_SOURCES',
      'PROSPECT_PRIORITY_MAX_POINTS',
      'PROSPECT_PRIORITY_REFUSALS',
      'TERMINAL_ACQUISITION_CASE_STATES',
      'WORKSPACE_APPROVAL_READINESS_OUTCOME',
      'WORKSPACE_APPROVAL_READINESS_REFUSALS',
      'WORKSPACE_DRAFT_REFUSALS',
      'WORKSPACE_DRAFT_STATES',
      'acquisitionCaseSchema',
      'activationAttestationSchema',
      'appendInstagramInboundObservation',
      'buildWorkspaceReviewItem',
      'canTransition',
      'completeCoreActiveHandoff',
      'coreEligibilityObservationSchema',
      'createEnrichmentClaim',
      'createEnrichmentProfile',
      'createInstagramConversation',
      'createProspectIdentity',
      'createWorkspaceDraft',
      'enrichmentClaimIdentity',
      'enrichmentClaimSchema',
      'enrichmentProfileSchema',
      'enrichmentSourceSchema',
      'evaluateAcquisitionContactEligibility',
      'evaluateAcquisitionEligibility',
      'evaluateEnrichmentReviewReadiness',
      'evaluateInstagramAcquisitionContinuation',
      'evaluateProspectPriority',
      'evaluateWorkspaceApprovalReadiness',
      'instagramConversationSnapshotSchema',
      'instagramInboundObservationSchema',
      'instagramOutboundCandidatePostureSchema',
      'instagramOutboundCandidateSchema',
      'isTerminalAcquisitionCaseState',
      'openAcquisitionCase',
      'parseEnrichmentClaim',
      'parseEnrichmentProfile',
      'parseInstagramConversation',
      'parseInstagramInboundObservation',
      'parseWorkspaceDraft',
      'prepareInstagramOutboundCandidate',
      'prospectIdentitySchema',
      'reviseWorkspaceDraft',
      'summariseEnrichmentConsistency',
      'transitionAcquisitionCase',
      'transitionWorkspaceDraft',
      'workspaceDraftSchema',
    ]);
  });

  it('NO package or app imports it', () => {
    // Aarohi has no runtime. Asserted so the first consumer is a deliberate decision.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'aarohi-agent') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/aarohi-agent')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });
});
