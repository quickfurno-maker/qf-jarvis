# ADR-0085 — QFJ-P12 Aarohi Vendor Growth and Acquisition Agent (QVGE), and roadmap reconciliation

**Status:** Accepted — governance and documentation only (no runtime package, no UI, no migration, no managed database, no deployment, no provider or channel configuration, no n8n or Meta execution). Aarohi's runtime remains **PLANNED / DISABLED**.
**Deciders:** Owner
**Relates to:** [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0015](./ADR-0015-complete-client-journey-and-reassignment-policy.md) · [ADR-0039](./ADR-0039-canonical-qf-jarvis-roadmap-v3-and-governance-reconciliation.md) · [ADR-0083](./ADR-0083-qfj-p08-communication-authorization-correlation-runtime.md) · [ADR-0084](./ADR-0084-qfj-p09-01-execution-intent-correlation-runtime.md)

## Context

Baseline: `main` at `710426bc8546441e1c1d2d284a91ee127aa60414`, the merge of PR #87. Collision checks
on that baseline: `ADR-0085` unclaimed and unreferenced anywhere in the repository (`ADR-0086`–`0088`
likewise), no `docs/architecture/aarohi-vendor-growth-roadmap-overlay.md`, migrations `0001`–`0009`
with no `0010`, `0009` at `e834bc3c…`.

PR #88 (JOS-01A, the Jarvis OS operator control plane) is open and unmerged. It is a strong frontend
change with green exact-head CI, and it is blocked — not by a runtime defect, but because merging it
would write two contradictions into the canonical documentation set.

**Contradiction 1 — the agent roster.** JOS-01A renders Aarohi and Anisha as separate agents on
separate routes with separate capabilities, and `docs/architecture/jarvis-os.md` states that canonical
Aarohi/QVGE governance is a separate prerequisite if it has not yet merged. It had not. Current `main`
defines exactly three governed agents, and gives Anisha "first-time prospects and existing, active,
expired, and dormant vendors — through the full lifecycle", including first vendor contact,
qualification, sales-pitch creation, conversion and payment follow-up. A product surface asserting a
fourth agent while the constitution assigns that agent's entire scope to a third one is not a cosmetic
mismatch: the constitution is the document every future agent build must satisfy, so the surface would
be describing a boundary no build is obliged to honour.

**Contradiction 2 — QFJ-P09.01 status.** The JOS overlay and `jarvis-os.md` state that QFJ-P09.01 is
merged and QFJ-P09.02 is next, while the canonical QFJ-P09 status paragraph still reads
"implemented on a feature branch, not merged". PR #87 merged on 2026-08-03. The roadmap simply was not
updated, and a status line that is stale in one direction is indistinguishable from one that is wrong.

Both are fixed here, in one governance change, ahead of PR #88 — so that PR #88 never merges onto a
contradictory baseline.

## Decision

### 1. Aarohi is a canonical governed agent

**Canonical agent:** Aarohi — Vendor Growth and Acquisition Agent.
**Subsystem:** QuickFurno Vendor Growth Engine (**QVGE**).
**Jarvis OS section:** "Aarohi — Vendor Growth".
**Historical alias:** `ANI-COLD-AQUI` — **non-canonical and retired.** It is recorded so the lineage is
traceable, and it must not be used as an identifier, a capability id, a namespace or a routing key.
**Roadmap owner:** QFJ-P12 — Advanced Intelligence and Future Agents.

The governed roster becomes **four**: Jarvis, Riya, Aarohi, Anisha.

### 2. The permanent split

This is the load-bearing paragraph of this ADR. The boundary is drawn at **registration status as
QuickFurno Core reports it**, not at conversation topic, channel, or which agent happened to speak
first.

- **Riya** — customer conversation and qualification.
- **Aarohi** — genuinely net-new, **unregistered** vendor acquisition, through to authoritative
  paid/active conversion.
- **Anisha** — **registered/existing** vendor relationship, support and success: post-activation
  onboarding and success, renewal, resale, upsell and cross-sell, retention, registered-vendor
  reactivation, and complaints.
- **Jarvis** — coordination, and complex or cross-agent cases.
- **QuickFurno Core** — final business, commercial, identity, consent, payment and activation
  authority.
- **n8n** — approved execution only. **Providers** — delivery only.

Anisha is **narrowed at the front edge only**. She loses cold acquisition of unregistered parties; she
keeps the complete routine lifecycle of a registered vendor. The standing rule that her role must not
be narrowed to "only promotion" or "only onboarding" is unchanged and still binds — this decision
moves one boundary deliberately and by owner decision, and is not a licence to erode the rest.

### 3. Handoff at ACTIVE

**When QuickFurno Core authoritatively confirms ACTIVE, Aarohi stops acquisition selling and primary
vendor relationship ownership moves to Anisha.**

The trigger is Core's authoritative confirmation. It is not Aarohi's belief that a payment succeeded,
not a provider receipt, not a model's reading of a conversation, and not an inference from a message
saying "I've paid". Until Core says ACTIVE, the party is not a registered vendor; once Core says
ACTIVE, Aarohi's acquisition mandate over that party ends.

### 4. The existing-vendor gate

**If Core says the discovered party is registered, active, inactive, dormant, former, previously
contacted, duplicate or do-not-contact, Aarohi must not create a second cold-acquisition
relationship.** Route according to Core truth.

This gate exists because the failure it prevents is the specific, predictable failure of an
acquisition agent: cold-pitching a vendor who is already a customer, re-approaching someone who
already said no, or opening a duplicate relationship beside an existing one. Aarohi never resolves
this from local state or model memory — the check is against Core, and **absent or ambiguous Core
truth is a stop, not a proceed.**

### 5. The QVGE capability overlay: AVG-0 … AVG-12

The overlay is recorded in
[aarohi-vendor-growth-roadmap-overlay.md](../architecture/aarohi-vendor-growth-roadmap-overlay.md).

**AVG identifiers are overlay ids owned by QFJ-P12. They are not phases.** They do not renumber
anything, they do not create QFJ-P13, and QFJ-P13 does not exist. `P00`–`P12` are unchanged.

Every AVG stage is **PLANNED / DISABLED**. Recording a capability grants nothing: there is no Aarohi
runtime, no outreach, no channel, no credential, and no Instagram, WhatsApp, n8n or Meta integration
in this repository.

### 6. QFJ-P09.01 status correction

The canonical QFJ-P09 status paragraph is corrected to the merged truth: PR #87 is **MERGED**, final
head `e0bc58c33adcf09cc98fcbeddef14682a7e0a7ce`, merge commit
`710426bc8546441e1c1d2d284a91ee127aa60414`, merged at `2026-08-03T07:06:21Z`. The execution-intent
correlation foundation is merged, remains powerless and dispatches nothing; **QFJ-P09 remains
INCOMPLETE**; the next bounded slice is **QFJ-P09.02 — test-only authorized dispatch envelope / n8n
bridge validation**; live send remains OFF.

ADR-0084's history is not rewritten, and no execution-intent runtime code is modified.

A regression assertion (`apps/api/src/tests/governance-consistency.test.ts`) fails if the roadmap ever
again claims both that P09.01 is merged and that it is implemented on an unmerged feature branch, and
if the four-agent roster and the Aarohi/Anisha split fall out of agreement across the canonical
documents. A contradiction between two documents is exactly the class of defect that review misses and
a cheap test catches.

## Rejected alternatives

**Merge PR #88 first and reconcile governance afterwards.** Rejected. It inverts the authority order:
the product surface would have been the first canonical statement that Aarohi exists, and the
constitution would have been amended to match a UI. Governance precedes the surface that depends on it.

**Extend Anisha to cover acquisition and drop Aarohi.** Rejected on owner decision, and it is also the
weaker design. Acquisition and account management have different failure modes — the acquisition
failure is contacting someone who should not be contacted, the relationship failure is mishandling
someone who is already owed service — and one agent holding both blurs the boundary precisely where
the existing-vendor gate has to be enforced.

**Introduce Aarohi as QFJ-P13.** Rejected, and explicitly forbidden. The major-phase spine is
canonical; a new agent is future-agent work, which is what QFJ-P12 already owns. Renumbering the spine
to accommodate an agent would break every document, ADR and report that cites a phase id.

**Keep `ANI-COLD-AQUI` as the identifier.** Rejected. The name encodes the very conflation this ADR
removes: it reads as an Anisha subsystem, and Aarohi is not one.

## Consequences

- The canonical roster is four agents. `docs/governance/agent-constitution.md`,
  `docs/governance/authority-routing-data-access-matrix.md` and
  `docs/architecture/qf-jarvis-roadmap-v3.md` are updated together; a partial update would recreate the
  contradiction this ADR exists to remove.
- A fourth RAG namespace, `AAROHI`, is reserved. Namespaces remain per-agent and are never cross-read.
- Vendor-side routing is no longer a single destination: it is resolved by Core's registration truth.
- PR #88 becomes mergeable on a consistent baseline once this merges and is merged into it.
- **Nothing becomes executable.** This ADR adds no package, no contract, no schema, no capability
  registration and no rollout change.

## Non-goals

Not in scope: any Aarohi runtime, prospect store, enrichment pipeline, scoring model, outreach
workspace, Instagram or WhatsApp integration, omnichannel identity resolution, sales brain, package
engine, registration or payment integration, analytics API, or dashboard beyond the PLANNED Jarvis OS
surface. No migration is created or modified; no managed database is touched; nothing is deployed;
production rollout remains **OFF**.

## Change-control rule

Aarohi's scope, the ACTIVE handoff, the existing-vendor gate and the AVG overlay ownership may be
changed only by a superseding ADR. Operational status may advance (an AVG stage being designed, a
capability being implemented) without replacing this decision. Nothing in this ADR authorizes a
migration number, a provider, a channel, or an activation.
