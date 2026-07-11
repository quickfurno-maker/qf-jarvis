# ADR-0001 — Source of Truth Boundary

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

QuickFurno Core is the existing business system. It owns leads, clients, vendors, assignments, packages, wallets, payments, campaigns, policy, and authorization. It is where the business actually happens.

QF Jarvis is being introduced as an intelligence layer: it will consume what happens in the business, reason about it, and recommend. To reason well it needs data — and the moment a system holds data and produces conclusions from it, there is pressure to let it hold the *authoritative* version of that data, and then to let it act on that data directly. Both steps feel like efficiency. Together they produce two systems that both believe they are correct, which is the failure mode that ends marketplaces.

The pressure is real and will recur. It will arrive as "Jarvis already knows the wallet balance, why round-trip to Core?", as "we need a cached lead state for performance," and as "this is urgent, let Jarvis just write it." Each is individually reasonable. Collectively they dissolve the boundary.

The decision must therefore be made once, permanently, and recorded — before there is any code to argue from.

## Decision

**QuickFurno Core remains the single, permanent, authoritative source of truth for all business data and all authorization.**

Specifically:

- QuickFurno Core owns leads, clients, vendors, assignments, packages, wallets, payments, campaigns, policies, approval decisions, execution intents, execution results, and audit records.
- QF Jarvis owns **only** its own intelligence artifacts: the recommendations it produced (with their evidence, rationale, and evaluation) and its agent runs.
- QF Jarvis may maintain **derived read models**, which are explicitly non-authoritative, rebuildable from canonical events, and minimized. If a derived view ever disagrees with Core, **Core is right**.
- QF Jarvis has **no write path into business state**, and none may be built.
- QF Jarvis **never** becomes the source of truth for any business fact — not permanently, not temporarily, and not "just as a cache."

The full statement of what each system owns, may do, and must not do is [system-boundary.md](../architecture/system-boundary.md), which is authoritative and derives from this decision.

## Alternatives considered

**1. Jarvis as a co-authoritative system for the domains it reasons about.**
Jarvis would own, say, lead-quality state. Rejected: "co-authoritative" is not a thing. Either one system is right when they disagree, or the business has no answer to "what is true?" A marketplace that cannot answer that question about a wallet balance is a marketplace with a legal problem, not an architectural one.

**2. Jarvis with a scoped write path — reads from Core, writes back derived judgments.**
Tempting, and the most likely thing to be proposed later. Rejected: a write path is a write path. Once it exists, its scope grows by pull request, and the audit chain from "what happened to this vendor" back to "who decided that" acquires a link nobody can attribute to a human or a policy.

**3. Jarvis as a full replica of Core's data, kept in sync.**
Rejected: replication implies a synchronization problem, and synchronization problems are resolved by someone deciding who wins. That someone is Core, always — at which point the replica is just an expensive derived view with worse privacy properties.

**4. Event sourcing where Jarvis and Core are peers over a shared log.**
Rejected as over-engineering, and as a boundary dissolved by design. It also assumes we can change Core's persistence model, which we cannot and should not.

## Consequences

**Positive.**

- There is always exactly one answer to "what is true?", and it lives where the business already lives.
- A compromised or malfunctioning Jarvis cannot corrupt business truth. Its worst output is a bad *recommendation*, which a human or a policy declines.
- Audit is tractable: every business fact has one owner and one history.
- Deletion and privacy obligations are honorable, because Jarvis references rather than copies ([data-ownership.md](../architecture/data-ownership.md)).
- Jarvis is disposable. Losing every Jarvis read model costs replay time and nothing else.

**Negative — accepted.**

- Jarvis must round-trip to Core for authoritative confirmation, which costs latency.
- Some computations are slower or more awkward than they would be with local authoritative state.
- Derived views can be stale, and the system must be designed to tolerate that rather than to eliminate it.
- Every business action requires a path through Core, even when Jarvis "already knows the answer."

These costs are accepted deliberately. They are the price of the single source of truth, and they are cheaper than the alternative.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Boundary erosion by increment** — each individual shortcut is defensible | The boundary is an ADR, not a convention. Weakening it requires a superseding ADR and the business owner's decision, not a code review |
| **A derived view becomes load-bearing** — the business starts depending on Jarvis's copy being correct | Rebuild read models from scratch periodically and prove nothing breaks (Phase 11 exit criterion) |
| **Staleness produces a wrong recommendation** | Core re-validates every submitted recommendation against its own truth before authorizing it ([trust-boundaries.md](../architecture/trust-boundaries.md), B3) |
| **Latency pressure drives a "temporary" write path** | There is no such thing as a temporary write path. Escalate to the business owner rather than shipping one |

## Follow-up

- [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) establishes the corresponding authority boundary: Jarvis recommends, Core authorizes, n8n executes.
- Phase 2 defines the canonical event and recommendation contracts that make this boundary workable in practice.
- Phase 11 must prove that derived views can be destroyed and rebuilt with identical results, and that Core wins every reconciliation.
- The responsibility matrix ([responsibility-matrix.md](../architecture/responsibility-matrix.md)) is reviewed at every phase gate. If QF Jarvis has appeared in an **A** or **R** cell for business state, this ADR has been violated.
