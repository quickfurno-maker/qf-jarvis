# ADR-0122 — QFJ-P12 / QVGE / AVG-5: the Aarohi Instagram conversation OFFLINE DOMAIN

- **Status:** Accepted
- **Date:** 2026-08-26
- **Owner phase:** QFJ-P12 — Advanced Intelligence and Future Agents
- **Overlay stage:** AVG-5 — Instagram Conversation Integration
- **Supersedes:** nothing
- **Renumbers:** nothing. `QFJ-P00`–`QFJ-P12` are unchanged, and there is no `QFJ-P13`.
- **Related:** [ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (AVG-0/AVG-1),
  [ADR-0111](./ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md) (AVG-2),
  [ADR-0112](./ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md) (AVG-3),
  [ADR-0113](./ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md) (AVG-4),
  [aarohi-vendor-growth-roadmap-overlay.md](../architecture/aarohi-vendor-growth-roadmap-overlay.md)

---

## Context

The overlay sentence for this stage is short and every clause of it is load-bearing:

> **AVG-5 — Instagram Conversation Integration.** Governed inbound/outbound conversation on
> Instagram. Delivery remains provider-side and execution remains n8n-side; Aarohi holds no provider
> credential and calls no Meta API. Consent and eligibility are Core's, revalidated at execution
> time.

AVG-1 through AVG-4 already exist as merged offline domains: a prospect identity that is explicitly
not a vendor, untrusted enrichment evidence, deterministic priority separated from a Core-gated
contact decision, and an inert workspace whose drafts can say only
`READY_FOR_CORE_APPROVAL_REQUEST`. What none of them has is a channel.

### The sequencing decision this ADR is written under

The owner has fixed the order explicitly: **finish Aarohi AVG-5 through AVG-12 first, and only then
adopt the real QuickFurno execution integration under QFJ-P09.** That ordering is what makes the
central decision below the right one rather than merely a cautious one.

### The limitation this ADR refuses to paper over

There is no Core → n8n → Instagram execution path in this repository. There is no Meta provider
adapter, no credential, no webhook and no delivery receipt. Nothing here can honestly report that an
Instagram message was accepted by a provider or delivered to a person, because nothing here could
observe either fact.

So AVG-5 proves two safe directions and stops: Aarohi can **observe** an Instagram conversation, and
Aarohi can **prepare** an outbound candidate. It cannot send one, and this ADR is largely about the
things that had to be left out for that sentence to stay true.

---

## Decision

### 1. The shared executable channel vocabulary is NOT widened, and that is the decision

`packages/contracts/src/communications/communication-channel.ts` declares
`COMMUNICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'voice']`. AVG-5 leaves it exactly as it
found it.

Membership there is not a label. It is the set of channels a `CommunicationRequestV1` may name, which
pulls a channel into the eighteen-state communication lifecycle including its `provider-accepted` and
`delivered` states. Those states can only be asserted by something that watched a provider accept and
deliver. For Instagram, nothing in this repository could — so a member added today would be a promise
that a transport exists, and the first honest thing anyone did with it would be to invent a state.

That is the same argument the shared file already makes about `web`, and it applies here for the same
reason.

**AVG-5 therefore defines an Aarohi-LOCAL token**, `AAROHI_AVG5_CHANNEL = 'instagram'`, inside the
Aarohi domain. It is not a `CommunicationChannel`, and it cannot quietly become one: this package
imports no shared contract at all, so there is nothing for the literal to widen. A containment spec
reads the shared file directly and asserts the four members and the absence of a fifth.

**Adopting a real, executable Instagram channel is QFJ-P09's work.** That later integration must
decide the shared boundary — the request contract, the lifecycle, the n8n route, the provider adapter
and the delivery evidence — as one governed decision. It must not arrive as a side effect of an
offline domain slice, which is exactly what adding a member here would have been.

### 2. Inbound is an OBSERVATION, and its posture says so

`parseInstagramInboundObservation` normalizes one inbound message into a frozen canonical turn. The
contract version, the channel, the direction and the source posture are **stamped** rather than
accepted — there is no input field for any of them — so an injected fixture cannot describe itself as
something better than it is. The posture literal is
`INJECTED_OFFLINE_INSTAGRAM_OBSERVATION`, and it is deliberately unflattering: this is a caller's
report about a conversation, not authenticated provider output.

The body is bounded, trimmed, carriage-return-canonicalized and refused outright if it carries a
control character. Beyond that the user's words are preserved exactly, because **normalizing is not
interpreting**.

### 3. Inbound text establishes nothing

The observation has no field for consent, opt-in, opt-out, STOP, do-not-contact, identity
verification, registration, activation, approval, authorization, provider acceptance or delivery, and
the strict schema refuses a caller that attaches one. Nothing reads the body and concludes any of
them.

Core owns consent and suppression truth and re-decides it at execution time. AVG-7 may later classify
conversation intent as **advisory evidence**; even then it will not become authority. A spec drives a
message reading `STOP. do not contact me. unsubscribe.` through the parser and asserts that the
result is that text and eleven ordinary fields — nothing concluded.

### 4. The conversation snapshot is immutable, finite, deduplicated and canonically ordered

`createInstagramConversation` opens an empty snapshot; `appendInstagramInboundObservation` returns a
new one. Every binding is re-checked on append — a turn from another prospect, conversation, thread
or participant is refused rather than absorbed — and a repeated `instagramMessageRef` is refused,
because provider redelivery is normal and counting one message twice makes a conversation look busier
than it was to a human reading the count. The snapshot holds at most
`MAX_INSTAGRAM_CONVERSATION_TURNS` turns.

**Ordering policy, chosen explicitly:** turns are held sorted by `observedAt`, then by
`instagramMessageRef` to break ties. The alternative — strict append-order refusal — was rejected
because provider events genuinely arrive out of order and refusing a late one would discard a real
observation rather than record it. The consequence is stated rather than left implicit: **array
position carries no chronological claim of its own.** What a reader may rely on is `observedAt`,
which is itself only what a caller asserted about an offline injected report.

**There is no OUTBOUND turn direction.** That is the structural reason an outbound candidate can
never be recorded as though it had been said. Real outbound turns become observable when something
actually sends one, which requires an execution path that does not exist.

**The PUBLIC canonical parser certifies the whole aggregate, not a bag of canonical parts.** Owner
review found that the builder checked every one of these properties as it added a turn while
`instagramConversationSnapshotSchema` and `parseInstagramConversation` checked none of them — so a
hand-assembled snapshot whose top-level binding named one prospect and whose turns named another
parsed, rebuilt and came back canonical. The builder's invariant and the parser's invariant were two
different invariants, and both continuation and candidate preparation trust the parser as their
conversation gate.

The invariant now lives in one source-private helper, over one total comparator that the builder
sorts with and the schema validates against, so the two cannot drift. A snapshot passes only if every
turn matches the top-level binding, no message reference repeats, and the turns are STRICTLY
increasing in canonical order. Ordering and uniqueness are both asked because neither implies the
other.

**An unsorted array is refused rather than reordered.** A public canonical parser certifies the value
it was shown; silently repairing a producer's contract violation would hide the fact that a producer
is violating it. Producing canonical order is the builder's job, and it does it.

### 5. Channel-local identity is not identity, and AVG-6 is not started early

An `instagramParticipantRef` is a handle on one channel. It is not a Core vendor id, not a
cross-channel identity, and it never merges two prospects: the participant reference and the
`prospectRef` are independent fields, neither derived from the other, and a spec proves that a
participant handle equal to another prospect's handle merges nothing.

The association between a conversation and a prospect is labelled
`CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING`. The name is the whole basis. It is not
`VERIFIED_IDENTITY`, not `RESOLVED_IDENTITY` and not `CORE_IDENTITY`, and there is no function here
that takes two prospect references. Omnichannel resolution and the WhatsApp transition are AVG-6's,
and WhatsApp is not named anywhere in this package's source — a containment spec still bans the word
outright.

### 6. Receiving a message is not permission to continue

`evaluateInstagramAcquisitionContinuation` answers one question — may Aarohi keep reviewing this
prospect? — and answers it by **delegating to the AVG-1 Core gate**, not by restating it. The status
map lives in exactly one place, so a status added to Core cannot mean one thing to the workspace and
another to a conversation.

`CONTINUE_AAROHI_ACQUISITION_REVIEW` is the only positive outcome, and it is review continuation. It
is not contact eligibility, not send eligibility, not consent and not a reply instruction. Every Core
status other than `NOT_REGISTERED` stops, including `ACTIVE` — and stopping is all it does, because
ending Aarohi's ownership requires the canonical Core ACTIVE handoff boundary and nothing in this
file can reach it. A cross-prospect or malformed observation stops as well.

The function's signature has two parameters and neither is a score.

### 7. Outbound is a CANDIDATE derived from a canonical AVG-4 OPEN draft

`prepareInstagramOutboundCandidate` calls `evaluateWorkspaceApprovalReadiness` rather than
reimplementing it, so draft validity, profile validity, prospect agreement, OPEN state and the Core
gate are AVG-4's answer and not a second opinion.

**The words come from the draft.** There is no `body` field on the builder's input and the schema is
strict, so a caller cannot review one message and prepare a different one. The candidate binds the
exact `draftRef` and `draftRevision` those words came from, so a reader can go and look at what a
human actually reviewed.

The single positive outcome is `READY_FOR_FUTURE_CORE_INSTAGRAM_COMMUNICATION_PATH`. It is long and
it contains the word FUTURE on purpose: `READY_TO_SEND`, `SEND_ALLOWED`, `AUTHORIZED`, `EXECUTABLE`
and `PROVIDER_READY` are all things this repository cannot make true for Instagram today, and a token
is read by people who will not read the file it came from.

### 8. The CURRENT Core gate is re-run every time

An earlier eligible review is a fact about the past. The observation handed to the builder is the one
consulted, so a prospect that has since become `DO_NOT_CONTACT`, `REGISTERED`, `ACTIVE` or `UNKNOWN`
yields no candidate whatever any earlier review concluded — and whatever priority the prospect
scored, because priority is not an input to this function at all. A cross-prospect observation fails
closed.

`requiresCoreExecutionTimeRevalidation: true` says out loud that even a prepared candidate is not
permission: Core re-decides at execution time, on the far side of a boundary that does not exist yet.

### 9. The negative facts are literals, not prose

Every candidate carries a frozen posture in which `communicationRequestCreated`,
`approvalRequestCreated`, `approvalDecisionCreated`, `communicationAuthorizationCreated`,
`executionIntentCreated`, `n8nExecutionRequested`, `metaApiCalled`, `providerSendRequested`, `sent`,
`delivered`, `businessEffect` and `productionMutation` are all `false`, pinned to that literal by a
strict schema. A posture that could hold `true` for any of them would be a posture worth lying with;
this one cannot even be constructed, and the module fails to load if somebody tries.

### 10. A containment scan was narrowed, deliberately and truthfully

Through AVG-4 the package's containment spec banned the bare substrings `instagram`, `meta`, `n8n`
and `authorization` anywhere in production source. AVG-5 writes three of those — its channel token,
and its declarations that `metaApiCalled`, `n8nExecutionRequested` and
`communicationAuthorizationCreated` are false.

Those are **declarations of absence**. A scan that read them as presence would have forced the public
contract to be renamed around a grep, making the contract less legible in order to keep a test quiet.
So the ban was narrowed to the shapes that would constitute actually reaching a provider — hosts,
endpoints, clients, SDKs, tokens, headers, and any URL at all — and a **stronger** positive assertion
was added in its place: the posture is evaluated and every one of those fields is asserted `false`,
and the shared channel file is read and asserted unchanged. `whatsapp` remains a bare ban.

---

## What AVG-5 deliberately does not do

| Left out                                                                                              | Owner       |
| ----------------------------------------------------------------------------------------------------- | ----------- |
| Shared executable Instagram channel, `CommunicationRequestV1`, lifecycle, n8n route, provider adapter | **QFJ-P09** |
| Omnichannel identity resolution, Instagram → WhatsApp handoff                                         | AVG-6       |
| Reply generation, objection handling, conversation classification, any model call                     | AVG-7       |
| Package, pricing, discount, entitlement, offer truth                                                  | AVG-8       |
| Registration integration                                                                              | AVG-9       |
| Payment, activation, Anisha handoff beyond the existing Core gate                                     | AVG-10      |
| Persistence, dashboard, admin APIs, analytics                                                         | AVG-11      |
| Any increase in autonomy                                                                              | AVG-12      |

There is no database, migration, store, file, cache, scheduler, environment read, secret, HTTP client
or provider SDK. Dependencies are unchanged: `zod` alone.

---

## Consequences

Aarohi has a canonical Instagram conversation domain, and Aarohi still cannot send anything.

The value is narrow and worth stating plainly. When QFJ-P09 builds the real governed execution
highway, it will attach to a domain that already normalizes inbound conversation as untrusted
observation, keeps a bounded deduplicated history, refuses to resolve identity it cannot resolve,
re-runs the Core gate on every outbound preparation, and states every non-effect as a machine-checked
literal. The transport is the part that does not exist. The controls around it are what this slice
is.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts that the first consumer will be a deliberate decision.

**Production Instagram integration remains a separate, later, separately reviewed adoption.**
