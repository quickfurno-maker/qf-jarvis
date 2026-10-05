import http from 'node:http';
import https from 'node:https';

import {
  context,
  isSpanContextValid,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import {
  createQfjScaleMetadata,
  qfjScaleRetryable,
  signQfjScaleHeaders,
  type QfjScaleActor,
  type QfjScaleErrorClass,
  type QfjScaleMetadataV1,
} from './contract.js';
import { QFJ_SCALE_DEFAULTS, QfjIsolationFailure, QfjIsolationGate } from './isolation.js';

export interface QfjScaleHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type QfjScaleHttpPost = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<QfjScaleHttpResponse>;

export type QfjScaleTransportResult =
  | {
      readonly ok: true;
      readonly response: QfjScaleHttpResponse;
      readonly metadata: QfjScaleMetadataV1;
    }
  | {
      readonly ok: false;
      readonly errorClass: QfjScaleErrorClass;
      readonly retryable: boolean;
      readonly metadata: QfjScaleMetadataV1;
    };

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxTotalSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxFreeSockets: QFJ_SCALE_DEFAULTS.maxFreeSockets,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxTotalSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxFreeSockets: QFJ_SCALE_DEFAULTS.maxFreeSockets,
});

const defaultGate = new QfjIsolationGate({
  maxConcurrent: QFJ_SCALE_DEFAULTS.maxConcurrent,
  breakerFailureThreshold: QFJ_SCALE_DEFAULTS.breakerFailureThreshold,
  breakerOpenMs: QFJ_SCALE_DEFAULTS.breakerOpenMs,
});

function protocolAllowed(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1')
  );
}

export function boundedNodeHttpPost(
  urlText: string,
  init: Parameters<QfjScaleHttpPost>[1],
): Promise<QfjScaleHttpResponse> {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return Promise.reject(new QfjIsolationFailure('QFJ_CONTRACT_INVALID', false));
  }
  if (!protocolAllowed(url)) {
    return Promise.reject(new QfjIsolationFailure('QFJ_CONTRACT_INVALID', false));
  }

  const transport = url.protocol === 'https:' ? https : http;
  const agent = url.protocol === 'https:' ? httpsAgent : httpAgent;

  return new Promise<QfjScaleHttpResponse>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'POST',
        headers: init.headers,
        agent,
        signal: init.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let failed = false;

        response.on('data', (chunk: Buffer | string) => {
          if (failed) return;
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
          bytes += value.length;
          if (bytes > 65_536) {
            failed = true;
            request.destroy(new QfjIsolationFailure('QFJ_INVALID_RESPONSE', false));
            return;
          }
          chunks.push(value);
        });

        response.on('end', () => {
          if (failed) return;
          const body = Buffer.concat(chunks).toString('utf8');
          resolve(
            Object.freeze({
              status: response.statusCode ?? 503,
              text(): Promise<string> {
                return Promise.resolve(body);
              },
            }),
          );
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(init.body);
  });
}

export function createQfjScaleTransport(gate: QfjIsolationGate = defaultGate) {
  return async function executeQfjScaleRequest(args: {
    readonly url: string;
    readonly path: string;
    readonly body: string;
    readonly keyId: string;
    readonly privateKeyPem: string;
    readonly actor: QfjScaleActor;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly expectedRevision?: number;
    readonly correlationId?: string;
    readonly traceId?: string;
    readonly timeoutMs?: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    readonly httpPost?: QfjScaleHttpPost;
  }): Promise<QfjScaleTransportResult> {
    const tracer = trace.getTracer('qfj.cross-system-scale', '1');
    return tracer.startActiveSpan(
      'qfj.http.client',
      {
        kind: SpanKind.CLIENT,
        attributes: { 'http.request.method': 'POST', 'qfj.route': args.path },
      },
      async (span) => {
        const timeoutMs = args.timeoutMs ?? QFJ_SCALE_DEFAULTS.timeoutMs;
        const current = span.spanContext();
        const activeTraceId = isSpanContextValid(current) ? current.traceId : undefined;
        const selectedTraceId = args.traceId ?? activeTraceId;
        const metadata = createQfjScaleMetadata({
          requestId: args.requestId,
          idempotencyKey: args.idempotencyKey,
          actor: args.actor,
          timeoutMs,
          ...(args.expectedRevision === undefined
            ? {}
            : { expectedRevision: args.expectedRevision }),
          ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId }),
          ...(selectedTraceId === undefined ? {} : { traceId: selectedTraceId }),
        });
        const rawBody = Buffer.from(args.body, 'utf8');
        const scaleHeaders = signQfjScaleHeaders({
          method: 'POST',
          path: args.path,
          metadata,
          keyId: args.keyId,
          privateKeyPem: args.privateKeyPem,
          rawBody,
        });
        const baseHeaders: Record<string, string> = {
          ...(args.headers ?? {}),
          ...scaleHeaders,
        };
        if (activeTraceId !== undefined && activeTraceId === metadata.traceId) {
          propagation.inject(context.active(), baseHeaders);
        }
        const post = args.httpPost ?? boundedNodeHttpPost;

        try {
          const response = await gate.run({
            deadlineAt: metadata.deadlineAt,
            task: async (signal) => {
              const effectiveSignal =
                args.signal === undefined ? signal : AbortSignal.any([signal, args.signal]);
              const value = await post(args.url, {
                method: 'POST',
                redirect: 'error',
                signal: effectiveSignal,
                headers: Object.freeze(baseHeaders),
                body: args.body,
              });
              if (value.status === 429) {
                throw new QfjIsolationFailure('QFJ_BACKPRESSURE', true);
              }
              if (value.status >= 500) {
                throw new QfjIsolationFailure('QFJ_UPSTREAM_UNAVAILABLE', true);
              }
              return value;
            },
          });
          span.setAttribute('http.response.status_code', response.status);
          span.setStatus({
            code: response.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          });
          return Object.freeze({ ok: true as const, response, metadata });
        } catch (error) {
          const failure =
            error instanceof QfjIsolationFailure
              ? error
              : new QfjIsolationFailure('QFJ_UPSTREAM_UNAVAILABLE', true);
          span.setAttribute('qfj.error_class', failure.errorClass);
          span.setStatus({ code: SpanStatusCode.ERROR });
          return Object.freeze({
            ok: false as const,
            errorClass: failure.errorClass,
            retryable: qfjScaleRetryable(failure.errorClass),
            metadata,
          });
        } finally {
          span.end();
        }
      },
    );
  };
}

export const executeQfjScaleRequest = createQfjScaleTransport();

export function qfjScaleIsolationSnapshot() {
  return defaultGate.snapshot();
}
