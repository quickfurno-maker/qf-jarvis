# ADR-0017 — Live Communication Sequencing

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

The roadmap approved in Phase 0 put the messaging pilot **inside Phase 10**, as gates 10a–10f. Phase 10 would build the n8n bridge and, in the same phase, run a controlled pilot against real recipients — with the caveat that _if Core's dispatch capability was not ready, Phase 10 would exit against a conforming test dispatcher instead._

Read that caveat again, because it is the problem. It makes the most consequential property of the entire project — _whether a real client's phone rings_ — **conditional on the readiness of another team's roadmap.** If Core happened to be ready, Phase 10 would go live. If it happened not to be, Phase 10 would stay in test.

That is not a decision. It is a coin flip dressed as a plan, and it decides the one thing that must never be decided by accident: the first time this system reaches a real person.

There is a second problem underneath it. Phase 10's pilot would run against a **simulated Core interface**, because the real one is Phase 11's work. So the pilot would be exercising consent enforcement, opt-out refusal, and delivery truth against a _mock of the very authority that owns them_. A green pilot would prove that our simulation of Core's consent logic agrees with our contracts — which is a statement about us, not about the world.

**The first real message must not be sent against a fake consent authority.**

## Decision

**Phase 10 is test-only. Phase 11 makes Core integration live. Phase 11A is a separate, gated, controlled communication pilot. No production communication is permitted before Phase 11 succeeds.**

### Phase 10 — n8n Execution Bridge: **TEST ONLY**

Builds and proves the n8n side against the Phase 2 contracts and fixtures:

- test dispatcher; fixtures; **simulated** Core interface
- execution-intent validation — authenticity, integrity, freshness, bounds
- n8n contract validation
- **duplicate-effect testing** — one intent produces at most one provider call initiation
- messaging lifecycle simulation across all eighteen states
- voice-gate design and tests

**Explicitly forbidden in Phase 10:** no production recipient, no live provider, no production message, no production call. Not "discouraged". Not "only with approval". **Forbidden.**

### Phase 11 — QuickFurno Core Integration: **LIVE**

Live canonical event emitters. Recommendation submission. **Core's authorization interface** — the real one. Core's execution-intent dispatch. Result callbacks. **Consent re-validation at execution time.** Reconciliation. Deletion and anonymisation propagation.

This is the phase in which the QuickFurno Communication Core — the actual consent, preference, suppression, and delivery authority — becomes something the system can ask, rather than something it simulates.

### Phase 11A — Controlled Communication Pilot

A gated sequence, and never out of order:

1. **Internal test destinations.** Our own numbers. Nobody else's.
2. **One low-risk transactional purpose.** One. Not a category of purposes.
3. **Human-approved client pilot.** Volume-bounded, every message behind a named human approval.
4. **Delivery and result reconciliation.** Did every result reach Core? Did any retry double-send? Was anything claimed as delivered that was not?
5. **Controlled expansion**, one reversible step at a time.
6. **Voice only after messaging safety evidence.**

### The rule that ties it together

> **No production communication is permitted before Phase 11 succeeds.**

Not before Phase 11 _starts_. Not before it _mostly works_. Before it **succeeds** — meaning Core emits, Core authorizes, Core records, and consent is enforced by the authority that owns it.

### Messaging before voice, still

Voice is not just another channel. It is synchronous, intrusive, impossible to retract, and it brings transcripts, recording consent, quiet hours, and misdial risk with it — **none of which arrive before it.** It goes last, after messaging has demonstrated consent enforcement, at-most-once execution, and authoritative result recording end to end.

**Production outbound voice requires explicit human approval on every call.** Enforced in the contract: a `CommunicationRequestV1` on the voice channel must carry `requiredApproval` of `stronger-approval` or `founder`, and a voice call must reference an approved **script**, not a message template.

### And the boundary, unchanged

**No Jarvis-to-n8n path. No Jarvis-to-provider path.** Execution intents are dispatched to n8n **by QuickFurno Core**. Jarvis cannot construct one — `issuer` is the literal `quickfurno-core` and `executor` the literal `n8n`.

## Consequences

**Positive.**

- **The first real message is sent deliberately**, in a phase whose entire purpose is to send it carefully — not as a side effect of another phase's infrastructure work happening to be ready.
- **Consent is proven against the real authority.** A pilot that proves our mock agrees with our contracts proves nothing about a real client's opt-out.
- **Phase 10 can complete on its own schedule**, with no dependency on Core's readiness and no temptation to "just try one" because the bridge is working.
- **The go-live decision has a name and a gate**, rather than being an emergent property of two teams' timelines.
- **Voice cannot arrive early**, because it sits behind messaging evidence that does not exist until 11A is well underway.

**Negative, and accepted.**

- **The first live message is later than it would have been.** Weeks, plausibly. This is the entire point: the alternative is a first message sent because the plumbing was ready, against a consent check we wrote ourselves.
- **Phase 10 exits without ever having sent anything**, which will feel unfinished. It is not. A bridge proven against fixtures and a conforming test dispatcher is exactly what makes Phase 11's integration testable and Phase 10's correctness provable without waiting on another system.
- **Phase 11 grows.** It absorbs the live cut-over that Phase 10 used to conditionally own. That is the intended trade — the integration risk lands in the phase built to carry it.
- **Renumbering.** Introducing 11A rather than shifting 12–15 keeps existing references intact, at the cost of a non-sequential phase name. Cheap.

## Alternatives rejected

**Keep the pilot in Phase 10, as approved.** Rejected for the two reasons in Context: it makes go-live conditional on another team's schedule, and it validates consent against a simulation of the authority that owns consent.

**Keep the conditional** — go live in Phase 10 _if_ Core is ready, otherwise defer. Rejected most firmly of all. A conditional whose branches are "reach real customers" and "do not reach real customers" is not a plan; it is an unowned decision, and it resolves according to which team shipped faster.

**Run the pilot inside Phase 11 rather than a separate 11A.** Tempting — Core goes live, so just send the messages. Rejected because Phase 11 is a large integration phase, and a controlled pilot buried inside a large phase is a pilot that gets compressed when the phase runs late. The pilot needs its own gates, its own evidence, and its own ability to **stop** without stalling everything else.

**Skip the internal-destinations stage and start with a small client pilot.** Rejected. The first end-to-end send will surface something nobody predicted. It should surface it against our own phone, not a customer's.

**Allow voice in the pilot once messaging gate 3 passes.** Rejected. Messaging _safety evidence_ means reconciliation has run and no double-send occurred — which requires volume and time. Voice brings misdial, recording consent, and quiet-hours risk that messaging never tested, and it does so on a channel that cannot be retracted.
