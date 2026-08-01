/**
 * The operator operations query surface (QFJ-P08-A, ADR-0075).
 *
 * One programmatic method that turns an injected authoritative projection into a validated, frozen,
 * content-free `ConversationOperationsSnapshot`. It is a QUERY, not a console: no dashboard, no
 * React, no route, no REST/GraphQL, no websocket, no polling worker, no browser bundle. It exists so
 * a later AUTHENTICATED operator API has a stable validated projection to read.
 *
 * The single most important rule here is that production FABRICATES NOTHING. The composition may
 * derive exactly one value — `assignedActor`, through M1's existing `assignAgent` — and may copy
 * `conversationId`, `revision`, `partyType`, `humanTakeover` and `aiPaused` from the authoritative
 * state record inside the projection. The six remaining tokens (`conversationState`,
 * `lastActivityAt`, `escalationStatus`, `followUpStatus`, `deliveryStatePlaceholder`, `auditRef`)
 * come from the injected source and are copied verbatim.
 *
 * Inferring any of them would be worse than leaving them empty. Deriving `conversationState` from
 * `aiPaused` would silently define new conversation-state transitions inside `jarvis-runtime`;
 * deriving `auditRef` from a revision or a command id would attest to a correlation nobody recorded.
 * A missing or invalid projection is refused, not repaired.
 */
import {
  assignAgent,
  createConversationOperationsSnapshot,
  CONVERSATION_STATES,
  RUNTIME_DATA_CLASSES,
  RUNTIME_PARTY_TYPES,
  RUNTIME_SUBJECT_STATUSES,
} from '@qf-jarvis/agent-runtime';
import type { ConversationOperationsSnapshot } from '@qf-jarvis/agent-runtime';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type {
  ConversationControlState,
  ConversationOperationsProjection,
  ConversationStateKey,
  OperationsProjectingAuthoritativeConversationStatePort,
} from '../contracts/authoritative-state.js';

/**
 * One operations query, explicitly tenant-scoped (QFJ-P08-B1, ADR-0076).
 *
 * A query by conversation alone could be answered from another tenant's record. `conversationId` is
 * not assumed globally unique, so the caller states which tenant it is asking about.
 */
export interface ConversationOperationsQueryInput {
  readonly tenantId: string;
  readonly conversationId: string;
}

/** The outcome of one operations query. Type-only; no new runtime vocabulary. */
export type JarvisConversationOperationsResult =
  | { readonly ok: true; readonly snapshot: ConversationOperationsSnapshot }
  | {
      readonly ok: false;
      readonly reason:
        | 'operations-invalid-conversation'
        | 'operations-unavailable'
        | 'operations-source-failure'
        | 'operations-invalid-result';
    };

function failure(
  reason: Extract<JarvisConversationOperationsResult, { ok: false }>['reason'],
): JarvisConversationOperationsResult {
  return Object.freeze({ ok: false as const, reason });
}

/** A plain, non-array object with no inherited enumerable payload. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}

const EXACT_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

/** An exact conversation id: no wildcard, no `latest` — the two strings that mean "any of them". */
function isQueryableConversationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    EXACT_IDENTIFIER.test(value) &&
    !value.includes('*') &&
    value.toLowerCase() !== 'latest'
  );
}

function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && EXACT_IDENTIFIER.test(value);
}

/** The exact own keys a `ConversationControlState` carries. */
const STATE_KEYS = [
  'conversationId',
  'tenantId',
  'revision',
  'partyType',
  'dataClass',
  'humanTakeover',
  'aiPaused',
  'cancelled',
  'subjectStatus',
  'subjectRef',
  'observedAt',
] as const;

/** The exact own keys a `ConversationOperationsProjection` carries. */
const PROJECTION_KEYS = [
  'state',
  'conversationState',
  'lastActivityAt',
  'escalationStatus',
  'followUpStatus',
  'deliveryStatePlaceholder',
  'auditRef',
] as const;

/**
 * Re-validate a foreign `ConversationControlState` and return a fresh frozen copy.
 *
 * INTERNAL, and not exported as a public validator: this is a defensive check at one boundary, not a
 * capability callers should reach for. `OperationsProjectingAuthoritativeConversationStatePort` is
 * structural, so a projection may arrive from an implementation this repository never compiled, and
 * TypeScript's word for its shape is not evidence.
 *
 * `subjectRef` is `string | undefined` in the contract, so the key must be PRESENT and either a safe
 * opaque token or `undefined` — an absent key is a different shape from the one M5 declares.
 */
function canonicalizeState(value: unknown): ConversationControlState | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  const expected = [...STATE_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return undefined;
  }
  const revision = value['revision'];
  const subjectRef = value['subjectRef'];
  if (
    !isSafeToken(value['conversationId']) ||
    !isSafeToken(value['tenantId']) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !RUNTIME_PARTY_TYPES.includes(value['partyType'] as (typeof RUNTIME_PARTY_TYPES)[number]) ||
    !RUNTIME_DATA_CLASSES.includes(value['dataClass'] as (typeof RUNTIME_DATA_CLASSES)[number]) ||
    typeof value['humanTakeover'] !== 'boolean' ||
    typeof value['aiPaused'] !== 'boolean' ||
    typeof value['cancelled'] !== 'boolean' ||
    !RUNTIME_SUBJECT_STATUSES.includes(
      value['subjectStatus'] as (typeof RUNTIME_SUBJECT_STATUSES)[number],
    ) ||
    (subjectRef !== undefined && !isSafeToken(subjectRef)) ||
    !isSafeToken(value['observedAt'])
  ) {
    return undefined;
  }
  return Object.freeze({
    conversationId: value['conversationId'],
    tenantId: value['tenantId'],
    revision,
    partyType: value['partyType'] as ConversationControlState['partyType'],
    dataClass: value['dataClass'] as ConversationControlState['dataClass'],
    humanTakeover: value['humanTakeover'],
    aiPaused: value['aiPaused'],
    cancelled: value['cancelled'],
    subjectStatus: value['subjectStatus'] as ConversationControlState['subjectStatus'],
    subjectRef,
    observedAt: value['observedAt'],
  });
}

/** Re-validate the projection wrapper and its six supplemental tokens. */
function canonicalizeProjection(value: unknown): ConversationOperationsProjection | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  const expected = [...PROJECTION_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return undefined;
  }
  const state = canonicalizeState(value['state']);
  if (state === undefined) {
    return undefined;
  }
  if (
    !CONVERSATION_STATES.includes(
      value['conversationState'] as (typeof CONVERSATION_STATES)[number],
    ) ||
    typeof value['lastActivityAt'] !== 'string' ||
    !isSafeToken(value['escalationStatus']) ||
    !isSafeToken(value['followUpStatus']) ||
    !isSafeToken(value['deliveryStatePlaceholder']) ||
    !isSafeToken(value['auditRef'])
  ) {
    return undefined;
  }
  // `lastActivityAt` is NOT checked here beyond being a string: the M1 snapshot constructor owns the
  // canonical-instant grammar, and duplicating it would create a second definition of an instant.
  return Object.freeze({
    state,
    conversationState: value[
      'conversationState'
    ] as ConversationOperationsProjection['conversationState'],
    lastActivityAt: value['lastActivityAt'],
    escalationStatus: value['escalationStatus'],
    followUpStatus: value['followUpStatus'],
    deliveryStatePlaceholder: value['deliveryStatePlaceholder'],
    auditRef: value['auditRef'],
  });
}

/**
 * Does this source implement the projection capability? Private structural check on the ONE
 * configured object; never root-exported, never mutating the source.
 */
function asProjecting(
  source: JarvisRuntimeConfig['authoritativeState'],
): OperationsProjectingAuthoritativeConversationStatePort | undefined {
  const candidate = source as Partial<OperationsProjectingAuthoritativeConversationStatePort>;
  return typeof candidate.readOperationsProjection === 'function'
    ? (source as OperationsProjectingAuthoritativeConversationStatePort)
    : undefined;
}

/**
 * Read one conversation's operations snapshot through the configured authoritative source.
 *
 * Order: validate the id → detect the projection capability on the SAME configured object → call it
 * EXACTLY once → re-validate the answer → derive only `assignedActor` → build the snapshot through
 * M1's constructor.
 *
 * No retry, no fallback, no second source, no repair.
 */
export async function readOperationsSnapshotThroughSource(
  config: JarvisRuntimeConfig,
  input: ConversationOperationsQueryInput,
): Promise<JarvisConversationOperationsResult> {
  // Both identifiers are checked BEFORE any source call: a wildcard query is not a query, and a
  // source should never be asked to interpret one. An invalid tenant reuses the existing closed
  // reason rather than adding a second one -- the caller's remedy is identical either way.
  if (
    !isPlainRecord(input) ||
    !isQueryableConversationId(input.tenantId) ||
    !isQueryableConversationId(input.conversationId)
  ) {
    return failure('operations-invalid-conversation');
  }
  const key: ConversationStateKey = Object.freeze({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });

  const projecting = asProjecting(config.authoritativeState);
  if (projecting === undefined) {
    return failure('operations-unavailable');
  }

  let raw: unknown;
  try {
    raw = await projecting.readOperationsProjection(key);
  } catch {
    // Foreign code. The thrown value is discarded, never logged or re-emitted.
    return failure('operations-source-failure');
  }

  const projection = canonicalizeProjection(raw);
  if (
    projection?.state.conversationId !== key.conversationId ||
    projection.state.tenantId !== key.tenantId
  ) {
    // A projection for a different conversation -- or the right conversation under the WRONG TENANT
    // -- is not a near miss; answering with it would attribute one tenant's control state to another.
    return failure('operations-invalid-result');
  }

  // The ONE derived value, through M1's existing router. This is reuse, not a second router: the same
  // pure function the inbound path uses, given the same inputs, with nothing here able to override it.
  const assignedActor = assignAgent(
    projection.state.partyType,
    projection.state.humanTakeover,
    config.policy,
  );

  try {
    const snapshot = createConversationOperationsSnapshot({
      conversationId: projection.state.conversationId,
      revision: projection.state.revision,
      assignedActor,
      partyType: projection.state.partyType,
      conversationState: projection.conversationState,
      lastActivityAt: projection.lastActivityAt,
      aiPaused: projection.state.aiPaused,
      humanTakeover: projection.state.humanTakeover,
      escalationStatus: projection.escalationStatus,
      followUpStatus: projection.followUpStatus,
      deliveryStatePlaceholder: projection.deliveryStatePlaceholder,
      auditRef: projection.auditRef,
    });
    return Object.freeze({ ok: true as const, snapshot });
  } catch {
    // The M1 constructor refused -- most often a non-canonical `lastActivityAt`. Refused, not repaired.
    return failure('operations-invalid-result');
  }
}
