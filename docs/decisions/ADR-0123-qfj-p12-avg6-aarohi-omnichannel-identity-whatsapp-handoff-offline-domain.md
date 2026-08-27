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

A WhatsApp participant reference is an OPAQUE channel-local handle. Three screens apply and no one
of them is enough: the opaque character class refuses `@`, `/`, `+` and whitespace, which rules out
an address, a link and most written numbers; a conservative contact-shape screen — the same shapes
AVG-2 uses, named by SHAPE rather than by platform — refuses a dialable run of seven or more digits;
and a digit COUNT refuses seven or more digits anywhere in the reference, whatever separates them.
The same three screens apply to `sourceRef`, because provenance is a natural place to hide one.

**The third screen is an owner-review correction, and the reason it exists is worth keeping.** The
shape screen recognises the separators it was told about — whitespace, brackets, `.`, `+` and `-` —
and the opaque character class independently permits `_` and `:`. So `9_1_9_8_1_2_3_4_5_6_7_8` and
`91:98:12:34:56:78` were phone numbers walking through a screen whose stated promise was that no
destination is stored under any name. The fix counts digits rather than enumerating separators,
because a separator allowlist has to be right about every character the surrounding grammar permits
today AND after the next edit to that grammar, while a count does not care what is in between and
stays correct when the character class changes underneath it. Six digits is the threshold: the
shortest number anybody would recognise as dialable is seven.

**Its scope is narrower than the rule, deliberately.** The digit count applies to the WhatsApp
participant reference and to `sourceRef`. It does NOT apply to the Instagram participant reference,
which is AVG-5's certified channel-local grammar: AVG-5 accepts `ig.participant.9_1_9_8_1_2_3_4_5_6_7_8`
today, and tightening the same field here would mean a conversation AVG-5 certifies as canonical
could be refused by AVG-6 — a cross-stage incompatibility rather than a containment improvement, and
a silent change to a certified contract. The WhatsApp handle is the field a destination would
actually be going into, because it is the one that names the channel a message would eventually
leave by. A spec asserts both halves: the separated form is accepted as an Instagram handle and
refused as a WhatsApp handle and as a `sourceRef`, in the same test, so the asymmetry is a recorded
decision rather than an oversight.

The shared `CommunicationRequestV1` is built on the same principle: it names an opaque Core recipient
and carries no number either, because resolving an actual recipient is Core's job at execution time.
AVG-6 does not import it.

**A second mutation finding, from the owner-review round.** Adding the digit count MASKED the
dialable-run shape for the two fields that now carry both screens, and the mutation that drops the
shape stopped failing. The shape is not redundant: the Instagram participant reference keeps AVG-5's
grammar and has no digit count, so there the shape is the only thing between a bare phone number and
the package. The specs now assert that directly, and the mutation fails again. The same round masked
two more: the new bundle-versus-recommendation binding checks took over the refusal in the existing
cross-prospect specs, so the conversation binding stopped being exercised. The case that separates
them is a bundle and a recommendation that agree with each OTHER and disagree with the conversation,
and it is now a spec. All three were closed by strengthening the assertion, never by weakening the
mutation.

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

### 5b. A recommendation cannot predate the evidence it names

Also an owner-review correction. The evaluator accepted a `createdAt` without ever comparing it to
the `observedAt` of the claims it was reading, so it would happily issue a recommendation stamped
09:00 resting on evidence observed at 09:05. The `preparedAt >= createdAt` check on the candidate
does not repair this: it constrains a different pair of instants entirely.

The evaluator now requires `createdAt` to be at or after the latest evidence instant in the bundle,
compared as semantic UTC instants rather than as strings — optional milliseconds mean `09:00:00.500Z`
sorts before `09:00:00Z` lexicographically while being half a second later, and `09:00:00Z` and
`09:00:00.000Z` are one moment written twice. Both directions are asserted by specs.

It returns `undefined` rather than a `REVIEW_REQUIRED` recommendation. That is a deliberate choice
between two refusals: a review outcome is an identity JUDGEMENT about evidence somebody can go and
read, and filing an impossibility as a judgement would put it in front of a reviewer as though it
were one. An empty bundle names no evidence at all, so any `createdAt` remains coherent.

### 6. The handoff candidate is bound to the EVIDENCE, not to an object that describes it

`prepareWhatsAppChannelHandoffCandidate` requires a canonical AVG-5 conversation (through AVG-5's own
public parser, so a forged mixed-prospect snapshot is refused there and the refusal is inherited),
the canonical evidence BUNDLE, and a recommendation — and it re-runs the deterministic policy over
that bundle before it will read the recommendation's outcome.

**This is an owner-review correction, and it is the most important one in this ADR.** The first
AVG-6 head trusted a recommendation because it SAID `LINK_RECOMMENDED`. Everything about that object
was certified — strict schema, closed outcome, closed reason code, pinned posture, sorted unique
references, matching bindings — and none of it was evidence. A caller could hand-write a positive
recommendation naming two references that existed nowhere, and the builder had nothing to check it
against, because the evidence was not one of its arguments.

That is the general failure this whole architecture is arranged against: **a typed, parsed artifact
standing in for the provenance it merely describes.** A recommendation on its own is powerless, so
the defect was never in producing one; it was here, at the first point where a recommendation turns
into downstream semantic state.

So the bundle is a required input, it is parsed by the same public parser everything else uses, and
`evaluateCrossChannelIdentityLink` is re-run over it — seeded with the supplied recommendation's own
reference and instant, so the only thing that can differ is what the canonical policy concludes from
the canonical evidence. The result must reproduce the supplied recommendation EXACTLY: every field,
evidence references included, compared by value and never by object identity. Not "does it agree
about the outcome" — a forged positive with invented references agrees about the outcome. The
question is whether this exact evidence, under the canonical policy, produces this exact
recommendation. Only then is the outcome read, and it is the RE-EVALUATED outcome that is read,
because the derived value is the honest one to treat as authoritative.

**Three failure classes, three codes, kept apart on purpose.**
`IDENTITY_EVIDENCE_BUNDLE_INVALID` and `IDENTITY_RECOMMENDATION_INVALID` are shape failures.
`IDENTITY_LINK_NOT_RECOMMENDED` is an honestly evaluated `REVIEW_REQUIRED` — a person looking.
`IDENTITY_RECOMMENDATION_POLICY_MISMATCH` is a well-formed object whose provenance does not hold up.
A reviewer wants to tell those apart, and one vague code for all three would lose exactly the
distinction the new refusal exists to make.

The public recommendation schema was tightened alongside it: a `LINK_RECOMMENDED` recommendation must
name at least two supporting references. That is a LOCAL self-consistency floor and nothing more —
it stops an object literally claiming `SUFFICIENT_INDEPENDENT_SUPPORT` while naming zero or one piece
of evidence. It does not prove the policy was applied, and the ADR says so plainly: a schema is shown
one object, independence is a property of the SOURCES behind the referenced claims, and those live in
a bundle the schema was never given. Two invented references satisfy it. Only the re-evaluation above
proves anything.

There is no `body`, `message`, `template`, `prospectRef` or `whatsappParticipantRef` on the builder's
input, no verdict, no confidence and no "verified" flag — every one of those would be the caller
telling the function what the evidence means instead of showing it the evidence. A candidate is also
refused if its `preparedAt` precedes the `createdAt` of the recommendation it rests on; both are
caller-asserted canonical instants and no clock is read.

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
re-derives every identity recommendation from that exact bundle before acting on it, refuses a
recommendation that could not have rested on the evidence it names, re-runs the Core gate on every
preparation, stores no destination at any point — counted digit by digit, not merely pattern-matched
— and states every non-effect as a machine-checked literal. The transport is the part that does not exist. The controls
around it are what this slice is.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts that the first consumer will be a deliberate decision.

**Production WhatsApp integration remains a separate, later, separately reviewed adoption.**
