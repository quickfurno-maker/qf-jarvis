/**
 * The Conversation Operations Center projection contract (QFJ-M1, ADR-0054 §L).
 *
 * The mandatory FUTURE dashboard projection fields, DOCUMENTED here so later agent/WhatsApp/dashboard
 * phases have a stable, content-free contract to build on. This is a contract only — there is no
 * dashboard, no persistence, and no message content. QuickFurno Core owns the authoritative
 * conversation record.
 */
import type { ConversationState, RuntimeActor, RuntimePartyType } from './vocabularies.js';

/** The closed list of safe projection fields the future operations center will surface. */
export const CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS = [
  'conversationId',
  'assignedActor',
  'partyType',
  'conversationState',
  'lastActivityAt',
  'aiPaused',
  'humanTakeover',
  'escalationStatus',
  'followUpStatus',
  'deliveryStatePlaceholder',
  'auditRef',
] as const;
export type ConversationOperationsSnapshotField =
  (typeof CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS)[number];

/** A content-free operations-center snapshot shape (future projection; not built here). */
export interface ConversationOperationsSnapshot {
  readonly conversationId: string;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly conversationState: ConversationState;
  readonly lastActivityAt: string;
  readonly aiPaused: boolean;
  readonly humanTakeover: boolean;
  /** A safe status token; never message content. */
  readonly escalationStatus: string;
  /** A safe status token; never message content. */
  readonly followUpStatus: string;
  /** A placeholder for a future delivery-state token; never message content. */
  readonly deliveryStatePlaceholder: string;
  /** An opaque audit reference; never message content, subject, or PII. */
  readonly auditRef: string;
}
