import type {
  CanonicalInstant,
  ControlPlaneSections,
} from '@qf-jarvis/control-plane-read-contract';

/**
 * The progressive read-source boundary (JOS-01E, ADR-0089).
 *
 * ### What this is for
 *
 * JOS-01B made the control plane truthful by compiling every figure in from merged repository and
 * governance state. That is honest but terminal: there was no way for a real observation to reach
 * the snapshot without rewriting the builder, and "rewrite the builder" is how a single unreviewed
 * adapter ends up able to change anything on the page.
 *
 * This is the governed alternative. A source declares, up front and in data, exactly which sections
 * it may speak for. Composition then applies its contribution to those sections and to nothing
 * else — so adopting a source is a bounded, reviewable decision rather than an open door.
 *
 * ### Server-only, framework-neutral, read-only
 *
 * No React, no Next, no `fetch`, no client. The type names nothing that could act: there is no
 * `send`, `execute`, `approve`, `write`, `update`, `delete` or `mutate`, and no authority flag such
 * as `canExecute` or `isAuthorized`. A source produces observations; authority stays with
 * QuickFurno Core, which is a property of what this interface CANNOT express.
 *
 * ### `read()` is synchronous, and that is the point
 *
 * An adapter that fetched inside the builder would make snapshot construction impure, undeterministic
 * and dependent on network timing — and the builder's whole value is that the page and the API
 * provably produce the same bytes from the same inputs.
 *
 * So the impure half happens at the boundary, exactly as `generatedAt` already does: whoever serves
 * the request performs any I/O, constructs the source around the result, and hands it in. `read()`
 * then only reports what that source already holds. A future HTTP-backed adapter is constructed
 * after its `await`, not during composition.
 */

/** The sections a source may speak for. Derived from the contract so it cannot drift. */
export type ControlPlaneSectionName = keyof ControlPlaneSections;

/**
 * Sections no Jarvis-side adapter may ever own.
 *
 * `coreSync` states which records QuickFurno Core owns. Letting a Jarvis adapter rewrite it would
 * let Jarvis re-describe the authority boundary it is subject to — the one claim this application
 * must never be able to make about itself.
 */
export const SECTIONS_CLOSED_TO_ADAPTERS: readonly ControlPlaneSectionName[] = Object.freeze([
  'coreSync',
]);

/**
 * One section's worth of observed rows.
 *
 * There is no `availability` field: a contribution exists only when the source genuinely read
 * something, and composition sets `AVAILABLE`. A source cannot hand back `AVAILABLE` with no rows
 * and cannot mark a section `NOT_CONNECTED` while claiming to have observed it — both of those are
 * unrepresentable rather than merely discouraged.
 */
export interface SectionContribution {
  /** Prose an operator reads. Must describe what WAS read, not what might be. */
  readonly reason: string;
  /** Names the system actually read. */
  readonly expectedSource: string;
  /** The observed rows. Empty is a legitimate observation here — the source did look. */
  readonly items: readonly unknown[];
}

/** A source that successfully observed its sections. */
export interface ObservedResult {
  readonly status: 'OBSERVED';
  /**
   * When the underlying facts were read.
   *
   * NOT the snapshot's `generatedAt`. Serving a request stamps a new envelope; it re-reads nothing.
   * A source that cannot say when it observed something is not observing it.
   */
  readonly observedAt: CanonicalInstant;
  readonly sections: Readonly<Partial<Record<ControlPlaneSectionName, SectionContribution>>>;
}

/**
 * A source that could not be read.
 *
 * This is a first-class, expected outcome, not an error path bolted on. The alternative — returning
 * an empty success — is precisely the lie the whole contract exists to prevent: an operator reading
 * "0 approvals waiting" when the truth is "nobody asked".
 */
export interface UnavailableResult {
  readonly status: 'UNAVAILABLE';
  /** Operator-facing prose. Never an exception message, path, host, query or stack. */
  readonly reason: string;
}

export type ReadSourceResult = ObservedResult | UnavailableResult;

export interface ControlPlaneReadSource {
  /** Stable identity, used in provenance and to detect two sources claiming one section. */
  readonly id: string;
  /** Human label for the operator-facing provenance sentence. */
  readonly label: string;
  /**
   * The sections this source is adopted to speak for.
   *
   * Declared as data so that "what can this adapter change?" is answerable by reading one line,
   * without tracing what its `read()` happens to return today.
   */
  readonly owns: readonly ControlPlaneSectionName[];
  /** Report what this source already holds. Pure: no I/O, no clock, no environment. */
  read: () => ReadSourceResult;
}

/**
 * The sources this build has ADOPTED. Deliberately empty.
 *
 * Nothing in merged `main` can be read from inside Jarvis OS without crossing a boundary this
 * phase is not permitted to cross:
 *
 * - QuickFurno Core has no adopted read protocol. Inventing an endpoint, a token or a Supabase
 *   query would fabricate connectivity, and Core owns business truth regardless.
 * - n8n has no adopted read protocol, and the test-only execution bridge belongs to QFJ-P09.02.
 * - The durable runtimes (`postgres-conversation-state`, `postgres-approval-queue`) are reachable
 *   only with managed-database credentials. Granting Jarvis OS a connection string to make panels
 *   look populated would hand a read-only surface the reach it was designed not to have.
 * - The processing runtimes (`agent-runtime`, `jarvis-runtime`) transform envelopes; they hold no
 *   observable state. `createConversationOperationsSnapshot` is a SHAPE over records supplied to
 *   it, not a source of them.
 *
 * So this release adopts none, and the control plane keeps saying exactly what it said before. The
 * machinery is what JOS-01E delivers: a source becomes adoptable when its canonical QFJ owner
 * exposes a governed read protocol, and adoption is then a one-line registry change plus a review —
 * not another builder rewrite.
 */
export const ADOPTED_READ_SOURCES: readonly ControlPlaneReadSource[] = Object.freeze([]);
