# ADR-0123 — QFJ-P12 / QVGE / AVG-6: the Aarohi omnichannel identity and WhatsApp handoff OFFLINE DOMAIN

- **Status:** Accepted
- **Date:** 2026-08-27
- **Owner phase:** QFJ-P12 — Advanced Intelligence and Future Agents
- **Overlay stage:** AVG-6 — Omnichannel Identity and WhatsApp Handoff
- **Certified baseline:** `d4072ed4db69994218faf87f5afe7abb771ec4e9`
- **Supersedes:** nothing
- **Renumbers:** nothing. `QFJ-P00`–`QFJ-P12` are unchanged, and there is no `QFJ-P13`.
- **Related:** [ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (AVG-0/AVG-1),
  [ADR-0111](./ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md) (AVG-2),
  [ADR-0112](./ADR-0112-qfj-p12-avg3-aarohi-scoring-outreach-eligibility-domain.md) (AVG-3),
  [ADR-0113](./ADR-0113-qfj-p12-avg4-aarohi-outreach-workspace-domain.md) (AVG-4),
  [ADR-0122](./ADR-0122-qfj-p12-avg5-aarohi-instagram-conversation-offline-domain.md) (AVG-5),
  [aarohi-vendor-growth-roadmap-overlay.md](../architecture/aarohi-vendor-growth-roadmap-overlay.md)

---

## Context

The overlay sentence for this stage:

> **AVG-6 — Omnichannel Identity and WhatsApp Handoff.** Resolving one prospect across channels, and
> the transition from Instagram to WhatsApp. Identity resolution is evidence-based and reviewable; a
> merge is a recommendation, never a silent rewrite of who someone is. WhatsApp remains QuickFurno's
> existing approved infrastructure and is not activated here.

AVG-5 left Aarohi able to observe an Instagram conversation and prepare an inert outbound candidate.
What it could not do is say that the person in that conversation is also the person behind a WhatsApp
handle, and it deliberately refused to guess: `CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING` was named
that way precisely so nobody read it as resolved identity. AVG-6 is where that question gets asked
properly.

### The sequencing decision this ADR is written under

The owner's order is fixed: **finish Aarohi AVG-6 through AVG-12 first, and only then adopt the real
QuickFurno execution integration under QFJ-P09.**

### The limitation this ADR refuses to paper over

Nothing available to this domain can prove that two handles are one person. A self-assertion is a
claim, an operator's reading is a judgement, and a public profile referencing both is a coincidence
until something authoritative says otherwise. QuickFurno Core owns identity truth when it has any,
and it is not being asked here.

So AVG-6 proves what it can and stops: evidence can be held, bounded and reviewed; a link can be
RECOMMENDED; a channel transition can be PREPARED. Nothing is merged, nothing is resolved, and
nothing is sent.

---

## Decision

### 1. A merge is a recommendation, never a rewrite — and that is structural

There is no `mergeIdentities`, no `mergeProspects`, no `resolveIdentity`, and no function anywhere in
this domain that takes two identities and returns one. There is no field that could record that a
merge happened: `identityMerged`, `coreIdentityMutated`, `identityVerified` and `consentEstablished`
are pinned to the literal `false` by a strict schema, and the module fails to load if somebody
constructs a posture that says otherwise.

Being wrong about who somebody is has a particular shape of harm. It silently attaches one person's
conversation, history and eventual contact to another person's record, and nobody notices until
something reaches the wrong human. A recommendation can be refused; a rewrite cannot be un-noticed.

### 2. Two things called "handoff", and the names keep them apart

AVG-6's handoff is a CHANNEL transition — Instagram to WhatsApp. The other handoff is Aarohi's
acquisition ownership passing to Anisha, which happens only on authoritative Core ACTIVE through
`completeCoreActiveHandoff` (AVG-1, ADR-0085).

They are not the same thing and must never become confusable, so the types are named
`WhatsAppChannelHandoffCandidate` and `WhatsAppChannelHandoffPosture` rather than `Handoff*`. AVG-6
does not import `completeCoreActiveHandoff`, does not import the acquisition case at all, transitions
nothing, and its candidate states `acquisitionCaseMutated: false` and `anishaHandoffExecuted: false`.
A containment spec reads the AVG-6 source and asserts every one of those names absent.

### 3. No destination is stored, under any name

A WhatsApp participant reference is an OPAQUE channel-local handle. Two screens apply and neither
alone is enough: the opaque character class refuses `@`, `/`, `+` and whitespace, which rules out an
address, a link and most written numbers; and a conservative contact-shape screen — the same shapes
AVG-2 uses, named by SHAPE rather than by platform — refuses a bare run of seven or more digits,
which is exactly what a phone number is once somebody strips the punctuation. The same screen applies
to `sourceRef`, because provenance is a natural place to hide one.

The shared `CommunicationRequestV1` is built on the same principle: it names an opaque Core recipient
and carries no number either, because resolving an actual recipient is Core's job at execution time.
AVG-6 does not import it.

**A mutation review finding worth recording.** Two of the contact shapes — the address shape and the
fetchable-location shape — are unreachable through the character class alone, so removing either
changed nothing until the class was widened alongside it. They are kept as defence in depth for the
day a reference format legitimately needs a wider class, and the mutation proofs now remove both
guards together so the shape screen is genuinely the thing under test.

### 4. Evidence is untrusted, bounded and reviewable

A `CrossChannelIdentityEvidenceClaim` says one thing: whether one observation SUPPORTS or CONTRADICTS
these two handles being one party. There is no `PROVES_SAME_PARTY`, no confidence number, no message
body, no consent field and no Core identity — the strict schema refuses a caller that attaches one.
The posture is stamped `INJECTED_OFFLINE_IDENTITY_EVIDENCE`, and there is no input field for it, so a
fixture cannot describe itself as provider-authenticated or Core-verified.

The bundle is immutable, capped at `MAX_IDENTITY_EVIDENCE_CLAIMS`, deduplicated by `evidenceRef`, and
canonically ordered by the **semantic UTC instant** then `evidenceRef`.

**The public parser certifies the whole aggregate**, not a bag of individually valid claims: every
claim must match the bundle's binding, no reference may repeat, and claims must be strictly
increasing. That invariant lives in one source-private helper used by the schema, the parser and the
builder. AVG-5's owner review found exactly the opposite arrangement — a builder that checked
everything and a parser that checked nothing — and this file is written with the fix rather than the
bug. The same applies to the comparator: it orders by the instant, not the timestamp string, because
the canonical grammar makes milliseconds optional and `09:00:00.500Z` sorts before `09:00:00Z`
lexicographically.

An unsorted bundle is refused, not reordered.

### 5. The recommendation policy is deterministic, and every clause earns its place

`LINK_RECOMMENDED` requires **all** of: a canonical bundle; no contradicting claim at all; at least
two supporting claims from corroborating sources; those claims coming from at least two DISTINCT
`sourceRef`s; and at least one from a source whose role is `CORROBORATING` rather than merely
`WEAK_CORROBORATING`.

Each clause exists because of a specific way weak evidence looks strong:

- **Distinct source references**, because the same observation recorded twice is one observation, and
  two evidence references is exactly how it comes to look like two.
- **A non-weak leg**, because public data repeats itself — two listings quoting the same directory
  corroborate nothing, and `PUBLIC_REFERENCE_CORROBORATION` is graded `WEAK_CORROBORATING` for that
  reason.
- **No contradiction**, because one credible denial outweighs any amount of circumstantial agreement
  when the cost of being wrong is attaching the wrong human to a record.
- **`UNKNOWN` provenance contributes nothing**, graded `NON_CORROBORATING`, so unrecorded provenance
  is visibly worth zero rather than quietly worth something.

`IDENTITY_SOURCE_ROLE` is a TOTAL map over the closed source vocabulary, so a source kind added later
fails to compile until somebody decides what it may corroborate.

There is no threshold to tune, no score, no model, and nothing that gets easier as evidence piles up
beyond the two independent legs. Everything else is `REVIEW_REQUIRED` — which is not a failure state.
It is a person looking, which is the correct outcome for a question this domain cannot settle.

### 6. The handoff candidate binds a real conversation and a real recommendation

`prepareWhatsAppChannelHandoffCandidate` requires a canonical AVG-5 conversation (through AVG-5's own
public parser, so a forged mixed-prospect snapshot is refused there and the refusal is inherited), a
recommendation whose outcome is `LINK_RECOMMENDED`, and a recommendation whose prospect and Instagram
participant match that conversation.

There is no `body`, `message`, `template`, `prospectRef` or `whatsappParticipantRef` on the builder's
input, and the schema is strict — so a caller cannot re-point a candidate at somebody else or attach
content to it. A candidate is also refused if its `preparedAt` precedes the `createdAt` of the
recommendation it rests on; both are caller-asserted canonical instants and no clock is read.

### 7. Identity evidence is not acquisition permission

Those are separate questions with separate authorities, and the builder asks both. A positive
recommendation says two handles are probably one person; the AVG-1 Core gate says whether Aarohi may
be approaching that person at all. Any amount of the first buys none of the second: the CURRENT Core
observation is re-run through the existing gate every time, exactly `NOT_REGISTERED` proceeds, and a
prospect who has since become `DO_NOT_CONTACT`, `REGISTERED`, `ACTIVE`, `UNKNOWN`, `AMBIGUOUS` or
`CORE_UNAVAILABLE` yields no candidate however well-evidenced the link is. A spec drives eight
independent corroborating claims against current suppression and gets nothing.

### 8. Consent stays Core's, and the candidate says what is still owed

A prospect saying "message me on WhatsApp" may be identity evidence. It is not a consent record, and
this domain creates none: there is no `consent`, `optedIn`, `canContact` or `permissionGranted` field
anywhere, and the strict schemas refuse them.

The candidate states three obligations as literals: `requiresCoreRecipientResolution`,
`requiresCoreConsentRevalidation` and `requiresCoreExecutionTimeEligibilityRevalidation`, all `true`,
alongside `recipientResolvedByCore: false` and `consentEstablished: false`. A prepared candidate is
not permission; it is a note about what somebody else must still establish.

### 9. WhatsApp is already a governed channel, and this changes nothing about that

`whatsapp` has been a member of the shared `COMMUNICATION_CHANNELS` vocabulary since long before
AVG-6, and AVG-6 leaves it byte-identical. That membership is not what this file uses: the tokens
here are an Aarohi-local IDENTITY and TRANSITION vocabulary, this package imports no shared contract,
and nothing creates a communication request, an approval, an authorization or an intent. Naming the
destination channel of a transition is not activating it.

### 10. A containment scan was narrowed, deliberately and truthfully

Through AVG-5 the package banned the bare substring `whatsapp` in production source. AVG-6 writes it
— as an identity channel token, as `whatsappParticipantRef`, and as `whatsappSendRequested: false`.
The last is a declaration of absence, and the same argument that applied to `instagram` in AVG-5
applies here: a scan that read it as presence would force the contract to be renamed around a grep.

So the ban moved to the shapes that would constitute actually reaching WhatsApp — clients, SDKs,
hosts, `wa.me`, `whatsapp.com`, WABA and phone-number ids — and the destination ban was
**strengthened**: `phonenumber`, `e164`, `msisdn` and their variants are now banned outright, which
is what the bare `whatsapp` ban was really standing in for.

---

## What AVG-6 deliberately does not do

| Left out                                                                                  | Owner       |
| ----------------------------------------------------------------------------------------- | ----------- |
| Reply generation, objection handling, conversation interpretation, any model call         | AVG-7       |
| Package, pricing, discount, entitlement, offer truth                                      | AVG-8       |
| Registration integration                                                                  | AVG-9       |
| Payment, activation, Anisha ownership handoff                                             | AVG-10      |
| Persistence, dashboard, admin APIs, analytics, a durable identity store                   | AVG-11      |
| Any increase in autonomy                                                                  | AVG-12      |
| Shared executable channel adoption, `CommunicationRequestV1`, n8n route, provider adapter | **QFJ-P09** |

There is no database, migration, store, cache, scheduler, environment read, secret, HTTP client or
provider SDK. Dependencies are unchanged: `zod` alone.

---

## Consequences

Aarohi can now hold a reviewable opinion about whether two channel handles are one person, and still
cannot act on it.

The value is narrow and worth stating plainly. When QFJ-P09 builds the real governed execution
highway, it will attach to a domain that already treats identity evidence as untrusted, refuses to
merge anything, keeps a bounded deduplicated bundle whose parser certifies the whole aggregate,
re-runs the Core gate on every preparation, stores no destination at any point, and states every
non-effect as a machine-checked literal. The transport is the part that does not exist. The controls
around it are what this slice is.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts that the first consumer will be a deliberate decision.

**Production WhatsApp integration remains a separate, later, separately reviewed adoption.**
