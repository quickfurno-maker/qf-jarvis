# ADR-0049 — QFJ-P04.01E Provider Operations and Rollout Governance

**Status:** Accepted (2026-07-24) — QFJ-P04.01E
**Deciders:** Owner
**Phase:** QFJ-P04.01 — Model Gateway (governed provider rollout across OFF/SHADOW/CANARY/ACTIVE/FALLBACK)

**Relates to:** [ADR-0048](./ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md) (hybrid routing) · [ADR-0047](./ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md) (local provider) · [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) (Groq provider) · [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (gateway foundation) · [ADR-0041](./ADR-0041-provider-independent-cloud-local-and-hybrid-model-inference.md) · [ADR-0028](./ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md) · design docs [model-provider-independence.md](../architecture/model-provider-independence.md), [model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md)

**Design documents introduced:** [docs/reports/qfj-p04-01e/](../reports/qfj-p04-01e/) (reports 01–05)

> **This ADR is implemented in the same bounded slice it governs.** It adds a governed **provider-rollout controller** — OFF → SHADOW → CANARY → ACTIVE with FALLBACK and an emergency disable — over the existing providers and hybrid routing, behind the unchanged `ModelProvider` contract. **No live Groq or local-model call, no real key/token, no external network in tests/CI** — validated through deterministic injected transports. Rollout is **opt-in**: a gateway with no controller behaves exactly as QFJ-P04.01D. No schema/migration (0008 absent); the `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

QFJ-P04.01D gave the gateway a validated hybrid-routing policy and bounded failover. QFJ-P04.01E adds the **operational governance** to roll a provider release out safely: a stable release always serves, a candidate release is proven first in SHADOW (never returned), then a deterministic CANARY cohort, then ACTIVE, with a FALLBACK posture and a synchronous emergency disable. The controller consumes already-authorized approval attestations; it is not itself an authorization system, and it activates no live provider.

## Decision

### A. Immutable concepts

1. **`ProviderReleaseRef`** — `releaseId`, `providerId`, `modelId`, `modelVersion`, `executionClass`, and a `configDigest` (a capability/configuration version digest). No secret, no provider object.
2. **`RolloutApprovalAttestation`** — an opaque `evaluationRef`, an exact release/version binding (`releaseId` + `configDigest`), applicable privacy/data-control or endpoint-posture references, an approved **mode ceiling**, an approved **canary ceiling** (basis points), and a monotonic `revision`. It carries **no legal claim**.
3. **`ProviderRolloutPolicy`** — `rolloutId`, a monotonic `revision`, a `mode`, a stable release, an optional candidate release, `canaryBasisPoints`, a `shadow` flag, a fallback-to-stable rule, total/serving/shadow attempt limits, a closed operator reason, and the binding approval. **Default OFF.**

All three are validated and frozen. IDs/versions/refs use closed grammars; there is no arbitrary metadata map.

### B. Mode semantics

- **OFF** — no provider call; fail closed.
- **SHADOW** — the stable release is the only serving response. After the stable response is accepted, at most **one sequential** candidate shadow invocation runs; its output is **never** returned, accepted, authorized, executed, or used as a fallback, and a shadow failure never changes the stable response. No parallel shadow traffic; a separate one-call shadow budget. (Sequential shadowing is documented as a non-production default pending latency evaluation.) A failed stable response means **no shadow runs**.
- **CANARY** — a deterministic bucket derived from `rolloutId` + `runId` **only** assigns the configured basis-point cohort to the candidate; everyone else uses stable. Exactly **one** serving route. No randomness/time/user/client/vendor/subject/protected input. A candidate→stable fallback is allowed only when explicitly enabled, the failure is retryable/transient, privacy is preserved, and the shared serving budget remains.
- **ACTIVE** — the candidate/active release serves all eligible traffic; the stable release remains a rollback reference only.
- **FALLBACK** — the stable release serves primary; the candidate is eligible only as a bounded fallback on an approved transient stable failure. No percentage or shadow path.

### C. Transition governance

Normal promotion: `OFF → SHADOW → CANARY → ACTIVE`. Rollback/demotion: `ACTIVE → CANARY → SHADOW → OFF`, `ACTIVE → FALLBACK → OFF`, `CANARY → SHADOW/OFF`, `SHADOW → OFF`, and `ANY → OFF` by emergency disable. **No `OFF → ACTIVE`; no `SHADOW → ACTIVE`.** Revisions are monotonic with optimistic `expectedRevision`. A candidate release/model/version change requires a **new attestation and a safe restart**; a canary **increase** requires a new revision and an approval ceiling that covers it; decreases/rollback are always allowed. There is **no automatic promotion and no self-approval** — the controller consumes already-authorized attestations but is not an auth system.

### D. Readiness

Groq is eligible only with its positive ZDR/data-controls attestation and health (ADR-0046); local only with its endpoint/model/auth-TLS attestations and health (ADR-0047). **ACTIVE additionally requires** an opaque evaluation approval bound to the provider/model/prompt compatibility. QFJ-P04.04 supplies the real evaluation evidence later. A missing/stale/mismatched approval **fails closed**. No compliance claim.

### E. Canary

A **stable, deterministic, non-security** hash of `rolloutId` + `runId` yields a bucket in `[0, 10000)`; the candidate serves iff `bucket < canaryBasisPoints`. Basis points are `0..10000`. No personal or business-value input; no persistence.

### F. Kill switch

A synchronous, in-memory **emergency disable** sets a new OFF revision, blocks new calls immediately, and cannot be re-enabled from a stale revision. No remote API, CLI, or environment lookup.

### G. Observability

Bounded, content-free events only: `rollout-transitioned`, `rollout-refused`, `emergency-disabled`, `serving-release-selected`, `canary-assigned`, `shadow-started`, `shadow-completed`, `shadow-failed`, `candidate-fallback-to-stable`, `approval-mismatch`, `rollout-health-refusal`. They carry only ids, modes, reason codes, canary bucket/basis points, and counts — **never** a prompt, message, subject reference, key, token, raw body, or operator PII.

### H. Authority / non-goals

Inference only; the controller and providers hold no business authority; QuickFurno Core is final; n8n is execution-only; Riya client-only; Anisha vendor-only; Jarvis coordinator; Kimi excluded. **No** live activation/calls/keys/tokens; no remote ops; no persistence/schema/migration/0008; no full evaluation; no automatic promotion; no A/B platform; no dynamic cost/latency optimizer; no voting; no parallel shadow; no agents/memory/RAG/tools/n8n; no deployment.

## Rejected alternatives

- **A single `active`/`inactive` flag.** Rejected — a candidate must be provable in SHADOW then a deterministic CANARY cohort before ACTIVE; a direct `OFF → ACTIVE` is forbidden.
- **Parallel shadow traffic.** Rejected — at most one sequential candidate shadow call after stable acceptance; its output is discarded.
- **Random/time/attribute-based canary.** Rejected — a deterministic `rolloutId + runId` hash only; no personal/business input; no persistence.
- **A remote/CLI/env kill switch.** Rejected — a synchronous in-memory emergency disable to a new OFF revision; a stale revision cannot re-enable.
- **Make rollout the default and rewrite serving.** Rejected — rollout is opt-in via an injected controller; a gateway with no controller is byte-for-byte unchanged.

## Consequences

**Positive.** A provider release can be rolled out through governed, auditable stages with a deterministic canary, a non-returning shadow, a bounded fallback, and an instant emergency disable — all without live activation, and all reusing the P04.01D attempt ledger and failover gate.

**Negative — accepted.** The controller is evaluated only against deterministic injected transports here; ACTIVE requires a real evaluation approval that QFJ-P04.04 supplies later, and no live provider is activated. Sequential shadowing adds latency and is a non-production default pending evaluation.

## Change-control rule

Adding a mode, changing the transition matrix, the canary function, the attempt bounds, the approval binding, or the observability surface requires a superseding ADR. Activating a live release (any promotion to ACTIVE) requires provider activation (ADR-0046/0047 attestations) and QFJ-P04.04 evaluation approval bound to the exact release/model/version.
