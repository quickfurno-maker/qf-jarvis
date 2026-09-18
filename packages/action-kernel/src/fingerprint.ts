/** Deterministic, content-only request fingerprint used for in-process conflict detection. */
import { createHash } from 'node:crypto';

import type { CoreDecisionRequest } from '@qf-jarvis/agent-runtime';

function canonicalize(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null) return 'n';
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite-number');
    return `d:${String(value)}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported-fingerprint-value');
}

export function actionKernelIdentityKey(request: CoreDecisionRequest): string {
  const identity = canonicalize({
    conversationId: request.conversationId,
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    expectedRevision: request.expectedRevision,
  });
  return `ak1:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

export function actionKernelRequestFingerprint(request: CoreDecisionRequest): string {
  return createHash('sha256').update(canonicalize(request), 'utf8').digest('hex');
}
