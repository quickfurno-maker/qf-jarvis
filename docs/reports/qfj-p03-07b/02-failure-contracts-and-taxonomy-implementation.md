# Report 02 — Failure Contracts and Taxonomy Implementation

**Date:** 2026-07-22. Implementation of the closed taxonomy in `projections/projection-failure-taxonomy.ts` (internal; not root-exported).

## The five closed categories

```
DETERMINISTIC_HANDLER_FAILURE
TRANSIENT_INFRASTRUCTURE_FAILURE
REPOSITORY_INVARIANT_FAILURE
CANCELLATION_OR_SHUTDOWN
UNKNOWN_UNCLASSIFIED_FAILURE
```

`PROJECTION_FAILURE_CATEGORIES` is a frozen `as const` tuple; `isProjectionFailureCategory` is the closed type guard. Arbitrary category strings cannot be produced — the classifier only ever returns one of the five via a small internal factory.

## Normalized classification result (immutable)

`classifyProjectionFailure(error): ProjectionFailureClassification` returns a **frozen** object carrying only:

- `category` — one closed category;
- `code` — the closed repository-owned diagnostic code;
- `disposition` — `'retry'` (deterministic only) or `'fail-closed'` (all others);
- `sqlstate` — a recognised 5-char `[0-9A-Z]` code when safely present, else `null`.

It carries **no** raw thrown value, message, stack, SQL, secret, or payload. It never throws and never invokes a caller getter/`valueOf`/`toString`.

## Closed diagnostic codes (per category)

| Category                         | Diagnostic code                          |
| -------------------------------- | ---------------------------------------- |
| DETERMINISTIC_HANDLER_FAILURE    | `projection-handler-failed`              |
| TRANSIENT_INFRASTRUCTURE_FAILURE | `projection-infrastructure-failed`       |
| REPOSITORY_INVARIANT_FAILURE     | `projection-repository-invariant-failed` |
| CANCELLATION_OR_SHUTDOWN         | `projection-cancelled`                   |
| UNKNOWN_UNCLASSIFIED_FAILURE     | `projection-unknown-failure` ← **new**   |

`projection-unknown-failure` is also added to the closed **runner** error vocabulary (`projection-runner-errors.ts`) so the runner surfaces the unknown category distinctly from infrastructure. Existing externally-visible codes are unchanged; the stored `safe_error_code` set (`projection-safe-error.ts`) is unchanged (only a deterministic failure ever records `projection-handler-failed`).

## Explicit deterministic-handler-failure contract

`ProjectionDeterministicHandlerFailure` (+ factory `deterministicHandlerFailure(detail?)`) is the approved, repository-owned way a handler DECLARES a deterministic refusal. Properties:

- a **closed** stable `code` (`projection-handler-failed`), fixed on the instance;
- an **optional bounded, sanitized** `detail` (printable-ASCII only, capped at 200 chars) — an in-memory convenience field, **never stored durably and never propagated into the classification result**;
- recognised by a **hostile-safe brand** read (an own-data-property Symbol brand, read via the guarded descriptor path — never `instanceof` alone, never a getter);
- a plain `Error` without a recognised code is **not** deterministic.

Companion contracts (same hostile-safe brand pattern): `ProjectionRepositoryInvariantFailure` / `repositoryInvariantFailure()` and `ProjectionCancellation` / `projectionCancellation()`. `ProjectionSafeErrorCodeError` and a standard `AbortError` (own data `name === 'AbortError'`) are also recognised as repository-invariant and cancellation respectively.

## SQLSTATE tables (exact, unchanged sets — ADR-0040)

**Deterministic** (`isDeterministicHandlerSqlstate`): `23505`, `23514`, `23503`, `23502`, class `22` (prefix `22`), `42501`, `42P01`, `42703`, `42883`.
**Transient infrastructure** (`isRecognizedInfrastructureSqlstate`): `40P01`, `40001`, class `08` (prefix `08`), `57P0*` (prefix `57P0`), class `53` (prefix `53`).

Neither set was expanded or shrunk. A valid-but-unrecognised SQLSTATE maps to `TRANSIENT_INFRASTRUCTURE_FAILURE` (conservative), never deterministic.

## Hostile-safe normalization

`inspectSqlstate` (moved here from the runner) and `readOwnDataProperty` guard `Object.getOwnPropertyDescriptor`, ignore accessors, and swallow revoked-Proxy / hostile-trap throws. The classifier never throws and leaks no secret for: null/undefined/string/number/symbol/array/function throws; hostile getters for `code`/`message`; revoked Proxies; hostile descriptor traps; and cyclic objects. Proven by the unit matrix (report 04).
