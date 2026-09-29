# ADR-0176 — Riya is a Jarvis-side QuickFurno specialist, not QuickFurno Core

**Status:** Accepted  
**Date:** 2026-09-30

## Decision

Riya is an independently owned specialist inside the Jarvis runtime. She serves QuickFurno client conversations, but she is not a QuickFurno Core module, database owner, provider account, workflow authority, or business system of record.

The only production relationship is:

```
QuickFurno Core
  -> signed, bounded turn material / conversation context
Jarvis
  -> routes CLIENT work to Riya
Riya
  -> model-backed conversation proposal
Jarvis
  -> signed reply proposal
QuickFurno Core
  -> revalidates authority and decides whether anything is persisted or sent
```

QuickFurno owns identity, consent, conversation state, service-window state, human takeover, lead state, matching, assignment, pricing, payments, provider credentials, Meta delivery, and every irreversible business action.

Riya owns conversational intelligence for the client role only: understanding the client's message, maintaining a coherent sales conversation from the bounded context supplied for the turn, proposing useful replies, and proposing bounded observations/question plans under the governed Riya schemas.

## Hard boundary

Riya/Jarvis MUST NOT:

- connect directly to QuickFurno's database as business authority;
- own or use QuickFurno Meta/WhatsApp provider credentials;
- send a customer message directly to Meta;
- mutate lead, CRM, matching, assignment, payment, consent, booking, or campaign state;
- invent QuickFurno facts not present in signed material, Core availability, or governed knowledge;
- treat conversational memory as authoritative business state;
- bypass the signed QuickFurno material/context/reply contracts.

QuickFurno MUST NOT embed or reimplement Riya's prompt, model selection, model provider, conversational reasoning, or persona policy. Core routes and authorizes; Jarvis/Riya reasons and proposes.

## One shared WhatsApp number

The physical WhatsApp number is a QuickFurno communication asset. It does not belong to Riya, Anisha, or Aarohi. QuickFurno resolves the party/context and assigns the actor. Jarvis then serves the assigned specialist. Persona identity is therefore independent of provider-account identity.

## Riya behavior evolution

Riya behavior is versioned on the Jarvis side. Prompt/model changes are candidate artifacts until they pass the existing evaluation, approval, seal, and production-release gates. A behavior change never justifies weakening the Core authority boundary.

For the next behavior version, optimize for:

- natural WhatsApp conversation rather than form-like interrogation;
- a useful answer before a sales question when the client asked something;
- one next-best question by default, two only when tightly coupled;
- no repeated greeting or re-asking facts already present in context;
- concise responses by default, expanding only when the client asks;
- natural English/Hindi/Hinglish mirroring;
- progressive qualification without forcing budget/contact too early;
- explicit uncertainty instead of invented business facts;
- graceful human-handoff language without falsely claiming a handoff already occurred.

## Consequences

Riya can evolve quickly without coupling QuickFurno Core to a model provider or prompt implementation. QuickFurno can also change CRM/provider infrastructure without changing Riya's model-side architecture, provided the signed contracts remain compatible.

The cost is deliberate: a Riya prompt/model change requires its own certification lineage before production activation, even when the business application itself is unchanged.
