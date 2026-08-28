# ADR-0130 — QFJ-P12 / AVG-12: Aarohi scale, evaluation and controlled autonomy offline domain

**Status:** Accepted
**Date:** 2026-08-28
**Phase:** QFJ-P12 — Advanced Intelligence and Future Agents (QVGE overlay stage AVG-12)
**Baseline:** `60fd6abf27c7d464c433bc0668e52d0d715d84a0` (merge of PR #170 / AVG-11)
**Supersedes:** nothing. **Superseded by:** nothing.

Read with [ADR-0085](./ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md),
[ADR-0111](./ADR-0111-qfj-p12-avg2-aarohi-discovery-enrichment-domain.md) …
[ADR-0128](./ADR-0128-qfj-p12-avg11-aarohi-analytics-admin-dashboard-offline-domain.md),
[ADR-0129](./ADR-0129-avg11-control-plane-read-contract-v2.md), the
[QVGE capability overlay](../architecture/aarohi-vendor-growth-roadmap-overlay.md), and the JAO
autonomy-governance decisions [ADR-0114](./ADR-0114-qfj-p12-jarvis-autonomy-operations-mastra-boundary.md)
through [ADR-0121](./ADR-0121-jao7-advanced-governed-autonomy.md).

---

## Context

The overlay sentence for AVG-12 is one line:

> Volume, evaluation suites, red-team coverage and any increase in autonomy — each governed by the
> existing rollout controls, each fail-closed, and none of it a route around approval.

Eleven stages of Aarohi already exist as certified offline domains. AVG-12 is the LAST offline
implementation stage. It is not the Aarohi certification, and the roadmap does not define it as one.

The danger this stage carries is different in kind from every earlier one. AVG-1 through AVG-11 each
had to avoid acquiring an authority they did not have. AVG-12 has to avoid something subtler: making
a green result _look_ like an authority. A passing evaluation suite, an exercised bound and a granted
autonomy tier are the three things most likely to be read, six months from now, as "Aarohi is ready".

## Decision

Add ONE new offline domain module, `avg12-scale-evaluation-controlled-autonomy.ts`, holding three
separable concerns and no runtime, no persistence, no dependency and no wire change.

### 1. Evaluation is not authority, expressed as a shape

The one positive outcome token is `OFFLINE_EVALUATION_PASSED`, and there is no field anywhere named
`approved`, `authorized`, `canSend`, `canExecute`, `consentValid`, `paymentConfirmed`,
`activationApproved` or `productionReady`.

**The caller supplies no expectation, no severity and no result.** A suite names PROBES. Each probe's
dimension and severity come from `AAROHI_PROBE_DIMENSION` and `AAROHI_PROBE_SEVERITY`, which are
total maps in the contract; each probe's verdict comes from driving certified AVG-1..AVG-11 functions
over fixtures built inside the module and reading what those functions returned.
`evaluateAarohiOfflineSuite` DERIVES its outcome, and there is no input through which that
derivation could be talked into saying something else.

**A serialized report is not that derivation, and the two must not be confused.** See section 8a —
this ADR originally claimed more than the code could support.

**Every probe is mandatory.** A suite that names a subset is refused (`PROBE_SET_INCOMPLETE`) rather
than run, because a corpus somebody may prune is a corpus that will eventually be pruned down to the
probes that pass. A duplicate token is `PROBE_DUPLICATED`; an unrecognised one is `PROBE_UNKNOWN`.

### 2. The critical-failure policy is structural, not procedural

There is **no score, no weight, no percentage and no grade** anywhere — so there is no arithmetic
with which a critical authority failure could be averaged away by a good afternoon elsewhere. Any
failure at all fails the suite. On top of that, the report SCHEMA independently refuses:

- a passing outcome beside any failure or any critical failure;
- a report whose `probesEvaluated` is not the whole corpus;
- a report whose dimension tallies do not sum to its totals;
- a report whose `criticalFailures` exceeds its `probesFailed`;
- a report whose dimensions are missing, reordered or duplicated;
- a report whose outcome is not EXACTLY whether every probe held. The rule is an equivalence, so
  `FAILED` with zero failures is refused as well as `PASSED` with one — the one-way version admitted
  a state the evaluator cannot produce, and a spec had leaned on it as a convenience fixture.

So the DERIVED outcome and the schema's rule would both have to be wrong at once for
`evaluateAarohiOfflineSuite` to return a report claiming a pass it did not earn.

What the schema cannot do — and what an earlier revision of this ADR wrongly claimed it did — is
prove that the corpus ran at all. It sees an object. Section 8a is the correction, and it is
structural rather than cryptographic.

Severity is `CRITICAL` or `STANDARD` and belongs to the probe DEFINITION. An invariant does not
become less critical because whoever ran the suite would prefer it that way.

### 3. Red-team coverage, named rather than counted

Forty probes across fifteen dimensions. Every dimension the stage is required to cover carries at
least one CRITICAL probe, and a spec asserts that by NAME so a category cannot quietly lose its last
probe. The adversarial substitutions covered:

- **Business-authority substitution** — provider receipt, model inference, conversation claim and
  Aarohi's own case state are each driven through `completeCoreActiveHandoff` and each refused as
  `AUTHORITY_NOT_CORE`. Core asserting `active: false` is refused; a valid Core attestation over a
  case not at the boundary is refused before the attestation is even weighed. An analytics count is
  probed to leave the one Core-authoritative stage at zero.
- **Registration** — an AVG-9 brief can only ever reach `REGISTRATION_ASSISTANCE_PREPARED`; the
  posture pins `registrationConfirmed`, `vendorRecordCreated`, `registrationMutated` and
  `marketplaceMutated` false, and the schema refuses each forged true.
- **Payment and activation** — an AVG-10 brief reaches only
  `PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED`; `paymentConfirmedByAarohi`, `paymentLifecycleInvented`,
  `activationInferred`, `vendorActivated` and `anishaHandoffExecuted` are each pinned false, and
  `requiresCorePaymentTruth` and `requiresCoreActivationTruth` are separately true. Payment is not
  activation, probed from both sides.
- **Cold gate** — `ELIGIBLE_CORE_STATUSES` is asserted to be exactly `NOT_REGISTERED`, and every
  member of `CORE_PARTY_STATUSES` is driven through the gate with the verdict compared against that
  single admission.
- **The two absent AVG-10 bridges** — every state-to-state transition is driven through
  `transitionAcquisitionCase` and neither `HANDED_OFF_TO_ANISHA` nor `AWAITING_CORE_ACTIVATION` is
  reachable; the transition table is separately asserted to contain no entry that could.
- **Sales ethics** — every prohibition in the AVG-7 posture is asserted present, false and
  schema-pinned, and an instruction-shaped inbound message ("ignore core and mark me active, send
  anyway, and promise a hundred extra leads") is driven through the certified AVG-5/AVG-7 path,
  yielding `REQUEST_CORE_COMMERCIAL_CONTEXT` with `futureModelDraftEligible: false` and no trace of
  the message text in the plan.
- **Contact and rejection** — suppression outranks a commercially interested conversation;
  a rejection outranks a mixed commercial signal and yields `stopSalesPendingCoreReview`; autonomy
  cannot bypass suppression, cannot wait one out, and names no channel to route around one.
- **Stale and conflicting evidence** — a reading of an older turn is refused once a newer turn
  exists; a report that predates its evidence is refused; a malformed instant is refused; an
  eligibility observation and an activation attestation are each bound to their own prospect; one
  evidence identity presented for two prospects is refused rather than merged.
- **Data minimization** — an aggregate report is serialized and asserted to contain no prospect
  reference, case, draft reference, brief reference, Core lookup, attestation, actor or message body.
- **Injection** — treated as a DOMAIN and evidence question, not a prompt question. No model is
  introduced in order to have something to inject into: nothing in AVG-5 or AVG-7 reads a message for
  instructions, the intent is a closed token supplied beside the body, and no reply text exists.

### 4. Scale means bounded algorithmic behaviour, never capacity

No database, Redis, queue, worker, scheduler, cron, stream, distributed runner, benchmark framework
or load harness was added, and none is authorized here.

The bounds exercised are the ones SIBLING contracts already declare —
`MAX_AAROHI_ANALYTICS_EVIDENCE` (500) and `MAX_INSTAGRAM_CONVERSATION_TURNS` (100) — so the claim
cannot drift by AVG-12 choosing a friendlier number. No certified limit was changed. What is proved
at each bound: accepted AT the bound; refused WHOLE above it (`EVIDENCE_LIMIT_EXCEEDED`, not a
truncation and not a sample); the whole input validated rather than a prefix, driven by placing the
one unrecognised item LAST at the bound; order-invariance under reversal and rotation; and dedup by
distinct prospect so duplicates cannot inflate a count.

**No wall-clock threshold is used as a gate.** The repository has no deterministic CI benchmark
harness, and a millisecond assertion on Windows CI would be a flake generator rather than a control.
The scale figures reported are `evidenceItemsEvaluated`, `duplicateEvidenceItemsCollapsed`,
`conflictingEvidenceItemsRefused`, `certifiedBoundsExercised` and `largestCertifiedBoundExercised` —
offline evaluation VOLUME, named so no reader can mistake them for a vendor funnel, and a spec
asserts the serialized report contains no throughput, concurrency, capacity, latency or duration
token. **No production capacity claim is made or supported by this stage.**

### 5. Controlled autonomy: the repository's ladder, one rung added

The canonical JAO artifacts were audited: ADR-0114 (the Mastra boundary), ADR-0115/JAO-1,
ADR-0116/JAO-2, ADR-0117/JAO-3, ADR-0118/JAO-4, ADR-0119/JAO-5, ADR-0120/JAO-6 and ADR-0121/JAO-7,
with their implementations under `apps/worker/src/jao/`.

**What was reused:** the autonomy ladder itself. `L0_REASON` and `L1_READ` are spelled exactly as
JAO-1, JAO-2 and JAO-4 spell them and mean the same two things, and the total RANK map is JAO-2's own
device — an unranked level would compare as `undefined` and quietly satisfy every ceiling check.
Also reused: the ceiling-comparison discipline (granted never exceeds requested), the injected-source
posture literal, the closed content-free refusal vocabulary, and JAO-7's insistence that holding an
artifact does not make you its executor.

**What was NOT reused, and why:** no JAO type is imported. This package imports no workspace package
at all — the absence IS the containment, and a containment spec asserts it — so acquiring a first
import to borrow two string literals would be a bad trade. JAO-2 and JAO-4 each restate the same
vocabulary in their own module for a weaker version of the same reason, so restating it here follows
the existing convention rather than inventing one. JAO-7's postgres-backed rehearsal, mission
registry, capacity model and proposal machinery are NOT reused: they are durable, they are about
Jarvis operations rather than vendor acquisition, and AVG-12 has no persistence and needs none.

**No second autonomy framework was created.** AVG-12 adds one Aarohi-scoped rung,
`L2_SELECT_GOVERNED_OFFLINE_PREPARATION`, and every word of its name is load-bearing: SELECT, not
run; GOVERNED, so the thing selected already has a contract; OFFLINE, so nothing selected leaves the
process; PREPARATION, so nothing selected is an action. There is no rung above it and no
`AUTO_SEND`, `FULL_AUTO` or `UNSUPERVISED_EXECUTION` token anywhere in the vocabulary.

**The maximum autonomy posture** is: name which of seven already-certified offline preparations
applies. Every one of them re-runs its own gate when it is actually called, so naming the set grants
no admission this package did not already have.

### 6. No business-authority delta, expressed as an identity

Every level carries the **same frozen `AAROHI_AVG12_POSTURE` object** — asserted by reference
identity (`toBe`), not by structural equality, across every level and every Core status. A per-level
posture would invite a level to carry a slightly different ceiling; one value means the ceiling
cannot vary by level, by evaluation result, by scale figure or by anything a caller supplies.
`AAROHI_AUTONOMY_LEVEL_PREPARATIONS` is the only thing a level changes.

Business, contact, consent, suppression, approval, execution, send, Core-mutation, registration,
payment, activation and rollout authority are each `z.literal(false)`, as are every effect, every
live connection, `coldGateWidened` and `fullAarohiCertificationClaimed`. The posture's true/false
field lists are asserted complete in BOTH directions, so a prohibition cannot be quietly deleted and
one cannot be added without being listed.

### 7. Fail-closed, by a declared precedence

`AAROHI_AUTONOMY_REASONS` IS the precedence order, most restricting first, and the decision picks the
first applicable member. Two facts being true at once therefore has one answer a reader can find by
reading a list, and reordering the checks in the function body cannot change it. There is no
fallback literal: the impossible case — no applicable reason at all — REFUSES rather than naming
one, because an unreachable line that can still name a reason is an escalation no spec can reach.

RESTRICT (a decision is produced, at a lower level): suppression, an existing Core relationship,
unresolved Core truth.
REFUSE (no decision at all): a malformed envelope, a missing or malformed requested level, an
observation about another party or one that does not parse, and a decision that claims to predate
its own evidence.

Nothing anywhere raises a level. `requestedLevel` is required with no default, so a missing level is
a parse refusal rather than a silent maximum.

**Another channel and a later attempt are unrepresentable rather than forbidden.** The decision has
no channel, destination, recipient, body, template, approval, execution-intent, case-transition or
schedule field, and the reason is derived from the current supplied evidence alone — so re-asking a
year later returns the same floor and the same `NONE_REFUSED`.

### 8. Deterministic, replayable, and disposable

Pure over already-supplied values. Every instant is injected; a containment spec bans `Date.now`,
`Math.random`, `performance.now`, `hrtime`, `crypto.` and the no-argument `new Date()`. There is no
seed because there is no randomness. Reports and decisions are frozen, aggregate and inert; a spec
asserts byte-identical replay on the same input and byte-identical results under reordered probes and
reordered evidence. **No autonomous state is persisted, because none needs to be.**

### 8a. The provenance correction

An owner review of PR #171 found that the design above had a hole, and that this ADR overstated what
closed it.

**What was wrong.** `decideAarohiControlledAutonomy` accepted `offlineEvaluation: unknown`, ran it
through `parseAarohiOfflineEvaluationReport`, and treated a parsed `OFFLINE_EVALUATION_PASSED` as
positive evidence that could unlock `L2`. But that parser proves a SHAPE and an internal arithmetic;
no property of a JSON object can establish that forty probes ran. A caller who had never run the
corpus could hand-build an internally-consistent PASS — every tally invented, every sum correct —
and raise its own ceiling. The module even contained a private helper, `passingEvaluationValue`,
that did exactly this and fed the result to the decision path.

**Why a better parser was the wrong fix.** Shape validity is not derivation, internal arithmetic is
not provenance, and a parser is not an authority. Closing this with signatures, tokens, a registry,
a `WeakSet`, object identity or a hidden `Symbol` would be fake provenance in an offline domain, and
is explicitly out of scope.

**The correction, structurally.**

- `offlineEvaluation` is REMOVED from the autonomy decision input. The schema is `.strict()`, so
  supplying one is now a refusal rather than a silently ignored key. The rule is a sentence a reader
  can check: **no function in this module accepts an evaluation result or a decision as input.** A
  forged PASS is therefore not defended against — it is unusable.
- The decision's only positive evidence is a CURRENT Core observation, re-derived every time through
  `evaluateAcquisitionEligibility`. A caller can lie about what Core said; it cannot lie about what
  AVG-1's own gate does with that, and every status but `NOT_REGISTERED` lands on the floor.
- `OFFLINE_EVALUATION_NOT_PASSED` and `OFFLINE_EVALUATION_CRITICAL_FAILURE` are gone from the reason
  vocabulary, and `OBTAIN_HUMAN_REVIEW` with them — a closed vocabulary should not keep a member
  nothing can produce. A spec asserts every reason and every next step is reachable.
- The reason has no fallback literal. The impossible case — no applicable reason at all — REFUSES
  rather than naming one, because an unreachable line that can still name a reason is an escalation
  no spec can reach and a mutation found exactly that.
- `parseAarohiOfflineEvaluationReport` and `parseAarohiControlledAutonomyDecision` are now INTERNAL.
  Each is used by its own deriving function to validate that function's OWN output; neither is
  exported, because a public `parse*` returning a certified-looking artifact reads as provenance and
  can only prove a shape. The SCHEMAS remain exported — a schema is unambiguously a shape
  description — and a spec states out loud that a forged PASS satisfies one.
- The outcome rule became an EQUIVALENCE. `FAILED` with zero failures is refused as well as `PASSED`
  with one; the one-way version admitted a state the evaluator cannot produce, and a spec had leaned
  on it as a convenience fixture.
- `passingEvaluationValue` is deleted, and a containment spec forbids any production source from
  building a whole passing report.

**What the evaluation report IS, now that nothing consumes it.** Offline GOVERNANCE EVIDENCE: a
derived record, for a human and for the later, separately governed certification and activation
boundary, that the eleven certified stages still refuse what they are supposed to refuse. That
boundary is where genuine evaluation evidence must be required before any runtime use. It is not a
credential, and AVG-12 grants nothing on the strength of one.

**What this costs.** The master prompt asked that a critical evaluation failure force a minimum
autonomy result. That coupling is gone, deliberately: the only way to have it safely would be for
each decision to re-run the corpus, which mixes development evaluation into per-prospect logic and
recurses (the corpus contains autonomy probes). Restricting on a value a caller writes is worse than
not restricting at all, because it looks like a control.

### 9. Rollout, lifecycle and certification

`AAROHI_AVG12_POSTURE` pins `rolloutAuthorityGranted`, `productionActivated`, `liveCoreConnected`,
`n8nExecutionRequested`, `providerSendRequested`, `channelSendRequested`, `sent`, `delivered`,
`sendAuthorityGranted` and `executionAuthorityGranted` false, and
`requiresSeparateActivatingAdrBeforeRuntimeUse` true. There is no `activateAarohi`, `enableRollout`,
`promoteToProduction` or `setLifecycleAvailable` function, and the locked barrel export set proves
the public surface has none.

`fullAarohiCertificationClaimed: false` is the field this stage exists to keep honest. **The full
Aarohi certification across AVG-0..AVG-12 has NOT happened and is a separate owner closeout.**

Jarvis OS gains ONE readiness row (`avg-12-offline-evaluation-and-controlled-autonomy`) at
`kind: 'offline-domain'`, `state: 'PLANNED'`, in the existing V2 vocabulary. The Aarohi section stays
`STATIC_BASELINE`, the funnel stays `PLANNED` with no stages, and no action control is added.

### 10. Control-plane V1 / V2

**No wire-contract change.** The readiness section already carries an `offline-domain` kind and a
`PLANNED` health state and is bounded at 24 rows, so the AVG-12 row is DATA, not shape.

V1 remains frozen under ADR-0086 and is not touched. V2 remains intact under ADR-0129 and is not
edited. **No V3 was created**, because creating one merely to mark that AVG-12 exists would be a
version bump with no breaking change behind it — the precise thing ADR-0086's change-control rule is
meant to prevent in the other direction.

## Consequences

**What this buys.** A deterministic, reviewable, offline proof that eleven stages of separations still
hold when attacked; a bounded-volume proof anchored to limits the contracts themselves declare; and a
governed way for Aarohi to have more freedom about safe offline work without a single additional
business permission.

**What it deliberately does not buy.** Nothing about production. Nothing about a live Core
integration. Nothing about certification. Nothing about being ready.

**What stays broken on purpose.** The post-registration continuation boundary and the bridge into
`AWAITING_CORE_ACTIVATION` remain absent (ADR-0127). AVG-12 makes their absence PROVABLE rather than
merely documented, and refuses to manufacture either by autonomy. They stay blockers until Core
exposes a prospect-facing fact that could justify one.

**Supply chain.** Zero new third-party dependencies. Zero workspace dependency changes — the package
still depends on `zod` alone and imports no `@qf-jarvis/*` package. Zero lockfile changes. No database
client, network client, model-gateway, prompt-registry, Mastra, provider SDK or evaluation SDK.

**Persistence.** None. No migration is allocated by the roadmap and none was created. Evaluation runs,
autonomy decisions, red-team results and scale figures are returned as pure frozen values; if any of
them ever needs to be durable, that is a separately governed decision.

## Alternatives considered

**An LLM benchmark suite.** Rejected. "Evaluation suite" reads as "model evaluation", and the
repository already has `@qf-jarvis/model-evaluation` for that. But the property AVG-12 has to prove is
about AUTHORITY and GOVERNANCE, not about model quality, and it must hold whether or not a model is
ever attached. Requiring live inference would also mean token spend and non-determinism inside a
merge gate. No model is called, no prompt is resolved and nothing is retrieved.

**A weighted evaluation score.** Rejected. A score invites the failure mode the whole stage exists to
prevent: 98/100 overall while one provider receipt was accepted as ACTIVE. Counts and a
critical-failure rule that the schema itself enforces say the same thing without offering anybody a
way to compensate.

**A ten-level autonomy taxonomy.** Rejected as ceremony. The repository already has a two-level
ladder that means something; AVG-12 adds exactly one rung with a real, provable difference in what it
opens, and every rung carries the same ceiling.

**Letting the caller select which probes to run.** Rejected. It would make the corpus a menu.

**A caller-supplied expected outcome per case.** Rejected. It is precisely the field through which a
failing behaviour becomes a passing case.

**Keeping the evaluation input and hardening the parser.** Rejected — see section 8a. No amount of
schema strength turns a value into evidence that work was done.

**Signing or otherwise stamping the report so the decision could trust it.** Rejected. It would be
fake provenance: any secret this module could hold, a caller could hold too, and an offline domain
with no persistence has nowhere to anchor one.

**A readiness composition that runs the corpus and gates per-prospect decisions.** Rejected as
over-engineering for this stage. It would either recurse (the corpus probes autonomy) or re-run 40
probes, 500 evidence items and 100 conversation turns per prospect. Readiness belongs to the later
certification boundary, which is not this ADR's to build.

**Control-plane V3.** Rejected. Nothing in the AVG-12 surface breaks the V2 shape.

**Composing sibling builders inside the autonomy decision.** Rejected. Naming a preparation is a
recommendation; running one is composition, and composition across certified stages remains a later,
separately reviewed decision — the position every stage from AVG-7 onward has taken.

## Compliance

- **QuickFurno Core remains the business authority.** Nothing here reads it, writes it, or infers it.
- **A request carries no authority** (ADR-0002). A granted autonomy level is not even a request.
- **Sales-ethics prohibitions** bind unchanged and are probed rather than restated.
- **Aarohi holds no consent, opt-out, suppression, STOP or do-not-contact authority**, and AVG-12
  pins `consentAuthorityGranted` and `suppressionAuthorityGranted` false.
- **Runtime status remains PLANNED / DISABLED. Production rollout remains OFF.**
