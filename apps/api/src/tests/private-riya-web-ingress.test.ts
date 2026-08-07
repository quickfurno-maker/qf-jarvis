/**
 * The private Riya web ingress adapter (ADR-0097).
 *
 * These run the REAL handler behind a real ephemeral loopback server and make real HTTP requests.
 * A hand-rolled `IncomingMessage` double would prove the function works on the object the test
 * built; the properties that matter here — chunked bodies, duplicated headers, byte-exact
 * signatures, status codes, response headers — are properties of HTTP, so HTTP is what they are
 * proved against. Binding an ephemeral port is a TEST doing it; production source never calls
 * `listen`, which `private-riya-web-ingress-containment.test.ts` asserts separately.
 *
 * A unique sentinel reply body runs through the whole file. "No text leaked" is then a claim about
 * bytes that exist on a wire, not about the shape of a type.
 */
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';

import type {
  RiyaWebConversationResultV2,
  RiyaWebConversationService,
  RiyaWebConversationTurnV1,
} from '@qf-jarvis/riya-web-conversation-service';
import type { RuntimeDataClass } from '@qf-jarvis/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
  PRIVATE_RIYA_WEB_INGRESS_CALLER,
  PRIVATE_RIYA_WEB_INGRESS_PATH,
  PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
} from '../private-riya-web-ingress/contracts.js';
import {
  MAX_REQUEST_BODY_BYTES,
  createPrivateRiyaWebIngressHandler,
} from '../private-riya-web-ingress/create-handler.js';
import type { PrivateRiyaWebIngressConfig } from '../private-riya-web-ingress/create-handler.js';
import type {
  RiyaWebIngressClassificationInput,
  RiyaWebIngressDataClassPolicy,
} from '../private-riya-web-ingress/data-class-policy.js';
import { PRIVATE_RIYA_WEB_INGRESS_ERROR_CODES } from '../private-riya-web-ingress/errors.js';
import {
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  SIGNING_INPUT_DOMAIN,
  canonicalSigningInput,
} from '../private-riya-web-ingress/signature.js';

/** The one string this file hunts. */
const SENTINEL = 'SENTINEL-INGRESS-7c19ab35-core-authorized-answer';

const NOW = '2026-08-07T09:00:00.000Z';
const KEY_ID = 'qf.core.web.2026a';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
/** Clearly synthetic, generated per test run. No real key material is committed anywhere. */
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function requestBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
    version: 1,
    caller: PRIVATE_RIYA_WEB_INGRESS_CALLER,
    audience: PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
    requestId: 'req.1',
    issuedAt: NOW,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    receivedAt: '2026-08-07T08:59:58.000Z',
    webTurnRef: 'web.turn.opaque.ref',
    ...over,
  };
}

/** Sign exactly the bytes that will be sent. */
function signed(
  raw: string,
  over: { readonly keyId?: string; readonly method?: string; readonly path?: string } = {},
): Record<string, string> {
  const body = JSON.parse(raw) as {
    requestId: string;
    issuedAt: string;
    caller: string;
    audience: string;
  };
  const input = canonicalSigningInput({
    method: over.method ?? 'POST',
    path: over.path ?? PRIVATE_RIYA_WEB_INGRESS_PATH,
    caller: body.caller,
    audience: body.audience,
    requestId: body.requestId,
    issuedAt: body.issuedAt,
    keyId: over.keyId ?? KEY_ID,
    bodyDigest: createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('base64url'),
  });
  const signature = cryptoSign(null, Buffer.from(input, 'utf8'), privateKey).toString('base64url');
  return {
    'content-type': 'application/json',
    [KEY_ID_HEADER]: over.keyId ?? KEY_ID,
    [SIGNATURE_HEADER]: signature,
  };
}

/**
 * A recording classification policy. Synchronous by contract.
 *
 * The default is a SENTINEL rather than a literal, so a case can script an explicitly `undefined`
 * answer -- which is one of the malformed outputs the ingress must refuse, and would otherwise be
 * swallowed by a default parameter.
 */
const UNSET = Symbol('unset');
function scriptedPolicy(
  answer: unknown = UNSET,
  opts: { readonly throws?: boolean } = {},
): RiyaWebIngressDataClassPolicy & {
  calls(): number;
  seen(): RiyaWebIngressClassificationInput | undefined;
} {
  let calls = 0;
  let last: RiyaWebIngressClassificationInput | undefined;
  return {
    classify(input: RiyaWebIngressClassificationInput): RuntimeDataClass {
      calls += 1;
      last = input;
      if (opts.throws === true) {
        throw new Error('synthetic policy failure at 10.0.0.1');
      }
      return (answer === UNSET ? 'HOSTED_ALLOWED' : answer) as RuntimeDataClass;
    },
    calls: () => calls,
    seen: () => last,
  };
}

/** A recording conversation service. Composes nothing; answers what a case scripted. */
function scriptedService(
  over: {
    readonly disposition?: RiyaWebConversationResultV2['disposition'];
    readonly withReply?: boolean;
    readonly throws?: boolean;
    readonly mutate?: (result: RiyaWebConversationResultV2) => RiyaWebConversationResultV2;
  } = {},
): RiyaWebConversationService & { calls(): number; seen(): RiyaWebConversationTurnV1 | undefined } {
  let calls = 0;
  let last: RiyaWebConversationTurnV1 | undefined;
  const disposition = over.disposition ?? 'PROCESSED';
  const withReply = over.withReply ?? true;
  return {
    handleTurn(turn: RiyaWebConversationTurnV1): Promise<RiyaWebConversationResultV2> {
      calls += 1;
      last = turn;
      if (over.throws === true) {
        return Promise.reject(new Error('service at 10.0.0.1 — password=hunter2'));
      }
      const base = {
        version: 2 as const,
        tenantId: turn.tenantId,
        conversationId: turn.conversationId,
        messageId: turn.messageId,
        disposition,
        reason: undefined,
        continuity: {
          version: 1,
          tenantId: turn.tenantId,
          conversationId: turn.conversationId,
          continuityRevision: 0,
          phase: 'INTRO',
          summaryConfirmed: false,
          discovery: { behaviourVersion: 1, completeness: 'MORE_DISCOVERY_REQUIRED' },
        },
        authorizedReply:
          withReply && disposition === 'PROCESSED'
            ? {
                version: 1 as const,
                proposalId: 'prop.1',
                boundRevision: 1,
                proposalKind: 'REPLY' as const,
                replyBody: SENTINEL,
              }
            : undefined,
      } as unknown as RiyaWebConversationResultV2;
      return Promise.resolve(over.mutate === undefined ? base : over.mutate(base));
    },
    calls: () => calls,
    seen: () => last,
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => {
            resolve();
          });
        }),
    ),
  );
});

/** Start the real handler on an ephemeral loopback port and return its base URL. */
async function listening(over: Partial<PrivateRiyaWebIngressConfig> = {}): Promise<string> {
  const handler = createPrivateRiyaWebIngressHandler({
    service: over.service ?? scriptedService(),
    dataClassPolicy: over.dataClassPolicy ?? scriptedPolicy(),
    clock: over.clock ?? ((): string => NOW),
    verificationKeys: over.verificationKeys ?? [{ keyId: KEY_ID, publicKeyPem: PUBLIC_PEM }],
    ...(over.replay === undefined ? {} : { replay: over.replay }),
  });
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  // Typed inline rather than importing `AddressInfo` from `node:net`: a type import is erased and
  // grants nothing, but the repository spec lock scans import STATEMENTS, and not needing an
  // exception is better than being granted one.
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${String(port)}`;
}

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly json: Record<string, unknown>;
  readonly text: string;
}

async function post(
  base: string,
  raw: string,
  headers: Record<string, string>,
  path: string = PRIVATE_RIYA_WEB_INGRESS_PATH,
  method = 'POST',
): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: raw }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    json: JSON.parse(text) as Record<string, unknown>,
    text,
  };
}

/** The default happy path: a valid signed request over a working ingress. */
async function happy(
  over: Partial<PrivateRiyaWebIngressConfig> = {},
  body: Record<string, unknown> = requestBody(),
): Promise<Answer> {
  const base = await listening(over);
  const raw = JSON.stringify(body);
  return post(base, raw, signed(raw));
}

// ---------------------------------------------------------------------------
// (31) Authentication.
// ---------------------------------------------------------------------------

describe('(31) authentication', () => {
  it('a correctly signed request is served exactly once', async () => {
    const service = scriptedService();
    const policy = scriptedPolicy();
    const answer = await happy({ service, dataClassPolicy: policy });
    expect(answer.status).toBe(200);
    expect(service.calls()).toBe(1);
    expect(policy.calls()).toBe(1);
  });

  it.each([
    ['a missing key id', (h: Record<string, string>) => ({ ...h, [KEY_ID_HEADER]: '' })],
    ['a missing signature', (h: Record<string, string>) => ({ ...h, [SIGNATURE_HEADER]: '' })],
    [
      'a malformed base64url signature',
      (h: Record<string, string>) => ({ ...h, [SIGNATURE_HEADER]: '!!!not base64!!!' }),
    ],
    [
      'a truncated signature',
      (h: Record<string, string>) => ({ ...h, [SIGNATURE_HEADER]: 'AAAA' }),
    ],
    [
      'an unknown key id',
      (h: Record<string, string>) => ({ ...h, [KEY_ID_HEADER]: 'qf.core.web.unknown' }),
    ],
  ])('%s fails closed with no policy and no service call', async (_label, mutate) => {
    const service = scriptedService();
    const policy = scriptedPolicy();
    const base = await listening({ service, dataClassPolicy: policy });
    const raw = JSON.stringify(requestBody());
    const answer = await post(base, raw, mutate(signed(raw)));
    expect(answer.status).toBe(401);
    expect(answer.json['error']).toBe('authentication-failed');
    expect(policy.calls()).toBe(0);
    expect(service.calls()).toBe(0);
    expect(answer.text).not.toContain(SENTINEL);
  });

  it('a signature made with a DIFFERENT key fails closed', async () => {
    const other = generateKeyPairSync('ed25519');
    const service = scriptedService();
    const base = await listening({ service });
    const raw = JSON.stringify(requestBody());
    const headers = signed(raw);
    const input = canonicalSigningInput({
      method: 'POST',
      path: PRIVATE_RIYA_WEB_INGRESS_PATH,
      caller: PRIVATE_RIYA_WEB_INGRESS_CALLER,
      audience: PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
      requestId: 'req.1',
      issuedAt: NOW,
      keyId: KEY_ID,
      bodyDigest: createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('base64url'),
    });
    headers[SIGNATURE_HEADER] = cryptoSign(
      null,
      Buffer.from(input, 'utf8'),
      other.privateKey,
    ).toString('base64url');
    const answer = await post(base, raw, headers);
    expect(answer.status).toBe(401);
    expect(service.calls()).toBe(0);
  });

  it('a ONE-BYTE body change after signing fails closed', async () => {
    // The core property of binding the raw-body digest. The mutated body is still perfectly valid
    // JSON and still passes the schema -- only the signature disagrees.
    const service = scriptedService();
    const policy = scriptedPolicy();
    const base = await listening({ service, dataClassPolicy: policy });
    const raw = JSON.stringify(requestBody());
    const headers = signed(raw);
    const tampered = raw.replace('"msg.1"', '"msg.2"');
    expect(tampered).not.toBe(raw);
    expect(JSON.parse(tampered)).toBeTruthy();
    const answer = await post(base, tampered, headers);
    expect(answer.status).toBe(401);
    expect(policy.calls()).toBe(0);
    expect(service.calls()).toBe(0);
  });

  it('a signature bound to a different method or path is not accepted here', async () => {
    for (const over of [{ method: 'PUT' }, { path: '/internal/v1/riya/other' }]) {
      const service = scriptedService();
      const base = await listening({ service });
      const raw = JSON.stringify(requestBody());
      const answer = await post(base, raw, signed(raw, over));
      expect(answer.status).toBe(401);
      expect(service.calls()).toBe(0);
    }
  });

  it.each([
    ['a stale issuedAt', '2026-08-07T08:58:00.000Z'],
    ['a future issuedAt', '2026-08-07T09:02:00.000Z'],
  ])('%s fails closed', async (_label, issuedAt) => {
    const service = scriptedService();
    const policy = scriptedPolicy();
    const base = await listening({ service, dataClassPolicy: policy });
    const raw = JSON.stringify(requestBody({ issuedAt }));
    const answer = await post(base, raw, signed(raw));
    expect(answer.status).toBe(401);
    expect(policy.calls()).toBe(0);
    expect(service.calls()).toBe(0);
  });

  it('a request just inside the ±60s window is accepted at both edges', async () => {
    for (const issuedAt of ['2026-08-07T08:59:01.000Z', '2026-08-07T09:00:59.000Z']) {
      const base = await listening();
      const raw = JSON.stringify(requestBody({ issuedAt }));
      expect((await post(base, raw, signed(raw))).status, issuedAt).toBe(200);
    }
  });

  it.each([
    ['caller', { caller: 'someone-else' }],
    ['audience', { audience: 'qf-jarvis-public' }],
  ])('a wrong %s is refused', async (_label, over) => {
    const service = scriptedService();
    const base = await listening({ service });
    const raw = JSON.stringify(requestBody(over));
    const answer = await post(base, raw, signed(raw));
    // The literal schema catches it first; either way nothing downstream runs.
    expect([400, 401]).toContain(answer.status);
    expect(service.calls()).toBe(0);
  });

  it('never echoes the signature, key material or the body in a failure', async () => {
    const base = await listening();
    const raw = JSON.stringify(requestBody({ normalizedText: 'MY SECRET HOME ADDRESS' }));
    const headers = signed(raw);
    headers[KEY_ID_HEADER] = 'qf.core.web.unknown';
    const answer = await post(base, raw, headers);
    expect(answer.text).not.toContain('SECRET');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- always set by `signed`
    expect(answer.text).not.toContain(headers[SIGNATURE_HEADER]!);
    expect(answer.text).not.toContain('BEGIN PUBLIC KEY');
    expect(answer.text).not.toContain('qf.core.web.unknown');
    expect(Object.keys(answer.json).sort()).toEqual(['error', 'protocol', 'version']);
  });
});

// ---------------------------------------------------------------------------
// (32) Request shape.
// ---------------------------------------------------------------------------

describe('(32) request shape', () => {
  it('a wrong path is 404 and a wrong method is 405 with Allow: POST', async () => {
    const base = await listening();
    const raw = JSON.stringify(requestBody());
    const notFound = await post(base, raw, signed(raw), '/api/chat');
    expect(notFound.status).toBe(404);
    const wrongMethod = await post(base, raw, signed(raw), PRIVATE_RIYA_WEB_INGRESS_PATH, 'GET');
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');
  });

  it('a query string is refused — it is unsigned input', async () => {
    const base = await listening();
    const raw = JSON.stringify(requestBody());
    const answer = await post(
      base,
      raw,
      signed(raw),
      `${PRIVATE_RIYA_WEB_INGRESS_PATH}?tenant=other`,
    );
    expect(answer.status).toBe(404);
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['form encoding', 'application/x-www-form-urlencoded'],
    ['no charset but wrong type', 'application/xml'],
  ])('an unsupported content type (%s) is 415', async (_label, contentType) => {
    const base = await listening();
    const raw = JSON.stringify(requestBody());
    const answer = await post(base, raw, { ...signed(raw), 'content-type': contentType });
    expect(answer.status).toBe(415);
    expect(answer.json['error']).toBe('unsupported-media');
  });

  it('a compressed body is refused rather than decompressed', async () => {
    const base = await listening();
    const raw = JSON.stringify(requestBody());
    const answer = await post(base, raw, { ...signed(raw), 'content-encoding': 'gzip' });
    expect(answer.status).toBe(415);
  });

  it('application/json; charset=utf-8 is accepted', async () => {
    const base = await listening();
    const raw = JSON.stringify(requestBody());
    const answer = await post(base, raw, {
      ...signed(raw),
      'content-type': 'application/json; charset=utf-8',
    });
    expect(answer.status).toBe(200);
  });

  it('an oversized body is 413 and never reaches the service', async () => {
    const service = scriptedService();
    const base = await listening({ service });
    const raw = JSON.stringify(requestBody({ normalizedText: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }));
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
    const answer = await post(base, raw, signed(raw));
    expect(answer.status).toBe(413);
    expect(service.calls()).toBe(0);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
  ])('%s is 400 and never reaches the service', async (_label, raw) => {
    const service = scriptedService();
    const base = await listening({ service });
    const answer = await post(base, raw, {
      'content-type': 'application/json',
      [KEY_ID_HEADER]: KEY_ID,
      [SIGNATURE_HEADER]: 'AAAA',
    });
    expect(answer.status).toBe(400);
    expect(answer.json['error']).toBe('invalid-request');
    expect(service.calls()).toBe(0);
  });

  it.each([
    'dataClass',
    'channel',
    'partyType',
    'direction',
    'actor',
    'runtimeId',
    'model',
    'prompt',
    'consent',
    'canSubmit',
    'leadId',
    'vendorId',
    'city',
    'price',
    'approved',
    'delivered',
  ])('the forbidden field %s is REJECTED, never silently stripped', async (field) => {
    const service = scriptedService();
    const policy = scriptedPolicy();
    const base = await listening({ service, dataClassPolicy: policy });
    const raw = JSON.stringify(requestBody({ [field]: 'HOSTED_ALLOWED' }));
    const answer = await post(base, raw, signed(raw));
    expect(answer.status, field).toBe(400);
    expect(answer.json['error']).toBe('invalid-request');
    expect(policy.calls()).toBe(0);
    expect(service.calls()).toBe(0);
  });

  it('never quotes the client message in a validation failure', async () => {
    const base = await listening();
    const secret = 'MY SECRET HOME ADDRESS';
    const raw = JSON.stringify(requestBody({ normalizedText: `${secret}${'x'.repeat(4097)}` }));
    const answer = await post(base, raw, signed(raw));
    expect(answer.status).toBe(400);
    expect(answer.text).not.toContain('SECRET');
    for (const forbidden of ['normalizedText', 'zod', 'expected', 'received', 'path']) {
      expect(answer.text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// (33) The server-side dataClass policy.
// ---------------------------------------------------------------------------

describe('(33) server-side dataClass derivation', () => {
  it('the wire schema has no dataClass at all, and the policy output is what reaches the service', async () => {
    for (const answer of ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const) {
      const service = scriptedService();
      const base = await listening({ service, dataClassPolicy: scriptedPolicy(answer) });
      const raw = JSON.stringify(requestBody());
      expect((await post(base, raw, signed(raw))).status, answer).toBe(200);
      expect(service.seen()?.dataClass, answer).toBe(answer);
    }
  });

  it('the policy is called exactly once, and sees only signed request data', async () => {
    const policy = scriptedPolicy();
    const base = await listening({ dataClassPolicy: policy });
    const raw = JSON.stringify(requestBody({ subjectRef: 'subj.1', normalizedText: 'hello' }));
    await post(base, raw, signed(raw));
    expect(policy.calls()).toBe(1);
    expect(Object.keys(policy.seen() ?? {}).sort()).toEqual([
      'conversationId',
      'messageId',
      'normalizedText',
      'subjectRef',
      'tenantId',
    ]);
  });

  it('a policy that answers outside the closed vocabulary fails closed before the service', async () => {
    // Built inline rather than through `scriptedPolicy`, because a default parameter re-applies for
    // an explicitly passed `undefined` -- and `undefined` is one of the answers that must be refused.
    for (const bad of ['ANYTHING', '', null, 42, undefined, {}, ['HOSTED_ALLOWED']]) {
      const service = scriptedService();
      let calls = 0;
      const base = await listening({
        service,
        dataClassPolicy: {
          classify: (): RuntimeDataClass => {
            calls += 1;
            return bad as RuntimeDataClass;
          },
        },
      });
      const raw = JSON.stringify(requestBody());
      const answer = await post(base, raw, signed(raw));
      const label = bad === undefined ? 'undefined' : JSON.stringify(bad);
      expect(answer.status, label).toBe(500);
      expect(answer.json['error'], label).toBe('policy-refused');
      // The policy DID run -- so this proves the output was rejected, not that it was never asked.
      expect(calls, label).toBe(1);
      expect(service.calls(), label).toBe(0);
    }
  });

  it('a policy that throws fails closed, and its message never escapes', async () => {
    const service = scriptedService();
    const base = await listening({
      service,
      dataClassPolicy: scriptedPolicy('HOSTED_ALLOWED', { throws: true }),
    });
    const raw = JSON.stringify(requestBody());
    const answer = await post(base, raw, signed(raw));
    expect(answer.status).toBe(500);
    expect(answer.json['error']).toBe('policy-refused');
    expect(answer.text).not.toContain('10.0.0.1');
    expect(service.calls()).toBe(0);
  });

  it('there is no default: construction refuses a missing policy', () => {
    expect(() =>
      createPrivateRiyaWebIngressHandler({
        service: scriptedService(),
        clock: () => NOW,
        verificationKeys: [{ keyId: KEY_ID, publicKeyPem: PUBLIC_PEM }],
      } as unknown as PrivateRiyaWebIngressConfig),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// (34) The replay guard.
// ---------------------------------------------------------------------------

describe('(34) replay', () => {
  it('an exact duplicate is refused, and the service is still called once', async () => {
    const service = scriptedService();
    const base = await listening({ service });
    const raw = JSON.stringify(requestBody());
    const headers = signed(raw);
    expect((await post(base, raw, headers)).status).toBe(200);
    const again = await post(base, raw, headers);
    expect(again.status).toBe(409);
    expect(again.json['error']).toBe('replay-detected');
    expect(service.calls()).toBe(1);
    expect(again.text).not.toContain(SENTINEL);
  });

  it('the same requestId with a DIFFERENT body is a conflict, not a replay', async () => {
    const service = scriptedService();
    const base = await listening({ service });
    const first = JSON.stringify(requestBody());
    expect((await post(base, first, signed(first))).status).toBe(200);
    const second = JSON.stringify(requestBody({ messageId: 'msg.2' }));
    const answer = await post(base, second, signed(second));
    expect(answer.status).toBe(409);
    expect(answer.json['error']).toBe('request-conflict');
    expect(service.calls()).toBe(1);
  });

  it('a different requestId succeeds', async () => {
    const service = scriptedService();
    const base = await listening({ service });
    for (const requestId of ['req.1', 'req.2', 'req.3']) {
      const raw = JSON.stringify(requestBody({ requestId }));
      expect((await post(base, raw, signed(raw))).status, requestId).toBe(200);
    }
    expect(service.calls()).toBe(3);
  });

  it('an entry expires lazily, so the identifier becomes usable again', async () => {
    const service = scriptedService();
    let now = NOW;
    const base = await listening({ service, clock: () => now, replay: { ttlMs: 1 } });
    const raw = JSON.stringify(requestBody());
    expect((await post(base, raw, signed(raw))).status).toBe(200);
    // Same signed bytes, a later clock. Freshness still passes; the claim has expired.
    now = '2026-08-07T09:00:30.000Z';
    expect((await post(base, raw, signed(raw))).status).toBe(200);
    expect(service.calls()).toBe(2);
  });

  it('capacity is bounded', async () => {
    const service = scriptedService();
    const base = await listening({ service, replay: { capacity: 2 } });
    for (const requestId of ['req.1', 'req.2', 'req.3', 'req.4']) {
      const raw = JSON.stringify(requestBody({ requestId }));
      expect((await post(base, raw, signed(raw))).status, requestId).toBe(200);
    }
    expect(service.calls()).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// (35, 37) Reply exposure and response containment.
// ---------------------------------------------------------------------------

describe('(35, 37) reply exposure', () => {
  const APPROVED_KEYS = [
    'authorizedReply',
    'conversationId',
    'disposition',
    'messageId',
    'protocol',
    'reason',
    'requestId',
    'tenantId',
    'version',
  ];

  it('an authorized reply is returned EXACTLY, and continuity is absent', async () => {
    const answer = await happy();
    expect(answer.status).toBe(200);
    expect(Object.keys(answer.json).sort()).toEqual(APPROVED_KEYS);
    const reply = answer.json['authorizedReply'] as Record<string, unknown>;
    expect(reply['replyBody']).toBe(SENTINEL);
    expect(reply['proposalKind']).toBe('REPLY');
    expect(answer.json['disposition']).toBe('PROCESSED');

    // The service really did hand over continuity on this very turn, and none of it is on the wire.
    for (const forbidden of [
      'continuity',
      'discovery',
      'fieldProvenance',
      'summaryConfirmed',
      'completionEvidenceRef',
      'runId',
      'provenance',
      'modelDrafted',
      'coreConsulted',
      'proposalDigest',
      'idempotencyKey',
      'INTRO',
      'MORE_DISCOVERY_REQUIRED',
    ]) {
      expect(answer.text, forbidden).not.toContain(forbidden);
    }
  });

  it('PROCESSED with NO authorized reply returns null and no text', async () => {
    const answer = await happy({ service: scriptedService({ withReply: false }) });
    expect(answer.status).toBe(200);
    expect(answer.json['disposition']).toBe('PROCESSED');
    expect(answer.json['authorizedReply']).toBeNull();
    expect(answer.text).not.toContain(SENTINEL);
  });

  it.each(['REFUSED', 'NOT_READY'] as const)('%s returns null and no text', async (disposition) => {
    const answer = await happy({ service: scriptedService({ disposition }) });
    expect(answer.status).toBe(200);
    expect(answer.json['disposition']).toBe(disposition);
    expect(answer.json['authorizedReply']).toBeNull();
    expect(answer.text).not.toContain(SENTINEL);
  });

  it('a contradictory service result fails closed with no body at all', async () => {
    // A reply attached to a NOT_READY disposition. Believing either half would be a guess.
    const answer = await happy({
      service: scriptedService({
        disposition: 'NOT_READY',
        mutate: (result) =>
          ({
            ...result,
            authorizedReply: {
              version: 1,
              proposalId: 'prop.1',
              boundRevision: 1,
              proposalKind: 'REPLY',
              replyBody: SENTINEL,
            },
          }) as unknown as RiyaWebConversationResultV2,
      }),
    });
    expect(answer.status).toBe(500);
    expect(answer.json['error']).toBe('internal-invariant');
    expect(answer.text).not.toContain(SENTINEL);
  });

  it('a result about a different conversation fails closed', async () => {
    const answer = await happy({
      service: scriptedService({
        mutate: (result) => ({ ...result, conversationId: 'conv.OTHER' }),
      }),
    });
    expect(answer.status).toBe(500);
    expect(answer.text).not.toContain(SENTINEL);
  });

  it('a service that throws returns a fixed, content-free transport failure', async () => {
    const answer = await happy({ service: scriptedService({ throws: true }) });
    expect(answer.status).toBe(503);
    expect(answer.json['error']).toBe('service-unavailable');
    expect(answer.text).not.toContain('password');
    expect(answer.text).not.toContain('10.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// (37) Headers and browser containment.
// ---------------------------------------------------------------------------

describe('(37) response headers', () => {
  it('every response is no-store, nosniff, and carries no CORS or cookie header', async () => {
    const base = await listening();
    const raw = JSON.stringify(requestBody());
    const ok = await post(base, raw, signed(raw));
    const notFound = await post(base, raw, signed(raw), '/nope');
    const unauthorized = await post(base, raw, { ...signed(raw), [KEY_ID_HEADER]: 'nope' });

    for (const answer of [ok, notFound, unauthorized]) {
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.headers.get('cache-control')).toBe('no-store');
      expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
      expect(answer.headers.get('access-control-allow-origin')).toBeNull();
      expect(answer.headers.get('access-control-allow-credentials')).toBeNull();
      expect(answer.headers.get('set-cookie')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// (30) Construction-time fail closed.
// ---------------------------------------------------------------------------

describe('(30) construction fails closed', () => {
  const valid = (): PrivateRiyaWebIngressConfig => ({
    service: scriptedService(),
    dataClassPolicy: scriptedPolicy(),
    clock: () => NOW,
    verificationKeys: [{ keyId: KEY_ID, publicKeyPem: PUBLIC_PEM }],
  });

  it('accepts a fully valid configuration', () => {
    expect(() => createPrivateRiyaWebIngressHandler(valid())).not.toThrow();
  });

  it.each([
    ['a missing service', { service: undefined }],
    ['a service without handleTurn', { service: {} }],
    ['a missing policy', { dataClassPolicy: undefined }],
    ['a policy without classify', { dataClassPolicy: {} }],
    ['a missing clock', { clock: undefined }],
    ['a non-callable clock', { clock: 'now' }],
    ['an empty key ring', { verificationKeys: [] }],
    [
      'too many keys',
      {
        verificationKeys: [1, 2, 3, 4, 5].map((n) => ({
          keyId: `k.${String(n)}`,
          publicKeyPem: PUBLIC_PEM,
        })),
      },
    ],
    [
      'duplicate key ids',
      {
        verificationKeys: [
          { keyId: KEY_ID, publicKeyPem: PUBLIC_PEM },
          { keyId: KEY_ID, publicKeyPem: PUBLIC_PEM },
        ],
      },
    ],
    ['a malformed key', { verificationKeys: [{ keyId: KEY_ID, publicKeyPem: 'not a pem' }] }],
    ['a bad key id', { verificationKeys: [{ keyId: 'has space', publicKeyPem: PUBLIC_PEM }] }],
  ])('refuses %s', (_label, over) => {
    expect(() =>
      createPrivateRiyaWebIngressHandler({
        ...valid(),
        ...over,
      } as unknown as PrivateRiyaWebIngressConfig),
    ).toThrow();
  });

  it('refuses a non-Ed25519 key, and refuses PRIVATE key material outright', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      createPrivateRiyaWebIngressHandler({
        ...valid(),
        verificationKeys: [
          {
            keyId: KEY_ID,
            publicKeyPem: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          },
        ],
      }),
    ).toThrow();
    // Jarvis must never hold signing material. `createPublicKey` would happily derive a public key
    // from a private one, so the key TYPE is checked rather than assumed.
    expect(() =>
      createPrivateRiyaWebIngressHandler({
        ...valid(),
        verificationKeys: [
          {
            keyId: KEY_ID,
            publicKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
          },
        ],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Contract shape.
// ---------------------------------------------------------------------------

describe('the contract itself', () => {
  it('exposes exactly the nine closed error codes', () => {
    expect([...PRIVATE_RIYA_WEB_INGRESS_ERROR_CODES]).toEqual([
      'invalid-request',
      'authentication-failed',
      'replay-detected',
      'request-conflict',
      'payload-too-large',
      'unsupported-media',
      'policy-refused',
      'service-unavailable',
      'internal-invariant',
    ]);
    expect(Object.isFrozen(PRIVATE_RIYA_WEB_INGRESS_ERROR_CODES)).toBe(true);
  });

  it('the canonical signing input is nine LF-delimited lines in the locked order', () => {
    const input = canonicalSigningInput({
      method: 'POST',
      path: PRIVATE_RIYA_WEB_INGRESS_PATH,
      caller: PRIVATE_RIYA_WEB_INGRESS_CALLER,
      audience: PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
      requestId: 'req.1',
      issuedAt: NOW,
      keyId: KEY_ID,
      bodyDigest: 'ZGlnZXN0',
    });
    expect(input.split('\n')).toEqual([
      SIGNING_INPUT_DOMAIN,
      'POST',
      '/internal/v1/riya/web-turn',
      'quickfurno-core',
      'qf-jarvis-private-riya-web',
      'req.1',
      NOW,
      KEY_ID,
      'ZGlnZXN0',
    ]);
    expect(input.endsWith('\n')).toBe(false);
  });
});
