import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { GatewayConfig } from './config.js';
import {
  HANDSHAKE_METHOD,
  HANDSHAKE_PATH,
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  createHandshakeResponse,
  parseHandshakeChallenge,
  signHandshakeResponse,
  verifyHandshakeSignature,
} from './protocol.js';
import { BoundedReplayCache, type ReplayGuard } from './replay-cache.js';
import type { DurableTurnSpool } from './durable-turn-spool.js';
import {
  WHATSAPP_TURN_METHOD,
  WHATSAPP_TURN_PATH,
  WHATSAPP_TURN_PROTOCOL,
  parseWhatsAppTurn,
  verifyWhatsAppTurnSignature,
} from './whatsapp-turn-protocol.js';

const MAX_BODY_BYTES = 8_192;
const MAX_PROXY_RESPONSE_BYTES = 16_384;
const PRIVATE_RIYA_PATH = '/internal/v1/riya/web-turn';
const JSON_TYPE = 'application/json; charset=utf-8';

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(serialized, 'utf8'),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders,
  });
  response.end(serialized);
}

function singleHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) return value[0] ?? null;
  return null;
}

async function readBoundedBody(request: IncomingMessage): Promise<Uint8Array | null> {
  const declared = request.headers['content-length'];
  if (typeof declared === 'string') {
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BODY_BYTES) return null;
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    let value: Buffer;
    if (Buffer.isBuffer(chunk)) value = Buffer.from(chunk);
    else if (typeof chunk === 'string') value = Buffer.from(chunk, 'utf8');
    else if (chunk instanceof Uint8Array) value = Buffer.from(chunk);
    else return null;
    bytes += value.length;
    if (bytes > MAX_BODY_BYTES) return null;
    chunks.push(value);
  }
  if (bytes < 2) return null;
  return Buffer.concat(chunks);
}

function contentTypeAllowed(request: IncomingMessage): boolean {
  const value = singleHeader(request, 'content-type');
  return value !== null && value.toLowerCase().split(';', 1)[0]?.trim() === 'application/json';
}

async function proxyPrivateRiya(
  config: GatewayConfig,
  request: IncomingMessage,
  response: ServerResponse,
  rawBody: Uint8Array,
): Promise<void> {
  if (config.privateRiyaUpstreamUrl === undefined) {
    writeJson(response, 503, { error: 'service_unavailable' });
    return;
  }
  const keyId = singleHeader(request, KEY_ID_HEADER);
  const signature = singleHeader(request, SIGNATURE_HEADER);
  if (keyId === null || signature === null) {
    writeJson(response, 401, { error: 'authentication_failed' });
    return;
  }

  const upstreamUrl = new URL(PRIVATE_RIYA_PATH, config.privateRiyaUpstreamUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        [KEY_ID_HEADER]: keyId,
        [SIGNATURE_HEADER]: signature,
      },
      body: Buffer.from(rawBody),
    });
    const contentType = upstream.headers.get('content-type');
    if (
      contentType === null ||
      contentType.toLowerCase().split(';', 1)[0]?.trim() !== 'application/json'
    ) {
      writeJson(response, 503, { error: 'service_unavailable' });
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > MAX_PROXY_RESPONSE_BYTES) {
      writeJson(response, 503, { error: 'service_unavailable' });
      return;
    }
    const allowedStatuses = new Set([200, 400, 401, 404, 405, 409, 413, 415, 429, 503]);
    if (!allowedStatuses.has(upstream.status)) {
      writeJson(response, 503, { error: 'service_unavailable' });
      return;
    }
    response.writeHead(upstream.status, {
      'content-type': JSON_TYPE,
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    response.end(body);
  } catch {
    writeJson(response, 503, { error: 'service_unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

export interface GatewayServerDependencies {
  readonly config: GatewayConfig;
  readonly replayGuard?: ReplayGuard;
  readonly turnSpool?: DurableTurnSpool;
  readonly now?: () => Date;
}

export function createGatewayServer(dependencies: GatewayServerDependencies) {
  const replayGuard =
    dependencies.replayGuard ??
    new BoundedReplayCache(dependencies.config.replayTtlMs, dependencies.config.replayMaxEntries);
  const now = dependencies.now ?? (() => new Date());

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://gateway.invalid');
        if (url.search !== '') {
          writeJson(response, 400, { error: 'invalid_request' });
          return;
        }

        if (request.method === 'GET' && url.pathname === '/healthz') {
          writeJson(response, 200, { status: 'ok', service: 'qf-jarvis-gateway', version: 1 });
          return;
        }

        if (url.pathname === PRIVATE_RIYA_PATH) {
          if (request.method !== 'POST') {
            writeJson(response, 405, { error: 'method_not_allowed' });
            return;
          }
          if (!contentTypeAllowed(request)) {
            writeJson(response, 415, { error: 'invalid_request' });
            return;
          }
          const rawBody = await readBoundedBody(request);
          if (rawBody === null) {
            writeJson(response, 413, { error: 'invalid_request' });
            return;
          }
          await proxyPrivateRiya(dependencies.config, request, response, rawBody);
          return;
        }

        if (request.method === WHATSAPP_TURN_METHOD && url.pathname === WHATSAPP_TURN_PATH) {
          if (dependencies.turnSpool === undefined) {
            writeJson(response, 503, { error: 'service_unavailable' });
            return;
          }
          if (!contentTypeAllowed(request)) {
            writeJson(response, 415, { error: 'invalid_request' });
            return;
          }
          const rawBody = await readBoundedBody(request);
          if (rawBody === null) {
            writeJson(response, 413, { error: 'invalid_request' });
            return;
          }
          let decoded: unknown;
          try {
            decoded = JSON.parse(Buffer.from(rawBody).toString('utf8'));
          } catch {
            writeJson(response, 400, { error: 'invalid_request' });
            return;
          }
          const turn = parseWhatsAppTurn(decoded);
          if (turn === null) {
            writeJson(response, 400, { error: 'invalid_request' });
            return;
          }
          const current = now();
          const authenticated = verifyWhatsAppTurnSignature({
            rawBody,
            turn,
            keyId: singleHeader(request, KEY_ID_HEADER),
            signature: singleHeader(request, SIGNATURE_HEADER),
            verificationKeys: dependencies.config.verificationKeys,
            nowMs: current.getTime(),
            maxClockSkewMs: dependencies.config.maxClockSkewMs,
          });
          if (!authenticated) {
            writeJson(response, 401, { error: 'authentication_failed' });
            return;
          }
          const accepted = await dependencies.turnSpool.accept(turn, current.toISOString());
          if (accepted.outcome === 'replay') {
            writeJson(response, 409, { error: 'replay_rejected' });
            return;
          }
          if (accepted.outcome === 'conflict') {
            writeJson(response, 409, { error: 'turn_identity_conflict' });
            return;
          }
          writeJson(response, 202, {
            protocol: WHATSAPP_TURN_PROTOCOL,
            version: 1,
            requestId: turn.requestId,
            status: accepted.outcome,
            durable: true,
          });
          return;
        }

        if (request.method !== HANDSHAKE_METHOD || url.pathname !== HANDSHAKE_PATH) {
          writeJson(response, 404, { error: 'not_found' });
          return;
        }
        if (!contentTypeAllowed(request)) {
          writeJson(response, 415, { error: 'invalid_request' });
          return;
        }

        const rawBody = await readBoundedBody(request);
        if (rawBody === null) {
          writeJson(response, 413, { error: 'invalid_request' });
          return;
        }

        let decoded: unknown;
        try {
          decoded = JSON.parse(Buffer.from(rawBody).toString('utf8'));
        } catch {
          writeJson(response, 400, { error: 'invalid_request' });
          return;
        }
        const challenge = parseHandshakeChallenge(decoded);
        if (challenge === null) {
          writeJson(response, 400, { error: 'invalid_request' });
          return;
        }

        const current = now();
        const authenticated = verifyHandshakeSignature({
          rawBody,
          challenge,
          keyId: singleHeader(request, KEY_ID_HEADER),
          signature: singleHeader(request, SIGNATURE_HEADER),
          verificationKeys: dependencies.config.verificationKeys,
          nowMs: current.getTime(),
          maxClockSkewMs: dependencies.config.maxClockSkewMs,
        });
        if (!authenticated) {
          writeJson(response, 401, { error: 'authentication_failed' });
          return;
        }

        if (!replayGuard.claim(challenge.requestId, current.getTime())) {
          writeJson(response, 409, { error: 'replay_rejected' });
          return;
        }

        const body = createHandshakeResponse({ challenge, now: current });
        const rawResponse = Buffer.from(JSON.stringify(body), 'utf8');
        const signature = signHandshakeResponse({
          rawBody: rawResponse,
          response: body,
          signingKey: dependencies.config.signingKey,
        });
        writeJson(response, 200, body, {
          [KEY_ID_HEADER]: dependencies.config.signingKey.keyId,
          [SIGNATURE_HEADER]: signature,
        });
      } catch {
        writeJson(response, 503, { error: 'service_unavailable' });
      }
    })();
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
