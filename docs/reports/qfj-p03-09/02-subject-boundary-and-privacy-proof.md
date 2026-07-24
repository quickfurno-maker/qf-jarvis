# Report 02 — Subject Boundary and Privacy Proof

**Date:** 2026-07-24. **Slice:** QFJ-P03.09. **ADR:** [ADR-0044](../../decisions/ADR-0044-qfj-p03-09-subject-activity-projection.md).

## The subject is an opaque, non-personal reference

The projection keys on the existing Phase-2 EntityReference `(subject_type, subject_id)` exactly as migration 0001 stores and constrains it: `subject_type` a machine token (≤64), `subject_id` an opaque id (≤128, charset `[A-Za-z0-9._:-]`). The charset guardrail forbids free text (no spaces), and Core resolves the actual contact from its own records — reference-never-reproduce (ADR-0022 §8). No payload or personal data is read.

## No global widening — narrow reader by module boundary

- `ProjectionEvent` and `ProjectionDefinition` are **unchanged** — verified by test (`projection-subject-boundary.test.ts` asserts the interface still lists only `position/eventType/eventVersion/acceptedAt`, no `subject`/`payload`).
- The subject is resolved only by `projection-subject-reader.ts`, which selects **only** `subject_type, subject_id` and validates both against the 0001 grammar, returning a frozen `{subjectType, subjectId}`. It reads no payload/event-id/correlation/causation/source/signature/digest.
- **Enforcement:** an `eslint.config.mjs` block scoped to `projections/handlers/**` with `ignores: subject-activity.ts` forbids importing the subject reader — so the metadata reducers (`event-type-activity`, `daily-event-acceptance`) stay subject-blind in code, and only `subject-activity` may resolve the subject. Proven by `projection-subject-boundary.test.ts` (the rule fires on the import; the block is wired to the handlers-except-subject-activity scope). The shared reducer-I/O purity ban is factored into a shared const so the boundary block re-states it without drift.

## Honest least privilege at the SQL layer

The single deployment role `qf_jarvis_projection_runtime` holds the new `SELECT(subject_type, subject_id)` grant (migration 0007), so it _can_ query those columns at the SQL layer — per-projection visibility is a **code/module** property, not a second DB role (no separate subject worker/runner/pool/credential in the MVP). The grant is minimal and additive:

- **Granted** (proven by `projection-foundation.integration.test.ts`): `sequence, event_type, event_version, accepted_at, subject_type, subject_id`.
- **Still denied** (proven): `payload`, `correlation_id`, and all `UPDATE/DELETE/INSERT` on the immutable log; audit-table content; migration history; schema CREATE.
- **Proven end-to-end** (`subject-activity.integration.test.ts`): connecting **as** `qf_jarvis_projection_runtime`, `SELECT subject_type, subject_id FROM event` succeeds while `SELECT payload FROM event` raises `permission denied`.

## Diagnostics never carry the subject

The subject reader fails closed with fixed-message typed errors (`ProjectionInputError` / `ProjectionStoredDataError`) and never echoes a raw subject value — proven by unit tests that feed malformed subject values and assert the value is absent from the error message. The handler and digest utility never log row content.
