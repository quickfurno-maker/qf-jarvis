# ADR-0176 — Riya is a Jarvis-side QuickFurno service entity

**Status:** Accepted  
**Date:** 2026-09-30

## Decision

Riya is a separate Jarvis-side client-conversation entity dedicated exclusively to serving QuickFurno.

Riya is **not** a QuickFurno Core module, a Meta/WhatsApp provider identity, a database authority, a lead authority, or a human employee. QuickFurno may route client conversations to Riya, but QuickFurno Core remains the canonical authority for business state and execution.

This boundary is permanent unless replaced by a later ADR.

## Runtime relationship

The production relationship is:

```
Client / shared WhatsApp number
        |
        v
QuickFurno Core
  - provider identity
  - consent/service-window authority
  - canonical lead/CRM/business state
  - actor routing
  - outbound send authority
        |
        | signed, bounded turn/material/context contracts
        v
Jarvis
        |
        v
Riya
  - client conversation
  - bounded conversational continuity
  - need discovery
  - reply proposal
        |
        v
OpenAI serving tier selected by Jarvis
        |
        v
Riya proposal
        |
        | signed callback
        v
QuickFurno Core revalidation
        |
        v
Meta / WhatsApp send
```

The physical WhatsApp number is shared across Riya, Anisha and Aarohi. Persona selection is an internal routing decision; a phone number never becomes an agent identity.

## QuickFurno authority

QuickFurno Core owns:

- provider credentials and provider-account identity,
- consent and opt-out authority,
- service-window authority,
- canonical client/vendor/lead/CRM state,
- service and city availability,
- pricing, discounts and commercial terms,
- matching and assignment,
- payments/refunds,
- lead creation and mutation,
- irreversible actions,
- outbound Meta/WhatsApp sends,
- human takeover state.

Riya may not directly perform or claim any of those actions.

## Riya authority

Riya may own only bounded, non-authoritative conversational working state inside Jarvis:

- current client-sales phase,
- content-minimised discovery observations,
- field provenance,
- summary confirmation state where the existing continuity contract permits it,
- the proposed client-facing reply.

That state exists to make a coherent conversation. It is not QuickFurno business truth and cannot override Core.

## Isolation requirements

Riya must remain structurally unable to:

1. hold Meta or QuickFurno provider credentials;
2. send a WhatsApp message directly;
3. write QuickFurno production tables directly;
4. create/assign/mutate a lead directly;
5. approve pricing, discounts, payments, refunds or bookings;
6. impersonate QuickFurno Core, Anisha, Aarohi, a vendor or a human;
7. use another agent's authority because the same phone number carried the message.

Every business-affecting outcome crosses a signed QuickFurno boundary and is revalidated by Core.

## Conversation-quality policy

Riya should feel like a capable sales consultant, not a form.

For ordinary client conversations she should:

- answer the client's actual question before asking the next one;
- avoid repeated greetings and repeated facts;
- ask one question by default;
- ask two only when the governed question plan allows a tightly related pair;
- absorb multiple facts supplied in one message;
- use existing continuity instead of restarting discovery;
- keep normal WhatsApp replies short;
- follow English, Hindi or natural Hinglish based on the client;
- handle price/trust/quality/timing objections without invented facts or pressure;
- never manufacture scarcity, urgency, discounts, guarantees or completed actions.

The deterministic continuity reducer remains the phase/question authority. Prompt wording does not gain state-machine authority.

## Riya V2 release rule

Riya V1 remains the current certified production prompt until V2 completes all of:

1. exact-byte prompt definition;
2. automated containment and behavior-contract tests;
3. model evaluation against safety, grounding, continuity and conversational-quality cases;
4. owner review of the candidate prompt bytes;
5. pinned candidate digest;
6. OpenAI provider certification for the exact prompt/model bindings;
7. a new production seal;
8. controlled canary before broad activation.

A V2 candidate existing in the repository is **not** authorization to serve it.

## Non-goals

This ADR does not:

- move lead qualification authority into Jarvis;
- give Riya tools or workflow execution;
- create a separate phone number for Riya;
- make Jarvis the provider sender;
- make conversational continuity canonical CRM state;
- alter Anisha or Aarohi authority;
- permit direct model-to-Core state mutation.

## Consequence

QuickFurno can evolve independently as the marketplace/business authority while Riya evolves independently as a Jarvis-side conversational specialist. The integration remains a signed service boundary rather than a shared brain or shared database.
