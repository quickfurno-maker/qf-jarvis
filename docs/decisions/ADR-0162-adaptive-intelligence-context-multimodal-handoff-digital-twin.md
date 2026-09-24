# ADR-0162 — Adaptive intelligence, semantic context, multimodal planning, governed handoff and digital twin

**Status:** Accepted engineering foundation  
**Date:** 2026-09-24

## Context

Jarvis already has one provider-neutral Model Gateway, governed hybrid retrieval, QuickFurno-owned WhatsApp authority, deterministic agent assignment, exact release/evaluation evidence, and a fail-closed production activation path. The next capability wave must improve intelligence and efficiency without creating second routers, shadow business authority, new provider credentials or an autonomous execution path.

## Decision

Five pure packages define the new capability foundations.

### Model intelligence control

`@qf-jarvis/model-intelligence-control` may produce an adaptive **route intent** over exact release identities that already carry certification and evaluation references. It may use task class, privacy data class, decision risk, context need, structured-output need and cost/latency/quality preference.

The Model Gateway remains the only component allowed to perform actual provider routing. The route-intent layer cannot invoke a provider, alter health/circuit state, bypass capability checks, change a rollout, or activate a release.

A certified fallback is only an eligible distinct-provider release with explicit certification/evaluation references plus a separate fallback-certification reference for that exact release. Describing fallback eligibility does not enable fallback in the current production composition. Production remains OFF-only / fallback-disabled until a later exact-SHA evidence and owner-authorized activation slice.

Answer confidence is derived from objective evidence signals. Model self-confidence is never authority. Unverified Core facts require Core verification; contradictions or invalid structured output fail closed.

### Semantic context engine

`@qf-jarvis/semantic-context-engine` may reuse **context only** when knowledge revision, policy revision, agent scope, purpose and data class match exactly and the entry is approved and unexpired. It may never cache or replay a final customer reply, Core fact, consent decision, entitlement, payment state or other business authority.

Context compression is deterministic and extractive only: deduplicate, rank, bound and truncate retrieved text by literal source substring while preserving citation references. It may not synthesize an ellipsis, marker or uncited summary. A separate content-free retrieval planner may choose only bounded EXACT_FIRST, HYBRID or HYBRID_RERANKED intent and search budgets; it receives no user prose and cannot execute retrieval.

### Multimodal turn planning

`@qf-jarvis/multimodal-turn-planning` maps QuickFurno-provided media metadata to a required certified processing capability. It never fetches Meta media, receives a Meta credential, calls a model, persists media or sends a reply.

QuickFurno remains the media-access authority. Any future media bridge must provide only a minimized derived observation under the existing data-class rules. LOCAL_ONLY may never route to hosted media processing; HUMAN_ONLY is never inspected.

### Governed agent handoff

`@qf-jarvis/governed-agent-handoff` creates a reference-only handoff proposal. The target must match the already-authoritative actor, except that human takeover forces HUMAN. The package cannot alter assignment, create a conversation-control command, change revision, or perform a transition.

Every context reference must explicitly permit the target agent. Free-form conversation content is not part of the proposal.

### Digital twin simulation

The digital-twin package is offline and simulation-only. It compares injected baseline and candidate observations for authority violations, unsupported claims, grounding, latency and cost.

Any reported business effect, Core mutation or provider send is an automatic failure. The package contains no Core client, model/provider client, WhatsApp/Meta client, database adapter, credential ingress or production activation mechanism.

## Containment

This slice adds no migration, managed database change, provider credential, live media bridge, production provider fallback, model activation, WhatsApp send, Core mutation, control transition, autonomous JAO execution or production deployment.

Any production use of these capabilities requires a new exact-SHA certification and the existing owner/evidence gates. The previously merged release candidate remains independently auditable.
