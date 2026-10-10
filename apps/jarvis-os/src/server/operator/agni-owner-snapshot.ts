import {
  QFJ_SCALE_HEADERS,
  qfjCompatibilityResponseHeaders,
  qfjScaleResponseHeaders,
  verifyQfjScaleRequest,
  type QfjScaleMetadataV1,
  type QfjScaleVerificationKey,
} from '@qf-jarvis/cross-system-scale-contract';

export const AGNI_OWNER_SNAPSHOT_PATH = '/api/internal/agni/owner-snapshot' as const;
export const AGNI_OWNER_SNAPSHOT_REQUEST_PROTOCOL = 'qfj.agni.owner-snapshot.v1' as const;
export const AGNI_OWNER_SNAPSHOT_RESPONSE_PROTOCOL = 'qfj.agni.owner-snapshot.response.v1' as const;
export const AGNI_PARENT_HEARTBEAT_REQUEST_PROTOCOL =
  'qfj.agni.parent-heartbeat.request.v1' as const;
export const AGNI_PARENT_HEARTBEAT_RESPONSE_PROTOCOL = 'qfj.agni.parent-heartbeat.v1' as const;
export const AGNI_OWNER_ACTOR = 'qf-agni-operator-gateway' as const;

const MAX_BODY_BYTES = 4096;

export type AgniOwnerSnapshotVerification =
  Readonly<{ ok: true; metadata: QfjScaleMetadataV1 }> | Readonly<{ ok: false }>;

export function verifyAgniOwnerSnapshot(input: {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: Uint8Array;
  readonly verificationKeys: readonly QfjScaleVerificationKey[];
  readonly nowMs?: number;
}): AgniOwnerSnapshotVerification {
  if (input.rawBody.byteLength < 2 || input.rawBody.byteLength > MAX_BODY_BYTES) {
    return Object.freeze({ ok: false });
  }
  const verified = verifyQfjScaleRequest({
    headers: input.headers,
    method: 'POST',
    path: AGNI_OWNER_SNAPSHOT_PATH,
    rawBody: input.rawBody,
    verificationKeys: input.verificationKeys,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    allowLegacy: false,
  });
  if (!verified.ok || verified.mode !== 'v1' || verified.metadata.actor !== AGNI_OWNER_ACTOR) {
    return Object.freeze({ ok: false });
  }
  const keyId = input.headers[QFJ_SCALE_HEADERS.keyId];
  if (!keyId || !input.verificationKeys.some((entry) => entry.keyId === keyId)) {
    return Object.freeze({ ok: false });
  }
  return Object.freeze({ ok: true, metadata: verified.metadata });
}

export function parseAgniOwnerSnapshot(rawBody: Uint8Array): boolean {
  if (rawBody.byteLength < 2 || rawBody.byteLength > MAX_BODY_BYTES) return false;
  try {
    const value = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      (value as Record<string, unknown>)['protocol'] === AGNI_OWNER_SNAPSHOT_REQUEST_PROTOCOL
    );
  } catch {
    return false;
  }
}

export function parseAgniParentHeartbeat(rawBody: Uint8Array): string | null {
  if (rawBody.byteLength < 2 || rawBody.byteLength > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const b = body as Record<string, unknown>;
    if (
      Object.keys(b).length !== 2 ||
      b['protocol'] !== AGNI_PARENT_HEARTBEAT_REQUEST_PROTOCOL ||
      typeof b['challenge'] !== 'string' ||
      !/^[0-9a-f]{32}$/u.test(b['challenge'])
    )
      return null;
    return b['challenge'];
  } catch {
    return null;
  }
}

export function agniOwnerSnapshotResponseHeaders(
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
