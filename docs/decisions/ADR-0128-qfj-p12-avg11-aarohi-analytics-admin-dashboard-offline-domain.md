# ADR-0128 — QFJ-P12 / QVGE / AVG-11: the Aarohi ANALYTICS, ADMIN READ and DASHBOARD OFFLINE DOMAIN

- **Status:** Accepted (offline domain only; runtime PLANNED / DISABLED)
- **Owner phase:** QFJ-P12 — Aarohi Vendor Growth and Acquisition
- **Overlay stage:** AVG-11 — Analytics, Admin APIs and Full Dashboard
- **Certified qf-jarvis baseline:** `7bb65d785d8d7b81d87df91ab913500737e1dd56` (PR #169 / AVG-10 merge)
- **QuickFurno marketplace:** not inspected for this stage, and not needed. AVG-11 reads no Core
  surface, mirrors no Core shape and adds no Core-derived vocabulary; ADR-0127 already recorded the
  audit that establishes there is no prospect-facing Core read to reach.
- **Supersedes:** nothing
- **Related:**
  [ADR-0085](ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (governing
  architecture, the acquisition-case lifecycle and the ACTIVE handoff),
  [ADR-0086](ADR-0086-jos-01b-read-only-control-plane-contract-and-snapshot-api.md) (the read-only control-plane
  contract and snapshot API this stage extends),
  [ADR-0089](ADR-0089-jos-01e-progressive-backend-read-source-composition-boundary.md) (progressive read sources),
  [ADR-0126](ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md),
  [ADR-0127](ADR-0127-qfj-p12-avg10-aarohi-payment-activation-handoff-offline-domain.md)

---

## Context

The canonical overlay sentence for this stage, in full:

> **AVG-11 — Analytics, Admin APIs and Full Dashboard.** Funnel analytics, administrative read APIs
> and the complete Jarvis OS Aarohi surface. Read-oriented; the Jarvis OS section stays `PLANNED`
> until an activating ADR says otherwise.

### The failure this stage is designed against

**We prepared forty registration briefs, so forty vendors registered.**

Ten stages of this overlay exist to keep evidence apart from authority. AVG-9 is careful that a
prepared brief is assistance and not a registration. AVG-10 is careful that a payment fact is not an
activation fact. AVG-1 is careful that only QuickFurno Core may attest that a party is ACTIVE.

Analytics is where all of that gets flattened into numbers — and a number loses its provenance the
instant it is rendered. `40` under a heading is `40`, whatever the heading was careful about. The
second failure is quieter and worse: a `0` next to _Active vendors_ when the truth is _nobody has
connected Core_. The first reads as a business result; the second reads as a business result too,
and an operator has no way to tell either from the honest thing.

A third failure is specific to dashboards: they attract infrastructure. A funnel wants a table, a
table wants a migration, a trend wants an event stream, and none of that is authorized by an overlay
line that says "read-oriented".

---

## Decision

### 1. The domain lives in `@qf-jarvis/aarohi-agent`, and nothing imports it

`packages/aarohi-agent/src/contracts/avg11-analytics-admin-dashboard.ts` holds the whole analytics
model: the funnel vocabulary, the authority distinction, the counting rules and one pure builder.
The package still depends on **zod alone**, still imports no `@qf-jarvis` package, and is still
imported by **no package and no application** — a property `containment.test.ts` asserts by walking
the repository.

That last constraint decided the shape of everything below. Jarvis OS cannot import the domain, so
the wire contract cannot either; both therefore state the funnel vocabulary independently, and a
spec compares the two lists token for token. This is the same trade `compose.ts` already makes for
the canonical-instant grammar, and the alternative — a workspace dependency from a Next.js
application into the acquisition domain — would have made the first consumer of Aarohi an accident
rather than a decision.

### 2. A stage is DERIVED from certified evidence, never named by a caller

`AAROHI_FUNNEL_STAGES` is closed and contains nine members:

| Stage                                  | Certified by                         | Authority                 |
| -------------------------------------- | ------------------------------------ | ------------------------- |
| `PROSPECT_IDENTIFIED`                  | `createProspectIdentity` (AVG-1)     | `JARVIS_WORKFLOW_DERIVED` |
| `ELIGIBILITY_EVALUATED`                | the AVG-1 gate, re-run               | `JARVIS_WORKFLOW_DERIVED` |
| `ELIGIBLE_NET_NEW`                     | the AVG-1 gate returning eligible    | `JARVIS_WORKFLOW_DERIVED` |
| `OUTREACH_WORKSPACE_PREPARED`          | `parseWorkspaceDraft` (AVG-4)        | `JARVIS_WORKFLOW_DERIVED` |
| `CONVERSATION_OBSERVED`                | `parseInstagramConversation` (AVG-5) | `JARVIS_WORKFLOW_DERIVED` |
| `COMMERCIAL_CONTEXT_PREPARED`          | AVG-8's brief parser                 | `JARVIS_WORKFLOW_DERIVED` |
| `REGISTRATION_ASSISTANCE_PREPARED`     | AVG-9's brief parser                 | `JARVIS_WORKFLOW_DERIVED` |
| `PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED` | AVG-10's brief parser                | `JARVIS_WORKFLOW_DERIVED` |
| `CORE_ACTIVE_HANDOFF_CONFIRMED`        | `completeCoreActiveHandoff` (AVG-1)  | `CORE_AUTHORITATIVE`      |

There is no `REGISTERED`, `PAID`, `ACTIVE`, `CONVERTED`, `WON`, `CHURNED`, `CONTACTED`, `DELIVERED`,
`REPLIED` or `QUALIFIED` stage. `CONTACTED` is the absence a reader will look for: nothing in this
repository can send, so nothing can be contacted. AVG-4 prepares a DRAFT and AVG-5 observes an
INBOUND message, and those are the two facts, stated as themselves.

The stage an artifact counts for is **derived**. Each submitted value is handed to the certified
sibling parsers, and the stage follows from which one certifies it. Exactly one must: a value
recognised by none is `EVIDENCE_UNRECOGNISED` and a value recognised by more than one is
`EVIDENCE_AMBIGUOUS` — refused rather than resolved by precedence, because two certified parsers
accepting one payload is a governance defect and picking a winner would hide it.

So a caller cannot label a payment brief as a registration. To be counted as one it would have to
parse as an AVG-9 brief, and the strict schemas do not overlap.

### 3. Metric AUTHORITY is a third concept, kept apart from the two that already exist

`AAROHI_METRIC_AUTHORITIES` is `JARVIS_WORKFLOW_DERIVED`, `CORE_AUTHORITATIVE`,
`AUTHORITY_UNAVAILABLE`.

This is deliberately **not** `SectionAvailability` (can this whole panel be read?) and **not**
`SnapshotSource` / `Provenance` (where did this payload come from?). Those describe a transport;
this describes who is entitled to be believed about one figure. Collapsing three concepts into one
generic status is exactly how "Core is not connected" comes to render as "none", so the three stay
three, in the domain, on the wire and in the read model.

`AAROHI_STAGE_AUTHORITY` is a TOTAL map from stage to class. A stage added without an entry does not
compile, so no stage can arrive with its authority left to a default, and the single
`CORE_AUTHORITATIVE` entry is visible on one line. A caller supplies neither the stage nor the class.

### 4. The terminal metric re-runs AVG-1's own function

`CORE_ACTIVE_HANDOFF_CONFIRMED` is not counted from an artifact. The caller supplies an acquisition
case and Core's attestation, and AVG-11 calls **`completeCoreActiveHandoff`** — unchanged, unwrapped,
not duplicated and not composed — and counts only what that function itself confirms.

Everything AVG-1 refuses is therefore refused here, provably and without restatement: a
`PROVIDER_RECEIPT`, a `MODEL_INFERENCE`, a `CONVERSATION_CLAIM` and an `AGENT_CASE_STATE` are each
driven and rejected by a spec, as is a case supplied already sitting at `HANDED_OFF_TO_ANISHA` and a
case at any state other than `AWAITING_CORE_ACTIVATION`. AVG-1's own refusal reason is surfaced
rather than flattened.

The function is pure, so calling it transitions nothing: the case it returns is read for an identity
and discarded, and a spec asserts the supplied case is byte-identical afterwards.
`acquisitionCaseMutated: false` says it again on every report. `acquisition-case.ts` and
`active-handoff.ts` are **unchanged by this stage**, and `ELIGIBLE_CORE_STATUSES` remains exactly
`NOT_REGISTERED`.

### 5. UNKNOWN is not ZERO — and the unavailable metric has no field to hold a zero in

`AarohiFunnelMetric` is a discriminated union on `authority`. The two readable variants carry
`distinctProspects`; the unavailable variant carries `expectedAuthority` and a reason and **has no
count key at all**.

That is the difference between a rule and a shape. "Do not render unknown as zero" is a rule a
mapper can forget, a client can default around and a `?? 0` can quietly break. There being no number
present is a shape: `stage.value` does not compile without narrowing, `Object.hasOwn(metric,
'distinctProspects')` is `false`, and a serialized unavailable report contains no zero to misread.

The same union is carried on the wire (`funnelStageSchema`) and in the Jarvis OS read model
(`FunnelStage`), and the UI mapper carries it across branch by branch rather than spreading it — a
spec asserts the mapper contains no `stage.value ?? 0` and no `value: 0`.

Whether a source was read is the one fact a pure function genuinely cannot derive: an empty array
looks identical either way. So the calling boundary declares it per authority CLASS
(`OBSERVED` / `NOT_OBSERVED`), and stating it falsely in the dangerous direction is refused —
evidence of a class declared unobserved is `EVIDENCE_SUPPLIED_FOR_UNOBSERVED_SOURCE` rather than a
silent upgrade. `OBSERVED` with nothing found is a genuine zero and is reported as one.

### 6. No rate, and that is a decision rather than an omission

There is no rate, ratio, percentage, conversion or trend field anywhere in this stage, and no
function computes one.

A conversion rate needs a numerator and a denominator that are known, compatible and drawn from one
cohort. Across an authority boundary none of those hold: a Jarvis-derived numerator over a
Core-authoritative denominator compares work done with business truth, and either over a source
nobody read has no denominator at all. Every rate this stage could offer would be one of those, so
counts and availability are the whole safe answer and therefore the whole answer.
`conversionRateCalculated: false` and `revenueReported: false` pin it, and specs scan the report's
keys rather than its serialized text — `registration` contains `ratio`, and a scan that has to be
weakened to pass proves nothing.

No revenue, CAC, LTV, ROI, ARPU, amount, currency or discount appears either.

### 7. No time, no cohorts, no series

No durable event source exists for any of this evidence. There is nothing to bucket by hour or week
and no honest way to say a stage grew, so there is no window, no `since`, no `until` and no series.

A report carries one instant of its own, `preparedAt`, which is checked against the evidence it rests
on — a report claiming to predate an AVG-9 brief's `preparedAt`, an AVG-4 draft's `changedAt` or a
conversation's newest inbound turn is `REPORT_PREDATES_EVIDENCE` — and used for nothing else. No
clock is read anywhere in the package.

### 8. Deterministic counting

A stage's number is the size of the set of **distinct prospect references** with at least one
certifying artifact for it. Counting prospects rather than artifacts is what makes duplicate evidence
structurally non-inflating: one brief submitted three times, or two different briefs for one
prospect, is one prospect either way, because a set has no room for the second copy.

Every check scans the WHOLE input before the next is considered, in a fixed order, so shuffling the
evidence cannot change which refusal is returned or what a report contains. Where one check could
fire for several items — a handoff refusal — the reported reason is chosen by the fixed declaration
order of `HANDOFF_REFUSAL_REASONS`, never by position. Metrics are emitted once per stage in
`AAROHI_FUNNEL_STAGES` order, always all nine, and the parser refuses any other order or arity.

One evidence identity presented for two prospects is `EVIDENCE_IDENTITY_CONFLICT`. Identity is scoped
per KIND, because a draft and a conversation that happen to share a reference string are two
identities rather than one conflict. Cross-prospect mixing inside the one composite evidence shape —
an attestation about a different party than the case — is refused by `completeCoreActiveHandoff`
itself.

### 9. Data minimization: the report is aggregate, and has nowhere to put anything else

A report carries `contractVersion`, `reportRef`, `preparedAt`, `sourcePosture`, `evidenceSources`,
`metrics`, `outcome` and `posture` — an exact key set a spec asserts. There is no prospect reference,
case, draft, conversation, message, brief reference, Core lookup, package, amount, name, handle or
destination in it. Evidence is read, counted and discarded inside one pure function; the AVG-4 draft
body and the AVG-5 message bodies are parsed by their owners and never touched by this module.

`reportRef` is the one identity AVG-11 introduces, and it carries the local screen every stage since
AVG-7 has applied: no address, no fetchable location, and no run of seven or more digits.

### 10. The canonical Jarvis OS seam is REUSED

The existing versioned read-only snapshot API is extended. Specifically:

- `packages/control-plane-read-contract` gains the closed funnel-stage vocabulary, the metric
  authority distinction, the discriminated `funnelStageSchema`, an `AAROHI_FUNNEL_STAGE_AUTHORITY`
  map enforced centrally in the snapshot parser, and one new section,
  `sections.aarohiAcquisitionReadiness`.
- `apps/jarvis-os` gains the matching read-model types, one baseline section, one mapper branch, and
  the readiness panel on the existing `/agents/aarohi` page.

**No second dashboard. No second API namespace. No standalone Aarohi server. No parallel
control-plane or DTO stack.** The route set is still exactly three files and the snapshot route still
exports `GET` alone — in the Next.js App Router an unexported method is answered `405` by the
framework, so the absence is the enforcement.

`CONTROL_PLANE_READ_CONTRACT_VERSION` stays `'1'`. The change TIGHTENS V1 rather than widening it: a
funnel stage must now name a certified stage and carry an authority, which is a constraint no
existing producer violates because the only producer in the repository emits no funnel stages at all.
The package root still exports exactly four runtime symbols; everything added is a type or an
internal schema.

### 11. The Aarohi surface is completed as a READ surface, and stays PLANNED

The `/agents/aarohi` page previously carried four hand-written empty panels. Every sentence in them
was true and none of it came from anywhere — a contributor could have edited the text without editing
a fact, and a reader had no way to tell a designed empty state from a stale one.

They are replaced by one READINESS section read through the same `controlPlane()` seam as everything
else, at `STATIC_BASELINE`, carrying fourteen rows: eight offline domains, two authority boundaries
and four blockers. Readiness carries no number and no authority class, because it says what EXISTS
rather than how much of it there is; `HealthState` already spells both.

The blockers are the reason the section is worth having. ADR-0127 deliberately did not build the
post-registration continuation boundary or the bridge into `AWAITING_CORE_ACTIVATION`, and a surface
that simply omitted them would read as complete. Stating an absence is the only way an operator can
tell a missing feature from a missing panel. **This ADR does not build either bridge.**

The funnel section stays `PLANNED` with **no stages at all**, and its reason now says both halves of
the truth: the AVG-11 read surface is merged, and no evidence source is connected. The Aarohi agent
lifecycle stays `PLANNED`, the capability stays `PLANNED`, and the page carries **zero** action
controls — no `<button>`, no `<form>`, no `<input>`, no `onClick`, no client component, and none of
Contact, Send, Approve, Mark Registered, Mark Paid, Activate, Handoff, Assign Package, Grant Credits
or Retry Payment. A spec scans the page source for each.

The global analytics page is untouched and stays non-commercial.

### 12. No live data stack

Zero Supabase clients, SQL statements, migrations, analytics tables, Core HTTP calls, provider or n8n
calls, workers, queues and schedulers. Zero new third-party dependencies and zero lockfile delta.
`aarohi-agent` remains zod-only, `jarvis-os` gains no dependency, and the repository baseline
truthfully states that the READ SURFACE exists while live funnel data remains `PLANNED` and
`NOT_CONNECTED`.

---

## Mutation findings

Every mutation below was applied to the working tree, the affected suite was actually executed, and
the file was restored byte-identically (verified by SHA-256 against the pre-mutation digest, not by
git). Twenty-one mutations; **one survived the first pass**, and the gap it exposed was closed.

### The survivor, and what it was really about

Mutation 20 inserted `const AUTONOMY_LEVEL = 1;` into the AVG-11 contract and the suite stayed green.
The containment scan forbade the token `autonomy` with a case-SENSITIVE `toContain`, so it banned one
spelling of a capability rather than the capability. A contributor introducing AVG-12 autonomy would
almost certainly write a constant in `UPPER_SNAKE`, which is precisely the casing the scan missed.

The AVG-12 vocabulary check is now case-insensitive and separator-tolerant, and the mutation was
re-driven in four casings — `AUTONOMY_LEVEL`, `auto_outreach`, `learnedPolicy`,
`SelfOptimisingFunnel` — each of which is now caught. Final survivors: **0**.

| #   | Mutation                                                            | Caught by                                                                 |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | AVG-9 brief counted as a registration outcome                       | funnel-vocabulary and workflow-versus-outcome specs                       |
| 2   | AVG-10 brief counted as a confirmed Core handoff                    | authority-ownership refine and workflow-versus-outcome specs              |
| 3   | A case at `AWAITING_CORE_ACTIVATION` counted without an attestation | substitute-authority and terminal-case specs                              |
| 4   | The canonical handoff's refusal ignored                             | substitute-authority specs                                                |
| 5   | The metric authority refine removed from the report schema          | strict-schema specs                                                       |
| 6   | An unavailable metric given `distinctProspects: 0`                  | unknown-is-not-zero specs                                                 |
| 7   | The baseline readiness section marked `NOT_CONNECTED` with rows     | the contract's "unreadable is not empty" invariant                        |
| 8   | A `conversionRate` field added to the report                        | strict-schema, key-scan and containment specs                             |
| 9   | Counting artifacts instead of distinct prospects                    | duplicate-inflation specs                                                 |
| 10  | The handoff refusal chosen in input order                           | order-independence specs                                                  |
| 11  | Metrics emitted in reverse stage order                              | canonical-order specs                                                     |
| 12  | The identity-conflict check removed                                 | mixed-identity specs                                                      |
| 13  | `metrics` accepted from the caller                                  | envelope-strictness specs                                                 |
| 14  | `.strict()` dropped from the report schema                          | unknown-field specs                                                       |
| 15  | A `prospectRefs` array added to the report                          | aggregate-only and key-set specs                                          |
| 16  | A `POST` handler added to the snapshot route                        | the route-set lock                                                        |
| 17  | A `fetch(` added to the AVG-11 contract                             | containment scans                                                         |
| 18  | A case-transition helper added to AVG-11                            | containment scans                                                         |
| 19  | Aarohi marked `AVAILABLE` in the baseline                           | lifecycle and readiness specs                                             |
| 20  | AVG-12 autonomy vocabulary introduced                               | **SURVIVED** the first pass; caught once the scan became case-insensitive |
| 21  | The AVG-11 roadmap entry reverted to "planned and unimplemented"    | roadmap-overlay specs                                                     |

---

## What AVG-11 deliberately does not do

- **It does not build the post-registration continuation boundary**, and it does not build the bridge
  into `AWAITING_CORE_ACTIVATION`. Both remain absent for the reason ADR-0127 gave, and both are now
  DISPLAYED as blockers rather than left invisible.
- **It does not widen the cold-acquisition gate.** `ELIGIBLE_CORE_STATUSES` is still exactly
  `NOT_REGISTERED`, and this stage neither restates nor reweighs it.
- **It does not add a second route into `HANDED_OFF_TO_ANISHA`**, wrap `completeCoreActiveHandoff`,
  or change `acquisition-case.ts` or `active-handoff.ts` in any way.
- **It does not start AVG-12.** No autonomy increase, self-optimizing funnel, auto outreach, dynamic
  policy tuning, scale orchestration, load rollout, learned decision policy or automatic promotion.
- **It does not connect anything.** No source is adopted; `ADOPTED_READ_SOURCES` is still empty.
- **It does not publish a rate**, a trend, a revenue figure or any commercial performance number.

---

## Consequences

Aarohi now has a complete, truthful operator surface and an analytics model that cannot state a
QuickFurno business outcome. The cost is that most of it reads as unavailable, which is correct: no
evidence source exists, and a surface that filled the gap would be the failure this whole overlay
keeps refusing.

The next real step for this stage is not more analytics. It is a governed read protocol — at which
point a reviewed `ReadSourceDescriptor` can populate the funnel through the seam JOS-01E already
built, and the authority classes, the dedup rules and the unknown-is-not-zero shape are already there
to receive it.

Aarohi's runtime remains **PLANNED / DISABLED**. Production rollout remains **OFF**. Only a future
activating ADR may change either.
