# ADR-0150 — JF-4B/C/D: three-agent runtime delta closeout without external authority fabrication

- **Status:** Accepted, **as amended by the owner correction in §33–42**. A **composition delta**, not an
  agent build. **No deployment, no live provider call, no external side effect, no QuickFurno
  integration, and no D5 activation.** The correction adds **exactly one migration** — `0014` — under
  explicit owner authorization (§34).
- **Date:** 2026-09-11
- **Baseline:** `origin/main` at `a8129ebda6f4ec567ea6b969aaa361ab59d7c8c0` (PR #200, JF-4A).
  Migrations `0001`–`0013` at baseline; **`0014` is added by the correction (§34)** and the ledger is
  `0001`–`0014` with `0001`–`0013` byte-identical.
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

## Owner correction (§33–42)

The owner reviewed the head above and returned two blockers. Both are closed here, in the same PR.

The first review finding was that a gap I had **reported** was a blocker to close, not a limitation to
accept. That applies to §34 below. The second was that "Anisha and Aarohi are intentionally ungrounded"
was simply wrong: one shared governed RAG is required, and that is §35–§39.

### 33. What the head got wrong, stated plainly

`PROSPECT` was added to the runtime vocabulary and routed to `AAROHI`, and then **could not be
persisted**. Two separate places refused it:

1. the durable store's party `CHECK`, written by migration `0008` with the three types that existed
   then; and
2. the orchestration context schema, which carried **its own** three-value party list rather than
   deriving one from `RUNTIME_PARTY_TYPES`.

Every JF-4 spec passed, because each tested a piece in isolation: `assignAgent` in one file, the
behaviour mux in another, the adapter's gates in a third. **No spec ran a whole `processInbound` for a
`PROSPECT` turn.** A party type the authoritative store cannot hold and the context builder throws on is
not a party type; it is a crash waiting for its first real conversation. `jf4-three-agent-end-to-end`
now runs complete turns for all four party types so this cannot recur.

### 34. Migration `0014` — authorized, and narrow

`0014_conversation_prospect_party_type.sql` does exactly one thing: it drops
`conversation_runtime_state_party_type_known` and re-adds it as
`CHECK (party_type IN ('CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN'))`. Two statements.

It adds no table, column, index, type or view; changes no `DEFAULT`; transforms no row; issues no
`GRANT` or `REVOKE`; activates no D5; and changes no other `CHECK`. Its header documents that
exhaustively, and the containment scans read **statements only** so the documentation cannot be mistaken
for the thing it forbids.

**It was a widening, not a removal.** A dropped constraint would have satisfied "PROSPECT now persists"
and quietly accepted any string forever, so the specs assert both halves: `PROSPECT` is accepted, and an
arbitrary token is still refused at the application layer **and** by the database constraint, by name and
by SQL state `23514`. A database actually taken to `0013` is migrated forward with rows already in it,
and the refusal observed at `0013` becomes an acceptance at `0014`.

**The managed production database is NOT migrated by this lane.** It still carries `0001` only. JF-6 owns
managed parity and application.

### 35. ONE governed RAG, three truthful scopes — not three RAG systems

There is one governed-knowledge authority, one JF-3 provisioner, one revision-bound pack and one
retrieval implementation. What differs per agent is exactly three things: the agent scope a retrieval
runs under, the purpose it runs for, and the exact topics it may ask for.

There is no `riya-rag`, no `anisha-rag`, no `aarohi-rag`, no second registry, no second pack revision and
no vector store — and a repository-wide containment scan proves those paths are not there to take, not
merely untaken. `AgentGroundedKnowledgePolicy` carries `registry`/`retrieval` **once, at policy level**,
so a deployment has exactly one place to point grounding at.

`createRiyaGroundedKnowledgeBridge` survives as a thin wrapper over the generalized
`createAgentGroundedKnowledgeBridge`, so an existing RWC-P7 Riya deployment is byte-unchanged and keeps
precedence when both configurations are present.

### 36. The actor → scope/purpose map is CODE-CLOSED

`AGENT_KNOWLEDGE_BINDINGS` is a frozen total map: `RIYA → CLIENT/CLIENT_RESPONSE`,
`ANISHA → VENDOR/VENDOR_RESPONSE`, `AAROHI → PROSPECT/PROSPECT_RESPONSE`. A deployment configures
**topics**. It cannot configure a scope or a purpose, because `AgentKnowledgeTopicPolicy` has no field
for either.

That split is the whole security property. A caller able to name its own scope could read another
agent's records — a client turn retrieving vendor-only material, or an acquisition turn reading a
registered vendor's operational records. The party type is the trusted caller's statement of fact; the
scope is this repository's conclusion from it, derived from the actor `assignAgent` already chose.

The 3×3 denial matrix is asserted exactly, and the strongest form is measured end to end: a deployment
that **wrongly** configures Anisha with Aarohi's topic still cannot read the prospect record — the
authority reports `knowledge-not-found` rather than `knowledge-permission-denied`, so a vendor turn
cannot even learn that a prospect record exists, and the turn fails closed.

### 37. `PROSPECT` and `PROSPECT_RESPONSE` are the minimum honest additions

`KNOWLEDGE_AGENT_SCOPES` gained `PROSPECT` and `KNOWLEDGE_PURPOSES` gained `PROSPECT_RESPONSE`. Neither
`CLIENT` nor `VENDOR` was reused for Aarohi — that would make an acquisition turn indistinguishable from
a client or a registered-vendor turn at the authority boundary — and `COORDINATION` was not borrowed
merely to avoid a vocabulary addition. The permission scope cap is now bound to the vocabulary's own
length rather than to the literal `4` it used to carry.

### 38. Zero configured topics means NO retrieval, never "retrieve everything"

An agent with no configured topics, and an agent configured with an **empty** list, both reach the
authority zero times. `topicsForActor` returns `undefined` rather than an empty array so a caller cannot
confuse "this deployment did not configure Aarohi" with "Aarohi is configured to ask for nothing" — both
mean no retrieval, and neither means retrieve everything. There is no wildcard, no `latest`, no pattern,
and no selector derived from a message, a model or a channel.

### 39. No content was fabricated

`PRODUCTION_KNOWLEDGE_RECORDS` remains **0**, by design. Synthetic records exist only inside specs and
say so in their own content. Nothing was sourced from assistant memory, test fixtures, the web, the
QuickFurno repository, old training corpora or invented FAQs.

The empty pack's derived revision is **unchanged** by the vocabulary additions and is now pinned as a
literal, because that revision is the approval binding: if a vocabulary change could move it, every such
change would silently invalidate a production approval.

### 40. Party type alone selects the policy, and costs no extra state read

The knowledge port is reached only **after** the orchestrator's complete first gate has passed
(ADR-0068), so at the only moment the bridge can be used, takeover is already known false and the actor
is a pure function of the party type. Reading control state again here to learn something the gate has
already decided would add a read to every turn and a second place that believes it.

`UNKNOWN` needs no special case: it routes to `JARVIS` or `HUMAN`, neither of which is a grounded
business agent, so the lookup returns nothing and no turn can borrow another agent's topics.

### 41. Aarohi has no MODEL scope in Production V1 — measured, not assumed

This is the correction's honest residue, and it is recorded rather than hidden.

`MODEL_AGENT_SCOPES` and `PROMPT_AGENT_SCOPES` are `CLIENT | VENDOR | COORDINATION | SYSTEM`. There is no
prospect member, so a **model-eligible** acquisition turn reaches the draft step and **fails closed**
with `orchestration-draft-invalid` and **zero** gateway calls. The end-to-end spec asserts exactly that
figure rather than a loose bound, so a regression that started calling a model for Aarohi would fail.

That is consistent with Aarohi's own domain rather than a contradiction of it: AVG-7 pins `modelCall`,
`promptResolution` and `retrieval` to literal `false`, and the strategies that matter today map to
`NO_ACTION` or `ESCALATE_TO_HUMAN` with no model. What grounding buys her in V1 is therefore the
**boundary**, not a draft: the retrieval happens, under the `PROSPECT` scope, from the one shared
authority, and no other agent can read what it returns.

Closing it would mean adding a prospect member to the **model gateway and prompt-registry** scope
vocabularies, which binds to approved-release and evaluation identities. That is a separate authorized
lane — `JF-5` is where real models and their scope bindings are certified — and this correction was not
authorized to touch it. **Flagged for the owner rather than decided here.**

### 42. What this correction did NOT do

No D5 activation and no grant change. No QuickFurno, OneDecore, Meta or n8n. No provider call and no
credential. No managed-database migration. No new dependency, no vector store, no embedding, no
training or benchmark asset touched. No historical evidence or dataset deleted. Riya's behaviour is
byte-unchanged, and her web wire stays client-only.

## Consequences

Positive: the result is smaller than a rebuild. All three agents are representable, deterministic and
testable behind Jarvis boundaries, and JF-5 needs no architectural work.

Negative, and accepted:

- **Two shared vocabularies grew.** `RUNTIME_ACTORS` and `RUNTIME_PARTY_TYPES` are closed sets every
  package reads, so adding a member touches exact-set locks by design. Five existing locks were narrowed
  — including Aarohi's own "nothing composes this leaf", which becomes "exactly one package, in one
  file". Each records what it buys.
- **One migration was needed after all.** The head claimed none; `0014` is it, narrowly and under owner
  authorization (§34). The ledger is `0001`–`0014` and `0001`–`0013` are byte-identical.
- **Aarohi is composed, grounded and still unsupplied.** Her acquisition ARTIFACTS wait on a future
  QuickFurno/Core adapter, and she has no model scope in V1 (§41). Her governed retrieval boundary,
  however, is real and shared. That is the honest state, not a defect.
- **Two more shared vocabularies grew.** `KNOWLEDGE_AGENT_SCOPES` and `KNOWLEDGE_PURPOSES` each gained
  one member (§37), and the jarvis-runtime root barrel deliberately gained **type exports only** — its
  locked runtime-value surface is still six symbols.
- **The two AVG-10 gaps are still open**, and are JF-5/JF-7 prerequisites rather than JF-4 work.

## Next

**JF-5** — real Groq/Nara certification for all three agents.
