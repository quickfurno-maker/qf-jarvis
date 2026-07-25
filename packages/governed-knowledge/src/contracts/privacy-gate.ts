/**
 * The injected privacy gate (QFJ-P04.03, ADR-0051).
 *
 * A subject-linked record can only be exposed after a privacy gate reports the subject `clear`. The
 * gate is provider-neutral and synchronous; this package implements no Core erasure — the ONLY
 * concrete implementation shipped is the deterministic testing gate under `./testing`. A subject-
 * linked record with NO gate configured fails closed (the gateway never guesses a subject is clear).
 */
import type { KnowledgeSubjectStatus } from './vocabularies.js';

/** Resolves the current privacy status of an exact subject reference. */
export interface KnowledgePrivacyGate {
  /**
   * The privacy status of `subjectRef`. Only `clear` permits exposure; `erased`/`anonymised`/
   * `tombstoned`/`in-progress` block the record before its content is read. Must be deterministic
   * and must not read content or perform I/O.
   */
  subjectStatus(subjectRef: string): KnowledgeSubjectStatus;
}
