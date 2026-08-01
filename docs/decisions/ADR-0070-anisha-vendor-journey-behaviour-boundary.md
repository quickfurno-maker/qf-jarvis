# ADR-0070 — Anisha Vendor-Journey Behaviour Boundary

**Status:** Accepted — QFJ-S3-D-A (behaviour foundation; runtime composition deferred to S3-D-B)
**Deciders:** Owner
**Relates to:** [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration-foundation.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0066](./ADR-0066-shared-agent-runtime-execution-boundary.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0068](./ADR-0068-riya-authoritative-runtime-composition.md) · [ADR-0069](./ADR-0069-bounded-runtime-and-proposal-identifiers.md)

## Context

Riya is composed into the authoritative runtime. Anisha is the vendor half, and everything she needs
already exists: `VENDOR → ANISHA` assignment and the ANISHA↔VENDOR scope rule (ADR-0054), the
15-stage double-gated pipeline (ADR-0055), the generic behaviour seam (ADR-0068), provenance
(ADR-0066) and bounded identifiers (ADR-0069). What did not exist was any notion of _what a
vendor-journey turn is_.

### The governed name is "vendor journey", not "vendor care"

ADR-0067's S3-D handoff called this phase "vendor care" and described its intents as "issues, status
and fulfilment, not qualification". **Both were wrong**, and the S3-D Part 0 audit found no
occurrence of "vendor care" anywhere in governance except that sentence. The repository is explicit
and consistent:

- **ADR-0006 §1** — Anisha owns _acquisition, qualification, onboarding, profile completion,
  activation, package readiness, recharge, retention, upgrade, inactivity recovery, win-back_.
- **`agent-model.md:72`** — "Anisha — **the complete vendor journey**".
- **QFJ-P07 (`qf-jarvis-roadmap-v3.md:164,176`)** — "Anisha Vendor Journey", adding complaint intake,
  routine query resolution, vendor education, profile/portfolio/verification guidance and
  lead-response guidance.

Qualification and conversion are squarely hers. ADR-0067's handoff paragraph is corrected in this PR.

## Decision

### 1. Placement — a new leaf package

`@qf-jarvis/anisha-agent`, depending on `@qf-jarvis/agent-runtime` and `zod`. One-way:

```
anisha-agent  ->  agent-runtime public contracts
```

It is a sibling of `riya-agent` and never imports it: two bounded agents that could see each other
would be one agent with two names ([communication-model.md](../architecture/communication-model.md)
makes exactly that point about shared plumbing). It does not depend on `jarvis-runtime`,
`model-reply-adapter`, `model-gateway` or `core-decision-adapter`. It decides; S3-D-B composes.

### 2. Fixed role

`ANISHA_ACTOR = 'ANISHA'` and `ANISHA_SUPPORTED_PARTY = 'VENDOR'` are constants, not parameters. The
turn input has no `actor` field, so a caller cannot ask this package to speak as Riya or Jarvis, act
on a client, or assign itself. M1's routing, scope, vocabularies and policy are reused **unchanged** —
no agent-runtime production file was touched.

### 3. Vendor-journey intents — nine closed values

`UNSUPPORTED_NON_VENDOR_REQUEST` · `ESCALATION_REQUIRED_MATTER` · `HUMAN_VENDOR_SUPPORT_REQUEST` ·
`COMPLAINT_INTAKE` · `PACKAGE_OR_RECHARGE_READINESS` · `ONBOARDING_OR_PROFILE_GUIDANCE` ·
`LEAD_RESPONSE_GUIDANCE` · `ROUTINE_VENDOR_QUERY` · `INSUFFICIENT_CONTEXT`

Classification is **deterministic** and reads a closed set of booleans, one bounded count and one
governed band — never vendor text. **There is no confidence field.**

Ordering is by **safety, not likelihood**: out-of-scope, then escalation-required, then a human
request, then complaint, then the commercial signals. QFJ-P07 requires complex, disputed, sensitive,
financial, legal, fraud, high-risk and policy-exception matters to escalate; an agent that talked past
one of those while answering a package question is the failure this ordering prevents.

`LEAD_RESPONSE_GUIDANCE` is deliberately **not** merged into `ROUTINE_VENDOR_QUERY`. Helping a vendor
respond to leads they already hold is Anisha's; judging whether those leads were any good is Kabir's,
and ADR-0006 §3 names that exact slide as the failure bounded agents exist to prevent. One vocabulary
value is what keeps the boundary enforceable.

### 4. Money-adjacent signals are BANDS, never balances

`agent-model.md:78` and the authority matrix are explicit, and the band vocabulary is governed:
**`low` / `medium` / `high` / `critical`**.

A wallet figure copied into a Jarvis contract would be stale the moment it was written, and its mere
existence would invite somebody to reason about a real vendor's money from a copy nobody reconciles.
So `packageReadinessBand` is the only money-adjacent field in this package, and there is **no field a
balance, price, credit count, package cost, payment status or subscription object could occupy** —
which is a stronger guarantee than a rule saying not to add one.

Two further rules: a band may only accompany a package-related turn or an ongoing journey, and if the
signals and the context both name a band they must be **identical** — a disagreement throws rather
than being repaired, because choosing a side would mean deciding a vendor's position from a value
nobody reconciled.

### 5. Vendor-journey context — a snapshot, never a second vendor profile

Bounded opaque references for stage, onboarding step and verification status; the governed band; a
closed completeness state; a closed missing-field list. Core owns the vendor; this record references
Core-owned state and never copies it. No vendor name, phone, email, address, document, portfolio
content, verification result body, wallet, credits, balance, price, package catalogue, payment,
subscription, lead object, ranking, assignment, campaign data, free-text note or metadata bag.

Contradictions are refused: `SUFFICIENT_FOR_CORE_REVIEW` with fields still listed missing (a snapshot
that invites review while admitting it is incomplete), `MORE_CONTEXT_REQUIRED` with nothing listed
missing (a claim with no content), a duplicate missing field, and a field listed missing whose value
was nonetheless supplied (the record disagreeing with itself). `HUMAN_REVIEW_REQUIRED` permits any
number of missing fields: a person may need to look precisely because the picture is complete and
still wrong. An absent field need **not** be listed missing — relevance depends on the intent.

### 6. Five dispositions

`DRAFT_REPLY` · `CONTINUE_CLARIFICATION` · `PROPOSE_VENDOR_FOLLOW_UP` · `REQUEST_VENDOR_ESCALATION` ·
`REFUSE`

A follow-up may be **requested** only on a snapshot Core can review; absent context is not sufficient
context, so it continues clarification rather than proposing from a guess. A complaint is
**acknowledged and intaken only** — resolving it is Core's, and a reply promising a resolution would
be an outcome this agent cannot deliver.

### 7. `REQUEST_VENDOR_ESCALATION` is target-neutral, on purpose

Governance routes escalation to **Jarvis** (QFJ-P07); the merged M2 vocabulary offers
`ESCALATE_TO_HUMAN`. A behaviour kernel naming either would assert _which_ coordinator or person
executes — a routing decision this package does not own and cannot see. It states the **need**;
S3-D-B maps it to the M2 kind and documents that mapping. This package does not import or mention the
M2 proposal vocabulary at all.

### 8. Model eligibility is declarative

`modelReplyEligible` is an eligibility decision, not a call-budget enforcer, and this package invokes
nothing: there is no gateway, adapter, port or transport import through which a call could be made.
Process-wide at-most-one invocation remains owned by the merged `orchestrateInbound` pipeline and the
`ModelReplyPort` contracts (ADR-0055/0057/0068). `false` is returned on every pause, takeover,
role-violation, escalation and refusal path. No retry, no fallback, no refresh.

### 9. No M1 proposal helper

Riya's `createRiyaProposal`/`proposalKindFor` map onto the **M1** `RuntimeProposal` vocabulary and are
not called by the authoritative path (ADR-0068 §2). Adding an Anisha twin would double dead public
surface for visual symmetry alone, so none was added. A future real M1 consumer may add one under a
separate reviewed contract. This is also why the root API is **14** rather than Riya's 16.

### 10. QuickFurno Core remains the only business authority

Anisha may notice, classify, explain, acknowledge, continue clarification, request a Core-reviewed
follow-up, and request escalation. She may **not** approve, verify, activate or deactivate a vendor,
change eligibility, rank, assign a lead, score lead quality, mutate a profile or portfolio, upload or
approve documents, change or purchase a package, recharge a wallet, change credits, read or expose a
balance, process a payment, mutate a subscription, promise lead volume or ranking, communicate with
clients, inspect campaign performance, execute a follow-up, send a message, write a database, or call
n8n, WhatsApp or a provider. `agent-model.md:76` states the core of that list in those words. The
package contains no method or field through which any of it could happen.

### 11. Prompt boundary

One bounded, versioned, opaque `promptRef` (≤128 identifier characters). The decisive proof is
contractual: the field accepts **only** a bounded opaque reference, and this PR introduces **no
production prompt text** anywhere. The grammar's rejection of spaces is a secondary bound, not by
itself a proof of semantic secrecy.

## Rejected alternatives

- **"Vendor care" as the domain name.** Not a governed term, and it excludes qualification and
  conversion, which ADR-0006 and QFJ-P07 give to Anisha.
- **Merging lead-response guidance into routine queries.** Erases the Kabir boundary (ADR-0006 §3).
- **`REQUEST_HUMAN_VENDOR_SUPPORT` as the disposition name.** Names an executor the kernel cannot see.
- **A balance, credit or price field, even "read-only".** The authority matrix forbids it, and a field
  that exists will eventually be filled.
- **Copying Riya's discovery fields.** Service, location, property, budget and timeline describe a
  client requirement; a vendor journey is a different thing.
- **An M1 proposal helper for symmetry.** Dead surface.

## Consequences

Anisha can classify a vendor-journey turn, record where a vendor stands, and declare what should
happen next — without any ability to act. Every existing API lock is unchanged; the new package is
locked at 14 root runtime symbols.

## Phase status

This ADR records **S3-D-A: the Anisha behaviour foundation**. **S3-D overall is partial.** Nothing
imports `@qf-jarvis/anisha-agent`: no runtime or composition module invokes `decideAnishaTurn`, so
VENDOR turns still take the legacy default path.

**S3-D-B** will add the composition bridge — a vendor-journey input port, an Anisha adapter, and a
deterministic mux that selects exactly one adapter per turn by assigned actor and party type, feeding
the single existing `BehaviourDecisionPort`. No second seam, no second proposal, no second model call.

**Production rollout remains OFF.** No production data source supplies `VendorJourneySignals`, and
nothing here activates a provider, a mode or a deployment.

## Non-goals

No prompt text · no model call · no router, state machine, proposal helper, proposal authority or
ModelReplyPort · no memory · no tools · no WhatsApp · no n8n · no database or persistence · no
migration · no deployment · no client ownership · no lead-quality judgement · no money.

## Change-control rule

Adding a vendor-journey intent, a context field, a disposition or a band requires an ADR amendment.
Anisha stays vendor-only; the actor and party constants stay constants; classification stays
deterministic and confidence-free; money stays a band; every action-like result stays a request for
Core; prompt text never enters this package.
