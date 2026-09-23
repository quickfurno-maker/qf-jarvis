import { normalizeSourceDocument, type KnowledgeSourceDocumentInput } from '@qf-jarvis/knowledge-ingestion';
import {
  assessKnowledgeFreshness,
  type KnowledgeSourceFingerprint,
} from '@qf-jarvis/knowledge-freshness';

import type {
  KnowledgeFreshnessSourceBundle,
  KnowledgeFreshnessSourcePort,
} from './create-knowledge-freshness-coordinator.js';

export const KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL =
  'qfj.knowledge-freshness.source-manifest.v1' as const;

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_SOURCES = 1_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function detachedJson<T>(value: T): T {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError('knowledge-freshness-manifest-invalid');
  }
  if (encoded === undefined) throw new TypeError('knowledge-freshness-manifest-invalid');
  try {
    return JSON.parse(encoded) as T;
  } catch {
    throw new TypeError('knowledge-freshness-manifest-invalid');
  }
}

function parseFingerprint(value: unknown): KnowledgeSourceFingerprint {
  if (!record(value)) throw new TypeError('knowledge-freshness-manifest-invalid');
  const approved = value['approvedForProduction'] === true;
  const keys = approved
    ? [
        'sourceRef',
        'sourceRevision',
        'contentDigest',
        'ownerRef',
        'approvedForProduction',
        'approvalRef',
      ]
    : ['sourceRef', 'sourceRevision', 'contentDigest', 'ownerRef', 'approvedForProduction'];
  if (!exactKeys(value, keys) || typeof value['approvedForProduction'] !== 'boolean') {
    throw new TypeError('knowledge-freshness-manifest-invalid');
  }

  const candidate = detachedJson(value) as unknown as KnowledgeSourceFingerprint;
  // Reuse the canonical fingerprint validator. A one-element observed set exercises the same
  // validation path as a real freshness comparison without granting any acceptance state.
  assessKnowledgeFreshness([], [candidate]);
  return Object.freeze({ ...candidate });
}

function parseBundle(value: unknown): KnowledgeFreshnessSourceBundle {
  if (!record(value) || !exactKeys(value, ['fingerprint', 'document'])) {
    throw new TypeError('knowledge-freshness-manifest-invalid');
  }
  const fingerprint = parseFingerprint(value['fingerprint']);
  const document = detachedJson(value['document']) as KnowledgeSourceDocumentInput;

  let normalized;
  try {
    normalized = normalizeSourceDocument(document);
  } catch {
    throw new TypeError('knowledge-freshness-manifest-invalid');
  }

  if (
    fingerprint.sourceRef !== document.sourceRef ||
    fingerprint.sourceRevision !== document.sourceRevision ||
    fingerprint.ownerRef !== document.owner ||
    fingerprint.contentDigest !== normalized.contentDigest
  ) {
    throw new TypeError('knowledge-freshness-source-binding-invalid');
  }
  if (
    fingerprint.approvedForProduction &&
    (fingerprint.approvalRef === undefined ||
      document.approvedBy === undefined ||
      document.approvedAt === undefined)
  ) {
    throw new TypeError('knowledge-freshness-approval-binding-invalid');
  }

  return Object.freeze({ fingerprint, document: Object.freeze(document) });
}

/**
 * Convert one explicit, already-supplied source manifest into the freshness read port.
 *
 * There is intentionally no filesystem, network, source discovery, scheduling or approval lookup
 * here. The caller supplies the manifest; this adapter only validates, detaches and freezes it. That
 * keeps "source changed" separate from "source was approved" and prevents freshness from becoming an
 * autonomous publication mechanism.
 */
export function createKnowledgeFreshnessManifestSourcePort(
  value: unknown,
): KnowledgeFreshnessSourcePort {
  if (
    !record(value) ||
    !exactKeys(value, ['protocol', 'revision', 'sources']) ||
    value['protocol'] !== KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL ||
    typeof value['revision'] !== 'string' ||
    !REF.test(value['revision']) ||
    !Array.isArray(value['sources']) ||
    value['sources'].length > MAX_SOURCES
  ) {
    throw new TypeError('knowledge-freshness-manifest-invalid');
  }

  const bundles = Object.freeze(value['sources'].map(parseBundle));
  // Canonical validation also proves sourceRef uniqueness across the full manifest.
  assessKnowledgeFreshness(
    [],
    bundles.map((bundle) => bundle.fingerprint),
  );

  return Object.freeze({
    async readCurrent(): Promise<readonly KnowledgeFreshnessSourceBundle[]> {
      return Object.freeze(
        bundles.map((bundle) =>
          Object.freeze({
            fingerprint: Object.freeze({ ...bundle.fingerprint }),
            document: detachedJson(bundle.document),
          }),
        ),
      );
    },
  });
}
