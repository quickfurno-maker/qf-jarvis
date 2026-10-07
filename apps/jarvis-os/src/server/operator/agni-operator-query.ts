import {
  QFJ_SCALE_HEADERS,
  qfjCompatibilityResponseHeaders,
  qfjScaleResponseHeaders,
  verifyQfjScaleRequest,
  type QfjScaleMetadataV1,
  type QfjScaleVerificationKey,
} from '@qf-jarvis/cross-system-scale-contract';

export const AGNI_OPERATOR_QUERY_PATH =
  '/api/internal/agni/operator-query' as const;
export const AGNI_OPERATOR_QUERY_REQUEST_PROTOCOL =
  'qfj.agni.operator-query.v1' as const;
export const AGNI_OPERATOR_QUERY_RESPONSE_PROTOCOL =
  'qfj.agni.operator-query.response.v1' as const;

const MAX_BODY_BYTES = 4096;
const MAX_QUERY_CHARS = 500;

export type AgniOperatorQueryVerification =
  | Readonly<{ ok: true; metadata: QfjScaleMetadataV1 }>
  | Readonly<{ ok: false }>;

export function headersToRecord(
  headers: Headers,
): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const [key, value] of headers.entries()) output[key.toLowerCase()] = value;
  return Object.freeze(output);
}

export function verifyAgniOperatorQuery(input: {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: Uint8Array;
  readonly verificationKeys: readonly QfjScaleVerificationKey[];
  readonly nowMs?: number;
}): AgniOperatorQueryVerification {
  if (input.rawBody.byteLength < 2 || input.rawBody.byteLength > MAX_BODY_BYTES) {
    return Object.freeze({ ok: false });
  }
  const verified = verifyQfjScaleRequest({
    headers: input.headers,
    method: 'POST',
    path: AGNI_OPERATOR_QUERY_PATH,
    rawBody: input.rawBody,
    verificationKeys: input.verificationKeys,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    allowLegacy: false,
  });
  if (
    !verified.ok ||
    verified.mode !== 'v1' ||
    verified.metadata.actor !== 'qf-agni-control-plane'
  ) {
    return Object.freeze({ ok: false });
  }
  const keyId = input.headers[QFJ_SCALE_HEADERS.keyId];
  if (!keyId || !input.verificationKeys.some((entry) => entry.keyId === keyId)) {
    return Object.freeze({ ok: false });
  }
  return Object.freeze({ ok: true, metadata: verified.metadata });
}

export function parseAgniOperatorQuery(rawBody: Uint8Array): string | null {
  if (rawBody.byteLength < 2 || rawBody.byteLength > MAX_BODY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record['protocol'] !== AGNI_OPERATOR_QUERY_REQUEST_PROTOCOL ||
    typeof record['query'] !== 'string'
  ) {
    return null;
  }
  const query = record['query'];
  if (query.trim().length === 0 || query.length > MAX_QUERY_CHARS) return null;
  return query;
}

export function agniOperatorQueryResponseHeaders(
  metadata: Pick<QfjScaleMetadataV1, 'correlationId' | 'traceId'>,
): Readonly<Record<string, string>> {
  return Object.freeze({
    'cache-control': 'no-store, private',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...qfjScaleResponseHeaders(metadata),
    ...qfjCompatibilityResponseHeaders('current'),
  });
}
