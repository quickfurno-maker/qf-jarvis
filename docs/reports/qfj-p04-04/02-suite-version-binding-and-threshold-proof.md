# Report 02 — Suite, Version-Binding, and Threshold Proof

**Slice:** QFJ-P04.04 — Evaluation and Red-Team Foundation. **ADR:** [ADR-0052](../../decisions/ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md).

## Exact binding

Every suite/run/evidence object binds exact identities (proven): evaluation suite id/version, red-team suite id/version, fixture manifest id/version, evaluator impl id/version, the full `ProviderReleaseRef` (release/provider/model/version/config digest/execution class), prompt family/version, capability profile reference, knowledge revision, policy contract revision, and a canonical created-at instant. A non-canonical instant, a non-positive version, an oversized/invalid identifier, and a **wildcard/`latest`** identity are all rejected (`invalid-binding`). `bindingsMatch` returns true only for byte-exact identities and false on any single difference (prompt version, capability ref, knowledge revision, release) — this is the per-provider/per-model **parity** guarantee.

## Immutable suite and deterministic order

A scenario and a suite are deep-frozen (proven). A suite orders its scenarios deterministically by `(scenarioId, version)` and rejects a duplicate id/version (`duplicate-scenario`). The content digest is deterministic and order-insensitive for object keys but order-sensitive for arrays (proven), so the same suite + observations always yields the same `caseSetDigest`.

## Closed outcomes, severities, and thresholds — no average

Outcomes are the closed set `PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE`; severities `INFO/LOW/MEDIUM/HIGH/CRITICAL`. Thresholds are explicit, versioned, and immutable (a per-category maximum failure count, default zero). The suite result carries counts by outcome/category, mandatory-case state, threshold breaches, critical-failure and blocking-inconclusive counts, and the case-set digest — and **no average/score field** (proven: `averageScore`/`score` are absent). Evidence is gated on this closed state, never on a mean.

## Gating proven

- A **failed CRITICAL** case blocks evidence (`evidence-blocked-critical`).
- A **missing observation** for a HIGH/CRITICAL scenario is a blocking `INCONCLUSIVE` and blocks evidence.
- A suite **missing a mandatory** red-team kind blocks (`evidence-blocked-mandatory-missing`).
- A **category threshold breach** blocks (`evidence-blocked-threshold`).
- Evaluation is **deterministic** — the same suite + observations produce an identical case-set digest and counts.
