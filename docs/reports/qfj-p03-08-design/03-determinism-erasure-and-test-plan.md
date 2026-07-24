# Report 03 — Determinism, Erasure and Test Plan

**Date:** 2026-07-24. **Slice:** QFJ-P03.08. **ADR:** [ADR-0043](../../decisions/ADR-0043-qfj-p03-08-rebuild-determinism-and-erasure.md).

## Canonical SHA-256 equivalence contract

`live result == rebuilt result` ⇔ **identical SHA-256 digests** of a canonical serialization of all authoritative read-model rows. Canonicalization requires:

- `SELECT` all rows; **order by the complete primary key ascending**;
- include **every** authoritative read-model column; exclude **no** current column;
- stable object/key ordering; **BIGINT** → canonical base-10 string; **TIMESTAMPTZ** → canonical UTC ISO-8601; **DATE** → `YYYY-MM-DD`; explicit null encoding if ever applicable;
- **no** environment, random, process, clock, locale, or physical-page values;
- concatenate rows deterministically; SHA-256.

The contract is **semantic/canonical row equality**, not physical page/binary-storage equality. Core acceptance evidence must be a **real PostgreSQL integration test**, not only a fake/in-memory test.

The two existing read models are already determinism-friendly: timestamps come from `event.accepted_at` (never a wall clock), positions come from the position map, and there are no handler-generated random ids or clock reads. The append-only `projection_attempt.recorded_at` (a `clock_timestamp()` default) is **not** part of any read-model digest.

## Erasure proof split (QFJ-P03.08 vs QFJ-P03.09)

- The existing metadata read models hold no subject and thus have "nothing to erase" (migration 0004). A meaningful **subject-keyed** erasure proof needs the handler to receive an opaque subject reference, which `projection-definition.ts` deliberately forbids (ADR-0026).
- **QFJ-P03.08 (this slice)** proves erasure-survives-rebuild **structurally**: a synthetic, domain-neutral tombstone/erasure event type whose synthetic handler clears its synthetic derived state, asserting the same final erased digest after a full rebuild. No real/realistic personal data, no real subject id, no payload access, no external rehydration source; diagnostics use closed safe codes and reveal no erased state.
- **QFJ-P03.09** owns `rm_subject_activity`, the opaque subject-reference contract expansion, subject-keyed erasure-state representation, and the subject-specific acceptance proof — each under its own decision.
- QFJ-P03.08 does **not** define production legal retention or a deletion SLA (ADR-0019 §7 → Phase 11).

## Purity-lint requirement

Verified gap: ADR-0022 §4 claims projection reducer purity is mechanically linted, but `eslint.config.mjs` scopes purity rules only to `packages/contracts` and `packages/event-ingestion` — not the projections directory — and the byte-equal rebuild test does not yet exist. The QFJ-P03.08 **implementation** must add a projections-scoped purity lint (or equivalent mechanically-enforced rule) and prove it works (negative fixture / red test where practical). **This documentation task changes no config.**

## Test matrix (bounded; U = unit, I = real-PostgreSQL integration)

| # | Test | Kind | Invariant proved |
| --- | --- | --- | --- |
| 1 | Live vs rebuild digest equality (both metadata models) | I | `A == B` (ADR-0022 §7) |
| 2 | Erasure survives rebuild (synthetic tombstone projection) | I | erasure event replayed → identical post-erasure digest |
| 3 | Version bump → destroy + rebuild from position 1 | I | fresh checkpoint namespace; identical rebuilt digest |
| 4 | Late event before horizon applied deterministically | I | out-of-business-order arrival → same digest live/rebuild |
| 5 | Event after horizon excluded | I | positions `> horizon` ignored; digest stable |
| 6 | Crash/abort mid-rebuild leaves live untouched | I | aborted tx → live checkpoint/read-models unchanged |
| 7 | Rebuild isolation from live checkpoint | I | live `(name,version)` row unmodified |
| 8 | Rebuild isolation from failure rows | I | no `projection_failure` / `projection_attempt` rows created |
| 9 | Deterministic ordering (ORDER BY full PK) | U | canonicalization order stable across runs |
| 10 | No `event.sequence` ordering | U/I | reader/driver use `position` only |
| 11 | No package-root expansion | U | `public-api.test.ts` still 39 |
| 12 | Migration conformance / no 0007 | U | 0001–0006 hashes; 0007 absent |
| 13 | Security / redaction of rebuild diagnostics | U | closed safe codes only; no payload/subject in output |
| 14 | Real PostgreSQL integration (the digest property) | I | fails-not-skips without `DATABASE_URL` |
| 15 | Repeated rebuild idempotence | I | rebuild twice → identical digest each time |
| 16 | Concurrent live ingestion policy (prohibited) | U | driver documents/asserts quiescent-input contract |
| 17 | Hostile handler error values | U | throwing reducer aborts rebuild with a closed code, no leak |
| 18 | Commit-outcome-unknown (N/A) | — | documented not-applicable for the bounded proof |

Tests 1, 2, and 14 are the core acceptance evidence and **must** be real-PostgreSQL integration tests that **fail rather than skip** without the integration environment (the QFJ-P03.07G health-integration precedent).
