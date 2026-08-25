/**
 * The JAO-3 store port (ADR-0117).
 *
 * ### Narrow on purpose, and semantic rather than general
 *
 * Eight operations, each one a thing an investigation actually does. There is deliberately no
 * `query`, no `execute`, no `raw`, no row type and no SQL anywhere on this surface: a port that can
 * run arbitrary statements is not a port, it is a database handle with extra steps, and every
 * invariant the adapter enforces would become optional the moment a caller could route around it.
 *
 * There is also no `clearAll`, `deleteAll`, `reset`, `prune` or `delete`. Expiry is not deletion --
 * an expired investigation stops accepting work and stays exactly where it is, because the record
 * of an investigation that ran is worth more than the space it occupies. Test cleanup belongs to
 * the test harness, which owns its own disposable schema and is excluded from the emitting build.
 *
 * And there is no `authorize`, `approve`, `send`, `dispatch` or `execute`. JAO-3 remembers; it does
 * not permit. A spec asserts every one of those names is absent from the built surface.
 *
 * ### Why the port exists at all when there is one implementation
 *
 * Not for a second database. For the unit suite: the governed operations layer is proved against
 * this interface without PostgreSQL, and the interface is what states -- in types a compiler
 * checks -- that durability is somebody's job. A future implementation must satisfy the same
 * relations, and "a future Mastra removal must not destroy the memory format" is only true because
 * the format is defined here rather than by whatever happens to be storing it.
 */
import type {
  Jao3AppendCheckpointInput,
  Jao3AppendOwnerCorrectionInput,
  Jao3Checkpoint,
  Jao3CreateInvestigationInput,
  Jao3Investigation,
  Jao3InvestigationView,
  Jao3OwnerCorrection,
  Jao3ResumeInvestigationInput,
  Jao3SupersedeInvestigationInput,
  Jao3TransitionInput,
} from './contracts.js';

/**
 * What an append returns: the IMMUTABLE row it created, and the revision it committed at.
 *
 * ### Why the current investigation header is deliberately not here
 *
 * It used to be, and owner review found that it broke the exact-replay contract in a way no
 * immediate-replay test could see. The header is MUTABLE: append A at revision 4, let a later legal
 * write move the investigation to revision 7, then retry A. The checkpoint returned is the original
 * one, but the header returned is today's -- so "the same operation id returns the prior result
 * unchanged" was true of half the result and false of the other half, and the halves disagreed
 * about what revision this was.
 *
 * A durable result has to be intrinsically immutable, so it now carries only things that cannot
 * change: the row that was written, and `committedRevision` -- the revision the write actually
 * committed at, read back from the replay record rather than from the header. A caller that wants
 * current state calls `readInvestigation`, which is honest about being a separate question.
 *
 * `replayed` is CALL METADATA, not part of the durable result: it describes what this particular
 * call found, so it legitimately differs between the first write (`false`) and a retry (`true`)
 * while the durable fields are identical. That distinction is the whole point of surfacing it -- a
 * resuming caller genuinely does not know whether its previous attempt committed, and "this was
 * already done" is a different fact from "this has now been done" even though both are success.
 */
export interface Jao3CheckpointAppendResult {
  readonly checkpoint: Jao3Checkpoint;
  /** The revision this write committed at. Immutable, and unchanged by any later write. */
  readonly committedRevision: number;
  /** Call metadata: whether this call found the operation already committed. */
  readonly replayed: boolean;
}

export interface Jao3CorrectionAppendResult {
  readonly correction: Jao3OwnerCorrection;
  readonly committedRevision: number;
  readonly replayed: boolean;
}

/**
 * The durable operational memory port.
 *
 * Every mutating operation carries `expectedRevision`, and every one of them either advances the
 * revision by exactly one or fails closed. There is no operation that writes without arbitration.
 */
export interface Jao3InvestigationStore {
  /** Refuses `INVESTIGATION_ALREADY_EXISTS` rather than overwriting. */
  createInvestigation(
    input: Jao3CreateInvestigationInput,
    nowMs: number,
  ): Promise<Jao3Investigation>;

  /** The header alone. Refuses `INVESTIGATION_NOT_FOUND`; never reports absence for uncertainty. */
  readInvestigation(investigationId: string): Promise<Jao3Investigation>;

  /** The header with its checkpoint and correction history, oldest first. */
  readInvestigationView(investigationId: string): Promise<Jao3InvestigationView>;

  appendCheckpoint(
    input: Jao3AppendCheckpointInput,
    nowMs: number,
  ): Promise<Jao3CheckpointAppendResult>;

  appendOwnerCorrection(
    input: Jao3AppendOwnerCorrectionInput,
    nowMs: number,
  ): Promise<Jao3CorrectionAppendResult>;

  /** The ONLY way `currentRunId` changes, and it is always an explicit call. */
  resumeInvestigation(
    input: Jao3ResumeInvestigationInput,
    nowMs: number,
  ): Promise<Jao3Investigation>;

  pauseInvestigation(input: Jao3TransitionInput, nowMs: number): Promise<Jao3Investigation>;

  completeInvestigation(input: Jao3TransitionInput, nowMs: number): Promise<Jao3Investigation>;

  supersedeInvestigation(
    input: Jao3SupersedeInvestigationInput,
    nowMs: number,
  ): Promise<Jao3Investigation>;
}
