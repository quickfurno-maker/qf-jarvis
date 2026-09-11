# ADR-0150 — JF-4B/C/D: three-agent runtime delta closeout without external authority fabrication

- **Status:** Accepted — a **composition delta**, not an agent build. **No deployment, no live provider
  call, no external side effect, no QuickFurno integration, no migration, and no D5 activation.**
- **Date:** 2026-09-11
- **Baseline:** `origin/main` at `a8129ebda6f4ec567ea6b969aaa361ab59d7c8c0` (PR #200, JF-4A).
  Migrations `0001`–`0013`. **JF-4B/C/D adds none.**
- **Governed by:** ADR-0145 (JF-1 scope freeze), ADR-0146/0147 (JF-2 gateway), ADR-0148 (JF-3 RAG),
  ADR-0149 (JF-4A Mastra customer composition)
- **Depends on:** ADR-0054 (M1 runtime, actors, party types, `assignAgent`), ADR-0068 (Riya behaviour
  seam), ADR-0071 (Anisha vendor journey + behaviour mux), ADR-0085/0111–0113/0122–0128/0130 (Aarohi
  AVG-1…AVG-12), ADR-0103 (RWC-P7 grounding), ADR-0104 (RWC-P8 channel-neutral turn)
- **Reconciles:** the historical D6 sequencing prohibition — see §21, to a strictly limited extent

## Context

Three agents were already built. Only one was reachable.

1. **Riya** was built and runtime-composed (ADR-0068), and JF-4A added the application shell and the
   JF-3 retrieval port. Canonical, and untouched here.
2. **Anisha's** vendor journey was built and composed into `createJarvisRuntime` (ADR-0071), with a
   two-pair behaviour mux already routing `VENDOR + ANISHA` to her adapter.
3. **Aarohi's** AVG-1…AVG-12 acquisition domain was fully implemented and offline-certified — and the
   generic runtime could not name it at all. `RUNTIME_ACTORS` had no `AAROHI`, `RUNTIME_PARTY_TYPES` had
   no `PROSPECT`, and `@qf-jarvis/aarohi-agent` said in its own containment spec that **no package or
   app imports it**.

So the missing work was representation and routing, not behaviour. This ADR records what was reused and
the small seam that was genuinely absent.

## Decision

### 1–3. Riya, Anisha and Aarohi were already built

No agent was rebuilt. `packages/riya-agent`, `packages/anisha-agent` and every Aarohi domain file are
**unchanged**. JF-4A stays canonical for the customer path.

### 4. This is a composition delta

Five things were genuinely missing: the `AAROHI` actor, the `PROSPECT` party type, one routing case, a
third mux pair, and one behaviour adapter that calls an evaluator Aarohi already had.

### 5–8. One of each authority

One Jarvis runtime, one QF Model Gateway as provider authority, one governed-knowledge authority, one
durable conversation-control state. None of them changed.

### 9. Deterministic assignment only

`assignAgent` remains a pure total function of `(partyType, humanTakeover, policy)`. No model, channel,
message text, score or network influences it, and no sibling router was created — the existing `switch`
gained one case.

### 10. Final ownership table

| Party               | Agent                         | Notes                         |
| ------------------- | ----------------------------- | ----------------------------- |
| `CLIENT`            | `RIYA`                        | unchanged                     |
| `VENDOR`            | `ANISHA`                      | unchanged                     |
| `PROSPECT`          | `AAROHI`                      | **new**                       |
| `UNKNOWN`           | `JARVIS` / `HUMAN` per policy | byte-equivalent               |
| any, under takeover | `HUMAN`                       | checked **before** the switch |

### 11. Why an Aarohi prospect must not be mislabeled `VENDOR`

Aarohi's own contracts state that a prospect is explicitly **not** a Core vendor: its identity is opaque
and deliberately not a vendor identity, and its existing-vendor gate admits exactly one Core status,
`NOT_REGISTERED`.

Routing an unregistered prospect through `VENDOR` to avoid touching a vocabulary would therefore have
made the runtime assert the one thing Aarohi's domain exists to deny — and it would have handed the turn
to Anisha, whose journey assumes a registered relationship that does not exist yet. The prospect would be
answered about a relationship it does not have.

### 12. `PROSPECT` is the minimum honest change

A search for an already-merged prospect/acquisition discriminator found none. So one actor and one party
type were added, plus one routing case and one scope rule — and `AAROHI` is exactly as exclusive as
`RIYA` and `ANISHA`: it may act **only** on `PROSPECT`, and neither of the others may act on `PROSPECT`.

Who a party IS remains the trusted caller's statement. JF-7 freezes that external contract.

### 13. The behaviour mux stays exact-pair, with no fallback

Two pairs became three. It is still not a registry, still not a loop, still no "ask each adapter until
one answers". A selected adapter's `undefined` or rejection is the turn's answer and the others are never
consulted — and with three agents that matters more, not less: an acquisition prospect answered by the
vendor journey would be told about a relationship it does not have, and a registered vendor answered by
the acquisition brain would be sold something it already bought.

### 14. The Aarohi adapter reuses a named existing evaluator

`evaluateAarohiSalesTurn` **already is** Aarohi's turn-level decision. It binds an injected reading to
the CURRENT inbound message of a certified AVG-5 conversation, refuses a stale reading once a newer turn
exists, checks the causal chain as semantic UTC instants, re-runs the AVG-1 existing-vendor gate so only
`NOT_REGISTERED` proceeds, and derives one of six closed strategies through a deterministic total policy
the caller cannot influence.

So **no `decideAarohiTurn` was written.** The adapter reads one port, calls that one evaluator once, and
maps its closed strategy vocabulary onto the existing M2 proposal vocabulary:

| AVG-7 strategy                       | M2 proposal kind    | model permitted |
| ------------------------------------ | ------------------- | --------------- |
| `PREPARE_NONCOMMERCIAL_REPLY_BRIEF`  | `REPLY`             | yes             |
| `PREPARE_CLARIFYING_REPLY_BRIEF`     | `REPLY`             | yes             |
| `REQUEST_CORE_COMMERCIAL_CONTEXT`    | `NO_ACTION`         | **no**          |
| `REQUEST_CORE_PROCESS_CONTEXT`       | `NO_ACTION`         | **no**          |
| `REQUEST_CORE_CONTACT_POLICY_REVIEW` | `ESCALATE_TO_HUMAN` | no              |
| `REQUEST_HUMAN_REVIEW`               | `ESCALATE_TO_HUMAN` | no              |

The two `REQUEST_CORE_*_CONTEXT` rows are the consequential ones. AVG-8 and AVG-9 exist precisely because
a commercial or registration/payment question must stop at Core reference data — no price, package,
discount, registration step, payment or activation claim may originate in Aarohi. A `REPLY` there would
invite a model to answer a question Core has not answered.

**Model eligibility comes from the domain**, not the adapter: `brief.futureModelDraftEligible` is ANDed
with the map. Deciding it in the composition root would put a sales-ethics judgement in the wrong layer.

### 15–16. Model calls are the existing generic ones; Mastra adds zero

A model-eligible Aarohi decision enters the same M2/M4 path Riya and Anisha use, through the QF Model
Gateway, at most once. The adapter imports no gateway, no provider and no Mastra. Anisha and Aarohi reuse
JF-4A's `runCustomerTurnWorkflow` — **one** Mastra architecture in the application, not three — with no
memory, no storage, no scheduler and no retry.

### 17. Riya's web wire is unchanged and stays client-only

It still fixes `WEB`, `CLIENT`, `INBOUND`. It was **not** genericized so a caller could choose its own
party type: that boundary deliberately forbids exactly that. Anisha and Aarohi are reached through an
**internal** application composition with no HTTP route, no socket and no signature contract.

### 18. `completeCoreActiveHandoff` remains the sole route to Anisha ownership

No `handoffToAnisha`, `markActive`, `assumeActive`, `vendorActivated` or caller `isActive` was created,
and the adapter does not import, wrap or name the handoff function at all. Ownership moves as:

```
Aarohi acquisition → governed registration/payment assistance
  → authoritative Core fact says ACTIVE
    → existing completeCoreActiveHandoff  → HANDED_OFF_TO_ANISHA
      → the NEXT canonical turn is classified VENDOR by the trusted caller
        → existing assignAgent selects ANISHA
```

The transition is a governed domain result plus a later classification — **never a hidden mid-turn router
mutation.** A spec asserts no composition file writes `.assignedActor`.

### 19. Core remains the registration, payment and ACTIVE authority

Unchanged. A provider receipt, a model claim, a RAG statement, a caller boolean and Aarohi's own case
state are each refused as activation authority by the existing gate.

### 20. The two AVG-10 external gaps remain explicit

Post-registration continuation/correlation identity, and the bridge into `AWAITING_CORE_ACTIVATION` based
on external Core truth, are **still absent**. JF-4 fabricated neither. No default implementation, no
static production fake, no environment-derived pretend truth and no inference from unrelated facts. An
absent fact is a stop, per existing Aarohi semantics.

### 21. The historical D6 sequencing prohibition is superseded — ONLY for internal inert composition

Owner ruling, dated 2026-09-11. Jarvis may now compose Aarohi into its **internal** V1 runtime before
QuickFurno-side implementation, provided every external business-authority dependency remains injected,
explicit, absent by default, fail-closed, non-fabricated and non-activated. All of those hold: the Aarohi
input port is optional and unsupplied, and an absent port means a `PROSPECT` turn takes the legacy path.

This does **not** authorize — and JF-4 did none of — pretending Core adopted an event it has not,
fabricating registration/payment/ACTIVE/consent truth or recipient identity, sending a message, provider
execution, D5 activation, DB grant widening, QuickFurno code or calls, or n8n/Meta calls.

The distinction, stated plainly:

- **JF-4B/C/D** = internal Jarvis three-agent runtime composition, real authority ports still unbound.
- **Historical D6/D7/D8** = live external communication/execution integration, still subject to its own
  external adoption and permission gates, which remain intact and unsatisfied.

### 22–25. What stays gated

External Core adoption and live-execution gates are untouched. **D5 is reused, not activated**: its
projection handler and migration `0013` exist and no JF-4 file references them; the production projection
role still lacks the event-log payload grant, and JF-4 did not widen it. No DB permission change. No
QuickFurno integration.

### 26–28. No side effect, no provider, no deployment

All three agents remain proposal/reply systems. Model output is a DRAFT; only a Core-authorized result
becomes `authorizedReply`. No WhatsApp, Instagram, Meta, n8n, payment call, vendor activation, lead
creation or assignment. No real Groq/Nara call and no credential. Nothing binds a listener.

### 29–32. Next

**JF-5** certifies all three agents with real models. **JF-6** deploys and wires authenticated operator
controls. **JF-7** freezes the external three-agent/Core handshake. **QH-1** supplies the real QuickFurno
adapters.

## Consequences

Positive: the result is smaller than a rebuild. All three agents are representable, deterministic and
testable behind Jarvis boundaries, and JF-5 needs no architectural work.

Negative, and accepted:

- **Two shared vocabularies grew.** `RUNTIME_ACTORS` and `RUNTIME_PARTY_TYPES` are closed sets every
  package reads, so adding a member touches exact-set locks by design. Five existing locks were narrowed
  — including Aarohi's own "nothing composes this leaf", which becomes "exactly one package, in one
  file". Each records what it buys.
- **Aarohi is composed but unsupplied.** A `PROSPECT` turn reaches nothing until a future QuickFurno/Core
  adapter provides certified artifacts. That is the honest state, not a defect.
- **The two AVG-10 gaps are still open**, and are JF-5/JF-7 prerequisites rather than JF-4 work.

## Next

**JF-5** — real Groq/Nara certification for all three agents.
