# Report 01 — Current Baseline and Governance Constraints

**Task:** MVP and Post-MVP Delivery Overlay and Controlled Launch Sequencing. **Documentation and governance only.**
**Date:** 2026-07-22.

## Standing confirmations

- **Exactly two product-delivery phases** (PHASE 1 — MVP LAUNCH; PHASE 2 — POST-MVP EXPANSION).
- **No QFJ phase renumbering** and no new major phase.
- **No implementation occurred; no migration or SQL was created.** No external system accessed; no API key used.

## Verified baseline

| Fact                           | Value                                      |
| ------------------------------ | ------------------------------------------ |
| Local `main`                   | `2ca5bb0dc488a3b309024585a8f0788e11a8e984` |
| `origin/main`                  | `2ca5bb0dc488a3b309024585a8f0788e11a8e984` |
| Synchronization                | `0 0`, clean working tree                  |
| PR #26 (QFJ-P03.07A)           | MERGED                                     |
| PR #27 (provider independence) | MERGED                                     |

**Present on main:** ADR-0039, ADR-0040, ADR-0041; Canonical Roadmap v3.0; Agent Constitution; authority-routing-data-access matrix; migration ledger; model-provider-independence architecture; projection-failure-operations design. **Migration 0006 is absent.** Highest ADR = 0041 → next available = **ADR-0042** (verified from repository, not assumed). No open PRs; no overlapping MVP/overlay branch.

## Governance constraints inherited (must be preserved)

- **Canonical spine QFJ-P00…P12** is authoritative; the overlay maps to it and renumbers nothing (ADR-0039 change-control rule).
- **QuickFurno Core is the final business authority;** Jarvis/Riya/Anisha hold no unrestricted financial, commercial, administrative, or destructive authority (authority-routing matrix).
- **Event-backbone invariants** (immutable log; storage-sequence vs position; atomic handler+checkpoint; never skip; name+version advisory lock; fail-closed reconciliation) are unchanged (ADR-0021/0022/0034/0036/0037/0040).
- **Migration-allocation rule** (ADR-0039): prose cannot allocate a migration number; 0006 is owned by QFJ-P03.07C under separate authorization.
- **Provider independence** (ADR-0041): model providers infer only; communication providers deliver only; neither has business authority.

## Documents changed / added by this overlay

- **Added:** ADR-0042; `docs/architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md`; `docs/governance/mvp-capability-activation-matrix.md`; `docs/operations/mvp-launch-readiness-runbook.md`; five reports in this directory.
- **Changed:** `docs/architecture/qf-jarvis-roadmap-v3.md` (concise delivery-overlay banner only — no full rewrite).

## Repository conventions confirmed

ADRs under `docs/decisions/ADR-NNNN-*.md`; architecture under `docs/architecture/`; governance under `docs/governance/`; operations runbooks under `docs/operations/`; reports under `docs/reports/<slug>/`. The overlay follows these conventions.
