# ADR-0028 — AI Runtime Foundations and Roadmap Sequencing

**Status:** Accepted
**Date:** 2026-07-16
**Accepted:** 2026-07-16
**Deciders:** Keshav Sharma — Founder and business owner, QuickFurno

**Relates to:** [phased-roadmap.md](../architecture/phased-roadmap.md) · [agent-model.md](../architecture/agent-model.md) · [ADR-0002](./ADR-0002-recommend-authorize-execute-model.md) · [ADR-0006](./ADR-0006-agent-responsibility-boundaries.md) · [ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md) · [ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md) · [ADR-0017](./ADR-0017-live-communication-sequencing.md)

> **This ADR changes documentation, architecture and roadmap sequencing. It implements no runtime code.** Nothing described below exists in this repository. The model gateway, the knowledge system, the capability registry, the evaluation harness, tracing, identity and access controls, and the production-readiness controls are **approved architecture and future implementation** — not present capabilities. Where this ADR says a component "must" do something, it is stating a requirement on a **future** phase, not describing a thing that runs today.

---

## Context

The roadmap through [ADR-0017](./ADR-0017-live-communication-sequencing.md) sequenced the product cleanly — contracts, then the event backbone, then the coordinator, then the specialists, then approval, then the n8n bridge, then live Core integration, then the founder control plane, then hardening, evaluation and controlled automation. That sequence is sound and is **not** overturned here.

But it left a set of foundations **implied rather than scheduled**. The specialists (Phases 5–8) call a model; nothing yet says _how_ a model is invoked, budgeted, bounded, or failed over. Phase 9 exposes approval to people; nothing yet says those people must first have named accounts, MFA and role-based access. Phase 11 turns on live Core data and Phase 11A reaches a real person; nothing yet gates that on proven backups, disaster recovery, or multilingual communication safety in the languages QuickFurno's clients and vendors actually use. Phase 13 was quietly carrying "and also introduce tracing, redaction, access control, backups, cost limits, evaluation and capability restriction" — which would make Phase 13 the _first appearance_ of controls that everything before it had already depended on. A control that first appears in the hardening phase was not a control during the phases it was meant to protect.

The owner reviewed these gaps on 2026-07-16 and approved adding them as **first-class, sequenced foundations** rather than as things that happen to get built somewhere. The twelve additions are: (1) a model gateway and AI runtime policy; (2) cost, compute and concurrency governance; (3) governed QuickFurno knowledge retrieval; (4) a secure connector and capability registry; (5) continuous engineering evaluation; (6) AI tracing and observability; (7) data-quality and freshness gates; (8) human identity, MFA and RBAC before approval capability; (9) backup, restore and disaster-recovery readiness; (10) model and software supply-chain verification; (11) Hindi, Hinglish and Indian-market communication evaluation; and (12) an expanded founder operating system inside the Founder Control Plane.

**None of this weakens the permanent boundary.** It strengthens the road up to it.

## Decision

**Add the AI runtime, governance, evaluation, identity, production-readiness and multilingual-safety foundations to the roadmap as explicitly sequenced sub-phases, and require each control to appear in the phase that first depends on it — never later.**

The permanent boundary is unchanged and is restated in full below. The additions are inserted using **sub-phase numbers**, so every existing reference to Phases 5–15 remains valid and nothing is renumbered.

### Phase 4.0 — Model Gateway and AI Runtime Foundation

The first thing built after Phase 3, and **before any specialist agent**.

**Responsibilities.**

- **All model invocation passes through one internal gateway.** There is exactly one place a prompt becomes a model call.
- **Agents never import or call model providers directly.** No agent holds a provider SDK, an API key, or a base URL. An agent asks the gateway; the gateway decides and calls.
- **Gemma-first, but model-independent.** The architecture names Gemma as the initial local model and is written so that the model behind the gateway can change without touching an agent.
- **Runtime modes:** `OFF`, `SHADOW`, `CANARY`, `ACTIVE`, `FALLBACK` — a governed lifecycle for turning model use on, proving it in shadow, canarying it, running it, and degrading safely.
- **Model routing** — which model serves which request class.
- **Local-versus-remote policy** — what may run on a local model and what, if anything, may leave for a remote one, decided **before** the request is sent (see privacy classification below).
- **Timeout and circuit-breaker policy** — a slow or failing backend trips rather than hangs.
- **Retry budgets** — bounded, not open-ended.
- **Structured-output validation** — a model's output is validated against a contract, and a malformed output is a failure, not something to coerce.
- **Prompt versioning** and **model versioning** — both pinned, both recorded.
- **Model and prompt provenance** — every model-backed run records the model version and the prompt version; model provenance without prompt provenance is not provenance.
- **Privacy classification before remote processing** — data is classified before it may be considered for a remote model, and unclassified or too-sensitive data does not leave.
- **Token budgets**, **cost budgets**, **concurrency limits**, **queue limits**, and **resource-pressure controls** — the runtime has a spending limit, a parallelism limit, a backlog limit, and a way to shed load.
- **Provider fallback** and an **emergency kill switch** — a documented way to fall back, and a documented way to stop.

**Two hard rules.**

- **No consumer AI subscription may be treated as a production model backend.** A personal or consumer chat subscription is not a production dependency, is not governed by an enterprise data agreement, and must never sit behind the gateway in production.
- **No raw chat, model output or business conversation becomes training data automatically.** Training eligibility remains an explicit, named-human or named-versioned-policy decision against complete provenance ([ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md)). Sensitive personal data is never eligible.

The architecture is [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md).

### Phase 4.1 — Governed Knowledge and Capability Foundation

**Governed knowledge is separate from agent memory.** Agent memory is derived, per-agent, non-authoritative belief ([ADR-0016](./ADR-0016-agent-memory-and-learning-boundaries.md)). Governed knowledge is reviewed, versioned, approved reference material. They are different things with different lifecycles, and conflating them is how an unreviewed document becomes something an agent treats as fact.

**Knowledge lifecycle:** `uploaded → scanned → reviewed → approved → active → retired`.

**Every knowledge record carries:** document identifier · version · source · owner · `approvedBy` · `effectiveFrom` · `expiresAt` (where applicable) · classification · retrieval permissions · `supersededBy` (where applicable).

**Retrieved knowledge is evidence, never business authority.** QuickFurno Core remains authoritative for current operational and business state. A retrieved document may inform a recommendation; it may never be treated as the current truth about a lead, a vendor, a wallet, or a policy.

**Do not commit to a vector database merely because retrieval exists.** Vector retrieval must be justified by **evaluation evidence** (Phase 4.2). Deterministic lookup and metadata filtering remain valid first implementations, and are preferred until evidence says otherwise.

**A secure capability registry.** Every capability an agent or component may invoke is declared, and each declaration carries: capability identifier · owning component · allowed caller or agent · read/write classification · input contract · output contract · data classification · timeout · rate limit · audit requirements · environment availability · feature flag · failure behaviour.

**Open-ended capabilities are prohibited** — no arbitrary SQL, no arbitrary shell, no unrestricted filesystem access, no arbitrary URL fetching, no generic provider invocation, no unrestricted document retrieval. A capability is a **named, bounded, contract-typed door**, or it does not exist.

**The boundary is unchanged.** Jarvis still has no write access to QuickFurno business state, no direct path to n8n, no provider credentials, and no direct communication transport.

The architecture is [governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md).

### Phase 4.2 — Continuous Evaluation, Observability and Data Quality

**Engineering evaluation begins before the first specialist agent** — so the specialists are built against a harness that can fail them, rather than one retrofitted after they exist.

**Required evaluation categories:** golden cases · hard negatives · adversarial prompt-injection cases · multilingual prompt injection · routing correctness · domain-boundary refusal · evidence grounding · structured-output compliance · stale-context behaviour · incomplete-context behaviour · model-fallback behaviour · cost regressions · latency regressions · Hindi · English · Hinglish · Romanized Hindi · Indian number formats · lakh and crore interpretation · locality and category terminology.

**Phase 14 is unchanged in its purpose:** it owns **real-world business effectiveness, outcome correlation, and automation-promotion evidence**. Phase 4.2 owns the **engineering evaluation harness** — the thing that says "this agent version is correct and grounded," not "this agent version moved the business." The two are different questions and neither substitutes for the other.

**AI operational tracing covers the whole path:** canonical event → projection → coordinator route → specialist run → deterministic rules → knowledge retrieval → model gateway → output validation → recommendation.

**Tracing may record:** trace and span identifiers · agent and agent version · model and model version · prompt version · routing decision · retrieved source identifiers · token counts · latency · fallback reason · validation outcome · redaction outcome.

**Tracing must never record:** chain-of-thought · raw personal-data prompts · complete raw model output · secrets · provider credentials · phone numbers · message bodies · call transcripts. This is [security-principles.md](../governance/security-principles.md) §5 and [privacy-principles.md](../governance/privacy-principles.md) §6 and §7 applied to tracing, and it is not negotiable for debugging convenience.

**A formal input-readiness result:** `READY` · `READY_WITH_WARNINGS` · `STALE_CONTEXT` · `INCOMPLETE_CONTEXT` · `CONFLICTED_CONTEXT` · `SOURCE_UNAVAILABLE`. Every agent recommendation must eventually carry an **input watermark** (or equivalent evidence) showing the freshness and completeness of the facts it used — so a recommendation built on stale or partial context is _detectably_ so, rather than silently indistinguishable from one built on fresh, complete context.

The architecture is [ai-evaluation-observability-and-data-quality.md](../architecture/ai-evaluation-observability-and-data-quality.md).

### Phase 4.3 — Jarvis Coordination Layer

**The existing Phase 4 coordination work becomes Phase 4.3.** Its content is unchanged: routing · agent registry · agent-run recording · conflict detection · recommendation consolidation · deduplication · prioritization · expiry · founder attention management · cross-domain synthesis ([agent-model.md](../architecture/agent-model.md)).

**Entry criteria:** Phases 4.0, 4.1 and 4.2 complete. The coordinator is not built until the runtime it coordinates, the knowledge and capabilities it draws on, and the evaluation and tracing that watch it all exist.

**Do not move specialist domain logic into Jarvis** ([ADR-0006](./ADR-0006-agent-responsibility-boundaries.md)). The coordinator owns the connecting, never the concluding — unchanged.

### Phase 8.5 — Human Identity and Access Foundation

**Inserted before Phase 9**, because Phase 9 is where approval capability is first exposed to people, and **approval authority is the most valuable credential in the system** ([trust-boundaries.md](../architecture/trust-boundaries.md) B7). Exposing it before identity controls exist would be exposing it to accounts that cannot be attributed, revoked, or stepped up.

**Required capabilities:** named individual accounts · no shared approver accounts · MFA · role-based access control · delegated limits · step-up authentication for sensitive actions · session expiry · session and device revocation · emergency read-only mode · an access-review process · full actor attribution · separate reviewer and approver permissions where appropriate.

The architecture is [production-readiness-and-access-control.md](../architecture/production-readiness-and-access-control.md).

### Phase 10.5 — Production Readiness Foundation

**Inserted after Phase 10 and before Phase 11**, because Phase 11 is the first live Core integration and it may not run on infrastructure whose recovery has never been proven.

**Required outputs:** backup policy · encrypted backup mechanism · point-in-time recovery where supported · a restore drill · documented RPO and RTO · a disaster-recovery runbook · a Mac mini failure mode · a VPS failure mode · a managed-database failure mode · a provider-outage mode · a degraded read-only mode · model artifact hashes · tokenizer hashes · model licences · quantization records · prompt hashes · dependency-lockfile verification · build provenance · a container or deployment artifact digest where applicable · security-scan evidence · secret-isolation verification.

**A backup is not considered proven until a restore drill succeeds.** A backup nobody has restored is a hypothesis.

**This phase does not authorize live QuickFurno data or production communication.** It makes the platform recoverable; it grants no licence to put real data or real messages on it. The Phase 11 privacy-and-retention gate ([ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7) is untouched.

### Phase 11A — Multilingual Communication Safety Gate

**A mandatory entry gate before real communication**, added to Phase 11A. QuickFurno's clients and vendors communicate in Hindi, English, and the mixtures people actually use — and the first real message must be safe in the language it is actually written in, not only in English.

**The gate tests:** Hindi · English · Hinglish · Romanized Hindi · STOP and START interpretation · opt-out language · mixed-language consent · quiet-hours wording · numbers, dates, budgets and measurements · Pune and Mumbai locality names · interior, carpentry and modular terminology · respectful and non-manipulative tone · multilingual prompt injection · template rendering · no invented promises · no invented pricing · no invented availability.

**Voice remains after messaging safety evidence** ([ADR-0017](./ADR-0017-live-communication-sequencing.md)) — this gate does not move voice earlier.

### Phase 12 — Founder Control Plane and Operating System

**Expanded** from an attention view into a founder operating system: prioritized attention view · evidence view · approval queue · daily founder briefing · decision register · waiting-for tracker · delegated-action tracker · recurring review queues · stale-approval alerts · unresolved-incident view · agent health · model-gateway health · business-KPI summary · searchable audit history · a mobile urgent-review experience · governed calendar and reminder integration.

**The dashboard must never:** display optimistic approval · display optimistic delivery · collapse submitted, provider-accepted and delivered states · authorize locally · store a second copy of QuickFurno business truth ([ADR-0007](./ADR-0007-founder-approval-interface-and-authority.md), [ADR-0001](./ADR-0001-source-of-truth-boundary.md)).

### Phases 13, 14, 15 — clarified, not moved

- **Phase 13 hardens and independently verifies controls introduced earlier.** It **must not be the first appearance** of tracing, redaction, access control, backup, model governance, cost limits, evaluation, or capability restrictions. Those now appear in the phase that first needs them; Phase 13 proves them under adversarial conditions and closes the gaps.
- **Phase 14 retains** real-world business evaluation: recommendation acceptance · outcome correlation · confidence calibration · shadow comparison · agent regression detection · automation-candidate evidence.
- **Phase 15 retains** narrow, reversible policy automation only: no money automation · no bulk automation · no unrestricted autonomous communication · no Level 5.

## Sequencing

The final roadmap order, with existing Phases 5–15 **not renumbered**:

```
Phase 0
Phase 1
Phase 2
Phase 3   (stages 3.0–3.9)
Phase 4.0   Model gateway and AI runtime foundation
Phase 4.1   Governed knowledge and capability foundation
Phase 4.2   Continuous evaluation, observability and data quality
Phase 4.3   Jarvis coordination layer
Phase 5     Kabir
Phase 6     Riya
Phase 7     Anisha
Phase 8     Jitin
Phase 8.5   Human identity and access foundation
Phase 9     Approval and policy
Phase 10    n8n execution bridge (test only)
Phase 10.5  Production readiness foundation
Phase 11    QuickFurno Core integration (live)
Phase 11A   Controlled communication pilot — with the multilingual safety gate
Phase 12    Founder control plane and operating system
Phase 13    Security and observability hardening
Phase 14    Evaluation and learning loop
Phase 15    Controlled automation rollout
```

**Why sub-phase numbers.** Renumbering Phases 5–15 would invalidate every existing reference to them across the ADRs, the roadmap, and the contracts documentation. Sub-phase numbers add the new work exactly where it belongs while keeping "Phase 7 is Anisha" true.

**The load-bearing sequencing rule:** a control appears in the phase that first depends on it. Identity before approval (8.5 before 9). Production readiness before live data (10.5 before 11). Multilingual safety before real messages (the 11A gate before any send). The model gateway, governed capabilities, evaluation and tracing before the first specialist (4.0–4.2 before 5). Phase 13 then verifies; it does not introduce.

## Permanent boundaries

**Unchanged, and restated because an amendment is exactly where a boundary quietly erodes:**

```
Jarvis recommends.
QuickFurno Core authorizes.
n8n executes.
Providers deliver.
Results return to QuickFurno Core.
```

None of the additions weakens it:

- The **model gateway** invokes models; it authorizes nothing, executes nothing, and holds no provider credential. A hijacked model still cannot authorize, execute, dial, or write business state ([security-principles.md](../governance/security-principles.md)).
- **Governed capabilities** are bounded, contract-typed doors — never arbitrary SQL, shell, fetch, or provider access. Jarvis still has **no write access to business state, no path to n8n, no provider credentials, and no direct communication transport.**
- **Governed knowledge** is evidence, never authority. **QuickFurno Core remains authoritative** for current operational and business state.
- **Identity, backups, and multilingual safety** are controls _around_ the boundary; none introduces a new edge across it. The four edges that do not exist — Jarvis → provider, Jarvis → n8n, Jarvis → business state, agent → approval — still do not exist.

## Alternatives considered

- **Leave the foundations implicit and build them "when needed."** Rejected. "When needed" for a control is always _after_ the phase that needed it shipped without it. Identity built during Phase 9 means Phase 9 briefly had approval without attribution; tracing built in Phase 13 means Phases 5–12 ran unobserved.
- **Fold everything into Phase 13 (hardening).** Rejected explicitly. It makes Phase 13 the first appearance of controls that earlier phases depended on, which means those phases were never actually protected. Hardening verifies controls; it must not originate them.
- **Renumber Phases 5–15 to make room.** Rejected. It breaks every existing cross-reference for no benefit that sub-phase numbers do not already provide.
- **Commit now to a vector database and a remote model provider.** Rejected. Retrieval strategy and remote-model use must be justified by evaluation evidence; deterministic lookup and a local Gemma-first runtime are the valid first implementations, and premature commitment is how a dependency outlives its justification.
- **Treat a consumer AI subscription as the production backend to move faster.** Rejected outright. It is ungoverned by any data agreement and is not a production dependency.

## Positive consequences

- **Every control has a home, and it is the right one.** The road to live data and live communication is now paved with the controls each step needs.
- **The specialists are built against evaluation and tracing that already exist**, so their correctness is measurable from the first version.
- **Approval is never exposed to unattributable people**, and **live data is never put on unrecovered infrastructure.**
- **The boundary is restated and reinforced**, not weakened — a model gateway that owns all model calls is a smaller attack surface than agents each holding a provider key.
- **No existing reference breaks**, because nothing is renumbered.

## Negative consequences — accepted

- **The road to the first specialist is longer.** Phases 4.0–4.2 stand between Phase 3 and Kabir. Accepted: a specialist without a governed runtime, bounded capabilities, and an evaluation harness is a specialist nobody can trust or measure.
- **More phases means more gates**, and gates cost time. Accepted, and deliberate — each gate is cheaper than the incident it prevents.
- **This is documentation ahead of implementation.** The gap between "approved architecture" and "running code" is now larger, and the documents must keep saying so honestly. This ADR and the four architecture documents state it explicitly, repeatedly, on purpose.

## Risks

- **Documentation mistaken for implementation.** The single largest risk of this amendment. Mitigated by every new document distinguishing _approved architecture_, _future implementation_, and _current repository reality_, and by the status ledger in the roadmap and README saying `NOT IMPLEMENTED` for every new foundation.
- **Scope inflation** — a founder operating system and a knowledge system are each large. Mitigated by explicit exclusions, sub-phase boundaries, and the rule that vector retrieval and remote models must earn their place with evidence.
- **A control introduced early but verified only in Phase 13 rots in between.** Mitigated by Phase 13's redefinition as _independent verification and gap-closure_, with continuous evaluation and tracing (4.2) watching in the interim.
- **Privacy leakage through the new surfaces** — tracing, knowledge retrieval, remote model calls. Mitigated by the tracing never-record list, privacy classification before remote processing, and knowledge classification and retrieval permissions.

## Explicit exclusions

This ADR does **not**:

- implement any runtime code, model SDK, model call, gateway, knowledge store, capability registry, evaluation harness, tracing, identity system, or backup mechanism;
- access a database, SQL, migrations, Supabase, QuickFurno Core, n8n, WhatsApp, telephony, provider credentials, or any deployment system;
- add a package dependency or change the lockfile;
- authorize starting Stage 3.3, or any Phase 4.x, 8.5, 10.5, 11A, or 12 implementation;
- decide the production event-log privacy and retention question (an owner gate on Phase 11, [ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7);
- set any business baseline or numerical performance target ([success-metrics.md](../charter/success-metrics.md)).

## Follow-up phases

Each sub-phase below is authorized as **architecture and sequencing only** by this ADR. Implementing any of them is a separate, owner-authorized decision with its own branch, its own exit criteria, and — where it changes the shape of the system — its own ADR:

- **Phase 4.0** — model gateway and AI runtime (its own implementing ADR).
- **Phase 4.1** — governed knowledge and capability registry (its own implementing ADR; the vector-database question is decided later, on evidence).
- **Phase 4.2** — evaluation harness, tracing, and input-readiness watermark.
- **Phase 4.3** — the coordinator (the former Phase 4).
- **Phase 8.5** — identity, MFA, RBAC.
- **Phase 10.5** — backup, restore, disaster recovery, and supply-chain verification.
- **Phase 11A gate** — multilingual communication safety.
- **Phase 12** — the founder operating system.

Current status is recorded honestly in [phased-roadmap.md](../architecture/phased-roadmap.md) and [README.md](../../README.md): **Phase 3 in progress; Stage 3.2 complete, accepted and merged; Stage 3.3 not started; every new foundation is approved architecture, not implemented.**
