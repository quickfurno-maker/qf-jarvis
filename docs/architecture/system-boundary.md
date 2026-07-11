# System Boundary: QuickFurno Core ↔ QF Jarvis

This is the authoritative statement of the permanent architectural boundary
between QuickFurno Core and QF Jarvis. It constrains every current and future
phase of this repository. Nothing in Jarvis may violate it.

## Roles

- **QuickFurno Core** owns truth and operational state: business state, policy,
  authorization, money, and the state of leads, clients, vendors, wallets, and
  packages. It is the single system of record.
- **QF Jarvis** is intelligence: reasoning, recommendations, coordination,
  prioritization, specialist-agent orchestration, and founder decision support.
- **n8n** is the approved execution fabric.
- **External providers** (WhatsApp, SMS, email, voice, CRM, Google Ads, Meta
  Ads, and other delivery providers) deliver.

## The permanent rule

```
Jarvis recommends.
QuickFurno authorizes.
n8n executes.
Providers deliver.
Execution results return to QuickFurno Core.
```

## What this means concretely

1. **QuickFurno Core owns truth and operational state.** Jarvis holds no
   authoritative business state. Any state Jarvis keeps is derived, cached, or
   advisory, and is always reconcilable from Core.

2. **Jarvis receives versioned facts/events and produces structured
   recommendations.** Input is an explicit, versioned contract (facts and
   events). Output is structured recommendations and execution intents — never
   an ad-hoc side effect.

3. **Jarvis does not directly mutate QuickFurno business state.** It never
   writes to Core's tables, never assigns leads, never moves money, never
   changes client/vendor/wallet/package state. It proposes; Core decides.

4. **Jarvis does not directly send provider communications.** It never calls
   WhatsApp, SMS, email, voice, ad, or CRM providers itself. It emits an
   execution intent that QuickFurno authorizes.

5. **n8n executes approved execution intents.** Only after QuickFurno authorizes
   a recommendation does n8n carry it out against providers.

6. **External results return to QuickFurno Core.** Delivery outcomes flow back
   to Core, not to Jarvis directly.

7. **QuickFurno Core then emits resulting state changes/events.** Those events
   are what Jarvis observes next, closing the loop. Jarvis learns about the
   effects of its recommendations only through Core's emitted events.

## The flow, in one diagram

```
                 ┌─────────────────────────────────────────────┐
                 │                QuickFurno Core               │
                 │   (truth, policy, authorization, state)      │
                 └───────────────┬─────────────────▲───────────┘
       versioned facts / events  │                 │  execution results
                                 ▼                 │
                 ┌─────────────────────────────────┴───────────┐
                 │                  QF Jarvis                   │
                 │  reasoning · recommendations · intents       │
                 └───────────────┬─────────────────────────────┘
             recommendations /   │
             execution intents   │  (authorized by Core)
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │                     n8n                      │
                 │             (execution fabric)               │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │   Providers: WhatsApp · SMS · Email · Voice  │
                 │            CRM · Google Ads · Meta Ads       │
                 └─────────────────────────────────────────────┘
                       results ──▶ back to QuickFurno Core
```

## Integration is contract-first (not shared tables)

QuickFurno and Jarvis integrate **only** through explicit, versioned contracts
and events — never through shared database tables or shared ORM models. This
keeps the boundary enforceable and independently evolvable. See
[ADR-0002](../decisions/ADR-0002-contract-first-integration.md).

## Mandatory before QuickFurno integration

Phase 0A ships no business endpoints, so it has no authentication. Before any
real QuickFurno integration, the following are **mandatory**, not optional:

- **Internal service authentication** between QuickFurno Core, Jarvis, and n8n.
- **Signed event intake**: Jarvis must verify the authenticity and integrity of
  every inbound fact/event, and every recommendation/intent it emits must be
  attributable and verifiable by Core.
