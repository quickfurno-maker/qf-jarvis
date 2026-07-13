# QuickFurno Core Adapter — Design

**Status:** **Design only. Nothing here is implemented, and nothing here may be implemented in Stage 3.1.2.**
**Date:** 2026-07-13
**QuickFurno snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

> **This document designs work that lives in the QuickFurno repository and in a future Jarvis phase. Stage 3.1.2 wrote nothing to QuickFurno and implemented none of this. The first live Core integration is Phase 11.**

---

## Why an adapter is needed at all

The Phase 2 contracts were written to be **easy to adapt onto**, deliberately: a target payload names _which_ entity (an opaque reference) and _what happened_ (a stable reason code), plus a small governed bag of derived signals. It does not reproduce Core's record.

> **The adapter absorbs the difference; the contract does not bend.**

Having now read Core, that decision holds up — but the adapter's job is **larger than a field mapping**, and pretending otherwise is the failure mode this document exists to prevent. Three properties Jarvis's event backbone requires **do not exist in Core today**, and no amount of mapping creates them:

| Jarvis requires      | Core today                                                                                                                                                                                            | Consequence                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Durable delivery** | Emission is **fire-and-forget**; failures are swallowed, and a 3-second timeout resolves to `null` while the business transaction commits regardless (`lib/aos/events/emitLeadCreatedEvent.ts:73-93`) | Events are **lost silently**. A durable store fed by a lossy source is durable about whatever survived          |
| **Signed envelopes** | No signing of any kind                                                                                                                                                                                | Nothing to verify ([ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md)) |
| **Idempotency keys** | `eventId` is optional; `emitLeadCreatedEvent` fabricates a fallback lead id from `Date.now()` + `Math.random()` when one is absent (`:110-112`)                                                       | Redelivery cannot be recognised as redelivery                                                                   |

**These are not adapter concerns. They are source concerns**, and they must be fixed in Core. An adapter that "handled" a lossy source would only be hiding the loss behind a translation layer.

---

## A. Durable Core outbox

**The event source Jarvis ingests from must be a transactional outbox inside QuickFurno Core.**

### The one rule that makes it work

> **The business change and the outbox record commit in the SAME database transaction.**

```sql
BEGIN;
  -- the authoritative business change (Core's existing RPC does this today)
  UPDATE public.leads SET status = 'Verified' WHERE id = $1;

  -- the event, written in the SAME transaction
  INSERT INTO public.qf_event_outbox (event_id, event_type, event_version, subject_type,
                                      subject_id, correlation_id, causation_id,
                                      payload, occurred_at)
  VALUES (...);
COMMIT;
```

**If the transaction rolls back, the event does not exist. If it commits, the event exists.** There is no third outcome, and — crucially — **there is no window in which the business change is durable and the event is not.** That window is precisely what today's `await emitLeadCreatedEvent(...)`-after-`insert` pattern leaves open, and a process dying inside it loses the event with nothing to show that it did.

**No HTTP call happens inside the transaction.** Writing a row is the entire emit path; a webhook inside a transaction couples Core's commit latency to a network, and a webhook _after_ the commit is the fire-and-forget bug again.

### The relay

A separate, idempotent relay reads unacknowledged outbox rows and delivers them to Jarvis:

| Property            | Design                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ordering**        | By `outbox_id` (monotonic). Best-effort — Jarvis claims **deterministic ingestion order, not business ordering** ([ADR-0022](../decisions/ADR-0022-projections-ordering-and-rebuild-determinism.md))                     |
| **Retry**           | Bounded exponential backoff. A row stays unacknowledged until Jarvis durably accepts it                                                                                                                                  |
| **Acknowledgement** | Jarvis returns an ack per `event_id`; Core marks the row delivered. **Durable ack, not a 200 from a load balancer**                                                                                                      |
| **At-least-once**   | Assumed. **Redelivery is expected and safe** — `eventId` is the idempotency key, and duplicate suppression is Jarvis's job ([ADR-0020](../decisions/ADR-0020-event-ingestion-signature-verification-and-idempotency.md)) |
| **Poison events**   | Bounded attempts, then a dead-letter state **visible in Core**. A stuck outbox row must be an operational alarm, not a silent backlog                                                                                    |

### Signing

**Ed25519 over the canonical envelope**, at the relay, with a key held in Core's trust zone. Jarvis verifies at the ingestion boundary and **rejects anything unsigned or badly signed** — before parsing, before storing.

- **Key rotation** must be supported from day one: the envelope carries a key id, and Jarvis trusts a **set** of public keys. A rotation that requires a synchronised deploy of two services is a rotation that will not happen.
- **Jarvis holds only public keys.** It cannot sign, so it cannot forge an event that appears to come from Core.

### No fire-and-forget for an authoritative event

An event Jarvis derives truth from may not be best-effort. **Preview/telemetry emissions may remain fire-and-forget** — losing one costs a dashboard tick. Losing `qf.assignment.batch-created` costs a wrong answer that nobody detects, and the derived view is wrong from then until a rebuild that also cannot see the missing event.

### No direct Jarvis database access

**The relay pushes. Jarvis never reads Core's database, and Core never reads Jarvis's.** No credential crosses the boundary in either direction ([ADR-0001](../decisions/ADR-0001-source-of-truth-boundary.md), [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) §2).

This is not fastidiousness. Core's authoritative operations run as PostgreSQL functions invoked through the **Supabase service role**, which **bypasses row-level security** — so a "read-only" credential into Core's database would be read-only by our restraint, not by the database's enforcement.

---

## B. Jarvis recommendation intake

The return path. **Jarvis proposes; Core disposes.**

```
Jarvis ──RecommendationV1──▶ Core intake
                               │
                               ├─ authenticate the submitter
                               ├─ validate the schema        (strict; unknown keys rejected)
                               ├─ validate the policy        (deterministic, versioned, Core's)
                               ├─ check expiry               (a stale recommendation is refused, not run)
                               ├─ suppress duplicates        (recommendationId is the key)
                               ├─ validate AUTHORITY         (may this agent even propose this?)
                               │
                               ├─ approval required? ──▶ human (founder / admin) decides
                               │
                               └─ approved ──▶ Core issues ExecutionIntentV1
                                                 issuer:   'quickfurno-core'   (literal)
                                                 executor: 'n8n'               (literal)
                                                              │
                                                              ▼
                                                    n8n executes ──▶ provider delivers
                                                              │
                                                              ▼
                                          authoritative result event ──▶ back through the outbox
```

| Stage                    | Requirement                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Submission**           | Authenticated and signed. Core must know **which agent** proposed, and be able to prove it later                                                                                            |
| **Schema validation**    | `recommendationV1Schema`, strict. A recommendation that does not parse is **rejected, not repaired**                                                                                        |
| **Policy validation**    | **Deterministic, versioned, and Core's.** A model does not get to decide whether its own output is permissible                                                                              |
| **Expiry**               | Enforced at intake **and** at execution. A recommendation approved yesterday and executed today against a changed world is the quiet failure here                                           |
| **Duplicates**           | `recommendationId` is the idempotency key. A resubmission is not a second proposal                                                                                                          |
| **Authority validation** | Cross-check against the [authority matrix](./quickfurno-authority-matrix.md). **A recommendation to do something Jarvis may never do is refused at intake** — not merely left unapproved    |
| **Approval**             | Per `approvalLevel` (`none` → `delegated-approver` → `authorized-team-human` → `stronger-approval` → `founder`) and `riskClass`. Money, communication, and voice **always** require a human |
| **Execution intent**     | **Core-generated, always.** `issuer` is the literal `quickfurno-core`, so **Jarvis structurally cannot construct one** ([ADR-0014](../decisions/ADR-0014-governed-lifecycle-contracts.md))  |
| **Audit**                | Every stage recorded: proposed, validated, approved/rejected, issued, executed, resulted. **The audit trail is Core's, because the authority is Core's**                                    |
| **Result**               | The authoritative outcome returns as a canonical event **through the outbox** — the same durable path, not a side channel                                                                   |

**The rejection path is a feature.** A recommendation that Core refuses must produce a recorded, reason-coded refusal that Jarvis can learn from. An intake that silently drops what it does not like teaches an agent nothing and hides a disagreement between the two systems.

---

## C. Privacy boundary

**The default is that Jarvis does not receive personal data.** Not "receives it and is careful with it."

| Rule                                         | Mechanism                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opaque identifiers only**                  | `entityReferenceSchema` — `[A-Za-z0-9._:-]`, which **excludes `@` and `+`**, so an email address and an E.164 phone number are **structurally unable** to appear                                                           |
| **No copied contact details**                | No phone, email, or address in any event or memory — **unless a later, explicit privacy decision approves it.** Stage 3.1.2 approves nothing                                                                               |
| **Core resolves contacts at execution time** | n8n asks **Core** who to message, at the moment of authorized execution. **Jarvis never learns the recipient**, and cannot, because it never held them                                                                     |
| **Bands, never balances**                    | Money-adjacent events carry `low`/`medium`/`high`/`critical`. **A wallet figure in a Jarvis contract would be stale by construction** and would invite reasoning about a real vendor's money from a copy nobody reconciles |
| **No shared credentials**                    | Jarvis holds **no** Supabase key, service-role key, or database credential for Core. Ever                                                                                                                                  |
| **No direct table access**                   | In either direction                                                                                                                                                                                                        |
| **Deletion-aware**                           | `erasureState` is mandatory on memory, so an un-propagated deletion is **detectable** rather than invisible. `qf.privacy.erasure-requested` / `-recorded` propagate through the same outbox                                |

### The specific hazard this baseline found

Core stores **GPS coordinates and clarification answers inside `leads.message`**, a free-text column ([system inventory](./quickfurno-system-inventory.md)). A naive adapter that mapped "the lead's requirement text" into a derived signal would carry **precise home coordinates** across the boundary in a field nobody thought of as sensitive.

**This is exactly what the governed payload refuses by construction**: `derivedObservationSchema` rejects `body`, `notes`, `freetext`, and `raw` **by key**, and the always-forbidden set rejects credentials and contacts **by value shape**. The adapter must map **reason codes and bounded signals** — never Core's free text. A free-text passthrough is how the whole record gets copied, one convenient field at a time.

---

## D. Compatibility with the two stacks

The two services are **deliberately not alike**, and the boundary is what makes that safe rather than expensive.

|                     | QuickFurno Core                                                                                | QF Jarvis                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Framework**       | Next.js **14.2.15**, App Router (`package.json:16`)                                            | None (service)                                                                                                            |
| **Runtime**         | Node **20 (inferred, NOT pinned)** — see below                                                 | Node **24.18.0**, pinned three ways                                                                                       |
| **Package manager** | **npm** (`package-lock.json`)                                                                  | **pnpm 11.11.0** (`packageManager`)                                                                                       |
| **Database**        | Supabase (Core's project) — **permanently forbidden to Jarvis**                                | **Dedicated** Supabase-managed PostgreSQL 17 ([ADR-0023](../decisions/ADR-0023-dedicated-supabase-managed-postgresql.md)) |
| **Data access**     | `@supabase/supabase-js`, PostgREST + RPC                                                       | **`pg` only.** No `@supabase/supabase-js`, no Auth, no Storage, no Realtime, no Edge Functions                            |
| **Business logic**  | RPC-heavy: PostgreSQL functions via the **service role**, which **bypasses RLS**               | Canonical contracts, validated at the boundary                                                                            |
| **Deployment**      | PM2 on Hostinger **(per owner; not evidenced in the repository — no PM2 config is committed)** | Separate service                                                                                                          |
| **Shared packages** | **None. Zero. In either direction**                                                            |                                                                                                                           |

> **Correction to a stated assumption, and it matters.** The QuickFurno repository **pins no Node version at all**: there is no `engines` field, no `.nvmrc`, and no `.node-version`. The only Node signal in the repository is the devDependency `@types/node: ^20.16.5` (`package.json:22`) — which is a _types_ package, and pins the **type definitions**, not the runtime. Core will run on whatever Node the host provides.
>
> This is worth writing down rather than smoothing over: an unpinned runtime is a runtime that drifts silently, and **"Core is on Node 20" is currently a belief, not a guarantee.** If the outbox relay comes to depend on a Node API's behaviour, that belief becomes load-bearing. Pinning Core's runtime is a QuickFurno-side hygiene item, not a Jarvis one — but Phase 11 should not assume a version nobody declared.

**Jarvis imports no QuickFurno package, and QuickFurno imports no Jarvis package.** The only shared artifact is the **canonical event contract**, and it is shared as a _specification_ — the wire format — not as a linked dependency. Two runtimes and two package managers make that non-negotiable, which is a benefit: a shared library would have coupled two release cycles, and the temptation to "just import the types" is how a boundary becomes a build dependency and then an outage.

### What Core must build (and this stage may not)

1. `qf_event_outbox` table + transactional writes inside the existing RPCs.
2. The relay: read → sign → deliver → await ack → mark delivered.
3. Ed25519 signing, with key rotation.
4. The recommendation intake endpoint, with policy and authority validation.
5. Stable `reasonCode` vocabularies per event type.
6. Result events returned through the outbox.

**All six are QuickFurno repository work, and Stage 3.1.2 is forbidden from touching that repository.** They are recorded here so that the obligation exists in writing, and so that Phase 11 does not discover them one at a time.
