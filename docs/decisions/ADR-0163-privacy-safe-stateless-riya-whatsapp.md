# ADR-0163 â€” Privacy-Safe Stateless Riya on Production WhatsApp

**Status:** Accepted
**Date:** 2026-09-24
**Supersedes:** the WhatsApp-specific durable-Riya composition portion of ADR-0157 only
**Relates to:** ADR-0019, ADR-0094, ADR-0104, ADR-0157, ADR-0159, ADR-0160, ADR-0162

## Decision

Production WhatsApp MUST NOT compose Jarvis-owned Riya conversation-continuity or logical-turn
persistence while the lifecycle policy for migrations `0011_riya_conversation_continuity.sql` and
`0012_riya_logical_turn_idempotency.sql` remains undecided.

The WhatsApp worker therefore routes RIYA, ANISHA and AAROHI through the same bounded,
single-turn `processInboundForProposedReply` capability. RIYA is represented by a canonical
`partyType: CLIENT` inbound envelope.

QuickFurno remains the durable authority for the WhatsApp turn:

- inbound-message identity;
- conversation identity and exact revision;
- assigned actor / subject type;
- consent and suppression;
- human takeover / pause / cancellation;
- service-window authority;
- reply idempotency and provider send authority.

Jarvis keeps only the already-reviewed file turn spool needed to bound worker execution. It does not
create a second durable client-discovery state for WhatsApp.

## Why

The Riya continuity and logical-turn tables deliberately do not define a production retention,
erasure or expiry policy. Their migrations explicitly defer those decisions. Running live personal
conversation state into those tables would convert an unresolved governance question into an
implementation default.

The production WhatsApp contract already supplies a complete, revision-bound current turn from
QuickFurno and revalidates the same revision before accepting a reply proposal. A one-turn governed
proposal can therefore be safe without Jarvis owning longitudinal conversation state.

## Capability trade-off

This narrows only production WhatsApp Riya behavior. It does not delete or weaken the richer Riya
continuity subsystem used by separately governed surfaces and tests.

On WhatsApp, Riya does not accumulate Jarvis-owned discovery continuity across turns. The model sees
the current normalized turn plus governed knowledge and the current QuickFurno authority state
available to the ordinary Jarvis runtime. Any future restoration of multi-turn Riya discovery on
WhatsApp requires one of:

1. an owner-approved retention/erasure/idempotency lifecycle for the existing Jarvis stores; or
2. a reviewed Core-owned continuity contract that keeps durable conversation state in QuickFurno.

Either change creates a new certification lineage.

## Production invariants

The WhatsApp worker:

- MUST NOT import or construct `createJf6RiyaServiceBoundary`;
- MUST NOT construct `createPostgresRiyaConversationContinuityStore`;
- MUST NOT construct `createPostgresRiyaTurnCoordinator`;
- MUST NOT require a managed-Riya persistence approval artifact;
- MUST keep provider retry budget at zero and fallback disabled;
- MUST bind every proposal to the exact QuickFurno conversation revision;
- MUST leave final consent, service-window and provider-send authorization in QuickFurno;
- MUST keep LOCAL_ONLY media off the certified hosted text-model path.

Tests read the serving source and fail if the durable-Riya production composition is reintroduced.

## Certification consequence

This changes the production composition and therefore invalidates any older exact-SHA JF-5C seal for
the new head. The resulting merged SHA must complete the normal exact-head JF-5 certification chain
before live activation. Older certification evidence remains historical evidence only.
