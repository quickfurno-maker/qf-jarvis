import type { ControlPlaneSections } from '@qf-jarvis/control-plane-read-contract';

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
 * No React, no Next, no client. The type names nothing that could act: there is no `send`,
 * `execute`, `approve`, `write`, `update`, `delete` or `mutate`, and no authority flag such as
 * `canExecute` or `isAuthorized`. A source produces observations; authority stays with QuickFurno
 * Core, which is a property of what this interface CANNOT express.
 *
 * ### Runtime results are DATA. Every word an operator reads comes from the descriptor.
 *
 * This is the correction that matters most. An adapter that did
 * `catch (error) { return { status: 'UNAVAILABLE', reason: error.message } }` used to have its
 * exception text trimmed for length and rendered in a browser — so a connection string, an internal
 * hostname or a token could reach the page through the ordinary, non-throwing path.
 *
 * So a result carries no prose at all. Failure is a CLOSED reason code that composition maps to
 * fixed reviewed text, and success carries only rows. Provenance and explanation live in
 * `ReadSourceDescriptor`, which is reviewed source code and cannot be influenced at run time.
 */

/** The sections a source may speak for. Derived from the contract so it cannot drift. */
export type ControlPlaneSectionName = keyof ControlPlaneSections;

/**
 * The two section families, derived from the contract rather than listed by hand.
 *
 * The contract has genuinely different shapes: item sections carry `items`, and the two series
 * sections carry `points` plus a required `id` and `label`. Treating them alike is what made an
 * adapter owning `conversationActivity` or `modelLatency` impossible to satisfy — the composed
 * section failed the strict parser and the route degraded to a generic 503.
 */
export type SeriesSectionName = {
  [K in ControlPlaneSectionName]: ControlPlaneSections[K] extends { points: unknown } ? K : never;
}[ControlPlaneSectionName];

export type ItemSectionName = Exclude<ControlPlaneSectionName, SeriesSectionName>;

/**
 * What a source may contribute for one section, typed per section.
 *
 * A series section receives `points`, an item section receives `items`, and the element types come
 * from the contract — so a mistyped row is a compile error rather than something a final cast
 * launders into a runtime parse failure.
 */
export type SectionContributionFor<K extends ControlPlaneSectionName> = K extends SeriesSectionName
  ? { readonly points: ControlPlaneSections[K]['points'] }
  : K extends ItemSectionName
    ? { readonly items: ControlPlaneSections[K]['items'] }
    : never;

export type SectionContributions = {
  readonly [K in ControlPlaneSectionName]?: SectionContributionFor<K>;
};

/**
 * Why a source could not be read — a CLOSED set, never free text.
 *
 * Each maps to fixed reviewed prose in the composer. An adapter cannot add a code, so it cannot
 * author what an operator sees.
 */
export const UNAVAILABLE_REASONS = [
  'SOURCE_UNREACHABLE',
  'SOURCE_TIMED_OUT',
  'SOURCE_REJECTED_REQUEST',
  'SOURCE_RETURNED_UNUSABLE_DATA',
  /** Set by composition, not by a source: the observation fell outside the request window. */
  'SOURCE_OBSERVATION_OUT_OF_WINDOW',
] as const;

export type UnavailableReasonCode = (typeof UNAVAILABLE_REASONS)[number];

/** A source that successfully observed its sections. */
export interface ObservedResult {
  readonly status: 'OBSERVED';
  /**
   * When the underlying facts were read, as a canonical UTC instant.
   *
   * NOT the snapshot's `generatedAt`. Serving a request stamps a new envelope; it re-reads nothing.
   * This value is VALIDATED at composition — both its shape and its position in the request window —
   * because a field that is required but never checked is decoration, and this one is the entire
   * evidence for a `REQUEST_TIME` claim.
   */
  readonly observedAt: string;
  readonly sections: SectionContributions;
}

/**
 * A source that could not be read.
 *
 * A first-class, expected outcome rather than an error path bolted on. The alternative — returning
 * an empty success — is precisely the lie the contract exists to prevent: an operator reading
 * "0 approvals waiting" when the truth is "nobody asked".
 */
export interface UnavailableResult {
  readonly status: 'UNAVAILABLE';
  readonly reason: UnavailableReasonCode;
}

export type ReadSourceResult = ObservedResult | UnavailableResult;

/**
 * The bounds every adopted source's acquisition timeout must satisfy.
 *
 * A timeout is REQUIRED rather than defaulted, and range-checked rather than trusted. The loader
 * claims acquisition is bounded and cannot take a page down; leaving the bound implicit inside each
 * future adapter would make that claim depend on code nobody has written yet.
 *
 * The floor keeps a value from being effectively zero — a source that can never finish is not a
 * bounded source, it is a disabled one. The ceiling is what an operator will wait for a dashboard:
 * beyond it, showing the section as unreadable is more useful than continuing to block the render.
 */
export const MIN_SOURCE_TIMEOUT_MS = 100;
export const MAX_SOURCE_TIMEOUT_MS = 10_000;

/**
 * A reviewed, adopted source.
 *
 * `acquire()` MAY be async: that is the whole point of the request-scoped boundary. The impure work
 * happens there, is awaited, and the pure composer only ever sees already-collected results — so
 * snapshot construction stays deterministic and the page and the API cannot diverge by taking
 * different code paths.
 */
export interface ReadSourceDescriptor {
  /** Stable identity, used to detect two sources claiming one section. */
  readonly id: string;
  /** Operator-facing provenance. Reviewed prose; a runtime result cannot change it. */
  readonly label: string;
  /** Operator-facing explanation shown on the sections this source populates. */
  readonly observedReason: string;
  /**
   * The sections this source is adopted to speak for.
   *
   * Declared as data so that "what can this adapter change?" is answerable by reading one line,
   * without tracing what its `acquire()` happens to return today.
   */
  readonly owns: readonly ControlPlaneSectionName[];
  /**
   * How long the loader will wait for this source, in milliseconds.
   *
   * Reviewed per source, because a local read and a remote call do not deserve the same patience.
   * Validated against the bounds above as a descriptor-level fact, so a nonsensical value is a
   * governance error caught before any acquisition rather than a surprise under load.
   */
  readonly timeoutMs: number;
  /**
   * Read this source. The signal aborts when the loader's bound elapses.
   *
   * An adapter that ignores the signal cannot hold the page: the loader stops waiting either way
   * and records `SOURCE_TIMED_OUT`. Honouring it simply stops wasted work on the far side.
   */
  acquire: (signal: AbortSignal) => ReadSourceResult | Promise<ReadSourceResult>;
}

/** One acquired result, paired with the descriptor that produced it. The pure composer's input. */
export interface CollectedObservation {
  readonly descriptor: ReadSourceDescriptor;
  readonly result: ReadSourceResult;
}

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
 * So this release adopts none, and the control plane keeps saying exactly what it said before. A
 * source becomes adoptable when its canonical QFJ owner exposes a governed read protocol; adopting
 * it then means adding a reviewed descriptor here, and the request boundary already awaits it.
 */
export const ADOPTED_READ_SOURCES: readonly ReadSourceDescriptor[] = Object.freeze([]);
