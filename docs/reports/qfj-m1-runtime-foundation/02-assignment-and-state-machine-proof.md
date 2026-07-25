# Report 02 — Assignment and State-Machine Proof

**Slice:** QFJ-M1 — Agent and Conversation Runtime Foundation. **ADR:** [ADR-0054](../../decisions/ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md).

## Deterministic assignment

`assignAgent` is a pure function of party type, human-takeover state, and the routing policy — **no model guess, no randomness, no clock** (proven deterministic across repeated calls):

| Party / state       | Assigned actor                                 |
| ------------------- | ---------------------------------------------- |
| CLIENT              | **RIYA**                                       |
| VENDOR              | **ANISHA**                                     |
| UNKNOWN             | **JARVIS** (default) or **HUMAN** (per policy) |
| any, human takeover | **HUMAN** (overrides all AI assignment)        |

## Strict actor ↔ party scope

The single scope rule keeps Riya client-only and Anisha vendor-only: `isActorPartyCompatible`/`assertActorPartyCompatible` permit RIYA only on CLIENT and ANISHA only on VENDOR (Jarvis/Human/System may coordinate on any party). Proven: a REPLY proposal with actor `RIYA` on a `VENDOR` party is refused (`scope-violation`), and `ANISHA` on a `CLIENT` party is refused. Every proposal factory enforces this, so no cross-scope agent action can be constructed.

## Envelope validation

`createInboundEnvelope` deep-freezes a valid envelope and rejects (proven) an invalid identifier, a non-canonical instant, an unknown data class, and any extra field (e.g. a `webhookSecret`) — the schema is strict, so no provider SDK object, token, or arbitrary metadata can enter.

## Conversation-state machine (fail closed)

`isValidConversationTransition` permits only the closed graph and **fails closed** on any other transition (proven: `CLOSED → ACTIVE_AI` and `NEW → WAITING_EXTERNAL` are rejected). Returning control to AI from `HUMAN_TAKEOVER` (or `ESCALATED`) is permitted **only** with an explicit `authorized: true` — there is **no automatic release** from human takeover (proven: the transition is false without authorization and true with it).
