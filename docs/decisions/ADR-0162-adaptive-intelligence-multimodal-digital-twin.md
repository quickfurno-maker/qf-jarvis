# ADR-0162 — Adaptive intelligence, semantic context, multimodal planning, governed handoffs and digital twin

**Status:** Accepted engineering foundation  
**Date:** 2026-09-24

## Context

Jarvis now has a governed production candidate, hybrid retrieval, exact release certification, Core-owned business authority, proposal-only JAO actions and a durable but default-off memory foundation. The next capability tranche should improve intelligence and resilience without turning any of those mechanisms into a second authority path.

The requested capabilities are:

- adaptive model routing;
- semantic caching;
- advanced retrieval / context compression;
- multimodal WhatsApp;
- confidence-aware answering;
- governed agent handoffs;
- certified provider fallback;
- digital-twin simulation.

Several of these can be implemented immediately as deterministic policy or simulation. Others require production assets that do not yet exist. In particular, the current QuickFurno WhatsApp material contract deliberately supplies a provider media id and safe metadata, not raw media bytes or a media URL. Jarvis therefore cannot truthfully claim image/audio/document understanding until QuickFurno defines a reviewed signed content boundary.

## Decision

### 1. Adaptive model routing is a certified-release selector, not a second gateway

`@qf-jarvis/model-intelligence-control` may select an exact release id from an explicit per-complexity policy only after the existing model-gateway capability registry proves that release capable **and** the existing frozen `EvaluationEvidenceVerifier` verifies an exact `ACTIVE_MODEL_RELEASE` certification claim for that release and capability profile. The capability profile's optional `evaluationApprovalRef` is only an opaque forward reference and is never treated as certification by itself.

It owns no provider, transport, credential, endpoint, rollout controller or invocation loop. Selection does not activate inference.

Complexity classes are closed to `SIMPLE`, `STANDARD` and `COMPLEX`. The policy names exact release ids in deterministic order. No model output, latency observation or self-reported confidence may rewrite the routing table at runtime.

### 2. Certified provider fallback is planning only

A fallback may be prepared only when:

- the adaptive policy explicitly enables fallback;
- it contains an exact primary -> fallback release mapping;
- both releases are present in the existing capability registry;
- each release has an explicit evaluation ref, evidence digest and capability-profile ref in the adaptive policy;
- the existing evidence verifier accepts each exact claim for `ACTIVE_MODEL_RELEASE` / `ACTIVE`;
- an opaque capability-profile approval ref without verifier-backed evidence is insufficient;
- both satisfy the same technical capability requirement.

The strongest result is `FALLBACK_READY` with `executionAuthorized: false`.

Actual production fallback remains governed by the existing model gateway rollout/failover path and requires a separately reviewed production composition/certification. This ADR does not enable Nara, local inference or any second provider in the live worker.

### 3. Confidence is evidence-derived, never model self-confidence

The same package may compute an answer posture from bounded external evidence:

- whether grounding is required;
- retrieval hit count;
- citation and grounding coverage;
- ambiguity signals;
- structured-output validity;
- safety blocking;
- whether Core authority is required and available.

The allowed postures are `ANSWER`, `CLARIFY`, `VERIFY_CORE`, `HUMAN_HANDOFF` and `REFUSE`.

A model probability or prose statement such as "I am 90% confident" is not authority and is not an input to this decision.

### 4. Semantic cache is public-knowledge-only and revision bound

`@qf-jarvis/semantic-context-engine` may hold reusable response artifacts only when all of the following are exact:

- scope = `PUBLIC_KNOWLEDGE_ONLY`;
- data class = `HOSTED_ALLOWED`;
- immutable knowledge revision;
- prompt digest;
- model release id;
- agent scope;
- purpose.

The entry stores a query embedding but no raw query, conversation id or subject reference. It must carry citations. A semantic hit requires a bounded cosine-similarity threshold no lower than 0.90; the default is 0.97.

This is not a consent, business-state, Core-state, conversation-state or memory cache. Any of those would create a stale shadow authority and are prohibited.

No persistent production cache adapter is introduced by this ADR.

### 5. Advanced retrieval and context compression are deterministic and citation preserving

The semantic-context package may derive bounded retrieval sizes from a closed complexity class and may extractively compress already-governed `HybridKnowledgeHit` values.

Compression may reorder/select sentences but may not invent content or replace provenance. Every compressed block retains the exact original citation. There is no summarization model and no content-generating compressor in this tranche.

Production runtime adoption remains a separate reviewed composition change; the existing hybrid retrieval path is not silently changed by this ADR.

### 6. Multimodal WhatsApp is planning until a signed media-content boundary exists

`@qf-jarvis/multimodal-turn-planning` consumes only the already-minimized WhatsApp material shape:

- message type;
- normalized text;
- safe caption;
- provider media id;
- optional mime type and filename.

If normalized text exists, it is usable text. A caption may be used as caption text while still declaring the media unseen.

For image, document, audio, video or sticker references without content, the planner returns `MEDIA_CONTENT_REQUIRED` or `CAPTION_ONLY` and names the technical capability required. Every result states `mediaUnderstandingClaimed: false`.

The package downloads nothing, owns no Meta credential and accepts no provider URL. Actual image/audio/document understanding requires a future QuickFurno-owned signed media-content contract and separate data-class/privacy review.

### 7. Agent handoffs are Core-evidence-bound proposals

`@qf-jarvis/governed-agent-handoff` uses the existing ownership mapping:

- CLIENT -> RIYA;
- VENDOR -> ANISHA;
- PROSPECT -> AAROHI.

A cross-agent handoff requires an opaque Core assignment evidence reference. The strongest result is a proposal carrying `businessEffect: false`, `assignmentChanged: false` and `workflowStarted: false`.

It cannot update QuickFurno conversation state, appoint a human, start Temporal or send a message. The real assignment remains QuickFurno/Core authority.

### 8. Digital twin is a zero-effect release-evaluation harness

`@qf-jarvis/digital-twin-simulation` runs deterministic scenario inputs against an injected candidate and compares the returned decision/artifact to expected results.

Every candidate result carries effect counters for provider calls, Core mutations, channel sends, workflow starts and database writes. Any non-zero counter fails the scenario as `EFFECT_OCCURRED`.

Candidate exceptions are reduced to a bounded `CANDIDATE_FAILED` token; raw error text is not retained in the suite result.

The harness may compare a baseline suite and candidate suite to classify regressions, improvements and unchanged scenarios. It grants no release approval. Exact-SHA certification and human/owner approval remain separate.

## Production posture

This ADR adds no production activation and authorizes none of the following:

- no new provider credential;
- no provider invocation or provider fallback in the live worker;
- no dynamic model-routing table learned from traffic;
- no persistent semantic response cache;
- no cache of Core/consent/conversation/memory authority;
- no raw WhatsApp media download;
- no claim that an unseen attachment was understood;
- no agent assignment mutation;
- no autonomous workflow start;
- no JAO authority increase;
- no managed database migration;
- no knowledge activation;
- no JF-5C change;
- no production deployment or Meta send.

Any later production composition must preserve QuickFurno/Core as business authority, use exact certified provider/model releases, and restart the exact-SHA certification chain for the resulting Jarvis revision.

## Verification

Continuous evaluation must build and test all five new packages, including one cross-capability digital-twin suite. The package/app exact-set containment test records the five additions rather than widening to an open-ended package glob.
