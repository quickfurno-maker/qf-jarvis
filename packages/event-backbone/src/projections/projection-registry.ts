/**
 * The INTERNAL, immutable projection registry (Stage 3.4.2, ADR-0035).
 *
 * The registry is the closed set of projections this deployment knows about. It is built ONCE, from a
 * fixed list, at construction time. There is no `register()`, no `unregister()`, no plugin loader,
 * and no runtime mutation — a projection set that can change while a runner is mid-cycle is a
 * projection set that cannot be reasoned about for ordering, isolation, or rebuild determinism
 * (ADR-0022). Adding a projection is a code change and a migration, not a runtime call.
 *
 * **The caller is hostile until proven otherwise.** The input list is snapshotted through
 * repository-controlled logic that never invokes a caller-supplied method, every definition is copied
 * and frozen, and any failure originating in caller code becomes a typed, fixed-message error.
 *
 * What it is NOT, in this slice: it does not run, lock, read events, write checkpoints, retry, or
 * contain the two real read-model handlers. Those are Stage 3.4.3–3.4.5 (ADR-0035 §8).
 *
 * Not exported from the package root (ADR-0035 §7).
 */
import {
  defineProjection,
  ProjectionDefinitionError,
  type ProjectionDefinition,
  type ProjectionEvent,
  type ProjectionHandler,
} from './projection-definition.js';
import { isProjectionName, type ProjectionName } from './projection-name.js';

export type { ProjectionDefinition, ProjectionEvent, ProjectionHandler };

/**
 * The closed set of registry construction failure codes, each mapped to its FIXED message.
 *
 * As in the definition layer, the message is chosen by this table and nowhere else: there is no
 * constructor path accepting an arbitrary string, so ADR-0035 §9's "fixed by construction" claim is a
 * property of the type rather than a convention.
 */
const PROJECTION_REGISTRY_ERROR_MESSAGES = {
  'projection-registry-empty': 'A projection registry must contain at least one projection.',
  'projection-registry-invalid':
    'A projection registry must be built from an array of projection definitions.',
  'projection-registry-duplicate-name':
    'A projection name is registered more than once; one name means one active definition.',
  'projection-registry-too-large': 'A projection registry may contain at most 1024 projections.',
  'projection-registry-unreadable':
    'A projection registry input could not be read; its elements are not plainly accessible.',
} as const;

/**
 * The inclusive upper bound on the number of projections a single registry may hold.
 *
 * A caller-controlled array (a sparse array, or a proxy whose `length` trap returns
 * `Number.MAX_SAFE_INTEGER`) could otherwise drive the copy loop for effectively unbounded
 * iterations — a construction-time denial-of-service. This bound is checked against the reported
 * length BEFORE any element is read. Phase 3 defines exactly two proof projections, so `1024` is
 * deliberately generous: it never constrains legitimate use, only a hostile or misconfigured input.
 *
 * Internal-only: exported from THIS module for tests, never from the package root (ADR-0035 §7).
 */
export const MAX_PROJECTION_REGISTRY_SIZE = 1_024;

/** The closed set of registry failure codes. */
export const PROJECTION_REGISTRY_ERROR_CODES = Object.freeze(
  Object.keys(PROJECTION_REGISTRY_ERROR_MESSAGES) as ProjectionRegistryErrorCode[],
);

/** One registry failure code. */
export type ProjectionRegistryErrorCode = keyof typeof PROJECTION_REGISTRY_ERROR_MESSAGES;

/**
 * The fallback code applied when a supplied code is not one of the closed, known codes. A generically
 * invalid registry is the safe classification.
 */
const REGISTRY_FALLBACK_CODE: ProjectionRegistryErrorCode = 'projection-registry-invalid';

/**
 * Normalise an arbitrary runtime value into a known code, or the safe fallback.
 *
 * As with the definition layer, the static type is not a runtime guarantee: a caller can `as`-cast an
 * unbounded secret into the code position. `hasOwnProperty` against the closed message table (never
 * `in`) is the runtime gate, so an unrecognised value can never survive in `.code`.
 */
function normalizeRegistryCode(code: unknown): ProjectionRegistryErrorCode {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(PROJECTION_REGISTRY_ERROR_MESSAGES, code)
    ? (code as ProjectionRegistryErrorCode)
    : REGISTRY_FALLBACK_CODE;
}

/**
 * Registry construction failed.
 *
 * The constructor accepts **only a code**, **normalised at runtime** against the closed table: an
 * unrecognised value collapses to the safe fallback, so neither `message` NOR `code` can carry caller
 * text. No error embeds the offending definition, the duplicate name, a handler's source text, a
 * stringified object, or any unbounded caller input, and a caller's thrown error is discarded rather
 * than retained as `cause`. Even the duplicated projection name is withheld: a projection name is
 * repository-owned, but this type stays safe by construction rather than by the caller happening to
 * pass trusted data. Callers branch on {@link code}.
 */
export class ProjectionRegistryError extends Error {
  public readonly code: ProjectionRegistryErrorCode;

  public constructor(code: ProjectionRegistryErrorCode) {
    const safeCode = normalizeRegistryCode(code);
    super(PROJECTION_REGISTRY_ERROR_MESSAGES[safeCode]);
    this.name = 'ProjectionRegistryError';
    this.code = safeCode;
  }
}

/**
 * An immutable registry of projection definitions.
 *
 * Exposes no array, no `Map`, and no internal state — only a lookup, a frozen listing, and a count.
 * Handing out the backing collection would let any caller add, remove, or reorder projections after
 * construction, which is exactly the mutability this type exists to prevent.
 *
 * `get`, `has` and `list` are declared as function-typed PROPERTIES, not methods, because that is
 * what they are: closures over the backing map that never read `this`. Destructuring them
 * (`const { has } = registry`) therefore yields functions that keep working rather than throwing on
 * an undefined receiver, and the declaration says so at the type level instead of relying on a
 * convention a caller has to know.
 */
export interface ProjectionRegistry {
  /**
   * The definition registered under `name`, or `undefined` if there is none.
   * Any unregistered value — including a malformed or non-string one — yields `undefined` rather
   * than throwing: a lookup miss is a normal answer, not an exceptional one.
   */
  readonly get: (name: unknown) => ProjectionDefinition | undefined;
  /** True iff a definition is registered under `name`. */
  readonly has: (name: unknown) => boolean;
  /** Every definition, frozen, in ascending projection-name order. Deterministic across runs. */
  readonly list: () => readonly ProjectionDefinition[];
  /** How many projections are registered. Always at least one. */
  readonly size: number;
}

/**
 * Read the caller-controlled `length` and return it as a validated safe-integer count.
 *
 * The single caller-controlled read (`source.length`, which a proxy trap may intercept) is the ONLY
 * thing inside the `try`: any throw becomes a fresh `unreadable` error, so a forged error object
 * cannot escape. Structural rejection of a non-numeric / non-safe / negative length is raised OUTSIDE
 * that `try`, so it is a repository classification a caller cannot intercept or overwrite.
 */
function readReportedLength(source: ArrayLike<unknown>): number {
  let length: unknown;
  try {
    length = source.length;
  } catch {
    throw new ProjectionRegistryError('projection-registry-unreadable');
  }
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new ProjectionRegistryError('projection-registry-unreadable');
  }
  return length;
}

/**
 * Copy `length` elements out of the caller's array-like into a fresh repository-owned array.
 *
 * Every read here is caller-controlled (an element getter or proxy trap may throw), so the whole loop
 * is guarded and the `catch` is UNCONDITIONAL: it never re-inspects or rethrows the caught value.
 * A caller that deliberately throws a `ProjectionRegistryError`, a subclass, or an error carrying a
 * secret `message`/`code`/`cause`/enumerable property is discarded wholesale and replaced with a
 * fresh, fixed-message `unreadable` error. Nothing caller-thrown survives.
 */
function copyElements(source: ArrayLike<unknown>, length: number): readonly unknown[] {
  const copied: unknown[] = [];
  try {
    for (let index = 0; index < length; index += 1) {
      copied.push(source[index]);
    }
  } catch {
    throw new ProjectionRegistryError('projection-registry-unreadable');
  }
  return copied;
}

/**
 * Copy the caller's array into a repository-owned array **without invoking any caller method**.
 *
 * Notably it does not call `input.slice()`: `slice` is an ordinary, overridable own property, and a
 * caller could replace it with something that returns a different list than the one just validated —
 * or that throws. Indexed reads through a plain loop keep the traversal under repository control.
 *
 * The structure is deliberate: caller-controlled reads (`length`, each element) live in helpers whose
 * `catch` UNCONDITIONALLY yields a fresh `unreadable` error, while every deliberate classification
 * (non-array, too-large) is raised in THIS function OUTSIDE any caller-controlled `catch`. The
 * oversized-length check runs **before any element is read**, so a hostile `length` cannot drive the
 * loop even once.
 */
function snapshotDefinitionList(input: unknown): readonly unknown[] {
  // Array.isArray itself throws on a revoked proxy, so even the classification is guarded.
  let inputIsArray: boolean;
  try {
    inputIsArray = Array.isArray(input);
  } catch {
    throw new ProjectionRegistryError('projection-registry-unreadable');
  }

  if (!inputIsArray) {
    throw new ProjectionRegistryError('projection-registry-invalid');
  }

  const source = input as ArrayLike<unknown>;
  const length = readReportedLength(source);

  // Deliberate bound, raised OUTSIDE any caller-controlled catch and BEFORE any element read.
  if (length > MAX_PROJECTION_REGISTRY_SIZE) {
    throw new ProjectionRegistryError('projection-registry-too-large');
  }

  return copyElements(source, length);
}

/**
 * Build the immutable registry from a fixed list of definitions.
 *
 * Every input is validated and copied through {@link defineProjection}, so the caller's objects are
 * never retained and mutating them afterwards cannot change the registry. The input array is
 * snapshotted first, through repository-controlled logic, for the same reason.
 *
 * Fails closed on: an empty list, a non-array, an unreadable input, a malformed definition, and any
 * duplicate projection name — INCLUDING two definitions that share a name but differ in version.
 *
 * **Why duplicates are refused across versions.** Not because of storage contention: migration 0004
 * keys `projection_checkpoint` by `(projection_name, projection_version)`, and ADR-0034 §4 derives the
 * advisory-lock key from the projection name **and version**, so two versions would in fact occupy
 * distinct rows and distinct locks. It is refused as a deliberate **registry policy** for this slice:
 * one active definition per logical projection name, so a version bump *replaces* the active
 * definition rather than silently running two projections under one name. Deliberately operating
 * versions side by side is outside Stage 3.4.2 and would need its own ADR plus a distinct logical
 * naming and deployment policy (ADR-0035 §4).
 */
export function createProjectionRegistry(definitions: unknown): ProjectionRegistry {
  const offered = snapshotDefinitionList(definitions);

  if (offered.length === 0) {
    throw new ProjectionRegistryError('projection-registry-empty');
  }

  const byName = new Map<ProjectionName, ProjectionDefinition>();

  for (const candidate of offered) {
    // Throws ProjectionDefinitionError (safe, fixed message) for anything malformed or unreadable.
    const definition = defineProjection(candidate);

    if (byName.has(definition.name)) {
      throw new ProjectionRegistryError('projection-registry-duplicate-name');
    }

    byName.set(definition.name, definition);
  }

  // Deterministic ordering by name. Projection names are bounded lowercase kebab-case ASCII, so a
  // plain code-unit comparison is stable and locale-independent — unlike localeCompare, which varies
  // with the runtime's locale data and would make enumeration order environment-dependent.
  const ordered: readonly ProjectionDefinition[] = Object.freeze(
    [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : 1)),
  );

  // Closure-bound, not method-bound: these read `byName`/`ordered` directly and never touch `this`,
  // so a detached `const { has } = registry` keeps working instead of throwing on undefined `this`.
  const get = (name: unknown): ProjectionDefinition | undefined =>
    isProjectionName(name) ? byName.get(name) : undefined;

  const has = (name: unknown): boolean => get(name) !== undefined;

  // The same frozen array every call — safe to share precisely because it cannot be mutated.
  const list = (): readonly ProjectionDefinition[] => ordered;

  return Object.freeze({ get, has, list, size: ordered.length });
}

export { ProjectionDefinitionError };
