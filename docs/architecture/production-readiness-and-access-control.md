# Production Readiness and Access Control — QF Jarvis

**Status:** Approved architecture (Phases 8.5 and 10.5). **Not implemented.**
**Date:** 2026-07-16
**Decision:** [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)

> **What this document is.** The approved architecture for two inserted foundations: **human identity and access** (Phase 8.5, before Phase 9) and **production readiness** — backup, restore, disaster recovery, and supply-chain verification (Phase 10.5, after Phase 10 and before Phase 11).
>
> **What this document is not.** A description of anything that runs. **No identity system, no RBAC, no MFA, no backup mechanism, and no disaster-recovery capability exist in this repository.** This is design for future phases.

Three registers, kept distinct: **approved architecture** (here), **future implementation** (Phases 8.5 and 10.5, each with its own ADR), **current repository reality** (none of it exists).

---

## Phase 8.5 — Human Identity and Access Foundation

**Inserted before Phase 9**, and the reason is precise: Phase 9 is where **approval capability is first exposed to people**, and **approval authority is the most valuable credential in the system** — it is the one thing an agent can never hold ([trust-boundaries.md](./trust-boundaries.md) B7). Exposing that authority to accounts that cannot be attributed, revoked, or stepped up would be building the most dangerous door first and the lock afterward.

**This phase establishes identity and access controls before approval capabilities are exposed to people.**

### Required capabilities

| Capability | Why it is load-bearing |
| --- | --- |
| Named individual accounts | Every approval is attributable to a person ([security-principles.md](../governance/security-principles.md) §8) |
| No shared approver accounts | A shared account is an unattributable approval waiting to happen |
| MFA | Approval authority is worth stealing; a password alone is not enough |
| Role-based access control | Access follows the role, and roles have limits ([privacy-principles.md](../governance/privacy-principles.md) §4) |
| Delegated limits | An operator's authority is bounded; money escalates ([ADR-0005](../decisions/ADR-0005-human-and-policy-approval.md)) |
| Step-up authentication for sensitive actions | The riskiest actions demand a fresh, stronger proof of identity |
| Session expiry | An idle approver session is a standing authorization waiting to be stolen |
| Session and device revocation | A lost device or a compromised session can be cut off immediately |
| Emergency read-only mode | The system can be frozen to observation without being torn down |
| Access-review process | Access granted is access reviewed; entitlement drift is caught deliberately |
| Full actor attribution | Every action names who took it |
| Separate reviewer and approver permissions where appropriate | Reviewing is not approving; the two can be held by different people |

These are the human-side counterpart to the machine-side controls the architecture already specifies. The audit trail records *that a named person decided*; Phase 8.5 is what makes "a named person" true.

**The boundary is unchanged.** Identity and access controls govern *who among authorized humans may do what*; they add no edge across the permanent boundary and grant no agent any authority.

---

## Phase 10.5 — Production Readiness Foundation

**Inserted after Phase 10 and before Phase 11**, because Phase 11 is the first live Core integration and **it may not run on infrastructure whose recovery has never been proven.** Phase 10 builds and tests the execution bridge against fixtures; Phase 10.5 makes the platform underneath it recoverable; Phase 11 then turns on live data.

### Required outputs

**Backup and recovery.**

- backup policy;
- encrypted backup mechanism;
- point-in-time recovery where supported;
- a restore drill;
- documented **RPO** (how much data loss is tolerable) and **RTO** (how quickly service must return);
- a disaster-recovery runbook.

**A backup is not considered proven until a restore drill succeeds.** A backup nobody has restored is a hypothesis about a file, and the one irreplaceable asset in this system — the immutable event log — is exactly the thing that must not rest on a hypothesis ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md)).

**Failure modes, named in advance.**

- Mac mini failure mode;
- VPS failure mode;
- managed-database failure mode;
- provider-outage mode;
- degraded read-only mode — the system can keep serving reads and observation when its write or reasoning path is impaired.

**Supply-chain and artifact verification.**

- model artifact hashes;
- tokenizer hashes;
- model licences;
- quantization records;
- prompt hashes;
- dependency-lockfile verification;
- build provenance;
- a container or deployment artifact digest where applicable;
- security-scan evidence;
- secret-isolation verification.

Model and software supply-chain verification is the deployment-time counterpart to the repository's existing supply-chain controls — the pinned lockfile, the release-age cooldown, and the no-build-script policy ([supported-toolchain.md](../engineering/supported-toolchain.md)). A model is software too: its weights, its tokenizer, and its quantization are artifacts whose identity must be verifiable, and whose licence must be known.

### What this phase does not authorize

**This phase does not authorize live QuickFurno data or production communication.** It makes the platform recoverable and its artifacts verifiable; it grants no licence to put real personal data or real messages on it. The production event-log **privacy and retention decision remains an owner-approved hard gate on Phase 11** ([ADR-0019](../decisions/ADR-0019-durable-event-store-and-persistence.md) §7), and production communication remains gated on Phase 11A and its multilingual safety gate ([ADR-0017](../decisions/ADR-0017-live-communication-sequencing.md), [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)). **Having somewhere recoverable to put the data is not permission to put it there.**

---

## Current repository reality

**None of this is implemented.** There is no identity system, no MFA, no RBAC, no backup mechanism, no restore drill, no disaster-recovery runbook, and no model-artifact verification. `apps/api` and `apps/worker` remain compileable boundaries. Phases 8.5 and 10.5 are approved architecture that future, separately authorized phases will build, each with its own implementing ADR ([ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)).
