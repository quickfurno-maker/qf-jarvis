# ADR-0171 — TypeSafe Jev as Jarvis System-One decision plane

**Status:** Accepted
**Date:** 2026-09-29

## Context

Jev is not a chat model. TypeSafe exposes it as a bounded System-One decision API: one state plus
named noul, choice, and score questions produce typed probabilistic answers. Jarvis already has a
separate generative Model Gateway, QuickFurno/Core authority, JAO action admission, governed handoffs,
confidence posture, and deterministic safety gates. Treating Jev as another ModelProvider would merge
two different jobs and would make typed advisory judgments look like generated replies.

## Decision

Jarvis adds a distinct System-One decision plane with two layers:

1. @qf-jarvis/system-one-decision-runtime owns provider-neutral request/result contracts.
2. @qf-jarvis/typesafe-jev-adapter maps those contracts to TypeSafe's fixed
   POST https://api.typesafe.ai/v1/systemone endpoint.

The decision plane is agent-neutral. Requests carry a bounded governed actorRef, not a closed
Riya/Anisha/Aarohi enum. Current and future agents therefore share one decision interface while their
actual permissions remain defined elsewhere.

## Authority boundary

Every System-One completion carries these immutable facts:

- businessAuthority: false
- approvalGranted: false
- executionAuthorized: false

Jev may classify, score, rank, recommend a route, or produce evidence. It may not approve an action,
change QuickFurno/Core state, execute a JAO action, assign an agent, start a workflow, send a message,
or create a customer-facing reply. Existing authority and execution boundaries remain final.

## Activation stages

### Stage 1 — SHADOW

Jev runs only for evidence collection and comparison. Its output cannot change serving behavior.
Initial candidate decisions are:

- specialist-route suggestion;
- urgency and review scoring;
- handoff-candidate scoring;
- retrieval/relevance scoring;
- response-confidence supplementation;
- action-risk screening before JAO admission;
- proactive/anomaly prioritization.

### Stage 2 — ADVISORY

A separately certified decision profile may influence a non-authoritative branch, provided deterministic
safety, Core authority, action admission, and human-review rules still dominate. Low confidence or any
provider failure falls back to the pre-Jev Jarvis path.

### Stage 3 — bounded automation

No generic Jev automation mode exists. Any future automated use must certify one named decision profile,
threshold, data class, fallback, and effect boundary. A model-wide approval can never authorize actions.

## Model identity and drift

jev-latest is acceptable for SHADOW experimentation only. A serving/advisory certification must pin an
exact model identity discovered through TypeSafe's authenticated /v1/models endpoint and must be
re-certified before that identity changes.

## Data and privacy

Only PUBLIC or MINIMIZED_BUSINESS state may cross the Jev boundary. Secrets, credentials, raw
database objects, unrestricted transcripts, and unnecessary personal data are forbidden. Jarvis sends
only the decision state and questions; internal run, actor, authority, and workflow metadata are not
forwarded unless a reviewed profile explicitly needs a minimized field.

TypeSafe states that customer input is not used to train model weights, but it remains an external
processor. Jarvis therefore keeps minimization and purpose limitation as local requirements independent
of provider policy.

## Transport and failure behavior

The Jev transport is pinned to the official HTTPS endpoint, follows no redirects, performs one request,
uses no retry loop, and bounds the response body. Responses are revalidated locally even though the
provider promises typed output. Type mismatch, unexpected choices, probability-key drift, malformed
usage, timeout, cancellation, rate limit, and provider unavailability all fail closed.

Jev is never a single point of failure. Provider failure means the existing deterministic/LLM path
continues unchanged unless a future profile explicitly defines another certified fallback.

## Consequences

This architecture gives every Jarvis agent a fast shared decision primitive without turning Jev into a
chat model, action engine, or authority source. It also keeps future agent onboarding cheap: new agents
register governed identities and decision profiles rather than receiving a new provider integration.
