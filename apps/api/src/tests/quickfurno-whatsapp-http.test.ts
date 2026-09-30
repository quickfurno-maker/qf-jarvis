import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createQuickFurnoWhatsAppAuthorityReader,
  createQuickFurnoWhatsAppConversationContextReader,
  createQuickFurnoWhatsAppMaterialReader,
  createQuickFurnoWhatsAppReplyWriter,
  type QuickFurnoWhatsAppHttpPost,
} from '../quickfurno-whatsapp/quickfurno-http.js';
import {
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH,
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN,
  QFJ_WHATSAPP_REPLY_PATH,
  QFJ_WHATSAPP_REPLY_QUALIFICATION_SIGNING_DOMAIN,
  QFJ_WHATSAPP_REPLY_JOURNEY_SIGNING_DOMAIN,
  QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
  QFJ_WHATSAPP_TURN_MATERIAL_PATH,
  QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
} from '../quickfurno-whatsapp/contracts.js';

const keys = generateKeyPairSync('ed25519');
const keyId = 'jarvis-test';
const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const requestIds = ['11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555'];

function bodyDigest(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}
function signingInput(
  domain: string,
  pathName: string,
  requestId: string,
  issuedAt: string,
  body: string,
): string {
  return [
    domain,
    'POST',
    pathName,
    'qf-jarvis',
    'quickfurno-core',
    requestId,
    issuedAt,
    keyId,
    bodyDigest(body),
  ].join('\n');
}
function config(httpPost: QuickFurnoWhatsAppHttpPost) {
  let index = 0;
  return {
    baseUrl: 'https://quickfurno.example/',
    keyId,
    privateKeyPem,
    clock: () => '2026-09-18T12:00:00.000Z',
    requestId: () => requestIds[index++] ?? '99999999-9999-4999-8999-999999999999',
    httpPost,
  };
}
function authorityResponse(
  request: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 2,
    requestId: request['requestId'],
    tenantId: 'quickfurno',
    conversationId: request['conversationId'],
    revision: request['expectedRevision'] ?? 7,
    assignedActor: 'RIYA',
    subjectType: 'client',
    partyType: 'CLIENT',
    conversationState: 'OPEN',
    jarvisAllowed: true,
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('QuickFurno WhatsApp signed HTTP clients', () => {
  it('material reader signs the exact bytes and accepts only the bound response identity', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
              QFJ_WHATSAPP_TURN_MATERIAL_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      const responseBody = {
        ...authorityResponse(request, { dataClass: 'LOCAL_ONLY' }),
        inboundMessageId: request['inboundMessageId'],
        receivedAt: '2026-09-18T12:00:00.000Z',
        inbound: {
          version: 1,
          messageType: 'image',
          normalizedText: '[Attachment: image; content not inspected] Caption: Need this style',
          attachment: {
            kind: 'image',
            mediaId: 'media-123',
            mimeType: 'image/jpeg',
            caption: 'Need this style',
          },
          replyContext: { providerMessageId: 'wamid.parent' },
          referral: { sourceType: 'ad', sourceId: 'ad-123' },
        },
        normalizedText: '[Attachment: image; content not inspected] Caption: Need this style',
      };
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify(responseBody)),
      });
    });
    const reader = createQuickFurnoWhatsAppMaterialReader(config(post));
    const result = await reader.read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    });
    expect(result).toMatchObject({
      assignedActor: 'RIYA',
      subjectType: 'client',
      tenantId: 'quickfurno',
    });
    expect('purpose' in result).toBe(false);
    if ('purpose' in result) throw new Error('expected-conversation-material');
    expect(result.inbound).toMatchObject({
      messageType: 'image',
      attachment: { mediaId: 'media-123' },
      replyContext: { providerMessageId: 'wamid.parent' },
    });
    expect(post).toHaveBeenCalledOnce();
  });

  it('accepts a bounded returning-client V2 journey without weakening the V1 authority checks', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...authorityResponse(request),
              inboundMessageId: request['inboundMessageId'],
              receivedAt: '2026-09-30T04:00:00.000Z',
              inbound: { version: 1, messageType: 'text', normalizedText: 'Need painting now' },
              normalizedText: 'Need painting now',
              clientJourney: {
                version: 2,
                profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                profileRevision: 12,
                profileStatus: 'known',
                isFirstContact: false,
                isReturningClient: true,
                createdAt: '2025-09-10T05:00:00.000Z',
                lastSeenAt: '2026-09-30T04:00:00.000Z',
                name: 'Rahul',
                preferredLanguage: 'hinglish',
                missing: [],
                activeRequirement: {
                  requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  revision: 4,
                  status: 'discovering',
                  phase: 'PROJECT_DETAILS',
                  summaryConfirmed: false,
                  provenance: {
                    serviceInterest: 'user_stated',
                    location: 'user_stated',
                    budget: 'user_stated',
                    timeline: 'user_stated',
                  },
                  serviceInterest: 'PAINTING',
                  location: 'BANER',
                  budget: 'OPEN',
                  timeline: 'NOW',
                },
                properties: [
                  {
                    propertyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                    relation: 'current',
                    area: 'Baner',
                    propertyType: 'Apartment',
                    bhk: '3BHK',
                    projectStage: 'occupied',
                  },
                ],
                pastRequirements: [
                  {
                    requirementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                    categoryRef: 'INTERIOR_DESIGN',
                    propertyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                    status: 'converted',
                    closedAt: '2025-12-01T10:00:00.000Z',
                  },
                ],
              },
              coreAvailability: {
                version: 1,
                snapshotRef: 'availability.1',
                taxonomyVersion: 1,
                cities: [{ ref: 'PUNE', displayName: 'Pune' }],
                services: [{ ref: 'PAINTING', displayName: 'Painting' }],
                availability: [{ serviceRef: 'PAINTING', cityRefs: ['PUNE'] }],
              },
            }),
          ),
      });
    });
    const result = await createQuickFurnoWhatsAppMaterialReader(config(post)).read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    });
    if ('purpose' in result) throw new Error('expected-conversation-material');
    expect(result.clientJourney).toMatchObject({
      version: 2,
      isReturningClient: true,
      name: 'Rahul',
      properties: [{ area: 'Baner', bhk: '3BHK' }],
      pastRequirements: [{ categoryRef: 'INTERIOR_DESIGN', status: 'converted' }],
    });
  });


  it('accepts a Core match-readiness decision bound to the active requirement revision', async () => {
    const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...authorityResponse(request),
              inboundMessageId: request['inboundMessageId'],
              receivedAt: '2026-09-30T04:00:00.000Z',
              inbound: {
                version: 1,
                messageType: 'text',
                normalizedText: 'Please send me 3 vendors nearby',
              },
              normalizedText: 'Please send me 3 vendors nearby',
              clientJourney: {
                version: 1,
                profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                profileRevision: 5,
                profileStatus: 'known',
                isFirstContact: false,
                name: 'Rahul',
                missing: [],
                activeRequirement: {
                  requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  revision: 7,
                  status: 'ready_for_lead',
                  phase: 'SUMMARY',
                  summaryConfirmed: true,
                  provenance: {
                    serviceInterest: 'user_stated',
                    location: 'user_stated',
                  },
                  serviceInterest: 'INTERIOR_DESIGN',
                  location: 'BANER',
                },
              },
              clientMatchDecision: {
                version: 1,
                state: 'READY',
                requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                requirementRevision: 7,
                leadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                assignmentCount: 0,
                missingFields: [],
                reasonCode: 'MATCH_READY',
                coreReady: true,
                executionAuthorized: false,
              },
              coreAvailability: {
                version: 1,
                snapshotRef: 'availability.1',
                taxonomyVersion: 1,
                cities: [{ ref: 'BANER', displayName: 'Baner' }],
                services: [{ ref: 'INTERIOR_DESIGN', displayName: 'Interior Design' }],
                availability: [{ serviceRef: 'INTERIOR_DESIGN', cityRefs: ['BANER'] }],
              },
            }),
          ),
      });
    };

    const result = await createQuickFurnoWhatsAppMaterialReader(config(post)).read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    });
    if ('purpose' in result) throw new Error('expected-conversation-material');
    expect(result.clientMatchDecision).toMatchObject({
      state: 'READY',
      requirementRevision: 7,
      coreReady: true,
      assignmentCount: 0,
    });
  });


  it('accepts a coherent Core vendor-journey summary bound to matching state', async () => {
    const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...authorityResponse(request),
              inboundMessageId: request['inboundMessageId'],
              receivedAt: '2026-09-30T04:00:00.000Z',
              inbound: {
                version: 1,
                messageType: 'text',
                normalizedText: 'One vendor has not contacted me',
              },
              normalizedText: 'One vendor has not contacted me',
              clientJourney: {
                version: 1,
                profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                profileRevision: 5,
                profileStatus: 'known',
                isFirstContact: false,
                name: 'Rahul',
                missing: [],
                activeRequirement: {
                  requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  revision: 7,
                  status: 'ready_for_lead',
                  phase: 'SUMMARY',
                  summaryConfirmed: true,
                  provenance: {
                    serviceInterest: 'user_stated',
                    location: 'user_stated',
                  },
                  serviceInterest: 'INTERIOR_DESIGN',
                  location: 'BANER',
                },
              },
              clientMatchDecision: {
                version: 1,
                state: 'MATCHED',
                requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                requirementRevision: 7,
                leadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                assignmentCount: 3,
                missingFields: [],
                reasonCode: 'MATCH_BATCH_RELEASED',
                coreReady: false,
                executionAuthorized: false,
              },
              clientVendorJourney: {
                version: 1,
                requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                requirementRevision: 7,
                vendorsReleased: 3,
                vendorNoContactCount: 1,
                allReleasedVendorsContacted: false,
                satisfactionState: 'UNKNOWN',
                serviceRecoveryNeeded: false,
                reassignmentState: 'NONE',
                followUpDue: false,
              },
              coreAvailability: {
                version: 1,
                snapshotRef: 'availability.1',
                taxonomyVersion: 1,
                cities: [{ ref: 'BANER', displayName: 'Baner' }],
                services: [{ ref: 'INTERIOR_DESIGN', displayName: 'Interior Design' }],
                availability: [{ serviceRef: 'INTERIOR_DESIGN', cityRefs: ['BANER'] }],
              },
            }),
          ),
      });
    };

    const result = await createQuickFurnoWhatsAppMaterialReader(config(post)).read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    });
    if ('purpose' in result) throw new Error('expected-conversation-material');
    expect(result.clientVendorJourney).toMatchObject({
      vendorsReleased: 3,
      vendorNoContactCount: 1,
      allReleasedVendorsContacted: false,
      satisfactionState: 'UNKNOWN',
    });
  });

  it('rejects a Core match decision bound to a stale requirement revision', async () => {
    const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...authorityResponse(request),
              inboundMessageId: request['inboundMessageId'],
              receivedAt: '2026-09-30T04:00:00.000Z',
              inbound: { version: 1, messageType: 'text', normalizedText: 'Need vendors' },
              normalizedText: 'Need vendors',
              clientJourney: {
                version: 1,
                profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                profileRevision: 5,
                profileStatus: 'known',
                isFirstContact: false,
                name: 'Rahul',
                missing: [],
                activeRequirement: {
                  requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  revision: 7,
                  status: 'ready_for_lead',
                  phase: 'SUMMARY',
                  summaryConfirmed: true,
                  provenance: {
                    serviceInterest: 'user_stated',
                    location: 'user_stated',
                  },
                  serviceInterest: 'INTERIOR_DESIGN',
                  location: 'BANER',
                },
              },
              clientMatchDecision: {
                version: 1,
                state: 'READY',
                requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                requirementRevision: 6,
                leadId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                assignmentCount: 0,
                missingFields: [],
                reasonCode: 'MATCH_READY',
                coreReady: true,
                executionAuthorized: false,
              },
              coreAvailability: {
                version: 1,
                snapshotRef: 'availability.1',
                taxonomyVersion: 1,
                cities: [{ ref: 'BANER', displayName: 'Baner' }],
                services: [{ ref: 'INTERIOR_DESIGN', displayName: 'Interior Design' }],
                availability: [{ serviceRef: 'INTERIOR_DESIGN', cityRefs: ['BANER'] }],
              },
            }),
          ),
      });
    };

    await expect(
      createQuickFurnoWhatsAppMaterialReader(config(post)).read({
        conversationId: '22222222-2222-4222-8222-222222222222',
        inboundMessageId: '33333333-3333-4333-8333-333333333333',
        expectedRevision: 7,
      }),
    ).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('rejects contradictory V2 returning-client state before it reaches Riya', async () => {
    const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...authorityResponse(request),
              inboundMessageId: request['inboundMessageId'],
              receivedAt: '2026-09-30T04:00:00.000Z',
              inbound: { version: 1, messageType: 'text', normalizedText: 'Hi' },
              normalizedText: 'Hi',
              clientJourney: {
                version: 2,
                profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                profileRevision: 1,
                profileStatus: 'known',
                isFirstContact: true,
                isReturningClient: true,
                createdAt: '2025-09-10T05:00:00.000Z',
                lastSeenAt: '2026-09-30T04:00:00.000Z',
                missing: ['name', 'serviceInterest', 'location', 'budget', 'timeline'],
                activeRequirement: {
                  requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  revision: 0,
                  status: 'discovering',
                  phase: 'INTRO',
                  summaryConfirmed: false,
                  provenance: {},
                },
                properties: [],
                pastRequirements: [],
              },
              coreAvailability: {
                version: 1,
                snapshotRef: 'availability.1',
                taxonomyVersion: 1,
                cities: [],
                services: [],
                availability: [],
              },
            }),
          ),
      });
    };
    await expect(
      createQuickFurnoWhatsAppMaterialReader(config(post)).read({
        conversationId: '22222222-2222-4222-8222-222222222222',
        inboundMessageId: '33333333-3333-4333-8333-333333333333',
        expectedRevision: 7,
      }),
    ).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('conversation context reader signs the exact request and accepts only bounded non-authoritative context', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN,
              QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              protocol: 'qfj.whatsapp.conversation-context',
              version: 1,
              requestId: request['requestId'],
              tenantId: 'quickfurno',
              conversationId: request['conversationId'],
              revision: request['expectedRevision'],
              inboundMessageId: request['inboundMessageId'],
              context: {
                version: 1,
                authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT',
                text: 'USER: Earlier message',
                includedTurns: 1,
                truncated: false,
              },
            }),
          ),
      });
    });
    const reader = createQuickFurnoWhatsAppConversationContextReader(config(post));
    const result = await reader.read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    });
    expect(result.context).toEqual({
      version: 1,
      authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT',
      text: 'USER: Earlier message',
      includedTurns: 1,
      truncated: false,
    });
  });

  it('authority reader performs a signed content-free v2 read', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      expect(request).not.toHaveProperty('inboundMessageId');
      expect(request).not.toHaveProperty('expectedRevision');
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify(authorityResponse(request))),
      });
    });
    const reader = createQuickFurnoWhatsAppAuthorityReader(config(post));
    const authority = await reader.read({
      tenantId: 'quickfurno',
      conversationId: '22222222-2222-4222-8222-222222222222',
    });
    expect(authority).toMatchObject({
      tenantId: 'quickfurno',
      revision: 7,
      partyType: 'CLIENT',
      jarvisAllowed: true,
      subjectStatus: 'clear',
    });
    expect(post).toHaveBeenCalledOnce();
  });

  it('accepts only the bounded Riya first-contact authority state', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              authorityResponse(request, {
                assignedActor: 'RIYA',
                subjectType: 'client',
                partyType: 'CLIENT',
                dataClass: 'HOSTED_ALLOWED',
                subjectStatus: 'in-progress',
                subjectRef: undefined,
              }),
            ),
          ),
      });
    });
    const reader = createQuickFurnoWhatsAppAuthorityReader(config(post));
    const authority = await reader.read({
      tenantId: 'quickfurno',
      conversationId: '22222222-2222-4222-8222-222222222222',
    });
    expect(authority).toMatchObject({
      assignedActor: 'RIYA',
      subjectType: 'client',
      partyType: 'CLIENT',
      jarvisAllowed: true,
      dataClass: 'HOSTED_ALLOWED',
      subjectStatus: 'in-progress',
    });
    expect(authority).not.toHaveProperty('subjectRef');
  });

  it.each([
    ['vendor', 'ANISHA', 'VENDOR'],
    ['prospect', 'AAROHI', 'PROSPECT'],
  ])(
    'rejects first-contact authority without a durable subject for %s/%s',
    async (subjectType, assignedActor, partyType) => {
      const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
        const request = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(
                authorityResponse(request, {
                  subjectType,
                  assignedActor,
                  partyType,
                  subjectStatus: 'in-progress',
                  subjectRef: undefined,
                }),
              ),
            ),
        });
      };
      const reader = createQuickFurnoWhatsAppAuthorityReader(config(post));
      await expect(
        reader.read({
          tenantId: 'quickfurno',
          conversationId: '22222222-2222-4222-8222-222222222222',
        }),
      ).rejects.toMatchObject({ code: 'response-invalid' });
    },
  );

  it.each([
    ['client', 'ANISHA', 'CLIENT'],
    ['client', 'AAROHI', 'CLIENT'],
    ['vendor', 'RIYA', 'VENDOR'],
    ['vendor', 'AAROHI', 'VENDOR'],
    ['prospect', 'RIYA', 'PROSPECT'],
    ['prospect', 'ANISHA', 'PROSPECT'],
    ['client', 'HUMAN', 'CLIENT'],
    ['client', 'SYSTEM', 'CLIENT'],
    ['client', 'RIYA', 'VENDOR'],
  ])(
    'rejects jarvisAllowed authority drift for subject=%s actor=%s party=%s',
    async (subjectType, assignedActor, partyType) => {
      const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
        const request = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(authorityResponse(request, { subjectType, assignedActor, partyType })),
            ),
        });
      };
      const reader = createQuickFurnoWhatsAppAuthorityReader(config(post));
      await expect(
        reader.read({
          tenantId: 'quickfurno',
          conversationId: '22222222-2222-4222-8222-222222222222',
        }),
      ).rejects.toMatchObject({ code: 'response-invalid' });
    },
  );

  it('material reader rejects conflicting parallel text and structured material', async () => {
    const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...authorityResponse(request),
              inboundMessageId: request['inboundMessageId'],
              receivedAt: '2026-09-18T12:00:00.000Z',
              inbound: { version: 1, messageType: 'text', normalizedText: 'trusted text' },
              normalizedText: 'different text',
            }),
          ),
      });
    };
    const reader = createQuickFurnoWhatsAppMaterialReader(config(post));
    await expect(
      reader.read({
        conversationId: '22222222-2222-4222-8222-222222222222',
        inboundMessageId: '33333333-3333-4333-8333-333333333333',
        expectedRevision: 7,
      }),
    ).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('reply writer signs V2 structured Concierge output with deterministic idempotency', async () => {
    let captured: Record<string, unknown> | undefined;
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      captured = request;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
              QFJ_WHATSAPP_REPLY_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 202,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              protocol: 'qfj.whatsapp.reply',
              version: 2,
              requestId: request['requestId'],
              status: 'queued',
            }),
          ),
      });
    });
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    const outcome = await writer.write({
      conversationId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: 7,
      proposal: {
        actor: 'ANISHA',
        proposalId: 'prop.vendor.1',
        boundRevision: 7,
        body: 'Vendor assistance reply',
      },
    });
    expect(outcome).toBe('queued');
    expect(captured?.['actor']).toBe('ANISHA');
    expect(String(captured?.['idempotencyKey'])).toMatch(/^[0-9a-f]{64}$/u);
    expect(captured?.['experience']).toMatchObject({
      actor: 'ANISHA',
      kind: 'text',
      heading: 'Anisha · Partner Concierge',
    });
  });

  it('reply writer signs V3 qualification callback without conversational reply authority', async () => {
    let captured: Record<string, unknown> | undefined;
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      captured = request;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_REPLY_QUALIFICATION_SIGNING_DOMAIN,
              QFJ_WHATSAPP_REPLY_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 202,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              protocol: 'qfj.whatsapp.reply',
              version: 3,
              requestId: request['requestId'],
              status: 'applied',
              qualificationRequestId: request['qualificationRequestId'],
            }),
          ),
      });
    });
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    const outcome = await writer.write({
      conversationId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: 7,
      proposal: {
        actor: 'RIYA',
        proposalId: 'riya-qualification:request:message',
        boundRevision: 7,
        qualificationRequestId: '66666666-6666-4666-8666-666666666666',
        inboundMessageId: '33333333-3333-4333-8333-333333333333',
        target: 'budget',
        outcome: 'matched',
        value: '₹3–7 lakh',
      },
    });
    expect(outcome).toBe('queued');
    expect(captured).toMatchObject({
      version: 3,
      actor: 'RIYA',
      target: 'budget',
      outcome: 'matched',
      value: '₹3–7 lakh',
      qualificationRequestId: '66666666-6666-4666-8666-666666666666',
    });
    expect(captured).not.toHaveProperty('experience');
    expect(captured).not.toHaveProperty('body');
  });

  it('reply writer signs V4 when Riya carries a client journey proposal', async () => {
    let captured: Record<string, unknown> | undefined;
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      captured = request;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_REPLY_JOURNEY_SIGNING_DOMAIN,
              QFJ_WHATSAPP_REPLY_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 202,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              protocol: 'qfj.whatsapp.reply',
              version: 4,
              requestId: request['requestId'],
              status: 'queued',
              outboxId: 'outbox.1',
              clientJourney: { profileRevision: 3, requirementRevision: 6 },
            }),
          ),
      });
    });
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    const outcome = await writer.write({
      conversationId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: 7,
      proposal: {
        actor: 'RIYA',
        proposalId: 'prop.riya.memory.1',
        boundRevision: 7,
        body: 'Which area is the property in?',
        clientJourneyProposal: {
          version: 1,
          profileId: '66666666-6666-4666-8666-666666666666',
          profileRevision: 2,
          requirementId: '77777777-7777-4777-8777-777777777777',
          requirementRevision: 5,
          nextPhase: 'LOCATION',
          summaryConfirmed: false,
          name: { value: 'Rahul', provenance: 'user_stated' },
          sets: [{ field: 'serviceInterest', value: 'INTERIOR_DESIGN', provenance: 'user_stated' }],
          clears: [],
        },
      },
    });
    expect(outcome).toBe('queued');
    expect(captured).toMatchObject({
      version: 4,
      actor: 'RIYA',
      clientJourneyProposal: {
        profileRevision: 2,
        requirementRevision: 5,
        nextPhase: 'LOCATION',
      },
    });
    expect(String(captured?.['idempotencyKey'])).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('reply writer rejects a journey proposal from a non-Riya actor before network I/O', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>();
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    await expect(
      writer.write({
        conversationId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: 7,
        proposal: {
          actor: 'ANISHA',
          proposalId: 'prop.invalid.memory',
          boundRevision: 7,
          body: 'Invalid',
          clientJourneyProposal: {
            version: 1,
            profileId: '66666666-6666-4666-8666-666666666666',
            profileRevision: 2,
            requirementId: '77777777-7777-4777-8777-777777777777',
            requirementRevision: 5,
            nextPhase: 'LOCATION',
            summaryConfirmed: false,
            sets: [],
            clears: [],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(post).not.toHaveBeenCalled();
  });

  it('maps a QuickFurno revision conflict to a terminal stale result', async () => {
    const post: QuickFurnoWhatsAppHttpPost = () =>
      Promise.resolve({
        status: 409,
        text: () => Promise.resolve('{}'),
      });
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    await expect(
      writer.write({
        conversationId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: 7,
        proposal: { actor: 'RIYA', proposalId: 'prop.1', boundRevision: 7, body: 'hello' },
      }),
    ).resolves.toBe('stale');
  });
});
