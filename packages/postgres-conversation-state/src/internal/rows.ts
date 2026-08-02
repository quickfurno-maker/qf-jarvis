/**
 * Row canonicalization (QFJ-P08-B2, ADR-0077).
 *
 * INTERNAL. Every database row is treated as untrusted structural input and rebuilt into a fresh,
 * frozen record — never handed on by identity.
 *
 * "The CHECK constraints prevent that" is a claim about a schema this process has not verified it is
 * connected to. A partially applied migration, a hand-corrected row, a restore from an older dump or
 * a future column change all arrive here looking exactly like data. And durable evidence is the
 * thing a later audit will be read against, so a malformed row must become a refusal rather than a
 * confident answer.
 */
import type { ConversationControlState } from '@qf-jarvis/jarvis-runtime';
import type {
  ConversationControlAuditRecord,
  ConversationControlCommand,
  ConversationControlDecision,
  ConversationControlSnapshot,
} from '@qf-jarvis/conversation-control';

import { PostgresConversationStateError } from '../contracts/errors.js';
import {
  DATA_CLASSES,
  MAX_REVISION,
  PARTY_TYPES,
  SUBJECT_STATUSES,
  isExactIdentifier,
  isMember,
  isPlainRecord,
  isSafeReference,
  parseBigintRevision,
  toCanonicalInstant,
} from './validation.js';

function invariant(): never {
  throw new PostgresConversationStateError('repository-invariant');
}

/** Rebuild a `ConversationControlState` from one `conversation_runtime_state` row. */
export function canonicalizeStateRow(row: unknown): ConversationControlState {
  if (!isPlainRecord(row)) {
    return invariant();
  }
  const revision = parseBigintRevision(row['revision']);
  const subjectRef = row['subject_ref'];
  if (
    !isExactIdentifier(row['tenant_id']) ||
    !isExactIdentifier(row['conversation_id']) ||
    revision === undefined ||
    !isMember(PARTY_TYPES, row['party_type']) ||
    !isMember(DATA_CLASSES, row['data_class']) ||
    typeof row['human_takeover'] !== 'boolean' ||
    typeof row['ai_paused'] !== 'boolean' ||
    typeof row['cancelled'] !== 'boolean' ||
    !isMember(SUBJECT_STATUSES, row['subject_status']) ||
    // SQL NULL means "no subject", which the contract expresses as `undefined`, not as an empty
    // string. Anything else present must still be an opaque reference.
    (subjectRef !== null && !isExactIdentifier(subjectRef)) ||
    !isSafeReference(row['observed_at'])
  ) {
    return invariant();
  }
  return Object.freeze({
    conversationId: row['conversation_id'],
    tenantId: row['tenant_id'],
    revision,
    partyType: row['party_type'],
    dataClass: row['data_class'],
    humanTakeover: row['human_takeover'],
    aiPaused: row['ai_paused'],
    cancelled: row['cancelled'],
    subjectStatus: row['subject_status'],
    subjectRef: subjectRef ?? undefined,
    observedAt: row['observed_at'],
  });
}

/** The four-field control fragment the reducer operates on, projected from the full state. */
export function controlFragmentOf(state: ConversationControlState): {
  readonly conversationId: string;
  readonly revision: number;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
} {
  return {
    conversationId: state.conversationId,
    revision: state.revision,
    humanTakeover: state.humanTakeover,
    aiPaused: state.aiPaused,
  };
}

/** The exact outcome → reason pairings ADR-0074 permits. */
const ALLOWED_REASONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  APPLIED: Object.freeze(['applied']),
  NO_CHANGE: Object.freeze(['already-satisfied']),
  REFUSED: Object.freeze(['revision-mismatch', 'human-takeover-active', 'revision-exhausted']),
});

/**
 * Does the recorded post-state match what this ACTION does?
 *
 * The same postconditions the composition applies to a foreign decision (ADR-0075 §8a), applied here
 * to durable evidence. A stored row can satisfy every arithmetic constraint and still claim a
 * takeover was applied while its own flags say otherwise.
 *
 * `revision-mismatch` is deliberately not action-checked (staleness is decided before the action
 * semantics run), and `human-takeover-active` does not additionally require `aiPaused`, because
 * ADR-0074 accepts an external takeover-without-pause state.
 */
function actionSemanticsMatch(
  action: string,
  outcome: string,
  reason: string,
  humanTakeover: boolean,
  aiPaused: boolean,
): boolean {
  if (outcome === 'APPLIED') {
    switch (action) {
      case 'TAKE_OWNERSHIP':
        return humanTakeover && aiPaused;
      case 'RELEASE_OWNERSHIP':
        return !humanTakeover && aiPaused;
      case 'PAUSE_AI':
        return aiPaused;
      case 'RESUME_AI':
        return !humanTakeover && !aiPaused;
      default:
        return false;
    }
  }
  if (outcome === 'NO_CHANGE') {
    switch (action) {
      case 'TAKE_OWNERSHIP':
        return humanTakeover && aiPaused;
      case 'RELEASE_OWNERSHIP':
        return !humanTakeover;
      case 'PAUSE_AI':
        return aiPaused;
      case 'RESUME_AI':
        return !humanTakeover && !aiPaused;
      default:
        return false;
    }
  }
  if (reason === 'revision-exhausted') {
    switch (action) {
      case 'TAKE_OWNERSHIP':
        return !(humanTakeover && aiPaused);
      case 'RELEASE_OWNERSHIP':
        return humanTakeover;
      case 'PAUSE_AI':
        return !aiPaused;
      case 'RESUME_AI':
        return !humanTakeover && aiPaused;
      default:
        return false;
    }
  }
  return true;
}

/** The command identity a stored ledger row claims, for exact-duplicate comparison. */
export interface StoredCommandIdentity {
  readonly conversationId: string;
  readonly controlVersion: number;
  readonly expectedRevision: number;
  readonly action: string;
  readonly operatorRef: string;
  readonly reasonRef: string | undefined;
  readonly issuedAt: string;
}

/** One stored ledger row, canonicalized into its command identity and its decision. */
export interface StoredCommandRecord {
  readonly identity: StoredCommandIdentity;
  readonly decision: ConversationControlDecision;
}

/**
 * Rebuild a ledger row into a command identity plus a fresh, deeply frozen decision.
 *
 * This is what makes an exact-duplicate replay safe: the decision handed back to a caller is
 * reconstructed and re-checked here, so a row that drifted cannot be replayed as if it were the
 * decision that was actually made.
 */
export function canonicalizeCommandRow(row: unknown): StoredCommandRecord {
  if (!isPlainRecord(row)) {
    return invariant();
  }
  const expectedRevision = parseBigintRevision(row['expected_revision']);
  const observedRevision = parseBigintRevision(row['observed_revision']);
  const resultingRevision = parseBigintRevision(row['resulting_revision']);
  const issuedAt = toCanonicalInstant(row['issued_at']);
  const reasonRef = row['reason_ref'];
  const outcome = row['outcome'];
  const reason = row['reason'];
  const action = row['action'];
  const humanTakeover = row['resulting_human_takeover'];
  const aiPaused = row['resulting_ai_paused'];

  if (
    !isExactIdentifier(row['tenant_id']) ||
    !isExactIdentifier(row['command_id']) ||
    !isExactIdentifier(row['conversation_id']) ||
    !isExactIdentifier(row['operator_ref']) ||
    (reasonRef !== null && !isExactIdentifier(reasonRef)) ||
    row['control_version'] !== 1 ||
    row['record_version'] !== 1 ||
    expectedRevision === undefined ||
    observedRevision === undefined ||
    resultingRevision === undefined ||
    issuedAt === undefined ||
    typeof outcome !== 'string' ||
    typeof reason !== 'string' ||
    typeof action !== 'string' ||
    typeof humanTakeover !== 'boolean' ||
    typeof aiPaused !== 'boolean' ||
    !ALLOWED_REASONS[outcome]?.includes(reason) ||
    !actionSemanticsMatch(action, outcome, reason, humanTakeover, aiPaused)
  ) {
    return invariant();
  }

  // The arithmetic each outcome implies, re-derived rather than trusted.
  if (outcome === 'APPLIED') {
    if (
      expectedRevision !== observedRevision ||
      observedRevision >= MAX_REVISION ||
      resultingRevision !== observedRevision + 1
    ) {
      return invariant();
    }
  } else if (outcome === 'NO_CHANGE') {
    if (expectedRevision !== observedRevision || resultingRevision !== observedRevision) {
      return invariant();
    }
  } else if (reason === 'revision-mismatch') {
    if (expectedRevision === observedRevision || resultingRevision !== observedRevision) {
      return invariant();
    }
  } else if (reason === 'human-takeover-active') {
    if (
      action !== 'RESUME_AI' ||
      expectedRevision !== observedRevision ||
      resultingRevision !== observedRevision ||
      !humanTakeover
    ) {
      return invariant();
    }
  } else if (
    expectedRevision !== observedRevision ||
    observedRevision !== MAX_REVISION ||
    resultingRevision !== observedRevision
  ) {
    return invariant();
  }

  const nextState = Object.freeze({
    conversationId: row['conversation_id'],
    revision: resultingRevision,
    humanTakeover,
    aiPaused,
  }) as ConversationControlSnapshot;

  const auditRecord = Object.freeze({
    recordVersion: 1 as const,
    commandId: row['command_id'],
    conversationId: row['conversation_id'],
    action,
    operatorRef: row['operator_ref'],
    ...(reasonRef === null ? {} : { reasonRef }),
    expectedRevision,
    observedRevision,
    outcome,
    reason,
    resultingRevision,
    humanTakeover,
    aiPaused,
    issuedAt,
  }) as ConversationControlAuditRecord;

  return Object.freeze({
    identity: Object.freeze({
      conversationId: row['conversation_id'],
      controlVersion: 1,
      expectedRevision,
      action,
      operatorRef: row['operator_ref'],
      reasonRef: reasonRef ?? undefined,
      issuedAt,
    }),
    decision: Object.freeze({
      outcome,
      reason,
      nextState,
      auditRecord,
    }) as ConversationControlDecision,
  });
}

/**
 * Is a stored identity the SAME command as the one being applied?
 *
 * Every pure command field is compared, including `reasonRef`'s presence — an absent code and a
 * supplied one are different intents, not a formatting difference. `tenantId` is not compared here
 * because the row was looked up by it.
 */
export function isSameCommand(
  stored: StoredCommandIdentity,
  command: ConversationControlCommand,
): boolean {
  return (
    stored.conversationId === command.conversationId &&
    stored.controlVersion === command.controlVersion &&
    stored.expectedRevision === command.expectedRevision &&
    stored.action === command.action &&
    stored.operatorRef === command.operatorRef &&
    stored.reasonRef === command.reasonRef &&
    stored.issuedAt === command.issuedAt
  );
}
