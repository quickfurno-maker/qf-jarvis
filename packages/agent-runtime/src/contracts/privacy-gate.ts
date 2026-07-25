/**
 * The injected conversation privacy gate (QFJ-M1, ADR-0054 §I).
 *
 * A subject-linked conversation can only proceed to any model/knowledge interface after the gate
 * reports the subject `clear`. The gate is provider-neutral and synchronous; this package implements
 * no Core erasure — the ONLY concrete implementation shipped is the deterministic testing gate under
 * `./testing`. A subject-linked conversation with NO gate configured fails closed.
 */
import type { RuntimeSubjectStatus } from './vocabularies.js';

/** Resolves the current privacy status of an exact subject reference. */
export interface ConversationPrivacyGate {
  /**
   * The privacy status of `subjectRef`. Only `clear` permits proceeding; every other status blocks the
   * conversation BEFORE any model or knowledge interface is consulted. Must be deterministic and
   * perform no I/O.
   */
  subjectStatus(subjectRef: string): RuntimeSubjectStatus;
}
