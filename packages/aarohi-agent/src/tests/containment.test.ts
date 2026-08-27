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
  AAROHI_SALES_BRAIN_POSTURE,
  IDENTITY_LINK_POSTURE,
  INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE,
  WHATSAPP_CHANNEL_HANDOFF_POSTURE,
  identityLinkPostureSchema,
  instagramOutboundCandidatePostureSchema,
  salesBrainPostureSchema,
  whatsappChannelHandoffPostureSchema,
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

describe('Aarohi remains a DOMAIN, not a runtime through AVG-7', () => {
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
    // AVG-6 is the same story again, for the same reason. It models the Instagram-to-WhatsApp
    // channel transition, so it writes `whatsapp` -- as an identity channel token, as
    // `whatsappParticipantRef`, and as `whatsappSendRequested: false`. The last of those is another
    // declaration of absence, and the same argument applies: the ban moves to the shapes that would
    // constitute reaching WhatsApp, and the declaration is asserted false further down.
    //
    // What is NOT relaxed is the destination screen. A WhatsApp participant reference is checked
    // against the same contact shapes AVG-2 uses, so a phone number cannot enter the package under
    // any name -- which is the thing the bare `whatsapp` ban was really standing in for.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
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
        'whatsappclient',
        'sendwhatsapp',
        'whatsapp-web',
        'whatsapp-business',
        'wa.me',
        'whatsapp.com',
        'n8nclient',
        'calln8n',
        'n8n_',
        // Secrets and provider account identity.
        'accesstoken',
        'appsecret',
        'authorizationheader',
        'wabaid',
        'waba_id',
        'phonenumberid',
        'phone_number_id',
        // Destinations, under any name. AVG-6 stores an opaque channel-local handle and nothing
        // that could be dialled or delivered to.
        'phonenumber',
        'phone_number',
        'e164',
        'msisdn',
        'dialablenumber',
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
      // And no SQL, in any direction. Banning the database CLIENTS above leaves the statements
      // themselves, and a `CREATE TABLE` sitting in a pure domain package is one import away from
      // being run by something that does have a connection.
      for (const statement of [
        'create table',
        'alter table',
        'drop table',
        'create index',
        'insert into',
        'update set',
        'delete from',
        'primary key',
        'migration',
        '.sql',
      ]) {
        expect(code.toLowerCase(), `${file} must not contain ${statement}`).not.toContain(
          statement,
        );
      }
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

  it('declares the AVG-6 non-effects as literal falsehoods, not as prose', () => {
    // Identity is the one a reader should check first. There is no field anywhere that could say a
    // merge happened, and the two that a careless refactor might add are pinned false here.
    const link = IDENTITY_LINK_POSTURE as unknown as Readonly<Record<string, unknown>>;
    for (const declared of [
      'identityMerged',
      'coreIdentityMutated',
      'identityVerified',
      'consentEstablished',
      'communicationAuthorized',
    ]) {
      expect(link[declared], declared).toBe(false);
    }
    expect(link['recommendationOnly']).toBe(true);
    expect(identityLinkPostureSchema.safeParse({ ...link, identityMerged: true }).success).toBe(
      false,
    );

    const handoff = WHATSAPP_CHANNEL_HANDOFF_POSTURE as unknown as Readonly<
      Record<string, unknown>
    >;
    for (const declared of [
      'identityMergeExecuted',
      'coreIdentityMutated',
      'recipientResolvedByCore',
      'consentEstablished',
      'communicationRequestCreated',
      'approvalRequestCreated',
      'approvalDecisionCreated',
      'communicationAuthorizationCreated',
      'executionIntentCreated',
      'n8nExecutionRequested',
      'providerSendRequested',
      'whatsappSendRequested',
      'sent',
      'delivered',
      // The two that separate a CHANNEL transition from the Anisha OWNERSHIP handoff.
      'acquisitionCaseMutated',
      'anishaHandoffExecuted',
      'productionMutation',
      'businessEffect',
    ]) {
      expect(handoff[declared], declared).toBe(false);
    }
    for (const required of [
      'candidateOnly',
      'identityRecommendationOnly',
      'requiresCoreRecipientResolution',
      'requiresCoreConsentRevalidation',
      'requiresCoreExecutionTimeEligibilityRevalidation',
    ]) {
      expect(handoff[required], required).toBe(true);
    }
    expect(
      whatsappChannelHandoffPostureSchema.safeParse({ ...handoff, whatsappSendRequested: true })
        .success,
    ).toBe(false);
    expect(
      whatsappChannelHandoffPostureSchema.safeParse({
        ...handoff,
        requiresCoreConsentRevalidation: false,
      }).success,
    ).toBe(false);
  });

  it('reaches neither the model waist nor the prompt waist, and retrieves nothing', () => {
    // AVG-7 is called a SALES BRAIN, which is the name most likely to attract a model client. The
    // repository already has the governed places for that: `@qf-jarvis/model-gateway` is the single
    // model waist and `@qf-jarvis/prompt-registry` the governed prompt mechanism. A future
    // composition goes through both. This package reaches neither, and holds no prompt text of its
    // own -- a prompt string here would be un-governed content in a package with no governance for
    // content.
    //
    // Retrieval is banned for a different reason. RAG output is not commercial authority, and
    // commercial truth is AVG-8's; a retrieval hook in a sales brain is the shortest path from
    // "something was written down once" to "Aarohi quoted it".
    const scope = ['@qf-jarvis', ''].join('/');
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        `${scope}model-gateway`,
        `${scope}model-gateway-composition`,
        `${scope}model-reply-adapter`,
        `${scope}prompt-registry`,
        '@mastra',
        'groq',
        'openai',
        'anthropic',
        'ModelReplyPort',
        'modelClient',
        'callModel',
        'completions',
        'renderPrompt',
        'resolvePrompt',
        'promptTemplate',
        'systemPrompt',
        'embedding',
        'vectorstore',
        'vector_store',
        'retrievegoverned',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('declares the AVG-7 sales-ethics prohibitions as literal falsehoods, not as prose', () => {
    // The roadmap says AVG-7 is bounded by the same sales-ethics prohibitions as Anisha. Prose in a
    // file nobody re-reads is not a bound; these are.
    const brain = AAROHI_SALES_BRAIN_POSTURE as unknown as Readonly<Record<string, unknown>>;
    for (const declared of [
      // Commercial commitment, which is Core's and AVG-8's.
      'commercialCommitmentCreated',
      'commercialTruthOriginatedByBrain',
      'priceOriginatedByBrain',
      'discountOriginatedByBrain',
      // The four a fluent system offers without being asked.
      'guaranteeLeadVolume',
      'guaranteeRevenue',
      'guaranteeConversion',
      'contractualCommitmentCreated',
      // The three pressure tactics.
      'inventedUrgency',
      'inventedScarcity',
      'unsupportedSocialProof',
      // Authority that belongs to Core, in every direction.
      'consentEstablished',
      'suppressionMutated',
      'identityMutated',
      'registrationMutated',
      'paymentMutated',
      'activationMutated',
      'acquisitionCaseMutated',
      'anishaHandoffExecuted',
      // The governed execution chain, none of which starts here.
      'communicationRequestCreated',
      'approvalRequestCreated',
      'approvalDecisionCreated',
      'communicationAuthorizationCreated',
      'executionIntentCreated',
      'n8nExecutionRequested',
      'providerSendRequested',
      'channelSendRequested',
      'sent',
      'delivered',
      // The model waist, the prompt waist and retrieval.
      'modelCallExecuted',
      'promptResolved',
      'retrievalExecuted',
      'productionMutation',
      'businessEffect',
    ]) {
      expect(brain[declared], declared).toBe(false);
    }
    expect(brain['planOnly']).toBe(true);
    for (const forged of [
      { modelCallExecuted: true },
      { priceOriginatedByBrain: true },
      { guaranteeLeadVolume: true },
      { consentEstablished: true },
      { anishaHandoffExecuted: true },
      { planOnly: false },
    ]) {
      expect(
        salesBrainPostureSchema.safeParse({ ...brain, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('keeps AVG-7 clear of acquisition ownership and of every downstream builder', () => {
    const avg7 = codeOnly(readFileSync(join(SRC, 'contracts', 'avg7-sales-brain.ts'), 'utf8'));
    for (const forbidden of [
      'completeCoreActiveHandoff',
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'CONTACT_APPROVED',
      'activationAttestation',
      // The three builders a "sales brain" would be tempted to call next. Composition is a later,
      // separately reviewed decision; AVG-4 already owns the outreach workspace.
      'createOutreachDraft',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
    ]) {
      expect(avg7, `AVG-7 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('never reaches the OTHER handoff — Aarohi ownership stays where it was', () => {
    // `completeCoreActiveHandoff` is the only route to Anisha ownership and it requires a Core
    // ACTIVE attestation. AVG-6's handoff is a CHANNEL transition, and the two must not be
    // confusable: the name is checked, and so is every acquisition-case verb.
    const avg6 = readFileSync(join(SRC, 'contracts', 'avg6-omnichannel-identity.ts'), 'utf8');
    const code = codeOnly(avg6);
    for (const forbidden of [
      'completeCoreActiveHandoff',
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'CONTACT_APPROVED',
      'activationAttestation',
      'mergeIdentit',
      'mergeProspect',
      'resolveIdentity',
    ]) {
      expect(code, `AVG-6 must not name ${forbidden}`).not.toContain(forbidden);
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

  it('leaves the shared WhatsApp delivery channel exactly where it found it', () => {
    // `whatsapp` has been a governed delivery channel since long before AVG-6, and AVG-6 changes
    // nothing about that. Naming the destination channel of a transition is not activating it: this
    // package still imports no shared contract, creates no communication request and sends nothing.
    const shared = readFileSync(
      join(REPO_ROOT, 'packages', 'contracts', 'src', 'communications', 'communication-channel.ts'),
      'utf8',
    );
    const declared = /COMMUNICATION_CHANNELS = \[([^\]]*)\]/u.exec(shared)?.[1] ?? '';
    expect(declared).toContain("'whatsapp'");
    // Four members, and still exactly four.
    expect(declared.split(',').filter((one) => one.trim() !== '')).toHaveLength(4);
  });

  it('generates nothing and prices nothing', () => {
    // AVG-7 owns the sales brain and AVG-8 owns commercial truth. AVG-5 normalizes inbound text and
    // carries an AVG-4 draft's words; it must not acquire a reply generator or a price on the way.
    //
    // ### Why `price` and `discount` are now SHAPES rather than bare words
    //
    // Through AVG-6 this list banned both outright, which worked because no file had cause to write
    // them. AVG-7 does: the roadmap makes it "bounded by the same sales-ethics prohibitions as
    // Anisha", and the only way to bound something a machine can check is to write the prohibition
    // down -- as `priceOriginatedByBrain: false` and `discountOriginatedByBrain: false`.
    //
    // Those are DECLARATIONS OF ABSENCE, and this is the third time the same argument has applied
    // (AVG-5's `metaApiCalled`, AVG-6's `whatsappSendRequested`). A scan that reads them as presence
    // would force the contract to be renamed around a grep, making the prohibition less legible in
    // order to keep a test quiet. So the ban moves to the shapes a commercial VALUE would actually
    // arrive in -- a field literally called `price` or `discount`, a currency, a unit price, an
    // amount due -- and the declarations are separately asserted present and false further down,
    // which is a stronger check than the substring ever was.
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
        // Commercial VALUES, under the names one would actually arrive in.
        'pricing',
        'priceinr',
        'priceusd',
        'pricecents',
        'unitprice',
        'listprice',
        'baseprice',
        'amountdue',
        'amountpaid',
        'currency',
        'discountpercent',
        'discountamount',
        'discountcode',
        'discountrate',
        'entitlement',
        'invoice',
        'razorpay',
        'checkout',
        'quota',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      // And no field may simply BE a price, a discount or an amount. The match is on the token
      // immediately followed by a colon, so `unitPrice:` and `price?:` are caught while
      // `priceOriginatedByBrain:` -- a declaration that no price was invented -- is not.
      for (const shape of [/price\??:/iu, /discount\??:/iu, /amount\??:/iu]) {
        expect(code, `${file} must not declare ${String(shape)}`).not.toMatch(shape);
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
    // Instagram conversation domain; AVG-6 adds cross-channel identity evidence, a recommendation
    // that never merges anything, and an inert WhatsApp CHANNEL handoff candidate. Every addition
    // remains a closed vocabulary, bound, schema or pure function; nothing here sends or executes.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'AAROHI_AGENT_ID',
      'AAROHI_AVG3_CONTRACT_VERSION',
      'AAROHI_AVG4_CONTRACT_VERSION',
      'AAROHI_AVG5_CHANNEL',
      'AAROHI_AVG5_CONTRACT_VERSION',
      'AAROHI_AVG6_CONTRACT_VERSION',
      'AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL',
      'AAROHI_AVG6_HANDOFF_TARGET_CHANNEL',
      'AAROHI_AVG6_IDENTITY_CHANNELS',
      'AAROHI_AVG7_CONTRACT_VERSION',
      'AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE',
      'AAROHI_ENRICHMENT_CONTRACT_VERSION',
      'AAROHI_PROSPECT_CONTRACT_VERSION',
      'AAROHI_SALES_BRAIN_POSTURE',
      'AAROHI_SALES_CONVERSATION_INTENTS',
      'AAROHI_SALES_OBJECTION_KINDS',
      'AAROHI_SALES_STRATEGIES',
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
      'IDENTITY_EVIDENCE_REFUSALS',
      'IDENTITY_EVIDENCE_RELATIONS',
      'IDENTITY_EVIDENCE_SOURCE_KINDS',
      'IDENTITY_EVIDENCE_SOURCE_POSTURE',
      'IDENTITY_LINK_OUTCOMES',
      'IDENTITY_LINK_POSTURE',
      'IDENTITY_LINK_REASON_CODES',
      'IDENTITY_SOURCE_ROLE',
      'IDENTITY_SOURCE_ROLES',
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
      'MAX_IDENTITY_EVIDENCE_CLAIMS',
      'MAX_INSTAGRAM_CONVERSATION_TURNS',
      'MAX_INSTAGRAM_MESSAGE_LENGTH',
      'MAX_WORKSPACE_DRAFT_LENGTH',
      'PRESENCE_SIGNALS',
      'PROSPECT_DISCOVERY_SOURCES',
      'PROSPECT_PRIORITY_MAX_POINTS',
      'PROSPECT_PRIORITY_REFUSALS',
      'SALES_TURN_REFUSALS',
      'TERMINAL_ACQUISITION_CASE_STATES',
      'WHATSAPP_CHANNEL_HANDOFF_OUTCOME',
      'WHATSAPP_CHANNEL_HANDOFF_POSTURE',
      'WHATSAPP_CHANNEL_HANDOFF_REFUSALS',
      'WORKSPACE_APPROVAL_READINESS_OUTCOME',
      'WORKSPACE_APPROVAL_READINESS_REFUSALS',
      'WORKSPACE_DRAFT_REFUSALS',
      'WORKSPACE_DRAFT_STATES',
      'acquisitionCaseSchema',
      'activationAttestationSchema',
      'appendCrossChannelIdentityEvidence',
      'appendInstagramInboundObservation',
      'buildWorkspaceReviewItem',
      'canTransition',
      'completeCoreActiveHandoff',
      'coreEligibilityObservationSchema',
      'createAarohiSalesBrainInterpretation',
      'createCrossChannelIdentityEvidenceBundle',
      'createCrossChannelIdentityEvidenceClaim',
      'createEnrichmentClaim',
      'createEnrichmentProfile',
      'createInstagramConversation',
      'createProspectIdentity',
      'createWorkspaceDraft',
      'enrichmentClaimIdentity',
      'enrichmentClaimSchema',
      'enrichmentProfileSchema',
      'enrichmentSourceSchema',
      'evaluateAarohiSalesTurn',
      'evaluateAcquisitionContactEligibility',
      'evaluateAcquisitionEligibility',
      'evaluateCrossChannelIdentityLink',
      'evaluateEnrichmentReviewReadiness',
      'evaluateInstagramAcquisitionContinuation',
      'evaluateProspectPriority',
      'evaluateWorkspaceApprovalReadiness',
      'identityEvidenceBundleSchema',
      'identityEvidenceClaimSchema',
      'identityLinkPostureSchema',
      'identityLinkRecommendationSchema',
      'instagramConversationSnapshotSchema',
      'instagramInboundObservationSchema',
      'instagramOutboundCandidatePostureSchema',
      'instagramOutboundCandidateSchema',
      'isTerminalAcquisitionCaseState',
      'openAcquisitionCase',
      'parseAarohiSalesBrainInterpretation',
      'parseAarohiSalesTurnPlan',
      'parseCrossChannelIdentityEvidenceBundle',
      'parseCrossChannelIdentityLinkRecommendation',
      'parseEnrichmentClaim',
      'parseEnrichmentProfile',
      'parseInstagramConversation',
      'parseInstagramInboundObservation',
      'parseWorkspaceDraft',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
      'prospectIdentitySchema',
      'reviseWorkspaceDraft',
      'salesBrainInterpretationSchema',
      'salesBrainPostureSchema',
      'salesReplyBriefSchema',
      'salesTurnPlanSchema',
      'summariseEnrichmentConsistency',
      'transitionAcquisitionCase',
      'transitionWorkspaceDraft',
      'whatsappChannelHandoffCandidateSchema',
      'whatsappChannelHandoffPostureSchema',
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
