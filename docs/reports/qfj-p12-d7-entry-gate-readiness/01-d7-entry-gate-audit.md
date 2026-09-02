# QFJ-P12 — D7 real-integration entry-gate readiness audit

**Verdict at the audited baseline `4d364f9`: `OWNER_ARCHITECTURE_REOPEN_REQUIRED`.**
**Current status after the owner ruling of 2026-09-02: `ARCHITECTURE AMBIGUITY RESOLVED` — and
`D7 ENTRY GATE NOT SATISFIED`.**

> **Read §0 first.** The ambiguity this audit found was real at the time it ran, and the finding below
> is preserved verbatim as the evidence that produced the ruling. The owner has since resolved it. **No
> implementation became legal as a result** — only the nomenclature is settled.

**Starting main:** `9fd7f449c3ed56535e4cd8381b7a794f56011859` (merge of PR #183 / D5)
**Scope:** qf-jarvis repository only. No Core, marketplace, OneDecore, n8n, Meta, provider, external
database or external repository was accessed. No re-audit of another project was performed.
**Nature:** docs-only readiness audit. No production code, no migration, no activation, no ADR.

D7 cannot be entered — but the reason is **not only** the external blockers. Two accepted qf-jarvis
documents disagree about what D7's entry conditions actually are, and that disagreement cannot be
resolved by an implementer without silently picking a side. The external blockers are recorded below
and would independently prevent D7 as well.

---

## 0. OWNER RULING / RESOLUTION — 2026-09-02

**The ambiguity recorded in §3 existed at the audited baseline `9fd7f449c3ed56535e4cd8381b7a794f56011859`
(audit head `4d364f9`). The owner chose the resolution AFTER this audit reported it.** Nothing below in
§3 has been rewritten to look as though it had always said this; the finding stands as the record of why
the ruling was needed.

**The ruling, as ratified:**

1. **D6 remains canonical.** It was **not** absorbed, superseded or retired by ADR-0137. ADR-0135's
   **D5 → D6 → D7 → D8** stands. D6 is the **Jarvis-side live integration/composition** slice for the
   adopted **S4/S5/S7** surfaces. **The external C-track does not substitute for it** — external
   capability/adoption (C1/C4/C6) and Jarvis integration/composition (D6) are different work, and
   neither completes the other.

2. **D7 ≠ S11.** D7 is the **narrower** milestone: real-integration certification of the
   **communication/execution subsystem**, covering D5, D6 and their applicable external prerequisites.
   **S11** is the broader **Aarohi-wide** certification, reached only after **S10** runtime composition.
   **D7 precedes S11 and does not replace it.**

3. **D8 ≠ S12.** D8 is separately governed staged activation of the **narrower** subsystem after D7.
   S12 is separately governed staged activation of the **full Aarohi runtime** after S11. **D8 does not
   authorize S12, and S12 does not follow merely because D8 occurred.**

4. **S8 and S9 do not gate D7.** They are **Aarohi runtime** prerequisites and remain mandatory for
   **S8 + S9 → S10 → S11 → S12**. The ruling changes only _which_ milestone they gate. **Neither is
   weakened and no substitute may be implemented for either**; both remain
   `BLOCKED_BY_EXTERNAL_AUTHORITY`.

5. **The corrected D7 entry gate:**

   > **D5 + D6 + applicable C3A + applicable C3B + C4/S5 + C5/S6 + C6/S7 → D7**

   with every prerequisite beneath those C slices preserved, and **D6 itself requiring the externally
   adopted capabilities it integrates**. S8/S9 are deliberately absent.

6. **The D5 permission/registry problem is NOT fixed here.** ADR-0142 remains authoritative and every
   fact in §2 is unchanged: no grant on `qf_jarvis.event`, no widened role, no registry entry, no
   activation, no change to migration `0013`, no migration `0014`. **The correct permission design is
   reviewed as part of the future live-integration/activation path**, not here.

### What the ruling did NOT change

**Every external blocker in §4 remains exactly as recorded.** C0, C1, C2, C3A, C3B, C4/S5, C5/S6,
C6/S7, S8 and S9 are all still unproved or externally blocked. **No runtime implementation became legal
because the nomenclature was settled** — resolving what D7 _means_ did not produce any of the facts D7
_requires_.

**Outcome after the ruling:** the audit's `OUTCOME C` is discharged. The posture is now
**`OUTCOME B` — `D7_BLOCKED_EXTERNAL_PREREQUISITES`**: the architecture is internally consistent, and
the required authoritative external inputs are not proved.

---

## 1. The completed Jarvis chain — verified merged

| Slice | PR   | Merge commit | ADR      | ADR status                     |
| ----- | ---- | ------------ | -------- | ------------------------------ |
| D2    | #178 | `fb23e46`    | ADR-0137 | Accepted / MERGED              |
| D2a   | #179 | `2027d32`    | ADR-0138 | Accepted / MERGED              |
| D4    | #180 | `182a9cb`    | ADR-0140 | Accepted / MERGED              |
| D2b   | #181 | `88ddab5`    | ADR-0139 | Accepted / MERGED              |
| D3    | #182 | `f4bfe67`    | ADR-0141 | Accepted / MERGED              |
| D5    | #183 | `9fd7f44`    | ADR-0142 | Accepted — implemented offline |

No accepted decision in this chain is reopened by this audit.

---

## 2. D5 posture — proved from source, not prose

| Claim                                                   | Evidence                                                                                         | Result                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Exactly six V2 states                                   | `communication-state-record-v2.ts:72` `COMMUNICATION_STATE_RECORD_V2_STATES`                     | `rejected, authorized, provider-accepted, delivered, read, failed` — **6** |
| D4 production importer count                            | tracked non-test source scan                                                                     | **exactly 1**                                                              |
| That importer is the D5 handler                         | `projections/handlers/communication-state.ts`                                                    | **confirmed**                                                              |
| `rm_communication_state` exists                         | migration `0013`                                                                                 | **confirmed**                                                              |
| Migration inventory                                     | `migrations/*.sql`                                                                               | **13** files, `0001`–`0013`                                                |
| D5 in production registry                               | `production-registry.ts:36` lists `eventTypeActivity`, `dailyEventAcceptance`, `subjectActivity` | **ABSENT**                                                                 |
| `communicationStateProjection` referenced in production | repo-wide scan                                                                                   | **only its own definition** — nothing composes it                          |
| `state-recorded@3`                                      | repo-wide scan                                                                                   | **none**                                                                   |
| V1 → V2 conversion                                      | repo-wide scan                                                                                   | **none**                                                                   |
| `ProjectionEvent`                                       | `projection-definition.ts`                                                                       | `position`, `eventType`, `eventVersion`, `acceptedAt` — **metadata-only**  |

### The D5 activation blocker, confirmed at source level

Migration `0013` contains exactly **one** `GRANT` statement:

```sql
GRANT SELECT, INSERT, UPDATE ON qf_jarvis.rm_communication_state TO qf_jarvis_projection_runtime;
```

There is **no grant on `qf_jarvis.event`**. The D4 reader selects `event_id`, `source` and `payload`,
and the projection role holds none of them. **The projection role therefore cannot execute this
projection**, deliberately (ADR-0142). Nothing was granted by this audit.

This is the sharpest available proof that D5 is implemented but not live: even with a registry entry,
the runtime role would fail on the first read.

---

## 3. The architecture conflict — AS FOUND at head `4d364f9` (historical; resolved by §0)

> **This section is preserved as the evidence that produced the owner ruling.** It describes the
> repository as it stood when the audit ran. The conflicts below are **resolved** — see §0 — and the
> reconciled documents now carry dated owner-ruling clarifications.

### 3.1 What each accepted document actually says

**ADR-0135 §11 (Accepted) — the owning decision for the D-sequence:**

> **D5** tiered projection → **D6** S4/S5/S7 integration per ADR-0132 → **D7** certification →
> **D8** staged activation.

**`communication-state-projection-v2-design.md` (graph, lines 544–556)** agrees:

```
D5 --> D6 --> D7
D7 -.owner decision, not a dependency.-> D8
```

**ADR-0137 (Accepted, later) and `qfj-p10-core-protocol-event-adoption-plan.md` §6:**

```
D5 --> D7
C3A --> D7
C3B --> D7
D7 -.owner decision.-> D8
```

> **Live-integration gate:** **C3A / C3B / C4 / C5 / C6 as applicable, PLUS D5**, must all land before
> **D7** real-integration certification; **D8** activation stays separately governed.

### 3.2 Conflict 1 — D6 exists in one accepted ADR and is absent from another

Mentions of `D6`, counted:

| Document                                       | Owning ADR | `D6` mentions             |
| ---------------------------------------------- | ---------- | ------------------------- |
| ADR-0135                                       | ADR-0135   | **1** (the §11 sequence)  |
| `communication-state-projection-v2-design.md`  | ADR-0135   | **2** (graph node + edge) |
| ADR-0137                                       | ADR-0137   | **0**                     |
| `qfj-p10-core-protocol-event-adoption-plan.md` | ADR-0137   | **0**                     |
| ADR-0142                                       | ADR-0142   | **0**                     |

ADR-0135 makes **D6 a required slice between D5 and D7**. ADR-0137 neither schedules D6 nor retires
it — it simply does not exist there, and its gate sentence names only C-track slices plus D5.

**This is not a harmless omission.** D6 is _"S4/S5/S7 integration"_ — **Jarvis-side** work integrating
those transports. ADR-0137's mapping (`C1→S4, C4→S5, C5→S6, C6→S7`) shows C4 and C6 are the
**Core-side** slices for S5 and S7. Core-side adoption and Jarvis-side integration are different work
and cannot substitute for one another. So ADR-0137's gate does not cover what D6 covered, and no
document withdraws D6.

**A reader following ADR-0135 concludes D7 needs D6. A reader following ADR-0137 concludes it does
not.** Both documents are Accepted.

### 3.3 Conflict 2 — S8/S9 are mandatory in one sequence and dangling in the other

**`aarohi-real-execution-integration-plan.md` (ADR-0132's plan), graph lines 144–155:**

```
S3 --> S8      S6 --> S10     S8 --> S10     S10 --> S11
S3 --> S9      S7 --> S10     S9 --> S10     S11 -.owner decision, not a dependency.-> S12
```

S8 and S9 are **hard prerequisites** of S10, and S10 is a hard prerequisite of S11 certification.

**`qfj-p10-core-protocol-event-adoption-plan.md` §6 graph:** S8 and S9 appear as nodes with inbound
edges (`C1 --> S8`, `C1 --> S9`) and **no outgoing edge at all**. They terminate. D7's only inbound
edges are `D5`, `C3A`, `C3B`.

There is also **no S10 (runtime composition) node anywhere in the D-graph**, though the S-graph makes
composition a mandatory step before certification.

### 3.4 Conflict 3 — the D↔S mapping deliberately stops one row short

ADR-0137 supplies the mapping table that exists precisely to reconcile the two nomenclatures:

> Mapping to ADR-0132: C1→S4, C4→S5, C5→S6, C6→S7, S8→GAP A, S9→GAP B.

It maps every C-slice to its S-number. It **does not map D7→S11 or D8→S12.** The one artifact whose
job is to answer "are these the same milestone?" declines to answer for exactly the two milestones
this audit is about.

### 3.5 Answers to the five questions posed

**A. Are D7 and S11 the same certification milestone?**
**UNDETERMINED — `ARCHITECTURE_AMBIGUITY_REQUIRES_OWNER_DECISION`.** The circumstantial case is
strong: identical names ("real-integration certification"), identical position, and an identical
dotted "owner decision, not a dependency" edge to a separately-governed activation. But **no accepted
document states the equivalence**, and the mapping table that covers C1–C6 omits this row. Inferring
it from numbering is exactly what this audit was instructed not to do.

**B. Are D8 and S12 the same activation milestone?**
**UNDETERMINED**, for the same reason and with the same evidence. Both are "staged activation",
separately governed, reached by a non-dependency owner decision. Not stated anywhere.

**C. Are S8 and S9 mandatory before D7/S11 certification?**
**CONFLICTING.** Under ADR-0132's graph: **yes**, unambiguously (S8→S10→S11). Under ADR-0137's graph
and gate sentence: **not required, not even connected**. The answer is entirely determined by the
answer to (A), which is itself undetermined.

**D. Could a narrower communication-only D7 exist independently of S8/S9?**
**Plausible, and unstated.** This is the most charitable reconciliation: D7 certifies the
communication path (D5 + C3A/C3B), while S11 certifies the whole Aarohi runtime (which additionally
needs S8/S9 via S10). Both graphs would then be locally correct.

**But this reading does not dissolve Conflict 1.** D6 is _transport and result integration_ — squarely
inside the communication scope — so even a communication-only D7 still requires D6 under ADR-0135, and
ADR-0137's gate still omits it. The charitable reading resolves the S8/S9 question and leaves the D6
question untouched.

**E. Does accepted documentation already answer this, or is there a real inconsistency?**
**There is a real inconsistency**, on Conflict 1 independently of how (A) is resolved. Conflicts 2 and
3 are resolvable _if_ the owner rules on (A), but no document rules on it today.

---

## 4. External prerequisites — classified from repository evidence only

No external system was contacted. Every classification below cites merged qf-jarvis text.

| Prerequisite                                 | Classification                                   | Repository evidence                                                                                                 |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| C0 Core applied-state verification           | `BLOCKED_BY_EXTERNAL_AUTHORITY`                  | ADR-0137: must precede any reliance on event/outbox; Core-governed                                                  |
| C1 Core authorization adoption (S4)          | `EXTERNAL_PREREQUISITE_NOT_PROVEN`               | ADR-0137 Core-track graph; no landing evidence                                                                      |
| C2 canonical event/outbox publication        | `EXTERNAL_PREREQUISITE_NOT_PROVEN`               | ADR-0136: envelope is "inert types only", "definitively not wired" to `domain_events`/`outbox_events`               |
| C3A `authorization-recorded` emission        | `EXTERNAL_PREREQUISITE_NOT_PROVEN`               | ADR-0139 §197 and ADR-0141 §192: "neither has landed"                                                               |
| C3B `result-recorded` emission               | `EXTERNAL_PREREQUISITE_NOT_PROVEN`               | as above; additionally gated on a Core result-contract-fit proof for `executionIntentId` / `executionResultId`      |
| C4 / S5 Core→n8n submission + durable fact   | `BLOCKED_BY_EXTERNAL_AUTHORITY`                  | ADR-0137: `execution-submitted` "stays unresolved pending S5"                                                       |
| C5 / S6 execution-time eligibility semantics | `BLOCKED_BY_EXTERNAL_AUTHORITY`                  | ADR-0137: denial artifact + lifecycle mapping `DEFERRED_TO_C5/S6`; adoption plan §219 marks the boundary **ABSENT** |
| C6 / S7 result reconciliation                | `BLOCKED_BY_EXTERNAL_AUTHORITY`                  | adoption plan §221: **ABSENT**                                                                                      |
| S8 / GAP A                                   | `BLOCKED_BY_EXTERNAL_AUTHORITY`                  | ADR-0136 §108 and §197: "GAP A and GAP B remain open, so S8 and S9 remain blocked exactly as ADR-0132 said"         |
| S9 / GAP B                                   | `BLOCKED_BY_EXTERNAL_AUTHORITY`                  | ADR-0136 §110: `vendors.status` still has no `ACTIVE`                                                               |
| D6                                           | `ARCHITECTURE_AMBIGUITY_REQUIRES_OWNER_DECISION` | present in ADR-0135, absent from ADR-0137                                                                           |
| Runtime composition (S10)                    | `ARCHITECTURE_AMBIGUITY_REQUIRES_OWNER_DECISION` | mandatory in the S-graph, has no node in the D-graph                                                                |

**No external system is claimed to have adopted, deployed or emitted anything.**

---

## 5. Uncomposed Jarvis capability inventory

Production importer counts from tracked, non-test source. "Composed" means an app (`apps/api`,
`apps/worker`) reaches it.

| Package                               | Implemented | Merged | Prod importers     | Composed by app   | Live-capable                               | Activated | External prerequisite                |
| ------------------------------------- | ----------- | ------ | ------------------ | ----------------- | ------------------------------------------ | --------- | ------------------------------------ |
| `communication-request-runtime`       | yes         | yes    | **0**              | no                | no                                         | no        | S4 transport (C1)                    |
| `communication-authorization-runtime` | yes         | yes    | **0**              | no                | no                                         | no        | S4 transport (C1)                    |
| `approval-runtime`                    | yes         | yes    | 15                 | **`apps/worker`** | no                                         | no        | none (pure)                          |
| `approval-core-adapter`               | yes         | yes    | 1                  | **`apps/api`**    | no — transport injected, protocol PROPOSED | no        | Core endpoint adoption               |
| `execution-intent-runtime`            | yes         | yes    | 1                  | **`apps/worker`** | no                                         | no        | C4 / S5                              |
| `execution-dispatch-runtime`          | yes         | yes    | 3 (pkg-internal)   | no                | no                                         | no        | C4 / S5                              |
| `postgres-execution-replay-store`     | yes         | yes    | 1 (pkg-internal)   | no                | no                                         | no        | C4 / S5                              |
| `execution-dispatch-composition`      | yes         | yes    | **0**              | no                | no                                         | no        | C4 / S5                              |
| `communication-lifecycle-runtime`     | yes         | yes    | **0**              | no                | no                                         | no        | C3B / C6                             |
| `event-ingestion`                     | yes         | yes    | **0**              | **no**            | no                                         | no        | C2 (no live Core emission to ingest) |
| D4 trusted evidence reader            | yes         | yes    | **1**              | no                | no                                         | no        | C3A / C3B                            |
| D5 communication-state projection     | yes         | yes    | 0 (not registered) | no                | **no — role lacks the grant**              | no        | C3A / C3B                            |
| `aarohi-agent`                        | yes         | yes    | **0**              | **no**            | no                                         | no        | S8 + S9 + S10                        |

**Composing any of the zero-importer packages now would violate an accepted gate**, because each is
waiting on a Core-side fact that the repository records as unproved. Nothing was composed by this
audit.

`apps/worker` production dependencies: `agent-runtime`, `approval-runtime`, `contracts`,
`control-plane-read-contract`, `event-backbone`, `execution-intent-runtime`, `model-gateway`,
`recommendation-runtime`, `riya-agent`.
`apps/api` production dependencies: `agent-runtime`, `api`, `approval-core-adapter`, `contracts`,
`event-backbone`, `jarvis-runtime`, `model-evaluation`, `model-gateway`, `model-gateway-composition`,
`postgres-approval-queue`, `postgres-conversation-state`, `prompt-registry`,
`riya-web-conversation-service`.

**`aarohi-agent` appears in neither list.**

---

## 6. S8 / GAP A readiness

**Status: `BLOCKED_BY_EXTERNAL_AUTHORITY`. Totally absent — not partially implemented.**

- **Consuming boundary:** the `AcquisitionCase` lifecycle in
  `packages/aarohi-agent/src/contracts/acquisition-case.ts`. It carries `caseRef` and `prospectRef` as
  **opaque refs** (`OPAQUE_REF`), which is exactly the shape a future correlation would bind — and
  exactly why it cannot self-correlate today.
- **Existing consumer:** none. `aarohi-agent` has **0 production importers**.
- **Why it cannot be built now:** ADR-0132 §163 requires proof "from a Core-authoritative fact, that a
  registered vendor is the same party as an existing governed acquisition case", and records that
  "every per-party Core read is keyed by a Core vendor id that Aarohi structurally does not hold".
  ADR-0136 §108 re-confirms no prospect ↔ vendor correlation exists at the pinned commit.
- **Structural refusal already in place:** `ELIGIBLE_NET_NEW → ['REFUSED', 'CLOSED']`. The lifecycle
  cannot manufacture `CONTACT_APPROVED`; the comment states a future adapter must bind the shared Core
  approval result first.
- **Substitutes remain forbidden:** phone, email, name, lead id, first match, shared string grammar,
  and caller-provided `caseRef`/`prospectRef` are all barred. The refs being opaque is what stops the
  last one from becoming a silent correlation key.

**Nothing may be implemented inside Jarvis ahead of the authoritative external fact**, because the
boundary's entire content _is_ the verification of that fact.

## 7. S9 / GAP B readiness

**Status: `BLOCKED_BY_EXTERNAL_AUTHORITY`. Bridge absent; the boundary is provably unreachable.**

The transition table (`acquisition-case.ts:95–110`), stated in full:

| From                       | Permitted targets                          |
| -------------------------- | ------------------------------------------ |
| `DISCOVERED`               | `ELIGIBILITY_PENDING`, `REFUSED`, `CLOSED` |
| `ELIGIBILITY_PENDING`      | `ELIGIBLE_NET_NEW`, `REFUSED`, `CLOSED`    |
| `ELIGIBLE_NET_NEW`         | `REFUSED`, `CLOSED`                        |
| `CONTACT_APPROVED`         | `REFUSED`, `CLOSED`                        |
| `AWAITING_CORE_ACTIVATION` | `REFUSED`, `CLOSED`                        |
| `HANDED_OFF_TO_ANISHA`     | _(none)_                                   |
| `REFUSED` / `CLOSED`       | _(none)_                                   |

**No state anywhere lists `AWAITING_CORE_ACTIVATION` as a target.** It is therefore **unreachable**
through `canTransition` — deliberately, pending a governed bridge that does not exist.

`completeCoreActiveHandoff` (`active-handoff.ts:146`) **is** the only public route into
`HANDED_OFF_TO_ANISHA`, and it gates on `current.state !== 'AWAITING_CORE_ACTIVATION'` **before**
reading the attestation, returning `CASE_NOT_AWAITING_ACTIVATION`. Combined with the table above,
`HANDED_OFF_TO_ANISHA` is currently **unreachable in practice**: a valid Core ACTIVE attestation
cannot promote a case that cannot lawfully reach the precondition state.

That is the correct posture. ADR-0136 §110 records Core has **no `ACTIVE` vendor status at all**.
**No local "active" boolean or status was invented, and none may be.**

---

## 8. D7 entry-gate matrix

`implemented` ≠ `integrated` ≠ `certified` ≠ `activated`.

| Gate                      | Owning slice          | Jarvis artifact                   | Current status                                                                             | Evidence                                     | External dependency           | Jarvis can proceed now? | Reason                                             |
| ------------------------- | --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------- | ----------------------- | -------------------------------------------------- |
| D5                        | QFJ-P09 D5 / ADR-0142 | handler + migration `0013`        | **implemented** (offline); not integrated, not certified, not activated                    | PR #183, `9fd7f44`                           | none for the offline slice    | **done**                | complete as scoped                                 |
| C3A                       | Core / ADR-0137       | consumes `authorization-recorded` | `EXTERNAL_PREREQUISITE_NOT_PROVEN`                                                         | ADR-0139/0141: "neither has landed"          | Core emission                 | **no**                  | Jarvis cannot adopt on Core's behalf               |
| C3B                       | Core / ADR-0137       | consumes `result-recorded`        | `EXTERNAL_PREREQUISITE_NOT_PROVEN`                                                         | as above + contract-fit proof outstanding    | Core emission                 | **no**                  | execution ids have no Core source                  |
| C4 / S5                   | Core / ADR-0132       | `execution-submitted` evidence    | `BLOCKED_BY_EXTERNAL_AUTHORITY`                                                            | ADR-0137: unresolved pending S5              | Core→n8n durable fact         | **no**                  | artifact undefined                                 |
| C5 / S6                   | Core / ADR-0132       | late-denial mapping               | `BLOCKED_BY_EXTERNAL_AUTHORITY`                                                            | plan §219 **ABSENT**; `DEFERRED_TO_C5/S6`    | Core decision surface         | **no**                  | no lawful graph edge exists                        |
| C6 / S7                   | Core / ADR-0132       | result reconciliation             | `BLOCKED_BY_EXTERNAL_AUTHORITY`                                                            | plan §221 **ABSENT**                         | Core reconciliation           | **no**                  | —                                                  |
| S8                        | QFJ-P12 / ADR-0132    | continuation boundary             | `BLOCKED_BY_EXTERNAL_AUTHORITY`                                                            | ADR-0136 §197                                | prospect ↔ vendor fact        | **no**                  | §6 above                                           |
| S9                        | QFJ-P12 / ADR-0132    | pre-activation bridge             | `BLOCKED_BY_EXTERNAL_AUTHORITY`                                                            | ADR-0136 §110, §197                          | authoritative party-live fact | **no**                  | §7 above                                           |
| **D6**                    | **ADR-0135**          | S4/S5/S7 integration              | **`ARCHITECTURE_AMBIGUITY_REQUIRES_OWNER_DECISION`**                                       | in ADR-0135 §11; **absent from ADR-0137**    | C1/C4/C6                      | **no**                  | existence disputed between accepted ADRs           |
| Runtime composition (S10) | ADR-0132              | compose Aarohi, default OFF       | **`ARCHITECTURE_AMBIGUITY_REQUIRES_OWNER_DECISION`**                                       | mandatory in S-graph; **no node in D-graph** | S8 + S9                       | **no**                  | prerequisites blocked _and_ applicability disputed |
| **D7 certification**      | ADR-0135 / ADR-0137   | —                                 | **`ARCHITECTURE_AMBIGUITY_REQUIRES_OWNER_DECISION`**, and independently externally blocked | §3 above                                     | all of the above              | **no**                  | entry conditions not agreed                        |
| **D8 activation**         | separately governed   | —                                 | **not reachable**; owner decision, never a dependency                                      | ADR-0135 §11; ADR-0137                       | D7                            | **no**                  | rollout OFF                                        |

---

## 9. Required negative proofs

| Proof                                           | Result                                | Method                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `qf.communication.state-recorded@3`          | **confirmed absent**                  | repo-wide scan                                                                                                                                                                                                                        |
| No V1 → V2 conversion                           | **confirmed absent**                  | repo-wide scan for conversion helpers                                                                                                                                                                                                 |
| D4 importer count exactly 1                     | **confirmed**                         | tracked non-test source scan                                                                                                                                                                                                          |
| D5 handler is that importer                     | **confirmed**                         | same scan                                                                                                                                                                                                                             |
| D5 absent from production registry              | **confirmed**                         | `production-registry.ts:36` lists three, none of them D5                                                                                                                                                                              |
| Aarohi production composition absent            | **confirmed**                         | `aarohi-agent` in neither app's dependency set                                                                                                                                                                                        |
| Aarohi rollout default-off                      | **confirmed**                         | `avg12-…:343` pins `rolloutAuthorityGranted: z.literal(false)`                                                                                                                                                                        |
| No provider credential reaches Aarohi           | **confirmed**                         | zero credential-shaped identifiers in `aarohi-agent` production source                                                                                                                                                                |
| No external-project source vendored             | **confirmed**                         | no marketplace/OneDecore/core package present                                                                                                                                                                                         |
| No OneDecore reference in production code       | **confirmed, with detail**            | two hits, both **protective denylists** — `privacy-scan.ts:59` `PRODUCTION_NAMES = ['quickfurno','onedecore']` and a `validate-plan.ts` denylist entry. OneDecore is named as a forbidden string to scan **for**, not as a dependency |
| No external DB project id as runtime dependency | **confirmed, with detail**            | the only `supabase.co` hits are generic hostname-family parsing and redaction in `database-config.ts`. No project ref is hardcoded                                                                                                    |
| No activation flag changed                      | **confirmed**                         | audit is docs-only                                                                                                                                                                                                                    |
| Migration count                                 | **13**, `0001`–`0013`; **none added** | directory listing                                                                                                                                                                                                                     |

---

## 10. Outcome — the options put to the owner, and the ruling that followed

**At head `4d364f9` this audit reported `OUTCOME C — OWNER_ARCHITECTURE_REOPEN_REQUIRED` and
deliberately did not choose an interpretation.** The candidate resolutions it put up are preserved
below as the record of what was decided between.

**The owner ruled on 2026-09-02 — see §0.** The ruling selected **Option 1a** (D6 stands) and
**Option 2b** (D7 is communication-only; D7 ≠ S11, D8 ≠ S12, S8/S9 do not gate D7). The
reconciling edits named in the three-step correction below have been applied to ADR-0135, ADR-0137,
the QFJ-P10 adoption plan, the Model-2 design and the Aarohi plan.

**The current outcome is `OUTCOME B — D7_BLOCKED_EXTERNAL_PREREQUISITES`.**

**Question 1 — does D6 still exist?**

- _Option 1a:_ D6 stands as ADR-0135 §11 requires. Then ADR-0137's gate sentence and §6 graph are
  **incomplete** and should name D6 between D5 and D7.
- _Option 1b:_ D6 was absorbed into the C-track and is withdrawn. Then **ADR-0135 §11 must record the
  withdrawal**, and the `communication-state-projection-v2-design.md` graph must drop the D6 node.
  Note this option leaves Jarvis-side integration of S4/S5/S7 with **no named owning slice**.

**Question 2 — is D7 the same milestone as S11?**

- _Option 2a:_ **Yes, identical.** Then S8 and S9 are **mandatory** D7 prerequisites (via S10), and
  ADR-0137's graph must gain `S8 → …→ D7`, `S9 → …→ D7` and a composition node.
- _Option 2b:_ **No — D7 is communication-only certification; S11 is Aarohi-wide.** Then both graphs
  are correct as drawn, and the fix is one explicit sentence saying so, plus two rows added to the
  ADR-0137 mapping table (`D7 → (narrower than) S11`, `D8 → (narrower than) S12`).

**Smallest correction for owner decision — docs/ADR only, no code:**

1. Add two rows to the ADR-0137 "Mapping to ADR-0132" table for **D7/S11** and **D8/S12**, stating
   equivalence or explicit non-equivalence.
2. Add one sentence to ADR-0137's live-integration gate recording whether **S8/S9** are D7
   prerequisites — the answer follows from (2) above.
3. Record the **D6** ruling in whichever ADR the owner chooses to amend, and align the
   `communication-state-projection-v2-design.md` graph with it.

**No ADR is created by this audit**, because no new architecture decision has been made — only an
existing disagreement identified. Whichever way the owner rules, an ADR amendment is the vehicle.

### The next Jarvis-only slice, after the ruling

**`D6` is the next named Jarvis live-integration slice on this path** — the ruling settles that it
exists and that it is Jarvis-side work no C slice performs.

**D6 is NOT presently implementable.** It integrates externally adopted capabilities, and **none of
those capabilities has been adopted**: C3A and C3B have not landed, and C4/S5, C5/S6 and C6/S7 are
externally blocked. There is nothing to integrate.

Accordingly, and until the external prerequisites actually land:

- **do not implement D6**;
- **do not implement D7**;
- **do not implement D8**;
- **do not implement S8**;
- **do not implement S9**;
- **do not compose Aarohi**;
- **do not activate anything.**

**When the external prerequisites land, run a fresh D6 ENTRY-GATE audit before implementing D6.**
That audit **must** include the **D5 runtime permission problem** recorded in §2 and ADR-0142: the
projection role holds no `qf_jarvis.event` access, so D5 cannot execute as merged, and the correct
permission design is a reviewed part of the live-integration/activation path — **not something to
fix opportunistically inside D6.**

**Do not widen D5. Do not create adapters, mock transports or synthetic evidence to close any gate
above.**

---

## 11. Gates

`format:check`, `lint --max-warnings=0`, `typecheck`, `build`, `check:dist-containment`,
`git diff --check` and the full unit suite were run in an isolated worktree at
`9fd7f449c3ed56535e4cd8381b7a794f56011859`. Doc links were resolved against the filesystem and every
cited line number was re-read at source.

Results: `build` OK · `typecheck` OK · `lint --max-warnings=0` **0 errors** · `format:check` OK ·
`check:dist-containment` OK · `git diff --check` clean · unit suite **11,107 / 11,110**.

Three artifacts are recorded so none is mistaken for a finding, and **none involved a source change**:

1. The first gate run failed with `TS2688: Cannot find type definition file for node`. A `git
worktree` shares `.git` but **not** `node_modules`; after `pnpm install --frozen-lockfile` the
   gates run normally.
2. Running the gates **concurrently with the unit suite** made `typecheck` fail on
   `from-a-handler-2-zz-d4-lint-probe.ts` — a **transient probe** the D4 containment suite writes,
   lints and deletes. `typecheck` caught it mid-flight. Re-run **serially: typecheck 0, lint 0.** The
   probe is confirmed absent afterwards and was never staged.
3. The three unit failures are all in `apps/api/src/tests/deployment-containment.test.ts`, the known
   Windows parallel-load flake. **73/73 in isolation.** Unrelated and untouched.

**No test, timeout or assertion was weakened.**

### Gates re-run after the 2026-09-02 owner-ruling correction

The ruling correction is **documentation only** — seven markdown files, no source, no SQL, no migration.
Gates were re-run **serially** at the correction head: `format:check` **0** · `build` **0** ·
`typecheck` **0** · `lint --max-warnings=0` **0** · `check:dist-containment` OK · `git diff --check`
clean · unit suite **11,107 / 11,110**.

The three unit failures are again `apps/api/src/tests/deployment-containment.test.ts`, the known
Windows parallel-load flake — **73/73 in isolation**, unrelated and untouched. **No assertion, timeout,
lint policy or containment boundary was weakened to obtain any of these results.**

---

## 12. Scope statement

No production code, migration, registry entry, grant, activation flag or contract was changed. No
migration was allocated; the inventory remains `0001`–`0013`. **Production rollout remains OFF.** No
QuickFurno repository, Supabase project, OneDecore system, n8n workflow, Meta or provider endpoint,
external database or external repository was accessed, and no model call was made.

**ARCHITECTURE AMBIGUITY RESOLVED — D7 ENTRY GATE NOT SATISFIED — DO NOT IMPLEMENT OR ACTIVATE.**
