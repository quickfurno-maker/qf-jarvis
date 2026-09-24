# ADR-0161 — Governed memory, Core data tools, knowledge freshness and JAO action registry

**Status:** Accepted for engineering implementation only. No production activation or managed migration is authorized.

**Date:** 2026-09-23.

## Context

Jarvis already has four boundaries that this phase must preserve:

1. QuickFurno Core is business authority.
2. Governed knowledge is evidence/reference material, never live business authority.
3. Agent memory is derived, rebuildable, non-authoritative and erasure-aware under ADR-0016.
4. JAO remains default-off and cannot manufacture approval, execution authority or provider effects.

Riya's production persistence lifecycle is still separately blocked until the owner approves classification, purpose, retention and erasure behavior. Repository code must not invent that decision.

## Decision

### 1. Governed long-term memory

The memory capability reuses the existing canonical `AgentMemoryRecordV1` and `MemoryInvalidationRequestV1` contracts from ADR-0016. It does not create a parallel memory schema.

The admission/runtime layer requires all existing memory invariants, including:

- `authoritative: false`;
- `rebuildable: true`;
- agent/subject isolation;
- canonical source-event provenance;
- explicit erasure state;
- bounded expiry for every durable record.

Durable reads and writes are default-OFF. Enabling them requires an exact owner approval reference, retention-policy reference, erasure-policy reference and a bounded maximum retention period. A record whose expiry exceeds that ceiling is refused.

A private PostgreSQL adapter and reviewed schema source artifact may exist in `apps/api` so the implementation can be tested. The schema artifact is **not** added to the managed migration ledger and grants no role. Applying it to a managed database remains a separate governed deployment decision. The API composes the memory runtime over the same caller-owned durable pool without changing the existing runtime lifecycle surface. Erasure/invalidation physically deletes memory payloads and returns only a bounded deletion receipt. Expired memory may be physically purged only through a bounded oldest-first batch using `FOR UPDATE SKIP LOCKED`; scheduling that maintenance remains external.

The reusable foundation package remains free of database, environment, transport and model dependencies.

### 2. Live Core data tools

The Core data-tool registry is read-only by type. Its Riya dependency is `Pick<CoreRiyaIntakePort, 'readCurrent' | 'lookupSubmission'>`; the mutation-capable `submit` method cannot enter the composition.

The current tool vocabulary is:

- Core service availability read;
- Riya intake/contact/consent-state read;
- Riya submission lookup for idempotent recovery.

Every result is re-proved through its canonical Core parser before it becomes tool data.

The JF-6 serving composition binds service availability to the already-reviewed signed QuickFurno endpoint. A separate JF-6 structured-action composition now binds the durable continuity store and signed availability reader to the complete `CoreRiyaIntakePort`, but that port remains injected because QuickFurno has not yet supplied a separately reviewed live source-of-truth mapping from the opaque Riya customer reference to contact/consent/submission authority. No fallback or inferred mapping to lead or messaging consent is permitted.

### 3. Knowledge freshness

Freshness compares exact source identity using:

- source reference;
- source revision;
- normalized content digest;
- owner reference;
- production-approval state and exact approval reference.

A source is classified as `UNCHANGED`, `CHANGED`, `NEW` or `MISSING`. Approval/owner drift counts as change, and source disappearance blocks the cycle rather than silently shrinking the corpus.

The application coordinator additionally proves each fingerprint is bound to the actual normalized document. An explicit manifest adapter validates a caller-supplied, bounded source set, rejects duplicate identities and digest drift, and performs no filesystem/network discovery. A changed source set is evaluated before build. Only approved sources with passing evaluation may enter candidate construction.

Candidate construction reuses `buildStreamingKnowledgeRelease` with `activateAfterSeal: false` hard-pinned. The coordinator refuses any builder result that reports activation. Freshness can therefore prepare and seal an immutable **inactive** candidate, but cannot change the active serving revision.

There is no autonomous source approval, seal-to-active promotion or production activation in this capability.

### 4. JAO action registry

The registry records exact action/version identity, risk/effect class, allowed agent scopes, authority/approval/idempotency/rollback references, an exact binding reference and an enabled flag. Nested agent-scope lists are frozen as well as their containing action definitions.

The engineering registry ships every action disabled. Current definitions are:

- `propose_vendor_follow_up@1` → existing `jao6.vendor-follow-up.v1` proposal lane;
- `request_human_takeover@1` → conversation takeover boundary;
- `start_governed_followup@1` → Temporal request boundary.

The strongest registry verdict remains `ELIGIBLE_FOR_PROPOSAL`. It never means approved, authorized, executed or sent.

All three engineering actions have concrete non-executing bindings. Vendor follow-up reuses the existing JAO-6 governed business-action proposal path and may produce only the existing `RecommendationV1` plus powerless `ApprovalRequestV1`. Human takeover may produce only a request artifact that deliberately lacks operator identity, command id, expected revision and issuance evidence, so it cannot become a `ConversationControlCommand`. Governed follow-up may produce only validated content-minimized Temporal journey/wake input with `workflowStarted: false`; the worker never receives a Temporal client. None creates an approval decision, execution intent, Core mutation, control transition, workflow start or provider action.

The canonical runtime function uses the immutable engineering registry, so it remains fail-closed while those actions are disabled. Tests may use an internal, non-barrel seam to prove what a future separately reviewed enablement would enter.

## Containment

This phase does **not** authorize or perform:

- managed production database migration;
- owner retention/erasure policy creation;
- production memory enablement;
- Core business-state mutation;
- inferred Riya intake authority;
- automatic knowledge-source approval;
- knowledge activation;
- Meta/provider credential access or send;
- JF-5C minting;
- production worker activation;
- autonomous JAO execution.

## Release consequence

This code is newer than the previous production candidate. Any future production release containing it requires a fresh exact-SHA certification chain and all pre-existing owner/business/live-provider gates.

Until the Riya lifecycle owner decision exists, durable long-term memory must remain disabled. Until QuickFurno supplies a reviewed Riya intake read mapping, only the already-established signed Core read surfaces are live-capable.
