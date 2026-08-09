/**
 * RWC-P6B — containment for the structured-action capability (ADR-0102).
 *
 * The behaviour specs prove what the four actions do. These prove what they cannot do at all.
 *
 * The upward direction is the one that matters here. A structured action produces `user_confirmed` and
 * `COMPLETE`, the two strongest claims Riya can make about a conversation, and ADR-0101 §2 put them
 * behind a structured surface precisely so no inference could produce them. So this file's central
 * assertion is unglamorous and absolute: **no model, no prompt, no runtime, no generated text,
 * anywhere on this path.** A composition that asked a model to phrase the acknowledgement would have
 * re-opened the door one layer up, and it would look entirely reasonable in review.
 *
 * Scans read production source with comments stripped: this capability necessarily NAMES the things it
 * refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const read = (relative: string): string => codeOnly(readFileSync(`${SRC}${relative}`, 'utf8'));

/** Every file that makes up the structured-action capability, and only those. */
const structuredCode = (): string =>
  [
    'service/create-structured-action-service.ts',
    'contracts/structured-actions.ts',
    'contracts/structured-action-result.ts',
    'internal/submission-identity.ts',
    'internal/discovery-input.ts',
  ]
    .map(read)
    .join('\n');

const forbid = (code: string, values: readonly string[]): void => {
  for (const forbidden of values) {
    expect({
      forbidden,
      present: code.toLowerCase().includes(forbidden.toLowerCase()),
    }).toStrictEqual({ forbidden, present: false });
  }
};

describe('a structured action consults no model and no runtime', () => {
  it('names no model, prompt, gateway or reply capability', () => {
    forbid(structuredCode(), [
      'model-gateway',
      'model-reply-adapter',
      'ModelGatewayInvoker',
      'riya-model-interaction',
      'structuredOutputProfile',
      'promptRef',
      'promptText',
      'draftReply',
      'openai',
      'anthropic',
      'groq',
      'temperature',
    ]);
  });

  it('never reaches the JarvisRuntime, and holds no envelope', () => {
    // The text turn delegates exactly once to the runtime. A structured action delegates NOWHERE:
    // there is no orchestration to run, because there is nothing to decide that a model could help
    // with.
    forbid(structuredCode(), [
      'jarvis-runtime',
      'JarvisRuntime',
      'processInbound',
      'InboundEnvelope',
      'buildWebInboundEnvelope',
      'runtimeId',
      'agent-runtime',
    ]);
  });

  it('generates no client-facing text of any kind', () => {
    forbid(structuredCode(), [
      'replyBody',
      'authorizedReply',
      'acknowledgement',
      'template',
      'toLocaleString',
      'Intl.',
    ]);
    // And the result type has no text field. Read from source, because the absence is the contract.
    const result = read('contracts/structured-action-result.ts');
    expect(result).not.toMatch(/\b(body|text|message|reply|draft)\s*[?]?\s*:/u);
  });
});

describe('it reaches nothing, and invents nothing', () => {
  it('holds no transport, database, environment read, clock or randomness', () => {
    forbid(structuredCode(), [
      'fetch(',
      'node:http',
      'node:https',
      'undici',
      'axios',
      'https://',
      'apiKey',
      'Bearer',
      "'pg'",
      'DATABASE_URL',
      'connectionString',
      'process.env',
      'SELECT ',
      'INSERT ',
      'CREATE TABLE',
      'migration',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'hrtime',
      'setTimeout',
      'n8n',
      'webhook',
      'quickfurno.',
    ]);
  });

  it('the ONLY hash is the deterministic submission identity', () => {
    // A hash is otherwise exactly the shape a nonce would take, and a nonce in the key would make
    // every attempt a new enquiry.
    const identity = read('internal/submission-identity.ts');
    expect(identity).toContain("createHash('sha256')");
    expect(identity.match(/createHash\s*\(/gu) ?? []).toHaveLength(1);
    const rest = [
      'service/create-structured-action-service.ts',
      'contracts/structured-actions.ts',
      'contracts/structured-action-result.ts',
      'internal/discovery-input.ts',
    ]
      .map(read)
      .join('\n');
    forbid(rest, ['createHash', 'node:crypto', 'digest(']);
  });

  it('invents no city, no service and no availability fallback', () => {
    forbid(structuredCode(), [
      'pune',
      'mumbai',
      'bengaluru',
      'delhi',
      'defaultCity',
      'fallbackCity',
      'assumeAvailable',
      'allowAllCities',
      'cachedSnapshot',
    ]);
  });
});

describe('it decides nothing that belongs to Core, and stores nothing personal', () => {
  it('writes no consent and creates no lead', () => {
    forbid(structuredCode(), [
      'grantConsent',
      'recordConsent',
      'setConsent',
      'captureContact',
      'createLead',
      'assignVendor',
      'canSubmit',
      'isAuthorized',
    ]);
  });

  it('holds no raw contact, transcript or business payload', () => {
    forbid(structuredCode(), [
      'phoneNumber',
      'emailAddress',
      'customerName',
      'firstName',
      'consentText',
      'consentWording',
      'transcript',
      'normalizedText',
      'conversationHistory',
      'rollingSummary',
      'leadId',
      'leadRef',
      'price',
      'payment',
      'latitude',
    ]);
  });

  it('the contact evidence is passed and never retained', () => {
    const service = read('service/create-structured-action-service.ts');
    // Exactly one mention on the contact path, as the argument to the RWC-P6A reducer that discards
    // it. It reaches no result builder, no state and no error.
    expect(service).toContain('contactEvidenceRef: state.contact.evidenceRef');
    expect(service).not.toMatch(/contactEvidenceRef\s*[,)}]/u);
    expect(service).not.toMatch(/declined\([^)]*contact\.evidenceRef/u);
  });
});

describe('the bounded call counts are readable off the page', () => {
  const service = () => read('service/create-structured-action-service.ts');

  it('there is exactly ONE availability read site, and it is not in a reconciliation', () => {
    expect(service().match(/availabilityReader\s*\.\s*readCurrent\s*\(/gu) ?? []).toHaveLength(1);
    const reconciliation = service().slice(
      service().indexOf('async function persistCompletion'),
      service().indexOf('async function applyCoreResult'),
    );
    expect(reconciliation.length).toBeGreaterThan(0);
    expect(reconciliation).not.toMatch(/availabilityReader|parseCoreServiceAvailability/u);
  });

  it('the accepted-result reconciliation repeats NO Core call at all', () => {
    // The mutation already succeeded. Re-reading Core would invite a different answer, and
    // re-submitting would create the second enquiry this whole slice exists to prevent.
    const reconciliation = service().slice(
      service().indexOf('async function persistCompletion'),
      service().indexOf('async function applyCoreResult'),
    );
    expect(reconciliation).not.toMatch(/coreIntakePort/u);
    // ONE reload, and at most two attempts.
    expect(reconciliation.match(/continuityStore\s*\.\s*load\s*\(/gu) ?? []).toHaveLength(1);
    expect(reconciliation.match(/attempt\s*\(/gu) ?? []).toHaveLength(2);
  });

  it('there is exactly ONE submit site and ONE Core state read site', () => {
    expect(service().match(/coreIntakePort\s*\.\s*submit\s*\(/gu) ?? []).toHaveLength(1);
    expect(service().match(/coreIntakePort\s*\.\s*readCurrent\s*\(/gu) ?? []).toHaveLength(1);
  });

  it('there are exactly TWO lookup sites: the guard, and the ONE authorized recovery', () => {
    expect(service().match(/coreIntakePort\s*\.\s*lookupSubmission\s*\(/gu) ?? []).toHaveLength(2);
    // The recovery is straight-line and calls itself nowhere, so "at most one recovery" is a property
    // of the shape rather than of an argument about control flow.
    const recovery = service().slice(
      service().indexOf('async function recoverIndeterminate'),
      service().indexOf('async function submitConfirmedIntake'),
    );
    expect(recovery.match(/coreIntakePort\s*\.\s*lookupSubmission\s*\(/gu) ?? []).toHaveLength(1);
    expect(recovery).not.toMatch(/coreIntakePort\s*\.\s*submit\s*\(/u);
    // Exactly ONE mention of its own name in that span -- the declaration. A recursive call would be
    // a second, and an unbounded recovery loop is precisely what it would become.
    expect(recovery.match(/recoverIndeterminate/gu) ?? []).toHaveLength(1);
  });

  it('there are exactly TWO compare-and-set sites, and no loop anywhere', () => {
    // One shared `attempt` helper, called from `persistOnce` and twice from `persistCompletion` —
    // but only ONE place in the file actually touches the store.
    expect(service().match(/continuityStore\s*\.\s*compareAndSet\s*\(/gu) ?? []).toHaveLength(1);
    expect(service().match(/continuityStore\s*\.\s*load\s*\(/gu) ?? []).toHaveLength(2);
    expect(structuredCode()).not.toMatch(/\bwhile\s*\(|\bfor\s*\(|\bdo\s*\{/u);
  });
});

describe('the idempotency identity is the frozen business identity, and nothing else', () => {
  const identity = () => read('internal/submission-identity.ts');

  it('the preimage names exactly the eleven locked slots', () => {
    const preimage = identity().slice(
      identity().indexOf('JSON.stringify(['),
      identity().indexOf(']);'),
    );
    expect(preimage).toContain('input.tenantId');
    expect(preimage).toContain('input.conversationId');
    expect(preimage).toContain('input.subjectRef');
    for (const slot of [
      'serviceInterestRef',
      'locationRef',
      'propertyTypeRef',
      'scopeSummary',
      'budgetNote',
      'timelineNote',
      'consultationPreferenceRef',
    ]) {
      expect(preimage, slot).toContain(`discovery.${slot}`);
    }
  });

  it('the preimage excludes every volatile input', () => {
    const preimage = identity().slice(
      identity().indexOf('JSON.stringify(['),
      identity().indexOf(']);'),
    );
    for (const forbidden of [
      'continuityRevision',
      'actionRef',
      'intakeStateRef',
      'availabilitySnapshotRef',
      'taxonomyVersion',
      'evidenceRef',
      'nonce',
      'Date',
      'random',
    ]) {
      expect(preimage, forbidden).not.toContain(forbidden);
    }
  });

  it('the preimage is never logged, returned or put in an error', () => {
    forbid(identity(), ['console.', 'logger', 'return preimage', 'Error(preimage']);
    // It appears exactly twice: where it is built, and where it is hashed. Nowhere else -- it is a
    // description of a real person's home.
    expect(identity().match(/\bpreimage\b/gu) ?? []).toHaveLength(2);
  });

  it('there is no local idempotency grammar: the ONE shared schema is imported', () => {
    expect(identity()).toContain("import { idempotencyKeySchema } from '@qf-jarvis/contracts'");
    expect(structuredCode()).not.toMatch(/min\(\s*16\s*\)/u);
    expect(structuredCode()).not.toMatch(/MIN_IDEMPOTENCY_KEY_LENGTH/u);
  });

  it('there is no second Core availability pair rule', () => {
    const code = structuredCode();
    // The three shared predicates are IMPORTED. A local one would not diverge on the day it was
    // written; it would diverge on the day the shared one was corrected.
    expect(code).toContain("from '@qf-jarvis/core-service-availability-read/policy'");
    for (const forbidden of ['cityRefs', 'availability.find', 'includes(cityRef']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the structured surface is minimal, and hides its own machinery', () => {
  it('exports the three approved runtime values and no helper', () => {
    expect(Object.keys(barrel)).toContain('createRiyaStructuredActionService');
    expect(Object.keys(barrel)).toContain('RIYA_STRUCTURED_ACTION_DISPOSITIONS');
    expect(Object.keys(barrel)).toContain('RIYA_STRUCTURED_ACTION_REASON_CODES');
    for (const forbidden of [
      'riyaIntakeIdempotencyKey',
      'RIYA_INTAKE_IDEMPOTENCY_PREFIX',
      'needDiscoveryInputOf',
      'riyaSummaryEditActionSchema',
      'riyaSummaryConfirmActionSchema',
      'riyaContactAdvanceActionSchema',
      'riyaIntakeSubmissionActionSchema',
      'coreAvailabilityBlocks',
      'effectiveRef',
      'InMemoryContinuityStore',
      'queuedCoreIntakePort',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('the existing text-turn surface is untouched', () => {
    // Backward compatibility, stated as an assertion rather than an intention.
    for (const kept of [
      'createRiyaWebConversationService',
      'RIYA_WEB_CONVERSATION_DISPOSITIONS',
      'RIYA_WEB_CONVERSATION_ERROR_CODES',
      'RiyaWebConversationError',
    ]) {
      expect(Object.keys(barrel), kept).toContain(kept);
    }
    const textService = read('service/create-service.ts');
    // The text-turn config gained nothing. A conversational deployment must not have to supply a Core
    // intake adapter it never calls.
    expect(textService).not.toContain('coreIntakePort');
    expect(textService).not.toContain('core-riya-intake');
    expect(textService).not.toContain('riya-conversation-completion');
    const config = textService.slice(
      textService.indexOf('export interface RiyaWebConversationServiceConfig'),
      textService.indexOf('export interface RiyaWebConversationService {'),
    );
    expect(config).toContain('runtime:');
    expect(config).toContain('continuityStore:');
    expect(config).toContain('availabilityReader:');
    expect(config).toContain('runtimeId:');
  });

  it('the two services share no state and no constructor', () => {
    const structured = read('service/create-structured-action-service.ts');
    expect(structured).not.toContain('createRiyaWebConversationService');
    expect(read('service/create-service.ts')).not.toContain('createRiyaStructuredActionService');
  });

  it('deep-imports no private module of another package', () => {
    // `/policy` and `/testing` are published SUBPATHS, not internals.
    expect(structuredCode()).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal|composition)\//u);
  });
});
