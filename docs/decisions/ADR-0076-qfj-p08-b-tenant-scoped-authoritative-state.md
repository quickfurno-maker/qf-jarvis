# ADR-0076 — QFJ-P08-B Tenant-Scoped Authoritative State and Persistence Ownership

**Status:** Accepted — QFJ-P08-B1 (owner ratifications + the runtime contract correction; no database, no migration)
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0058](./ADR-0058-asynchronous-runtime-integration-boundaries.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0074](./ADR-0074-qfj-p08-a-conversation-control-command-foundation.md) · [ADR-0075](./ADR-0075-qfj-p08-a-writable-conversation-control-composition.md)

## Context

Baseline: `main` at `873a4d4de5e9ac025549b97e0fb3f67f552c65d3`, the merge of PR #78 (QFJ-P08-A PR 2).

The QFJ-P08-B schema audit returned **`OWNER_DECISION_REQUIRED`**. It found that a durable control
store could not be designed, let alone built, until three questions were answered: what the revision
versions and who owns it, who may create the first authoritative row, and whether `conversationId`
alone is a safe lookup key. It also warned against shipping another type-only "persistence
foundation" PR — ADR-0075 already locks the port, the atomicity contract and the single-source rule,
so restating them would deliver no new safety.

This ADR answers the three questions and makes the one runtime correction that must land **before**
any PostgreSQL adapter exists.

## Decision

### 1. Jarvis owns an operational runtime-safety replica — not a business record

Jarvis owns ONE durable **operational runtime-safety state replica** for conversation gating. It is
authoritative **inside the Jarvis runtime only**, for: revision-bound state gates, human takeover, AI
pause, the cancellation/privacy/party/data-class observations Jarvis reads, and deciding whether an
in-flight model/Core turn is stale.

QuickFurno Core remains the business source of truth for tenant/business identity, party
classification, data-class facts, cancellation business truth, subject/privacy/tombstone facts, all
business state, consent, approval and communication eligibility.

This narrows an existing phrase rather than contradicting it. ADR-0054 §L and ADR-0051 say _"Core owns
the authoritative conversation record"_ — that is about the **conversation**: what was said, who the
party is, what the business facts are. The record this ADR ratifies is authoritative for **Jarvis
runtime gating**, and for Core-owned fields it is a synchronized observation used to fail closed, not
a competing business record.

**No operator command may change** `tenantId`, `partyType`, `dataClass`, `cancelled`, `subjectStatus`
or `subjectRef`. Only the four ADR-0074 actions may change `humanTakeover`, `aiPaused` and the shared
revision. A future trusted Core-synchronization path may update the Core-derived fields — but through
the **same aggregate**, incrementing the **same revision**, atomically, and without touching the
control flags unless an explicitly governed import path authorises it. No direct SQL writer may ever
bypass that revision.

### 2. One revision versions the whole safe state

One revision versions exactly: `conversationId`, `tenantId`, `partyType`, `dataClass`,
`humanTakeover`, `aiPaused`, `cancelled`, `subjectStatus`, `subjectRef`.

`observedAt` is a correlation reference and does not independently define revision identity.

This is forced by the code, not chosen for tidiness. M3 compares `state.revision !==
request.expectedRevision` across the whole state; M2's second gate uses `ctx2.revision !==
ctx1.revision`; M4's post-gateway gate uses `after.revision !== before.revision` **alone**. A field
that could change without moving that number would be a change no gate could see.

Every mutation to any covered field must occur through one governed aggregate path, increment the
revision exactly once, be visible before the operation resolves, and invalidate any in-flight
operation bound to the prior revision.

**Never** `controlRevision` / `privacyRevision` / `coreRevision` / `operatorRevision`, never a base
state with process-local control flags overlaid, and never a "latest wins" merge between stores. Two
revisions is a split brain with a tidy name.

### 3. Identity is `(tenantId, conversationId)`

`conversationId` is **not** assumed globally unique. Nothing in tracked governance guarantees it, and
the runtime has always carried tenant and conversation as two separate identifiers.

The canonical key is `(tenantId, conversationId)`. The future persistent primary key is
`(tenant_id, conversation_id)`; the future command-idempotency scope is `(tenant_id, command_id)`.

### 4. Why the previous interface was unsafe

`read(conversationId)` is an unscoped query. The inbound path compared `envelope.tenantId` against the
returned state **after** the read — post-hoc tenant checking, which can notice a cross-tenant answer
but only once the wrong row has already been read. The operator control and query paths had nothing to
compare against at all: `ConversationControlCommandInput` carries no tenant, and the query took a bare
conversation id. A persistent store would have answered both from whichever row matched the id.

So the ports become tenant-scoped:

```ts
read(key: ConversationStateKey): Promise<ConversationControlState>
applyControlCommand(key: ConversationStateKey, command): Promise<ConversationControlDecision>
readOperationsProjection(key: ConversationStateKey): Promise<ConversationOperationsProjection>
```

**No conversationId-only overload is retained.** A compatibility overload would preserve exactly the
unsafe call shape this corrects.

`composeAndProcess` derives the key **once** from the validated envelope and hands the same one to the
M2 context port, the M4 reply-state reader, the M3 Core-state reader, the privacy gate and both
behaviour adapters. Every boundary that receives state or a projection from an injected structural
source then verifies that the returned `tenantId` **and** `conversationId` are the ones requested, and
fails closed otherwise — no repair, and never accepting the right conversation under the wrong tenant.

The existing envelope/state consistency comparisons remain as defence in depth. Scoping the key
prevents cross-tenant addressing; those checks stay because a source can still answer wrongly.

The operator surfaces are explicitly tenant-scoped:
`applyConversationControlCommand({ tenantId, command })` and
`readConversationOperationsSnapshot({ tenantId, conversationId })`, both validating the tenant against
the exact-token grammar **before** any source call. Invalid input yields the existing closed reasons —
`control-invalid-command` and `operations-invalid-conversation` — with **no new reason** added.

### 4a. Every conversation-keyed external read seam, not just the state port

Final review found the rule had been applied to the authoritative state port but not to the two
business-fact seams. `ClientSalesBehaviourInputRequest` and `VendorJourneyBehaviourInputRequest`
still carried only `conversationId` and `revision`, so a real supplier had nothing with which to
select the right tenant's Core-owned facts — and two tenants sharing one conversation id could have
received each other's signals.

Tenant-scoped conversation identity therefore applies to **every conversation-keyed external read
seam in the Jarvis composition**, not merely the state port. Both requests now carry
`tenantId` + `conversationId` + `revision`, with the tenant taken from the one key already derived
from the validated envelope — never from the supplied facts, and never from what the state source
returned. `revision` stays: a future supplier must fetch facts for the exact tenant-scoped
conversation _and_ revision.

This does **not** merge business facts into authoritative control state. The two seams remain separate
by design: one supplies Core-owned business facts, the other runtime gating state. Scoping both does
not join them, and **no business-fact persistence is introduced**.

The behaviour adapters are also authoritative-state readers, so they now validate identity on their
own state reread as well. A structural source could otherwise answer correctly at the first gate,
return another tenant's state during the behaviour read, and answer correctly again afterwards — and
that foreign `humanTakeover` / `aiPaused` would reach the behaviour decision. The check is one
comparison after the existing single read: no extra read, no retry, and no public error vocabulary
added.

### 5. The pure reducer stays tenant-free

`@qf-jarvis/conversation-control` is unchanged: no `tenantId` on `ConversationControlCommand`,
`ConversationControlSnapshot` or `ConversationControlAuditRecord`, and its root API stays at 9. The
reducer operates on one already-addressed conversation; tenancy is an addressing concern of this
composition and of the future store, which will key the audit row by tenant itself. Putting the tenant
in the command would duplicate into the evidence a value the store already indexes by.

### 6. Trusted bootstrap only — ratified, not implemented

**A control command may never lazily create an authoritative row.** It carries no tenant truth, party
type, data class, cancellation, subject status or subject-reference authority; a row built from one
would be fabricated business context wearing an operator's name.

QFJ-P08-B2's adapter will expose an explicit **trusted provisioning capability, separate from the
`JarvisRuntime` operator methods**. For a brand-new operational state: initial revision `0`,
`humanTakeover = false`, `aiPaused = false`, and every Core-derived field supplied explicitly by the
trusted provisioning input — **no defaults** for `partyType`, `dataClass`, `cancelled` or
`subjectStatus`. No live caller is authorised. Importing an already-controlled conversation is
governed separately. This interface does **not** belong in `jarvis-runtime`.

A valid command against a missing row fails closed at the composition boundary as a source failure;
the query behaves the same. **No public reason vocabulary is widened.**

### 7. Future store ownership

A dedicated PostgreSQL adapter package — proposed name **`@qf-jarvis/postgres-conversation-state`** —
below application composition and **outside** `jarvis-runtime`. It implements the tenant-scoped read
and writable ports, owns trusted provisioning, atomic command application and the durable
command-idempotency/audit ledger, and depends on `@qf-jarvis/jarvis-runtime` (types),
`@qf-jarvis/conversation-control` (reducer) and `pg`. Neither `jarvis-runtime` nor
`conversation-control` depends on it. No cycle. **Not created here.**

`jarvis-runtime` stays persistence-neutral, per ADR-0059. **`event-backbone` is not the runtime
owner:** the future migration may live in the existing central `qf_jarvis` stream after a ledger
collision check, but ownership belongs to the adapter.

### 8. The Core-only event log is not the control write path

`0001_event_log.sql` carries `CONSTRAINT event_source_is_quickfurno_core CHECK (source =
'quickfurno-core')`. Jarvis structurally cannot append an operator command as a canonical event. And
an asynchronously projected read model could not satisfy ADR-0075's requirement that an APPLIED state
be authoritative **before** `applyControlCommand` resolves. The future adapter is transactional
operational persistence. B1 authorises no `event-backbone` runtime dependency.

### 9. Operations projection stays deferred

The B2 adapter will initially implement `read`, `applyControlCommand` and trusted provisioning — and
**not** `readOperationsProjection`, until governed production writers exist for `conversationState`,
`lastActivityAt`, `escalationStatus`, `followUpStatus`, `deliveryStatePlaceholder` and `auditRef`.
Against an adapter lacking the capability the query correctly returns `operations-unavailable`. The
interface stays; the tokens are not fabricated.

### 10. Idempotency, ratified for B2

Unique scope `(tenantId, commandId)`. An **exact duplicate** — same tenant, same command id, identical
canonical command body — returns the **original stored decision**, with no second state effect and no
second audit row, even if the revision has since advanced; that is the crash-recovery case, and
re-evaluating would report `revision-mismatch` and lie about what happened. A **conflicting
duplicate** — same tenant and command id, different body — produces zero state effect and fails closed
as a source failure, with no public vocabulary widening. Not implemented here.

### 11. Provenance reference bumped

`DEFAULT_RUNTIME_REF` moves `qfj.jarvis-runtime.s3ib` → **`qfj.jarvis-runtime.p08b1`**. Tenant
isolation is a materially different guarantee for every inbound turn, and default provenance should
name the implementation that actually ran. An explicit configured `runtimeRef` still overrides.

## Rejected alternatives

- **Another type-only persistence foundation PR.** Restates ADR-0075 and adds no safety.
- **Keeping `read(conversationId)` with a post-read tenant comparison.** Detects a cross-tenant answer
  only after reading the wrong row, and gives the operator paths nothing to compare against.
- **A backwards-compatible `conversationId`-only overload.** Preserves the unsafe call shape.
- **Assuming `conversationId` is globally unique.** Unproven, and the assumption fails silently.
- **Putting `tenantId` into the pure command.** Pollutes a tenant-neutral leaf and duplicates it into
  audit evidence the store already keys by.
- **A second revision, or control flags overlaid on a separately versioned base.** The forbidden split
  brain.
- **Lazy row creation from an operator command.** Fabricates business context.
- **Event-sourcing operator control.** Structurally blocked by the Core-only `source` CHECK.
- **`event-backbone` as runtime owner of control state.** Conflates the canonical Core event log with
  operational runtime state.

## Consequences

Cross-tenant addressing is now unrepresentable rather than merely detectable, and a persistent adapter
can be written against a key that is safe to index. Every ADR-0074/0075 invariant is preserved: one
source object, one config field, no split brain, no reducer replay, no automatic resume, APPLIED
authoritative before resolve, at most one apply call.

Runtime API counts are unchanged everywhere — `agent-runtime` 46, `jarvis-runtime` 6,
`conversation-control` 9, and every other package — because the additions are type-only. No dependency
and no lockfile change. Migrations remain exactly `0001`–`0007`, **no `0008`**.

## Phase status

**QFJ-P08-B1 does NOT complete persistence.** There is still no durable store, no restart survival, no
cross-process CAS and no durable idempotency.

**Next: QFJ-P08-B2** — the migration plus the dedicated PostgreSQL adapter, after a fresh
migration-ledger and open-PR collision check. Managed PostgreSQL remains a separate paused lane.
**Production rollout remains OFF.**

## Non-goals

No database, `pg`, SQL, migration or migration number · no persistence · no durable idempotency · no
bootstrap implementation · no operations-projection producer · no operator HTTP/API/UI/auth · no
approval runtime · no consent/opt-out state · no P09 transport · no WhatsApp/n8n · no live Core · no
provider call · no deployment or activation.

## Change-control rule

The key stays `(tenantId, conversationId)`; reintroducing a conversation-only lookup requires a
superseding ADR. One revision keeps versioning the whole safe state — adding a second revision, or
overlaying control flags on a separately versioned base, requires a superseding ADR. Operator commands
never write Core-derived fields, and no path lazily provisions a row. The pure reducer stays
tenant-free. `jarvis-runtime` stays persistence-neutral, and conversation control never becomes
business, financial, approval or Core authority.
