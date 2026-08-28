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
  AAROHI_AVG12_POSTURE,
  AAROHI_OFFLINE_PROBES,
  ACQUISITION_CASE_STATES,
  ACQUISITION_CASE_TRANSITIONS,
  ELIGIBLE_CORE_STATUSES,
  aarohiAvg12PostureSchema,
  evaluateAarohiOfflineSuite,
  AAROHI_COMMERCIAL_FACTS_POSTURE,
  AAROHI_PAYMENT_FOLLOWUP_POSTURE,
  AAROHI_REGISTRATION_ASSISTANCE_POSTURE,
  AAROHI_SALES_BRAIN_POSTURE,
  IDENTITY_LINK_POSTURE,
  INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE,
  WHATSAPP_CHANNEL_HANDOFF_POSTURE,
  aarohiCommercialFactsPostureSchema,
  aarohiPaymentFollowupPostureSchema,
  aarohiRegistrationAssistancePostureSchema,
  AAROHI_FUNNEL_STAGES,
  AAROHI_METRIC_AUTHORITIES,
  AAROHI_STAGE_AUTHORITY,
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

describe('Aarohi remains a DOMAIN, not a runtime through AVG-10', () => {
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
    const DECLARED_FALSE = [
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
      // The three pressure tactics, and the omission that is a fourth.
      'inventedUrgency',
      'inventedScarcity',
      'unsupportedSocialProof',
      // The canonical ceiling names this one too, and the first AVG-7 head omitted it. Hiding the
      // inconvenient half of an offer is the quietest of these failures and the easiest to reach.
      'materialPackageLimitationHidden',
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
    ] as const;

    for (const declared of DECLARED_FALSE) {
      expect(brain[declared], declared).toBe(false);
    }
    expect(brain['planOnly']).toBe(true);

    // And the list must be COMPLETE, in both directions.
    //
    // A governance list that can quietly lose a member is a list that eventually will: deleting one
    // entry above leaves a passing test that checks one fewer prohibition, and nothing says so. So
    // the list is asserted against the posture itself rather than against somebody's memory —
    // every `false` field must be named here, and every name here must be a `false` field. Adding a
    // prohibition to the posture without listing it fails here too, which is the direction that
    // matters as AVG-8 onward extend the ceiling.
    const falseFields = Object.entries(brain)
      .filter(([, value]) => value === false)
      .map(([key]) => key);
    expect([...DECLARED_FALSE].sort()).toStrictEqual(falseFields.sort());
    for (const forged of [
      { modelCallExecuted: true },
      { priceOriginatedByBrain: true },
      { guaranteeLeadVolume: true },
      { materialPackageLimitationHidden: true },
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

  it('reaches no QuickFurno service, database client or commercial write path', () => {
    // AVG-8 mirrors a Core READ CONTRACT and imports nothing from the marketplace repository. The
    // bans are in three groups because they fail three different ways.
    //
    // A database client would make the offline posture a lie -- `snapshotSourceAuthenticated: false`
    // is only honest while there is no way to authenticate one.
    //
    // A QuickFurno service import would make Jarvis depend on a repository it does not build or
    // version, and would turn a contract mirror into a coupling.
    //
    // And the WRITE verbs are the ones that would quietly turn "a prospect asked about a package"
    // into an order. Those are AVG-9's, AVG-10's, and Core's.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        // Database clients and query builders.
        'adminClient',
        'servicerole',
        'service_role',
        'createclient',
        '.from(',
        '.select(',
        '.rpc(',
        'sql`',
        // The QuickFurno marketplace, by repository, service or function.
        'quickfurno-marketplace',
        'vendorpackageorderservice',
        'packageservice',
        'listavailablevendorpackages',
        'getvendorcurrentpackagesummary',
        // Commercial WRITE paths, every one of which belongs to Core.
        'createvendorpackageorder',
        'createmanualpayment',
        'markpaymentpaid',
        'assignpackagetovendor',
        'assignpackageafterpayment',
        'grantcredits',
        'creditwallet',
        'vendor_packages',
        // Derived commercial values nothing here may compute.
        'price_per_lead',
        'pricepertlead',
        'priceperlead',
        'effectiveprice',
        'discountpercent',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('declares the AVG-8 commercial ceiling as literal falsehoods, not as prose', () => {
    const commercial = AAROHI_COMMERCIAL_FACTS_POSTURE as unknown as Readonly<
      Record<string, unknown>
    >;
    const DECLARED_FALSE = [
      // The observation is injected. Saying so is what keeps the rest of the file honest.
      'snapshotSourceAuthenticated',
      // Forming a commercial opinion, in each of the four ways it could be formed.
      'packageRecommended',
      'bestPackageClaimed',
      'packageRanked',
      'packageEligibilityGranted',
      // Originating a commercial VALUE. `priceInterpreted` and `derivedPriceCalculated` are separate
      // failures: one assigns meaning to two Core numbers, the other makes a third out of them.
      'commercialTruthMutated',
      'commercialCommitmentCreated',
      'priceAdjusted',
      'priceInterpreted',
      'derivedPriceCalculated',
      'discountCreated',
      'savingsCalculated',
      'currencyInvented',
      'offerCreated',
      'materialPackageLimitationHidden',
      // The Core write paths, none of which starts here.
      'registrationMutated',
      'paymentMutated',
      'packageOrderCreated',
      'packageAssigned',
      'creditsMutated',
      'activationMutated',
      'acquisitionCaseMutated',
      'anishaHandoffExecuted',
      // The model waist, the prompt waist and retrieval.
      'modelCallExecuted',
      'promptResolved',
      'retrievalExecuted',
      // The governed execution chain.
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
      'productionMutation',
      'businessEffect',
    ] as const;
    const DECLARED_TRUE = [
      'referenceFactsOnly',
      'commercialFactsReadyForFutureGovernedDraft',
      'requiresCoreCommercialRevalidationBeforeFutureOutboundUse',
    ] as const;

    for (const declared of DECLARED_FALSE) {
      expect(commercial[declared], declared).toBe(false);
    }
    for (const declared of DECLARED_TRUE) {
      expect(commercial[declared], declared).toBe(true);
    }

    // Complete in both directions, for the reason ADR-0124 records: a governance list that can
    // quietly lose a member is a list that eventually will.
    expect([...DECLARED_FALSE].sort()).toStrictEqual(
      Object.entries(commercial)
        .filter(([, value]) => value === false)
        .map(([key]) => key)
        .sort(),
    );
    expect([...DECLARED_TRUE].sort()).toStrictEqual(
      Object.entries(commercial)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort(),
    );

    for (const forged of [
      { snapshotSourceAuthenticated: true },
      { packageRecommended: true },
      { priceInterpreted: true },
      { derivedPriceCalculated: true },
      { discountCreated: true },
      { packageOrderCreated: true },
      { referenceFactsOnly: false },
      { requiresCoreCommercialRevalidationBeforeFutureOutboundUse: false },
    ]) {
      expect(
        aarohiCommercialFactsPostureSchema.safeParse({ ...commercial, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('reaches no registration write path, and stores no registration secret or destination', () => {
    // AVG-9's risk surface is different in kind from AVG-8's, and worth naming separately.
    //
    // QuickFurno's registration surface is a WRITE. `registerVendor` takes a business name, a phone
    // number, an email address, a WhatsApp number and a GST number and inserts a row; there is no
    // registration-process READ contract to mirror. So the first group bans the write path by name
    // and the second bans its INPUT — because a registration domain that acquired somewhere to put
    // a phone number would be one edit from calling it, whatever the field was called.
    //
    // The third group is the failure this stage is really designed against: a plausible signup
    // process. Nothing here may name a step, a requirement, a document, an identity artefact or a
    // one-time code, because every one of those would be Aarohi describing a workflow QuickFurno
    // never published to it.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        // The registration write path, by service, function and input type.
        'registervendor',
        'vendorregistrationinput',
        'vendorservice',
        'vendorauthservice',
        'vendoraccessservice',
        'publicvendorservice',
        // Secrets and one-time codes, none of which this package may hold.
        'password',
        'otp',
        'secret',
        'sessiontoken',
        'refreshtoken',
        // An invented signup workflow, in the shapes it would actually arrive in.
        'signup',
        'registrationstep',
        'registration_step',
        'onboardingstep',
        'onboarding_step',
        'registrationurl',
        'registrationendpoint',
        'registrationform',
        // Identity artefacts a registration wizard collects. Core's to ask for, never Aarohi's.
        'gst',
        'kyc',
        'aadhaar',
        'pan_number',
        'bankaccount',
        'verifymobile',
        'documentupload',
        'uploaddocument',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('declares the AVG-9 registration ceiling as literal falsehoods, not as prose', () => {
    const registration = AAROHI_REGISTRATION_ASSISTANCE_POSTURE as unknown as Readonly<
      Record<string, unknown>
    >;
    const DECLARED_FALSE = [
      // The observation is injected. Saying so is what keeps the rest of the file honest.
      'processContextSourceAuthenticated',
      // The four ways this stage could claim an authority it does not have. They are separate
      // failures: one invents a workflow, one announces an outcome, one implies a record exists,
      // and one would be Core's state actually moving.
      'registrationProcessInvented',
      'registrationConfirmed',
      'vendorRecordCreated',
      'registrationMutated',
      // The overlay's own sentence — no marketplace mutation occurs from this side — and the
      // acquisition case, which is not a substitute for Core registration evidence.
      'marketplaceMutated',
      'acquisitionCaseMutated',
      // AVG-10's territory, kept out by name.
      'paymentMutated',
      'activationMutated',
      'anishaHandoffExecuted',
      // The model waist, the prompt waist and retrieval.
      'modelCallExecuted',
      'promptResolved',
      'retrievalExecuted',
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
      'productionMutation',
      'businessEffect',
    ] as const;
    const DECLARED_TRUE = [
      'assistanceContextOnly',
      'requiresCoreRegistrationExecution',
      'registrationProcessContextReadyForFutureGovernedAssistance',
      'requiresCoreStatusRevalidationBeforeFutureOutboundUse',
    ] as const;

    for (const declared of DECLARED_FALSE) {
      expect(registration[declared], declared).toBe(false);
    }
    for (const declared of DECLARED_TRUE) {
      expect(registration[declared], declared).toBe(true);
    }

    // Complete in both directions, for the reason ADR-0124 records: a governance list that can
    // quietly lose a member is a list that eventually will.
    expect([...DECLARED_FALSE].sort()).toStrictEqual(
      Object.entries(registration)
        .filter(([, value]) => value === false)
        .map(([key]) => key)
        .sort(),
    );
    expect([...DECLARED_TRUE].sort()).toStrictEqual(
      Object.entries(registration)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort(),
    );

    for (const forged of [
      { registrationMutated: true },
      { registrationConfirmed: true },
      { registrationProcessInvented: true },
      { vendorRecordCreated: true },
      { marketplaceMutated: true },
      { acquisitionCaseMutated: true },
      { paymentMutated: true },
      { activationMutated: true },
      { anishaHandoffExecuted: true },
      { processContextSourceAuthenticated: true },
      { assistanceContextOnly: false },
      { requiresCoreRegistrationExecution: false },
      { requiresCoreStatusRevalidationBeforeFutureOutboundUse: false },
    ]) {
      expect(
        aarohiRegistrationAssistancePostureSchema.safeParse({ ...registration, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('keeps AVG-9 clear of acquisition ownership and of AVG-10 entirely', () => {
    const avg9 = codeOnly(
      readFileSync(join(SRC, 'contracts', 'avg9-registration-integration.ts'), 'utf8'),
    );
    for (const forbidden of [
      // Acquisition-case ownership. A local state cannot become proof of a Core business state, so
      // AVG-9 does not reach the transition function at all rather than reaching it carefully.
      'completeCoreActiveHandoff',
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'REGISTRATION_STARTED',
      'PAYMENT_PENDING',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'activationAttestation',
      // AVG-10, which begins where this stage stops.
      'purchasePackage',
      'createVendorPackageOrder',
      'createManualPayment',
      'markPaymentPaid',
      'assignPackageToVendor',
      'grantCredits',
      // The downstream builders a registration domain would be tempted to call next. Composition
      // is a later, separately reviewed decision.
      'createOutreachDraft',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
      'prepareAarohiCommercialFactsBrief',
    ]) {
      expect(avg9, `AVG-9 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('reaches no QuickFurno payment or activation write path, and holds no payment instrument', () => {
    // AVG-10's risk surface, named from the read-only Core audit ADR-0127 records rather than
    // guessed at. The first group is every WRITE QuickFurno actually exposes for money and for going
    // live; a generic word ban is the one that quietly stops matching when somebody renames a
    // service, so these are the real function and RPC names.
    //
    // The second group is the payment INSTRUMENT surface. A domain that acquired somewhere to put a
    // card, an account or a UPI handle would be one edit from being a payment form, whatever the
    // field was called — and QuickFurno's own order rows record the provider as `not_connected`,
    // which is a fact about Core rather than a licence for Jarvis to connect one.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        // The manual-payment path (packageService).
        'createmanualpayment',
        'markpaymentpaid',
        'assignpackagetovendor',
        'assignpackageafterpayment',
        'assign_package_to_vendor',
        // The order path (vendorPackageOrderService).
        'createvendorpackageorder',
        'listvendorpackageorders',
        'vendor_package_orders',
        // The credit path (vendorCreditWalletService).
        'applyvendorcreditdelta',
        'grantvendorcredits',
        'grantcreditsforconfirmedpackagepurchase',
        'refundcreditforinvalidlead',
        // The activation path (vendorAdminService).
        'setvendorstatusaction',
        'updatevendorvisibility',
        'update_vendor_visibility',
        'updatevendorcredits',
        'updatevendorpackage',
        'vendoradminservice',
        // Core columns nothing here mirrors. Their values are unconstrained free text that only
        // Core writes, and copying a status string is how an invented lifecycle begins.
        'payment_status',
        'activation_status',
        'provider_payment_id',
        'provider_order_id',
        // Payment providers, none of which this repository integrates. QuickFurno records its own
        // provider as not connected; naming one here would be a promise that a transport exists.
        'razorpay',
        'stripe',
        'cashfree',
        'payu',
        'paytm',
        'phonepe',
        'ccavenue',
        'billdesk',
        'paymentgateway',
        // Payment instruments and bank identity, under any name.
        'cardnumber',
        'card_number',
        'cvv',
        'ifsc',
        'upi',
        'bankaccount',
        'bank_account',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('declares the AVG-10 payment and activation ceiling as literal falsehoods, not as prose', () => {
    const payment = AAROHI_PAYMENT_FOLLOWUP_POSTURE as unknown as Readonly<Record<string, unknown>>;
    const DECLARED_FALSE = [
      // The observation is injected. Saying so is what keeps the rest of the file honest.
      'paymentContextSourceAuthenticated',
      // The four ways this stage could claim money moved. They are separate failures: one is Core's
      // state actually changing, one is Aarohi deciding a payment succeeded, one is imagining a
      // lifecycle Core does not own, and one is an order existing because of this.
      'paymentMutated',
      'paymentConfirmedByAarohi',
      'paymentLifecycleInvented',
      'packageOrderCreated',
      'creditsMutated',
      // The four ways this stage could claim somebody went live. `activationInferred` is the one to
      // read twice: concluding ACTIVE from a payment is the most natural mistake in this domain,
      // and it is the mistake the whole stage is shaped to prevent.
      'activationMutated',
      'activationInferred',
      'vendorActivated',
      'anishaHandoffExecuted',
      // Neighbouring authority, none of which moves here.
      'registrationMutated',
      'acquisitionCaseMutated',
      'marketplaceMutated',
      // The model waist, the prompt waist and retrieval.
      'modelCallExecuted',
      'promptResolved',
      'retrievalExecuted',
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
      'productionMutation',
      'businessEffect',
    ] as const;
    const DECLARED_TRUE = [
      'assistanceContextOnly',
      // Two truths, declared separately. An authoritative payment fact would still not be an
      // activation fact, and folding them into one field would be the conflation this stage exists
      // to refuse.
      'requiresCorePaymentTruth',
      'requiresCoreActivationTruth',
      'requiresCoreStatusRevalidationBeforeFutureOutboundUse',
    ] as const;

    for (const declared of DECLARED_FALSE) {
      expect(payment[declared], declared).toBe(false);
    }
    for (const declared of DECLARED_TRUE) {
      expect(payment[declared], declared).toBe(true);
    }

    // Complete in both directions, for the reason ADR-0124 records.
    expect([...DECLARED_FALSE].sort()).toStrictEqual(
      Object.entries(payment)
        .filter(([, value]) => value === false)
        .map(([key]) => key)
        .sort(),
    );
    expect([...DECLARED_TRUE].sort()).toStrictEqual(
      Object.entries(payment)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort(),
    );

    for (const forged of [
      { paymentMutated: true },
      { paymentConfirmedByAarohi: true },
      { paymentLifecycleInvented: true },
      { activationMutated: true },
      { activationInferred: true },
      { vendorActivated: true },
      { anishaHandoffExecuted: true },
      { acquisitionCaseMutated: true },
      { paymentContextSourceAuthenticated: true },
      { assistanceContextOnly: false },
      { requiresCorePaymentTruth: false },
      { requiresCoreActivationTruth: false },
    ]) {
      expect(
        aarohiPaymentFollowupPostureSchema.safeParse({ ...payment, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });

  it('keeps AVG-10 clear of the handoff it must not duplicate', () => {
    // `completeCoreActiveHandoff` is the ONLY public route into `HANDED_OFF_TO_ANISHA`. AVG-10 does
    // not import, wrap, compose or name it — which is a stronger statement than composing it
    // carefully, because a second entrance to a terminal state cannot be safer than one.
    const avg10 = codeOnly(
      readFileSync(join(SRC, 'contracts', 'avg10-payment-activation-handoff.ts'), 'utf8'),
    );
    for (const forbidden of [
      'completeCoreActiveHandoff',
      'completeAvg10Handoff',
      'forceHandoff',
      'handoffToAnisha',
      'transitionToAnisha',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'CONTACT_APPROVED',
      'activationAttestation',
      'ACTIVATION_AUTHORITIES',
      'QUICKFURNO_CORE',
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      // And the cold gate, which AVG-10 may not widen and does not touch.
      'ELIGIBLE_CORE_STATUSES',
      'CORE_STATUS_ROLE',
      'evaluateAcquisitionEligibility',
      // The sibling builders. Composition is a later, separately reviewed decision.
      'prepareAarohiRegistrationAssistanceBrief',
      'prepareAarohiCommercialFactsBrief',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
    ]) {
      expect(avg10, `AVG-10 must not name ${forbidden}`).not.toContain(forbidden);
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
        // A currency CODE, and a currency FIELD. Not the bare word: AVG-8 writes
        // `currencyInvented: false`, which is the fourth declaration of absence this list has had to
        // make room for (after `metaApiCalled`, `whatsappSendRequested` and
        // `priceOriginatedByBrain`). The declaration is asserted present and false further down,
        // which is a stronger check than the substring was -- and the ban that matters is the one on
        // an actual currency, because QuickFurno's ORDER-write path hard-codes INR and this read
        // contract deliberately does not inherit it.
        'currencycode',
        'currency_code',
        "'inr'",
        '"inr"',
        "'usd'",
        '"usd"',
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
      // And no field may simply BE a price, a discount, an amount or a currency.
      //
      // The lookbehind matters. AVG-8 mirrors Core's available-package read surface field for field,
      // and two of those fields are `total_price` and `display_price` -- Core's names, copied rather
      // than chosen, and renaming them would be the first act of interpretation. So the ban is on a
      // field that IS one of these tokens, not one that ends with it: `price:` is caught,
      // `total_price:` is Core's data, and `priceOriginatedByBrain:` / `currencyInvented:` are
      // declarations that no price and no currency were invented. `unitPrice` and `listPrice` stay
      // covered by the substring list above.
      for (const shape of [
        /(?<![A-Za-z0-9_])price\??:/iu,
        /(?<![A-Za-z0-9_])discount\??:/iu,
        /(?<![A-Za-z0-9_])amount\??:/iu,
        /(?<![A-Za-z0-9_])currency\??:/iu,
      ]) {
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
    // AVG-11 adds aggregate acquisition analytics: a closed funnel vocabulary, a metric AUTHORITY
    // distinction, and one pure builder that counts distinct prospects and refuses to name a
    // business outcome. It exposes no rate, no admin write and no route into any transition.
    // AVG-12 adds the offline evaluation corpus, the bounded-volume proof and controlled autonomy:
    // closed probe, dimension and severity vocabularies whose maps a caller never supplies, one
    // pure suite evaluator whose outcome is derived, and one pure autonomy decision that grants
    // OFFLINE decision freedom over a single frozen posture. It exposes no activation, rollout,
    // send, approve or execute function, and no level changes the authority ceiling.
    //
    // Note the two names that are NOT here. `parseAarohiOfflineEvaluationReport` and
    // `parseAarohiControlledAutonomyDecision` were exported in an earlier revision and are now
    // internal: each proves a SHAPE, neither can prove that the corpus ran or that a decision was
    // derived, and a public `parse*` returning a certified-looking artifact reads as if it could.
    // The SCHEMAS remain exported, because a schema is unambiguously a shape description.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'AAROHI_ACQUISITION_FUNNEL_OUTCOME',
      'AAROHI_AGENT_ID',
      'AAROHI_ANALYTICS_EVIDENCE_KINDS',
      'AAROHI_ANALYTICS_POSTURE',
      'AAROHI_ANALYTICS_REFUSALS',
      'AAROHI_AUTONOMY_CEILING',
      'AAROHI_AUTONOMY_FLOOR',
      'AAROHI_AUTONOMY_LEVELS',
      'AAROHI_AUTONOMY_LEVEL_PREPARATIONS',
      'AAROHI_AUTONOMY_NEXT_STEPS',
      'AAROHI_AUTONOMY_RANK',
      'AAROHI_AUTONOMY_REASONS',
      'AAROHI_AUTONOMY_REASON_MAX_LEVEL',
      'AAROHI_AUTONOMY_REASON_NEXT_STEP',
      'AAROHI_AUTONOMY_REASON_PRECEDENCE',
      'AAROHI_AUTONOMY_REFUSALS',
      'AAROHI_AVG10_CONTRACT_VERSION',
      'AAROHI_AVG10_PAYMENT_SOURCE_POSTURE',
      'AAROHI_AVG11_CONTRACT_VERSION',
      'AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE',
      'AAROHI_AVG12_AUTONOMY_SOURCE_POSTURE',
      'AAROHI_AVG12_CONTRACT_VERSION',
      'AAROHI_AVG12_EVALUATION_SOURCE_POSTURE',
      'AAROHI_AVG12_POSTURE',
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
      'AAROHI_AVG8_COMMERCIAL_SCOPES',
      'AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE',
      'AAROHI_AVG8_CONTRACT_VERSION',
      'AAROHI_AVG9_CONTRACT_VERSION',
      'AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE',
      'AAROHI_COMMERCIAL_FACTS_POSTURE',
      'AAROHI_ENRICHMENT_CONTRACT_VERSION',
      'AAROHI_EVALUATION_DIMENSIONS',
      'AAROHI_EVALUATION_REFUSALS',
      'AAROHI_EVALUATION_SEVERITIES',
      'AAROHI_EVIDENCE_SOURCE_STATES',
      'AAROHI_FUNNEL_STAGES',
      'AAROHI_METRIC_AUTHORITIES',
      'AAROHI_METRIC_UNAVAILABLE_REASONS',
      'AAROHI_OFFLINE_EVALUATION_OUTCOMES',
      'AAROHI_OFFLINE_PREPARATIONS',
      'AAROHI_OFFLINE_PROBES',
      'AAROHI_OFFLINE_PROBE_COUNT',
      'AAROHI_PAYMENT_FOLLOWUP_POSTURE',
      'AAROHI_PROBE_DIMENSION',
      'AAROHI_PROBE_SEVERITY',
      'AAROHI_PROSPECT_CONTRACT_VERSION',
      'AAROHI_REGISTRATION_ASSISTANCE_POSTURE',
      'AAROHI_SALES_BRAIN_POSTURE',
      'AAROHI_SALES_CONVERSATION_INTENTS',
      'AAROHI_SALES_OBJECTION_KINDS',
      'AAROHI_SALES_STRATEGIES',
      'AAROHI_STAGE_AUTHORITY',
      'ACQUISITION_CASE_STATES',
      'ACQUISITION_CASE_TRANSITIONS',
      'ACQUISITION_REFUSAL_REASONS',
      'ACTIVATION_AUTHORITIES',
      'BLOCKED_CORE_STATUSES',
      'CASE_TRANSITION_REFUSALS',
      'COMMERCIAL_REFUSALS',
      'CONTACT_ELIGIBILITY_OUTCOME',
      'CONTACT_ELIGIBILITY_REFUSALS',
      'CORE_COMMERCIAL_FACTS_OUTCOME',
      'CORE_PARTY_STATUSES',
      'CORE_PAYMENT_CONTEXT_AVAILABILITIES',
      'CORE_PAYMENT_FOLLOWUP_OUTCOME',
      'CORE_REGISTRATION_ASSISTANCE_OUTCOME',
      'CORE_REGISTRATION_PROCESS_AVAILABILITIES',
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
      'MAX_AAROHI_ANALYTICS_EVIDENCE',
      'MAX_COMMERCIAL_PACKAGES',
      'MAX_ENRICHMENT_LABEL_LENGTH',
      'MAX_ENRICHMENT_PROFILE_CLAIMS',
      'MAX_IDENTITY_EVIDENCE_CLAIMS',
      'MAX_INSTAGRAM_CONVERSATION_TURNS',
      'MAX_INSTAGRAM_MESSAGE_LENGTH',
      'MAX_WORKSPACE_DRAFT_LENGTH',
      'PAYMENT_FOLLOWUP_REFUSALS',
      'PRESENCE_SIGNALS',
      'PROSPECT_DISCOVERY_SOURCES',
      'PROSPECT_PRIORITY_MAX_POINTS',
      'PROSPECT_PRIORITY_REFUSALS',
      'REGISTRATION_ASSISTANCE_REFUSALS',
      'SALES_TURN_REFUSALS',
      'TERMINAL_ACQUISITION_CASE_STATES',
      'WHATSAPP_CHANNEL_HANDOFF_OUTCOME',
      'WHATSAPP_CHANNEL_HANDOFF_POSTURE',
      'WHATSAPP_CHANNEL_HANDOFF_REFUSALS',
      'WORKSPACE_APPROVAL_READINESS_OUTCOME',
      'WORKSPACE_APPROVAL_READINESS_REFUSALS',
      'WORKSPACE_DRAFT_REFUSALS',
      'WORKSPACE_DRAFT_STATES',
      'aarohiAcquisitionFunnelReportSchema',
      'aarohiAnalyticsPostureSchema',
      'aarohiAvg12PostureSchema',
      'aarohiCommercialFactsBriefSchema',
      'aarohiCommercialFactsPostureSchema',
      'aarohiControlledAutonomyDecisionSchema',
      'aarohiEvaluationDimensionResultSchema',
      'aarohiEvidenceSourcesSchema',
      'aarohiFunnelMetricSchema',
      'aarohiOfflineEvaluationReportSchema',
      'aarohiOfflineScaleSummarySchema',
      'aarohiPaymentFollowupBriefSchema',
      'aarohiPaymentFollowupPostureSchema',
      'aarohiRegistrationAssistanceBriefSchema',
      'aarohiRegistrationAssistancePostureSchema',
      'acquisitionCaseSchema',
      'activationAttestationSchema',
      'appendCrossChannelIdentityEvidence',
      'appendInstagramInboundObservation',
      'buildAarohiAcquisitionFunnelReport',
      'buildWorkspaceReviewItem',
      'canTransition',
      'completeCoreActiveHandoff',
      'coreCommercialCatalogSnapshotSchema',
      'coreCommercialPackageOptionSchema',
      'coreEligibilityObservationSchema',
      'corePaymentFollowupContextSchema',
      'coreRegistrationProcessContextSchema',
      'createAarohiSalesBrainInterpretation',
      'createCoreCommercialCatalogSnapshot',
      'createCorePaymentFollowupContext',
      'createCoreRegistrationProcessContext',
      'createCrossChannelIdentityEvidenceBundle',
      'createCrossChannelIdentityEvidenceClaim',
      'createEnrichmentClaim',
      'createEnrichmentProfile',
      'createInstagramConversation',
      'createProspectIdentity',
      'createWorkspaceDraft',
      'decideAarohiControlledAutonomy',
      'enrichmentClaimIdentity',
      'enrichmentClaimSchema',
      'enrichmentProfileSchema',
      'enrichmentSourceSchema',
      'evaluateAarohiOfflineSuite',
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
      'parseAarohiAcquisitionFunnelReport',
      'parseAarohiCommercialFactsBrief',
      'parseAarohiPaymentFollowupBrief',
      'parseAarohiRegistrationAssistanceBrief',
      'parseAarohiSalesBrainInterpretation',
      'parseAarohiSalesTurnPlan',
      'parseCoreCommercialCatalogSnapshot',
      'parseCorePaymentFollowupContext',
      'parseCoreRegistrationProcessContext',
      'parseCrossChannelIdentityEvidenceBundle',
      'parseCrossChannelIdentityLinkRecommendation',
      'parseEnrichmentClaim',
      'parseEnrichmentProfile',
      'parseInstagramConversation',
      'parseInstagramInboundObservation',
      'parseWorkspaceDraft',
      'prepareAarohiCommercialFactsBrief',
      'prepareAarohiPaymentFollowupBrief',
      'prepareAarohiRegistrationAssistanceBrief',
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

/**
 * AVG-11 containment (ADR-0128).
 *
 * Analytics is the stage where every earlier separation could be quietly undone, so the scans here
 * are about two things: the module must reach nothing new, and it must not be able to STATE
 * anything a workflow artifact cannot support.
 */
describe('AVG-11 observes, and adds no authority of any kind', () => {
  const avg11 = (): string =>
    codeOnly(readFileSync(join(SRC, 'contracts', 'avg11-analytics-admin-dashboard.ts'), 'utf8'));

  it('reaches no store, no Core write path and no analytics infrastructure', () => {
    const code = avg11();
    for (const forbidden of [
      // A dashboard is the most natural place to grow a database, so the scan is explicit.
      'supabase',
      'createClient',
      'postgres',
      'Pool(',
      'SELECT ',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'GROUP BY',
      'migration',
      'warehouse',
      'clickhouse',
      'prometheus',
      'opentelemetry',
      // Transport and credentials.
      'fetch(',
      'axios',
      'http://',
      'https://',
      'process.env',
      'service_role',
      'SERVICE_ROLE',
      // The model, prompt and retrieval waists.
      'modelGateway',
      'model-gateway',
      'promptRegistry',
      'prompt-registry',
      // Spelled as CALLS rather than as the word: the posture legitimately pins
      // `retrievalExecuted: false`, and a scan that had to be weakened to pass proves nothing.
      'retrieve(',
      'vectorSearch',
      'ragQuery',
      'knowledgeBase',
      'embedding',
      'mastra',
      // n8n, providers and channels. Named as CALLS, because the posture pins
      // `n8nExecutionRequested: false` and a bare token would fire on the ceiling itself.
      'n8nClient',
      'callN8n',
      'dispatchToN8n',
      'webhook',
      'whatsapp',
      'graph.facebook',
      'razorpay',
      'stripe',
      // Governed effect objects, none of which analytics may create.
      'CommunicationRequest',
      'ApprovalRequest',
      'ApprovalDecision',
      'CommunicationAuthorization',
      'ExecutionIntent',
      // Scheduling. A report is computed on demand, never on a timer.
      'setTimeout',
      'setInterval',
      'cron',
      'queue',
      'worker',
    ]) {
      expect(code, 'AVG-11 must not name ' + forbidden).not.toContain(forbidden);
    }
  });

  it('names no write, admin-mutation or business-outcome verb', () => {
    const code = avg11();
    for (const forbidden of [
      'registerVendor',
      'confirmRegistration',
      'confirmPayment',
      'activateVendor',
      'assignPackage',
      'grantCredits',
      'retryPayment',
      'markRegistered',
      'markPaid',
      'createOrder',
      'refund',
      'payout',
      // The admin WRITE surface. AVG-11 is a read stage and names no verb that could change a
      // thing. Quoted, because `POSTURE` contains `POST` and a bare scan would fire on the very
      // field that pins the ceiling.
      "'POST'",
      "'PATCH'",
      "'PUT'",
      "'DELETE'",
      'mutate',
      'persist(',
      'persistTo',
      'repository',
      'upsert',
    ]) {
      expect(code, 'AVG-11 must not name ' + forbidden).not.toContain(forbidden);
    }
  });

  it('computes no rate, and holds no commercial or personal field', () => {
    const code = avg11();
    for (const forbidden of [
      // The rate decision, enforced rather than documented. Spelled with the punctuation of a
      // FIELD or an ASSIGNMENT, so the posture's `conversionRateCalculated: false` — which exists
      // precisely to pin this — is not mistaken for the thing it forbids.
      'conversionRate:',
      'conversionRate =',
      'percentage',
      'numerator',
      'denominator',
      // Commercial figures analytics must never originate.
      'revenue:',
      'revenue =',
      'totalRevenue',
      'arpu',
      'CAC',
      'LTV',
      'ROI',
      'amount',
      'currency',
      'discount',
      // Personal and destination data. None of it has a field to occupy.
      'phone',
      'email',
      'msisdn',
      'gstin',
      'address',
      'latitude',
      'longitude',
      'cardNumber',
      'accountNumber',
      'upiId',
    ]) {
      expect(code, 'AVG-11 must not name ' + forbidden).not.toContain(forbidden);
    }
  });

  it('declares the AVG-11 analytics ceiling as literal falsehoods, not as prose', () => {
    // Every non-effect is a `z.literal(false)` in the posture SCHEMA, so a report claiming otherwise
    // does not parse. Asserted against the schema rather than a built value, because a value can be
    // rebuilt and a schema cannot be talked around.
    const code = avg11();
    for (const pinned of [
      'unknownReportedAsZero: z.literal(false)',
      'conversionRateCalculated: z.literal(false)',
      'revenueReported: z.literal(false)',
      'businessOutcomeClaimed: z.literal(false)',
      'registrationConfirmed: z.literal(false)',
      'paymentConfirmed: z.literal(false)',
      'activationConfirmed: z.literal(false)',
      'vendorActivated: z.literal(false)',
      'anishaHandoffExecuted: z.literal(false)',
      'acquisitionCaseMutated: z.literal(false)',
      'marketplaceMutated: z.literal(false)',
      'packageOrderCreated: z.literal(false)',
      'creditsMutated: z.literal(false)',
      'modelCallExecuted: z.literal(false)',
      'promptResolved: z.literal(false)',
      'retrievalExecuted: z.literal(false)',
      'communicationAuthorizationCreated: z.literal(false)',
      'executionIntentCreated: z.literal(false)',
      'n8nExecutionRequested: z.literal(false)',
      'providerSendRequested: z.literal(false)',
      'channelSendRequested: z.literal(false)',
      'persisted: z.literal(false)',
      'adminWriteExposed: z.literal(false)',
      'productionMutation: z.literal(false)',
      'businessEffect: z.literal(false)',
    ]) {
      expect(code, 'AVG-11 must pin ' + pinned).toContain(pinned);
    }
  });

  it('reuses the canonical handoff rather than duplicating or widening it', () => {
    const code = avg11();
    // AVG-11 DOES name `completeCoreActiveHandoff`, and that is the point: the terminal metric is
    // counted by re-running AVG-1's own function, not by reading a case state. What it must not do
    // is add a second route, transition anything, or widen the cold gate.
    expect(code).toContain('completeCoreActiveHandoff(current, value.activationAttestation)');
    for (const forbidden of [
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'CONTACT_APPROVED',
      'handoffToAnisha',
      'forceHandoff',
      'markHandedOff',
      // The cold gate stays exactly one status wide, and AVG-11 does not restate or reweigh it.
      'ELIGIBLE_CORE_STATUSES',
      'CORE_STATUS_ROLE',
      'NOT_REGISTERED',
      'CORE_PARTY_STATUSES',
    ]) {
      expect(code, 'AVG-11 must not name ' + forbidden).not.toContain(forbidden);
    }

    // AVG-12 autonomy, which this stage does not begin.
    //
    // Case-INSENSITIVE, and it is here because a mutation slipped past the case-sensitive version:
    // `const AUTONOMY_LEVEL = 1` survived a scan that forbade `autonomy`. A vocabulary ban that only
    // catches one casing is a ban on a naming convention, not on a capability.
    for (const forbidden of [
      'autonomy',
      'autonomous',
      'selfOptimis',
      'selfTuning',
      'autoOutreach',
      'autoPromote',
      'promoteAutomatically',
      'rollout',
      'scaleOut',
      'learnedPolicy',
    ]) {
      expect(code, 'AVG-11 must not name ' + forbidden).not.toMatch(
        new RegExp(forbidden.replaceAll(/(?=[A-Z])/gu, '_?'), 'iu'),
      );
    }
  });

  it('agrees token for token with the wire contract it can never import', () => {
    // The control-plane read contract is framework-neutral and this package is imported by nothing,
    // so neither can reach the other. Both therefore state the funnel vocabulary independently, and
    // a divergence would let the wire publish a stage the domain cannot produce -- or refuse one it
    // can. The two lists are compared as TEXT, which is the same trade `compose.ts` already makes
    // for the canonical-instant grammar.
    const wire = readFileSync(
      join(
        REPO_ROOT,
        'packages',
        'control-plane-read-contract',
        'src',
        'contract',
        // V2 (ADR-0129). The AVG-11 vocabulary lives behind a contract VERSION rather than inside
        // V1, so this is the file to compare against -- and a spec below asserts V1 never acquired
        // any of it.
        'snapshot-v2.ts',
      ),
      'utf8',
    );

    const expected = AAROHI_FUNNEL_STAGES.map((stage) => stage.toLowerCase().replaceAll('_', '-'));
    for (const stage of expected) {
      expect(wire, 'the wire contract must carry the ' + stage + ' stage').toContain(
        "'" + stage + "',",
      );
    }

    // The authority classes agree, and the wire owns the same single Core-authoritative stage.
    for (const authority of AAROHI_METRIC_AUTHORITIES) {
      expect(wire, authority).toContain("'" + authority + "'");
    }
    expect(wire).toContain("'core-active-handoff-confirmed': 'CORE_AUTHORITATIVE'");

    const coreOwned = AAROHI_FUNNEL_STAGES.filter(
      (stage) => AAROHI_STAGE_AUTHORITY[stage] === 'CORE_AUTHORITATIVE',
    );
    expect(coreOwned).toStrictEqual(['CORE_ACTIVE_HANDOFF_CONFIRMED']);
  });

  it('left contract V1 entirely alone', () => {
    // ADR-0086's change-control rule, asserted from the domain side: a breaking snapshot-shape
    // change gets a new VERSION, never an edit in place. None of AVG-11's vocabulary may appear in
    // the V1 contract file, in either the funnel stages or the authority classes.
    const v1 = readFileSync(
      join(REPO_ROOT, 'packages', 'control-plane-read-contract', 'src', 'contract', 'snapshot.ts'),
      'utf8',
    );
    for (const stage of AAROHI_FUNNEL_STAGES) {
      expect(v1, stage).not.toContain(stage.toLowerCase().replaceAll('_', '-'));
    }
    for (const authority of AAROHI_METRIC_AUTHORITIES) {
      expect(v1, authority).not.toContain(authority);
    }
    expect(v1).not.toContain('aarohiAcquisitionReadiness');
    expect(v1).not.toContain('expectedAuthority');
  });
});

/**
 * AVG-12 containment (ADR-0130).
 *
 * The scans here differ from every earlier stage's in one way worth naming. AVG-12 legitimately
 * DRIVES the canonical functions adversarially: it calls `completeCoreActiveHandoff`, it names
 * `HANDED_OFF_TO_ANISHA` and `AWAITING_CORE_ACTIVATION`, and it reads `ELIGIBLE_CORE_STATUSES` —
 * because proving those boundaries hold is the entire point of a red-team corpus. So a token ban
 * would be the wrong instrument, and what is asserted instead is that every one of those calls is
 * a REFUSAL being demonstrated, that nothing certified is mutated by running the corpus, and that
 * the module acquires no capability of its own.
 */
describe('AVG-12 evaluates, and adds no capability of any kind', () => {
  const avg12 = (): string =>
    codeOnly(
      readFileSync(join(SRC, 'contracts', 'avg12-scale-evaluation-controlled-autonomy.ts'), 'utf8'),
    );

  it('adds no scale infrastructure — this stage measures bounds, it does not build capacity', () => {
    // "Scale" is the word most likely to attract a queue. The overlay sentence is about bounded
    // volume and fail-closed behaviour; a worker, a scheduler or a benchmark harness would be a
    // different stage entirely, and one this ADR does not authorize.
    const code = avg12();
    for (const forbidden of [
      'worker_threads',
      'node:cluster',
      'node:perf_hooks',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'BullMQ',
      'bullmq',
      'ioredis',
      'redis',
      'kafka',
      'rabbit',
      'autocannon',
      'benchmark(',
      'bench(',
      'loadTest',
      'stressTest',
      'concurrency',
      'throughput',
      'poolSize',
      'maxSockets',
      'horizontalScale',
      'autoscal',
      'loadBalancer',
    ]) {
      expect(code, 'AVG-12 must not name ' + forbidden).not.toContain(forbidden);
    }
  });

  it('reads no clock and rolls no dice, so a replay is a replay', () => {
    // Determinism is a load-bearing AVG-12 property and it is cheap to lose: one `Date.now()` in a
    // builder makes every report unrepeatable, and one `Math.random()` makes the corpus a sample.
    // `new Date(...)` WITH an argument is arithmetic over an injected instant and stays allowed;
    // the no-argument form reads the system clock and does not.
    const code = avg12();
    for (const forbidden of ['Date.now', 'Math.random', 'performance.now', 'hrtime', 'crypto.']) {
      expect(code, 'AVG-12 must not name ' + forbidden).not.toContain(forbidden);
    }
    expect(code, 'AVG-12 must not construct a Date from the clock').not.toMatch(
      /new\s+Date\s*\(\s*\)/u,
    );
  });

  it('pins the whole AVG-12 ceiling in the SCHEMA, not merely in the value', () => {
    // Asserted against the schema rather than a built value, because a value can be rebuilt and a
    // schema cannot be talked around. Every authority a controlled-autonomy stage might be thought
    // to confer is a `z.literal(false)` here.
    const code = avg12();
    for (const pinned of [
      'businessAuthorityExpanded: z.literal(false)',
      'contactAuthorityGranted: z.literal(false)',
      'consentAuthorityGranted: z.literal(false)',
      'suppressionAuthorityGranted: z.literal(false)',
      'approvalAuthorityGranted: z.literal(false)',
      'executionAuthorityGranted: z.literal(false)',
      'sendAuthorityGranted: z.literal(false)',
      'coreMutationAuthorityGranted: z.literal(false)',
      'registrationAuthorityGranted: z.literal(false)',
      'paymentAuthorityGranted: z.literal(false)',
      'activationAuthorityGranted: z.literal(false)',
      'rolloutAuthorityGranted: z.literal(false)',
      'coreWriteExecuted: z.literal(false)',
      'coldGateWidened: z.literal(false)',
      'acquisitionCaseMutated: z.literal(false)',
      'anishaHandoffExecuted: z.literal(false)',
      'communicationAuthorizationCreated: z.literal(false)',
      'executionIntentCreated: z.literal(false)',
      'n8nExecutionRequested: z.literal(false)',
      'providerSendRequested: z.literal(false)',
      'channelSendRequested: z.literal(false)',
      'modelCallExecuted: z.literal(false)',
      'promptResolved: z.literal(false)',
      'retrievalExecuted: z.literal(false)',
      'persisted: z.literal(false)',
      'liveCoreConnected: z.literal(false)',
      'productionActivated: z.literal(false)',
      'productionMutation: z.literal(false)',
      'businessEffect: z.literal(false)',
      'fullAarohiCertificationClaimed: z.literal(false)',
      'offlineOnly: z.literal(true)',
      'failClosed: z.literal(true)',
    ]) {
      expect(code, 'AVG-12 must pin ' + pinned).toContain(pinned);
    }
  });

  it('drives the canonical handoff only to be REFUSED, and adds no second route', () => {
    const code = avg12();
    // It calls AVG-1's own function, which is the point. What it must not do is add a route.
    expect(code).toContain('completeCoreActiveHandoff(');
    for (const forbidden of [
      'completeAvg12Handoff',
      'forceHandoff',
      'handoffToAnisha',
      'transitionToAnisha',
      'markHandedOff',
      'openAcquisitionCase',
      'grantHandoff',
      'promoteCase',
      'bridgeToActivation',
      'enterActivationBoundary',
      'continueAfterRegistration',
    ]) {
      expect(code, 'AVG-12 must not name ' + forbidden).not.toContain(forbidden);
    }
    // And a SUCCESSFUL handoff inside a red-team corpus would be the one fixture that must not
    // exist. It would leave a trace, so the assertion is behavioural rather than textual: nothing
    // the corpus produces may carry an acquisition-case state of any kind, terminal or otherwise.
    const produced = evaluateAarohiOfflineSuite({
      suiteRef: 'AVG12-CONTAINMENT',
      preparedAt: '2026-03-01T09:00:00.000Z',
      probes: [...AAROHI_OFFLINE_PROBES],
    });
    expect(produced.ok).toBe(true);
    if (produced.ok) {
      const serialized = JSON.stringify(produced.report);
      for (const state of ACQUISITION_CASE_STATES) {
        expect(serialized, state).not.toContain(state);
      }
    }
  });

  it('reads the cold gate and never writes it', () => {
    const code = avg12();
    // Reading `ELIGIBLE_CORE_STATUSES` is how the corpus proves the gate is one status wide.
    expect(code).toContain('ELIGIBLE_CORE_STATUSES');
    for (const forbidden of [
      'ELIGIBLE_CORE_STATUSES =',
      'ELIGIBLE_CORE_STATUSES.push',
      'CORE_STATUS_ROLE =',
      'ACQUISITION_CASE_TRANSITIONS =',
      'widenGate',
      'allowRegistered',
      'admitRegistered',
    ]) {
      expect(code, 'AVG-12 must not name ' + forbidden).not.toContain(forbidden);
    }
    // Reading a certified table is how the handoff-boundary probes prove the two bridges are
    // absent, so the ban is on ASSIGNING into one rather than on naming one. The tables are frozen,
    // and a spec below re-reads them after a full corpus run to prove nothing moved.
    for (const write of [
      /ELIGIBLE_CORE_STATUSES\s*\[[^\]]*\]\s*=[^=]/u,
      /CORE_STATUS_ROLE\s*\[[^\]]*\]\s*=[^=]/u,
      /ACQUISITION_CASE_TRANSITIONS\s*\[[^\]]*\]\s*=[^=]/u,
      /AAROHI_STAGE_AUTHORITY\s*\[[^\]]*\]\s*=[^=]/u,
    ]) {
      expect(code, 'AVG-12 must not write ' + String(write)).not.toMatch(write);
    }
  });

  it('leaves every certified constant exactly as it found it after a full corpus run', () => {
    // The strongest version of the claim above: run the whole corpus, then re-read the constants it
    // touched. A probe that mutated a frozen sibling value would be caught here rather than by
    // whichever spec happened to run afterwards.
    const before = JSON.stringify({
      eligible: ELIGIBLE_CORE_STATUSES,
      transitions: ACQUISITION_CASE_TRANSITIONS,
      stages: AAROHI_FUNNEL_STAGES,
      authority: AAROHI_STAGE_AUTHORITY,
      posture: AAROHI_AVG12_POSTURE,
    });
    const result = evaluateAarohiOfflineSuite({
      suiteRef: 'AVG12-CONTAINMENT',
      preparedAt: '2026-03-01T09:00:00.000Z',
      probes: [...AAROHI_OFFLINE_PROBES],
    });
    expect(result.ok).toBe(true);
    expect(
      JSON.stringify({
        eligible: ELIGIBLE_CORE_STATUSES,
        transitions: ACQUISITION_CASE_TRANSITIONS,
        stages: AAROHI_FUNNEL_STAGES,
        authority: AAROHI_STAGE_AUTHORITY,
        posture: AAROHI_AVG12_POSTURE,
      }),
    ).toBe(before);
    expect([...ELIGIBLE_CORE_STATUSES]).toStrictEqual(['NOT_REGISTERED']);
  });

  it('takes no evaluation result and no decision as INPUT, which is the whole correction', () => {
    // The defect an owner review found: `decideAarohiControlledAutonomy` used to accept an offline
    // evaluation report and let a passing one unlock the top rung. A report is a value, so a caller
    // who had never run the corpus could write a consistent PASS and raise its own ceiling.
    //
    // Shape validity is not derivation and a parser is not an authority, so the fix is not a better
    // parser -- it is that NOTHING here accepts one. Asserted against the INPUT SCHEMAS, because
    // that is where an input would have to reappear.
    const code = avg12();
    const inputSchemas = [
      ...code.matchAll(/const (\w*InputSchema) = z\s*\n?\s*\.object\(\{([^}]*)\}/gu),
    ];
    expect(inputSchemas.length, 'AVG-12 must declare its input schemas as strict objects').toBe(2);
    for (const [, name, body] of inputSchemas) {
      for (const forbidden of [
        'offlineEvaluation',
        'evaluation:',
        'evaluationReport',
        'evaluationPassed',
        'readiness',
        'report:',
        'decision:',
        'priorDecision',
        'grantedLevel',
        'outcome',
      ]) {
        expect(body, `${String(name)} must not accept ${forbidden}`).not.toContain(forbidden);
      }
    }
    // Both are strict, so an extra key is a refusal rather than a silently ignored field.
    expect(code.match(/\.strict\(\)/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('keeps both shape parsers internal, and exports neither', () => {
    const code = avg12();
    // They exist, and the deriving functions use them to validate their OWN output.
    expect(code).toContain('function parseAarohiOfflineEvaluationReport(');
    expect(code).toContain('function parseAarohiControlledAutonomyDecision(');
    // But neither is exported, because a public `parse*` returning a certified-looking artifact
    // reads as provenance and can only prove a shape.
    expect(code).not.toContain('export function parseAarohiOfflineEvaluationReport');
    expect(code).not.toContain('export function parseAarohiControlledAutonomyDecision');
    const barrel = codeOnly(readFileSync(join(SRC, 'index.ts'), 'utf8'));
    expect(barrel).not.toContain('parseAarohiOfflineEvaluationReport');
    expect(barrel).not.toContain('parseAarohiControlledAutonomyDecision');
  });

  it('states the outcome rule as an EQUIVALENCE, not an implication', () => {
    // The one-way rule admitted a report saying FAILED while carrying no failure -- a state the
    // evaluator cannot produce, and one an earlier spec used as a convenience fixture.
    const code = avg12();
    expect(code).toContain("(value.outcome === 'OFFLINE_EVALUATION_PASSED') ===");
    expect(code).toContain('(value.probesFailed === 0 && value.criticalFailures === 0)');
  });

  it('builds no complete passing report of its own anywhere in production source', () => {
    // An earlier revision carried a private `passingEvaluationValue(...)` helper that hand-built a
    // whole `OFFLINE_EVALUATION_PASSED` report and fed it to the decision path without running the
    // suite. It was a demonstration of the exact weakness, sitting inside the module that had it.
    const code = avg12();
    for (const forbidden of [
      'passingEvaluationValue',
      'fabricatedReport',
      'syntheticReport',
      'assumePassed',
      "outcome: 'OFFLINE_EVALUATION_PASSED'",
    ]) {
      expect(code, 'AVG-12 must not name ' + forbidden).not.toContain(forbidden);
    }
    // The token exists in exactly one shape: DERIVED from the probe tallies.
    expect(code).toContain("? 'OFFLINE_EVALUATION_PASSED'");
  });

  it('restates the shared grammars rather than narrowing them', () => {
    // AVG-12 restates the opaque-reference grammar and the canonical-instant grammar, for the reason
    // ADR-0124 records. Restating means they can DRIFT, so the two are compared as text against the
    // sibling that owns the same restatement — the trade AVG-11 already makes.
    const twelve = avg12();
    const eleven = codeOnly(
      readFileSync(join(SRC, 'contracts', 'avg11-analytics-admin-dashboard.ts'), 'utf8'),
    );
    for (const grammar of [
      'const UTC_INSTANT_PATTERN = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{3}))?Z$/u;',
      'const MAX_NON_DESTINATION_DIGITS = 6;',
    ]) {
      expect(twelve, 'AVG-12 grammar').toContain(grammar);
      expect(eleven, 'AVG-11 grammar').toContain(grammar);
    }
  });

  it('declares the AVG-12 ceiling as literal falsehoods, complete in both directions', () => {
    const posture = AAROHI_AVG12_POSTURE as unknown as Readonly<Record<string, unknown>>;
    const DECLARED_TRUE = [
      'offlineOnly',
      'failClosed',
      'requiresExistingGovernedAuthorityForAnyFutureAction',
      'requiresCoreAuthorityForAnyBusinessOutcome',
      'requiresSeparateCertificationBeforeIntegration',
      'requiresSeparateActivatingAdrBeforeRuntimeUse',
    ];
    expect(
      Object.entries(posture)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort(),
    ).toStrictEqual([...DECLARED_TRUE].sort());
    // Everything else is false, and there is nothing in the posture that is neither.
    expect(
      Object.entries(posture).filter(([, value]) => value !== true && value !== false),
    ).toStrictEqual([]);
    for (const forged of [
      { businessAuthorityExpanded: true },
      { sendAuthorityGranted: true },
      { rolloutAuthorityGranted: true },
      { productionActivated: true },
      { fullAarohiCertificationClaimed: true },
      { coldGateWidened: true },
      { offlineOnly: false },
      { failClosed: false },
      { requiresSeparateCertificationBeforeIntegration: false },
    ]) {
      expect(
        aarohiAvg12PostureSchema.safeParse({ ...posture, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });
});

/**
 * The capability ban, applied to the WHOLE package rather than to one stage.
 *
 * AVG-11's owner review moved this scanner from case-sensitive to case-insensitive after a mutation
 * survived by spelling `AUTONOMY_LEVEL` in capitals. That strength is preserved and extended: the
 * words `autonomy`, `evaluation` and `scale` are now legitimate here and are NOT banned — what is
 * banned is the CAPABILITY a phrase would describe, matched across whatever separator somebody
 * reaches for. A ban that only catches one spelling is a ban on a naming convention.
 */
describe('no file in this package names a capability the architecture forbids', () => {
  /** `['auto','send']` matches autoSend, auto_send, auto-send, auto.send and "auto send". */
  const capability = (words: readonly string[]): RegExp =>
    new RegExp(words.join('[\\s_.\\-]*'), 'iu');

  const FORBIDDEN_CAPABILITIES: readonly (readonly string[])[] = Object.freeze([
    ['auto', 'send'],
    ['auto', 'approve'],
    ['auto', 'execute'],
    ['auto', 'outreach'],
    ['auto', 'promote'],
    ['autonomous', 'send'],
    ['autonomous', 'execution'],
    ['unsupervised', 'send'],
    ['unsupervised', 'execution'],
    ['full', 'auto'],
    ['enable', 'rollout'],
    ['activate', 'production'],
    ['promote', 'to', 'production'],
    ['go', 'live'],
    ['bypass', 'approval'],
    ['bypass', 'consent'],
    ['skip', 'approval'],
    ['override', 'stop'],
    ['ignore', 'stop'],
    ['ignore', 'suppression'],
    ['infer', 'active'],
    ['assume', 'active'],
    ['self', 'approve'],
    ['force', 'handoff'],
    ['learned', 'policy'],
    ['scale', 'out'],
  ]);

  it('names none of them, in any casing and under any separator', () => {
    for (const { file, code } of productionFiles()) {
      for (const words of FORBIDDEN_CAPABILITIES) {
        expect(code, `${file} must not name ${words.join(' ')}`).not.toMatch(capability(words));
      }
    }
  });

  it('does not ban the legitimate AVG-12 words, which would be the wrong lesson', () => {
    // A regression guard on the guard. `autonomy`, `evaluation` and `scale` are this stage's
    // subject matter; banning them would force the contract to be renamed around a grep, which is
    // exactly the trade the AVG-5 review rejected.
    const code = codeOnly(
      readFileSync(join(SRC, 'contracts', 'avg12-scale-evaluation-controlled-autonomy.ts'), 'utf8'),
    );
    for (const legitimate of ['autonomy', 'evaluation', 'scale', 'probe']) {
      expect(code.toLowerCase(), legitimate).toContain(legitimate);
    }
    for (const words of FORBIDDEN_CAPABILITIES) {
      expect(code, words.join(' ')).not.toMatch(capability(words));
    }
  });
});
