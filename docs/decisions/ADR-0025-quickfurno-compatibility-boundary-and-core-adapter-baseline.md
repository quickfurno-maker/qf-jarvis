# ADR-0025 — QuickFurno Compatibility Boundary and Core Adapter Baseline

**Status:** **Accepted** — accepted by **Keshav Sharma** (Founder, QuickFurno — business owner) on **2026-07-13**.
**Date:** 2026-07-13
**Accepted:** 2026-07-13
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)
**Stage 3.1.2 merged at:** `6030597e4f3be19e5c288ef951e661a7359e4307`

> ### What acceptance authorizes, and what it does not
>
> **Acceptance authorizes the documented architecture and the owner policies recorded below** — the compatibility boundary, the vendor distribution policy, the WhatsApp policy, the classification of the safety findings, and the staged remediation plan.
>
> **Acceptance authorizes no action against any running system.** It does **not** authorize live integration, a Supabase connection, a provider setting change, a migration, n8n, WhatsApp, or any mutation of the QuickFurno repository. **Reading a system does not grant permission to act on it**, and an accepted description of a boundary is not permission to cross it.

**Depends on:** [ADR-0001](./ADR-0001-source-of-truth-boundary.md) (source-of-truth boundary) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) (recommend → authorize → execute) · [ADR-0003](./ADR-0003-event-driven-integration.md) (event-driven integration) · [ADR-0013](./ADR-0013-canonical-event-envelope-and-versioning.md) (canonical envelope) · [ADR-0015](./ADR-0015-complete-client-journey-and-reassignment-policy.md) (assignment and reassignment policy) · [ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) (signature verification and idempotency) · the [QuickFurno Compatibility Directive](../architecture/quickfurno-compatibility-directive.md)

**Compatibility snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**

---

## Context

Every architectural decision from ADR-0001 onward rests on a claim about a system nobody in this repository had read: **QuickFurno Core**. The contracts were written deliberately narrow to survive that ignorance — `entityType` is an open string because _"QuickFurno Core owns its own entity taxonomy, and Phase 2 has not integrated with Core, so enumerating its entity types here would be inventing a fact about a system we have not yet looked at."_

That was the right call. It is also a debt, and this ADR is the first payment on it.

Stage 3.1.2 read the QuickFurno repository at a **pinned commit** and produced a compatibility baseline: what Core actually is, what it actually emits, who is actually authoritative for what, and where our target contracts and Core's reality **do not meet**. The finding set is recorded in [docs/compatibility/](../compatibility/).

**Three facts from that read change how the integration must be designed, and none of them were knowable from this side of the boundary.**

**One. Core's current event bridge is not an event bus.** The AOS n8n bridge is preview-first, fire-and-forget, and best-effort: an emission failure is caught and logged, and the business transaction commits anyway. **An event that is allowed to be lost is not an event a downstream system may derive truth from.** Building Jarvis ingestion on top of it would mean building a durable, replayable, idempotent event store fed by a source that silently drops events — the durability would be decorative.

**Two. Core's authoritative business operations are PostgreSQL functions invoked with the Supabase service role**, which bypasses row-level security. Authority in Core is therefore enforced by _application code choosing which function to call_, not by the database. That is Core's business to run as it sees fit — but it means **the boundary between Jarvis and Core cannot be a database boundary**, and any design that gave Jarvis a credential into Core's database would be handing out a credential that RLS does not constrain.

**Three. Core emits none of the canonical events in the Phase 2 catalogue.** Not "emits them in a different shape" — emits none of them. The catalogue was always declared a **target**, and the directive said so plainly. This ADR is where that stops being an assumption and becomes a measured gap with a named resolution phase.

## Owner decisions — recorded 2026-07-13

**The compatibility research is accepted. The following decisions are the owner's, and they are what the manifest and the tests now enforce.**

### 1. The vendor distribution policy is locked

|                              |                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| **Initial assignment batch** | **At most 3** eligible vendors                                                          |
| **Replacement batch**        | **At most 3** _additional_ eligible vendors. **Exactly one** replacement batch          |
| **Lifetime maximum**         | **6 unique vendors per lead-category**, for all time                                    |
| **Overlap between batches**  | **Forbidden**                                                                           |
| **Replacement trigger**      | **Genuine client dissatisfaction AND explicit client confirmation**                     |
| **Core must revalidate**     | Category · location · eligibility · consent · capacity · package · credits · anti-abuse |
| **A different category**     | Creates a **separate linked lead with its own cap**                                     |
| **Jarvis and Riya**          | May **request** a replacement. **May never assign vendors**                             |
| **Final authority**          | **QuickFurno Core**                                                                     |

**The observed QuickFurno implementation is recorded as evidence, and is not the approved policy:** automatic/primary maximum **3**, manual recovery maximum **9**, **no explicit two-batch model**, **one combined distinct-vendor count**.

> **The observed value of 9 must never be silently replaced by the target 6.** It is evidence, and normalizing it away would delete the reason the remediation exists. The manifest therefore carries **both** `observed_current_core_policy` and `owner_approved_target_policy`, and a test asserts they are **explicitly different**.

**This is a Core implementation conflict, not an owner-approved policy.** Status: **`core_remediation_required`**.

**Jarvis must never generate, recommend or normalize an assignment above the owner-approved limits.**

### 2. The WhatsApp policy is locked

> ## **`LIVE_WHATSAPP_BEFORE_PHASE_11A = PROHIBITED`**

The existing `whatsapp-dispatch` Edge Function is recorded accurately: it is **live-capable**, it reads pending `whatsapp_logs` rows, it **calls the Meta Graph API**, it is **gated only by provider credentials and invocation**, it **cannot read the Next.js runtime feature flags**, and **`WHATSAPP_SENDING_ENABLED=false` does not govern it**.

Status: **`live_capable_not_authorized`** · Remediation required before: **`phase_11a`**.

**Until Phase 11A:** the function **must not be scheduled**, **must not be manually invoked for production delivery**, and **must not be given active Meta credentials**. **Queued records do not constitute authorization to send.** **No Jarvis recommendation may directly trigger it.**

Future live delivery requires: **Core authorization → execution intent → n8n → approved provider adapter → provider result → authoritative Core result event** — with recipient resolution, consent, opt-out/DNC, communication eligibility, quiet hours, message purpose, approval level, idempotency, at-most-once execution, and an audit trail all checked **by Core**.

### 3. Feature flags in one runtime do not govern another

**This is the general lesson, and it is worth more than the specific bug.** The Next.js feature flags and the Deno Edge Function are **separately deployed artifacts in different runtimes**. A constant in one **cannot** be a control over the other — it is a statement of intent that the other runtime never reads.

**A safety flag that the dangerous code path cannot see is not a safety flag. It is a comment that looks like one**, and it is more dangerous than no flag at all, because everybody — including the README — believes it.

### 4. Core safety remediation is mandatory before Phase 11/11A

The confirmed findings are engineering and security defects, **not unresolved business choices**. They are recorded in the manifest with severity, evidence, exposure, remediation, **owner**, and **blocking phase**, and they are the content of **Stage 3.1.3**.

**Hard blockers:** uncontrolled WhatsApp delivery (**before Phase 11A**) · the assignment-cap conflict (**before Phase 11**) · missing RLS and anonymously mutable operational controls (**before any live Jarvis integration**) · GPS in free text (**blocked from canonical payloads**) · unrestricted status transitions (**before Jarvis may recommend lifecycle-changing actions**).

### 5. The canonical payload does not yet reject coordinate-shaped content — and that is a gap, not an accepted risk

**The current contracts do not fully reject coordinate-shaped content hidden inside arbitrary strings.**

The governed payload refuses the free-text carrier keys (`body`, `notes`, `freetext`, `raw`), every contact key, and any value containing an email address or a phone number. It does **not** refuse a **latitude/longitude pair** placed inside an arbitrarily-named permitted key. Core stores precise client coordinates **inside `leads.message`**, so this is a concrete exposure, not a theoretical one.

> **This is a known contract gap. It is not expected-safe behaviour, and it is not an accepted risk.**

|                                     |                                                       |
| ----------------------------------- | ----------------------------------------------------- |
| **Finding**                         | `gps-value-shape-not-refused`                         |
| **Owner**                           | **`qf-jarvis`**                                       |
| **Severity**                        | **High**                                              |
| **Status**                          | **`contract_gap`**                                    |
| **Blocks**                          | **Stage 3.2** — signed fixture ingestion              |
| **Resolves in**                     | **Stage 3.1.4** — Canonical Payload Privacy Hardening |
| **May it be deferred to Phase 11?** | **No**                                                |

**Two consequences, both binding now:**

- **No live adapter may forward free-text requirement fields.** Not `leads.message`, not a renamed copy of it, not "just the requirement summary." **Reason codes and bounded signals only.** While the gap is open, that discipline _is_ the control — and discipline is exactly what Stage 3.1.4 replaces with structure.
- **Stage 3.1.4 must close the gap before signed ingestion begins.** Not before Phase 11 — before **Stage 3.2**. **Signing a payload that can smuggle coordinates only makes the smuggling authenticated**, and a signature is precisely the thing that would later be cited as evidence the payload was trustworthy.

**Phase 11 remains blocked until Core remediation (Stage 3.1.3) AND payload privacy hardening (Stage 3.1.4) are complete.** Phase 11 is the first moment real personal data crosses the boundary. **It may not begin through a hole we had already written down.**

### 6. Compatibility documentation authorizes no production action

**Reading a system does not grant permission to act on it.** Nothing in this ADR or in `docs/compatibility/` authorizes a connection, a setting change, a migration, a message, or a Stage 3.2 start.

---

## Decision

**Pin the compatibility baseline to a reviewed QuickFurno commit; keep the boundary absolute; design the Core adapter now and implement none of it.**

### 1. QuickFurno Core remains the authoritative Core. Jarvis remains a separate intelligence service.

Unchanged, and reaffirmed against the real system rather than against an assumption about it:

> **Jarvis recommends. QuickFurno Core authorizes. n8n executes. Providers deliver. Results return to Core.**

Core owns leads, clients, vendors, assignments, packages, credits, payments, and campaigns, and **it alone mutates them**. Jarvis holds derived, non-authoritative views. When a derived view disagrees with Core, **Core wins, and the view is rebuilt** ([ADR-0001](./ADR-0001-source-of-truth-boundary.md)).

### 2. No shared database. No shared credentials. No shared runtime packages.

| Forbidden                                | Why                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **A shared database**                    | Two services on one database is one service with extra steps and two deploy schedules                                      |
| **A shared credential**                  | Core's service role bypasses RLS. A credential Jarvis holds is a credential that can rewrite Core's business tables        |
| **A shared runtime package**             | Core is Next.js 14 / Node 20 / npm; Jarvis is Node 24 / pnpm. A shared package couples two release cycles and two runtimes |
| **A direct Jarvis read of a Core table** | A read path is a coupling to Core's schema, and Core's schema is Core's to change                                          |
| **A direct Core read of a Jarvis table** | Symmetric, and worse: it would make Jarvis's derived views look authoritative to the authoritative system                  |

**The integration surface is events in, recommendations out. Nothing else.**

### 3. The future event source is a durable, signed Core outbox

The current AOS bridge is **transitional, not canonical** (§5). The event source Jarvis ingests from must be:

- **Transactional** — the business change and the outbox record commit in **one** database transaction, so an event cannot be lost by a process dying between them, and cannot exist for a change that rolled back;
- **Signed** — Ed25519 over the canonical envelope, verified at the Jarvis boundary ([ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md));
- **Retryable and acknowledged** — delivery is retried until Jarvis acknowledges, and acknowledgement is durable;
- **Idempotent** — redelivery is expected and safe; `eventId` is the idempotency key.

**Fire-and-forget is not acceptable for an authoritative event.** The design is [quickfurno-core-adapter-design.md](../compatibility/quickfurno-core-adapter-design.md), and **it is a design, not an implementation.**

### 4. Recommendations return to Core for authorization

Jarvis submits recommendations to Core. **Core validates, applies deterministic policy, obtains human approval where required, and — only then — issues its own execution intent.** `ExecutionIntentV1.issuer` is the literal `quickfurno-core` and `executor` the literal `n8n`, so **Jarvis cannot construct a valid execution intent** even in error ([ADR-0014](./ADR-0014-governed-lifecycle-contracts.md)).

A recommendation is **inert**. It is a proposal with evidence, an expiry, and a required approval level. It is not an instruction, and Core is not obliged to act on it.

### 5. The current AOS bridge is transitional, and is not the integration

The QuickFurno AOS is a **preview-first agent scaffold**. It stays exactly as it is, **untouched, until Phase 11**. This ADR:

- **changes nothing in the QuickFurno repository**, and Stage 3.1.2 wrote nothing to it;
- does **not** deprecate the AOS bridge, disable it, or migrate it;
- records how each current event maps onto the canonical catalogue **when Phase 11 arrives** ([current-aos-to-jarvis-migration.md](../compatibility/current-aos-to-jarvis-migration.md)).

**Calling the current bridge "the integration" would be the most expensive mistake available here**, because it works well enough to demo and not nearly well enough to derive truth from — and the gap between those two is invisible until something is lost.

### 6. Compatibility is pinned to a reviewed commit, and drift requires an explicit refresh

The baseline is pinned to `00706899b46ae16fa6170c70125708b63e0926a9`. QuickFurno is under active development and **will** drift.

**A pinned, reviewed baseline is the only kind that means anything.** A compatibility document that silently tracks another repository's `main` is a document that was true once, is unverified now, and will be discovered to be wrong at integration time. So:

- The manifest records the snapshot SHA, and a test asserts it is present.
- **CI does not fetch QuickFurno.** The checked-in manifest _is_ the reviewed baseline, and a test that reached across a network to a moving target would be a test whose result depended on somebody else's merge.
- **Refreshing the snapshot is an explicit, reviewed act** — a new read, a new diff, a new owner review. It is not a dependency bump.

### 7. Phase 11 is the first live Core integration

**No live data and no production action is authorized by this ADR.** It authorizes reading, mapping and documenting — and nothing that touches a running system.

| Not authorized by this ADR                                                                |
| ----------------------------------------------------------------------------------------- |
| Any connection to QuickFurno's Supabase project — which remains **permanently forbidden** |
| Any write to a QuickFurno business table                                                  |
| Implementing the Core outbox, or signing, in QuickFurno                                   |
| Implementing Jarvis ingestion, an HTTP endpoint, or an agent                              |
| Any live personal data, which remains gated on the **Phase 11 privacy decision**          |

## Consequences

**Positive.**

- **The contracts can stop guessing.** `entityType` was left open because Core's taxonomy was unknown; it is now written down (22 entities), and a future closed enum has a reviewed source.
- **The gaps are counted rather than assumed.** "Core emits none of the canonical events" is now a measured statement with a per-event resolution phase, instead of a comfortable belief that the adapter will sort it out.
- **The outbox requirement is discovered before Phase 11, not during it.** Finding out that the event source drops events _after_ building ingestion on it is the expensive order to find out in.
- **Documentation drift in Core is now visible to us**, including a stale maximum-vendor count — the exact class of error that silently breaks a business rule.

**Negative — accepted.**

- **The baseline goes stale from the day it is pinned**, and refreshing it costs a real review. The alternative — tracking `main` — costs correctness, which is worse.
- **This stage produces no running code.** It is documentation, a manifest, and tests over that manifest. That is the correct output for a compatibility stage, and it will nonetheless feel like a phase where nothing shipped.
- **The Core outbox is work for the QuickFurno repository**, which this stage may not touch. It is therefore a designed obligation on a system this ADR cannot change, and it will not exist until somebody schedules it.
- **The manifest can drift from the documents beside it.** Mitigated by making the manifest the machine-readable source the tests check, rather than a summary of the prose.

## Alternatives rejected

**Ingest from the existing AOS n8n bridge.** Rejected. It is fire-and-forget: emission failures are swallowed and the transaction commits regardless. A durable, replayable event store fed by a lossy source has durable copies of the events that happened to survive, and no way to know which ones did not.

**Give Jarvis a read-only credential into Core's database.** Rejected, and it is the tempting one — it would work immediately and skip the outbox entirely. It couples Jarvis to Core's schema, makes every Core migration a potential Jarvis outage, and puts a credential to Core's data inside the Jarvis trust zone. Core's authority is enforced in application code above a service role that bypasses RLS, so "read-only" would be a property of our restraint rather than of the credential.

**Enumerate Core's entity types into `entityTypeSchema` now.** Rejected _for this stage_. The taxonomy is recorded in the compatibility documents and the manifest, where it can be reviewed. Closing the enum is a contract change, and this stage is explicitly not a contract change — the closed list arrives with the integration, having been reviewed as part of it.

**Track QuickFurno's `main` instead of pinning.** Rejected. See §6. A baseline that moves under you is not a baseline.

**Mark ADR-0025 Accepted with this stage.** Not proposed. The compatibility read is complete; the owner's review of it is not. **It stays Proposed.**
