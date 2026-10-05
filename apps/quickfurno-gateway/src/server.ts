import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  qfjScaleResponseHeaders,
  verifyQfjScaleRequest,
  type QfjScaleErrorClass,
} from '@qf-jarvis/cross-system-scale-contract';
import {
  addMetric,
  extractRemoteContext,
  recordMetric,
  SpanKind,
  SpanStatusCode,
  trace,
  withSpan,
} from '@qf-jarvis/observability';

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
const JSON_TYPE = 'application/json; charset=utf-8';

function recordSecurityFailure(kind: 'authentication' | 'contract' | 'signature'): void {
  try {
    addMetric('qf.security.auth.failures', 1, { operation: 'qfj_gateway', result: kind });
    if (kind === 'signature') {
      addMetric('qf.security.signature.failures', 1, {
        operation: 'qfj_gateway',
        result: 'invalid',
      });
    }
  } catch {
    // Security telemetry is powerless; request validation remains authoritative.
  }
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const span = trace.getActiveSpan();
  span?.setAttribute('http.response.status_code', status);
  if (status >= 500) span?.setStatus({ code: SpanStatusCode.ERROR });
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

function scaleVerificationKeys(config: GatewayConfig) {
  return config.verificationKeys.map((entry) => ({
    keyId: entry.keyId,
    publicKeyPem: entry.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }));
}

function scaleStatus(errorClass: QfjScaleErrorClass): number {
  if (errorClass === 'QFJ_AUTHENTICATION_FAILED') return 401;
  if (errorClass === 'QFJ_DEADLINE_EXCEEDED') return 408;
  if (errorClass === 'QFJ_BACKPRESSURE' || errorClass === 'QFJ_CIRCUIT_OPEN') return 429;
  return 400;
}

function scaleHeaderRecord(
  request: IncomingMessage,
): Readonly<Record<string, string | readonly string[] | undefined>> {
  return request.headers;
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
    const startedAt = performance.now();
    const pathname = (() => {
      try {
        return new URL(request.url ?? '/', 'http://gateway.invalid').pathname;
      } catch {
        return 'invalid';
      }
    })();
    const metricRoute =
      pathname === WHATSAPP_TURN_PATH
        ? 'whatsapp-turn'
        : pathname === HANDSHAKE_PATH
          ? 'handshake'
          : pathname === '/healthz'
            ? 'healthz'
            : 'other';
    const parent = extractRemoteContext(request.headers);
    void withSpan(
      'jarvis.gateway',
      SpanKind.SERVER,
      {
        'http.request.method': request.method ?? 'UNKNOWN',
        'http.route': metricRoute,
      },
      async () => {
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
            const scaleContract = verifyQfjScaleRequest({
              headers: scaleHeaderRecord(request),
              method: WHATSAPP_TURN_METHOD,
              path: WHATSAPP_TURN_PATH,
              rawBody,
              verificationKeys: scaleVerificationKeys(dependencies.config),
              nowMs: current.getTime(),
              allowLegacy: true,
            });
            if (!scaleContract.ok) {
              recordSecurityFailure(
                scaleContract.errorClass === 'QFJ_AUTHENTICATION_FAILED' ? 'signature' : 'contract',
              );
              writeJson(response, scaleStatus(scaleContract.errorClass), {
                error: 'scale_contract_rejected',
                errorClass: scaleContract.errorClass,
              });
              return;
            }
            const scaleResponseHeaders =
              scaleContract.mode === 'v1' ? qfjScaleResponseHeaders(scaleContract.metadata) : {};
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
              recordSecurityFailure('signature');
              writeJson(response, 401, { error: 'authentication_failed' }, scaleResponseHeaders);
              return;
            }
            const traceparent =
              scaleContract.mode === 'v1'
                ? (singleHeader(request, 'traceparent') ?? undefined)
                : undefined;
            const tracestate =
              traceparent === undefined
                ? undefined
                : (singleHeader(request, 'tracestate') ?? undefined);
            const accepted = await dependencies.turnSpool.accept(
              turn,
              current.toISOString(),
              traceparent === undefined
                ? undefined
                : {
                    traceparent,
                    ...(tracestate === undefined ? {} : { tracestate }),
                  },
            );
            if (accepted.outcome === 'replay') {
              writeJson(response, 409, { error: 'replay_rejected' }, scaleResponseHeaders);
              return;
            }
            if (accepted.outcome === 'conflict') {
              writeJson(response, 409, { error: 'turn_identity_conflict' }, scaleResponseHeaders);
              return;
            }
            writeJson(
              response,
              202,
              {
                protocol: WHATSAPP_TURN_PROTOCOL,
                version: 1,
                requestId: turn.requestId,
                status: accepted.outcome,
                durable: true,
              },
              scaleResponseHeaders,
            );
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
          const scaleContract = verifyQfjScaleRequest({
            headers: scaleHeaderRecord(request),
            method: HANDSHAKE_METHOD,
            path: HANDSHAKE_PATH,
            rawBody,
            verificationKeys: scaleVerificationKeys(dependencies.config),
            nowMs: current.getTime(),
            allowLegacy: true,
          });
          if (!scaleContract.ok) {
            recordSecurityFailure(
              scaleContract.errorClass === 'QFJ_AUTHENTICATION_FAILED' ? 'signature' : 'contract',
            );
            writeJson(response, scaleStatus(scaleContract.errorClass), {
              error: 'scale_contract_rejected',
              errorClass: scaleContract.errorClass,
            });
            return;
          }
          const scaleResponseHeaders =
            scaleContract.mode === 'v1' ? qfjScaleResponseHeaders(scaleContract.metadata) : {};
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
            recordSecurityFailure('signature');
            writeJson(response, 401, { error: 'authentication_failed' }, scaleResponseHeaders);
            return;
          }

          if (!replayGuard.claim(challenge.requestId, current.getTime())) {
            writeJson(response, 409, { error: 'replay_rejected' }, scaleResponseHeaders);
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
            ...scaleResponseHeaders,
            [KEY_ID_HEADER]: dependencies.config.signingKey.keyId,
            [SIGNATURE_HEADER]: signature,
          });
        } catch {
          trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
          writeJson(response, 503, { error: 'service_unavailable' });
        } finally {
          const statusClass = String(Math.floor(response.statusCode / 100)) + 'xx';
          const labels = {
            service: 'qf-jarvis-gateway',
            route: metricRoute,
            method: request.method ?? 'UNKNOWN',
            status_class: statusClass,
          };
          addMetric('qf.http.server.requests', 1, labels);
          recordMetric('qf.http.server.duration', performance.now() - startedAt, labels);
        }
      },
      parent,
    ).catch(() => {
      if (!response.headersSent) writeJson(response, 503, { error: 'service_unavailable' });
    });
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
