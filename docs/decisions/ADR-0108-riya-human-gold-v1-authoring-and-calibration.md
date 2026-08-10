# ADR-0108 — HGV1-A: Riya Human Gold V1 authoring system and Wave-1 calibration

- **Status:** Accepted — HGV1-A implementation on branch, NOT MERGED
- **Date:** 2026-08-10
- **Depends on:** ADR-0107 (RID-F1 dataset foundation and leakage firewall), ADR-0106 (RWC-P10
  quality evaluation), ADR-0104/0105 (RWC-P8/P9), ADR-0052 (the generic evaluation foundation)
- **Baseline:** RID-F1 merged as PR #112 — merge commit
  `66d83756ffbcc247a4a56c5a177da11ac6c45872`. Migrations `0001`–`0012`. **HGV1-A adds none.**

## Context

RID-F1 built the factory. It can validate a corpus, isolate splits by lineage, refuse the exam,
refuse a phone number, refuse an unsupported price, and stamp a release with a SHA-256 identity. It
deliberately contains no content and no target — ADR-0107 §22 recorded the provisional shape of Human
Gold V1 and left `360` out of production source on purpose, to be authored as data by the slice that
owns it.

HGV1-A is that slice, and it authors the SYSTEM rather than the content.

The failure it exists to prevent is specific and common. A team decides it needs 360 conversations,
starts writing, and discovers at conversation 200 that the first hundred are all the same
conversation in different clothes — same opener, same three-question rhythm, same closing nudge, one
persona wearing eight names. Every individual example passed review. The corpus is still nearly
worthless, because what a model extracts from it is the formula, and it then produces the formula in
situations the formula does not fit.

The other failure is worse and quieter: somebody generates the conversations with a model, a human
skims and approves them, and the corpus is labelled `HUMAN_AUTHORED_SYNTHETIC`. From then on every
downstream claim about the dataset is false, and nothing in the system can tell.

## Decision

### 1. HUMAN-AUTHORED MEANS A HUMAN WROTE THE WORDS. This rule is permanent

A trajectory may be labelled `HUMAN_AUTHORED_SYNTHETIC` only if a person composed its sentences.

Generating dialogue with a model and labelling it human-authored is prohibited, permanently and
without exception. A human clicking "approve" does not retroactively make an AI-written trajectory
human-authored — provenance is a statement about who produced the words, not about who tolerated
them. Model-assisted expansion has its own provenance (`TEACHER_GENERATED_SYNTHETIC`), its own
governance, and its own later slice.

The Gold corpus validator applies the rule to what the artifact **declares**: any trajectory whose
source kind is not `HUMAN_AUTHORED_SYNTHETIC` produces a `NOT_HUMAN_AUTHORED` finding, and two
accepted reviews do not change that.

#### The trust boundary, stated exactly

**Human-authorship classification is enforced; physical authorship is process-attested, not
cryptographically inferred.**

What the code does:

- `source.kind` and `source.sourceRef` record the **declared** provenance, and they are bound into the
  trajectory artifact alongside the dialogue — the same SHA-256 identity covers all of it, so a
  provenance claim cannot be edited apart from the words it describes.
- Gold validation refuses declared teacher content outright.
- Review never reclassifies teacher content, at any review count.

What the code cannot do, and does not claim to:

- It cannot tell a human-written sentence from a model-written one. No deterministic text validator
  can, and **there is no AI-authorship detector here** — adding one would mean invoking a model to
  police a corpus built specifically to avoid that.
- A caller who deliberately declares AI-written dialogue as `HUMAN_AUTHORED_SYNTHETIC` commits a
  governance violation that the prose validator will not detect.

What makes the claim trustworthy is therefore process, not mathematics: a controlled authoring
workflow, provenance bound to the artifact, Git history naming who committed what, and independent
review by somebody other than the author. That is **auditability**, and it is the right standard for
this dataset. It is not proof, and this ADR does not pretend otherwise.

### 2. HGV1-A ships ZERO Gold dialogue

This PR contains no Wave-1 conversation, and no fixture pretending to be one. Adding 72 fabricated
"human-authored" trajectories to make the pipeline look finished would be exactly the failure §1
prohibits, committed by the slice that defines the rule.

What ships is the plan, the briefs, the policies, the validators, the review workflow, the progress
board and the calibration gate. Humans author Wave 1 in the next content PR.

### 3. The target is 360, as a 5 × 3 × 12 × 2 matrix

`5 waves × 3 languages × 12 primary interaction kinds × 2 per cell = 360`, and every one of those
factors is checked. Not "roughly 360 spread sensibly" — the plan is a generated table of 360
assignments, and the corpus is validated against it slot by slot.

`360`, `72`, `288` appear in production source only inside the Gold V1 slice
(`gold-v1/contracts/vocabularies.ts` and `gold-v1/policy/gold-policy.ts`). The generic RID-F1 factory
still knows nothing about Gold's size, and a containment spec restates that lock rather than dropping
it.

### 4. Waves are BALANCED, not sequential

Each wave is a complete 3 × 12 × 2 cross-section: 72 assignments, 24 per language, 6 per kind. No
wave is "the English wave" or "the objections wave".

This is what makes calibration possible at all. If Wave 1 were the easy English discovery cases, its
lessons would say nothing about Hindi objections, and the first honest signal about the corpus would
arrive at Wave 4 — too late to act on.

### 5. Waves 1–4 are TRAIN, wave 5 is VALIDATION, and Gold V1 has NO holdout

288 / 72 / 0.

A corpus committed to Git is visible to everyone authoring against the repository. Naming part of it
a holdout would be a comforting label on something untrue, and a validation set everyone has read is
at least honestly described. A genuinely sealed holdout needs a separately governed restricted store;
it is deferred rather than faked. RID-F1 still supports `HOLDOUT` generically — Gold V1 does not use
it.

Because wave 5 is the validation split and lineage isolation is enforced upstream, no wave-5 scenario
may be a variant of a wave-1–4 lineage.

### 6. Assignment identity is deterministic, stable, and in its own namespace

`gold.v1.w{wave}.{en|hi|hinglish}.{kind}.{01|02}` — for example
`gold.v1.w1.hi.objection-price.02`.

Regenerating the plan produces byte-identical assignments, so an id in a brief, a progress record or a
commit message means the same thing in six months. The namespace is the Gold slice's own: an id in
P10's namespace would collide with the exam in every tool that keys on ids, and the plan validator
refuses one.

### 7. One slot, one conversation: `trajectoryId` equals `assignmentId`

That is the entire mapping. A corpus therefore cannot quietly gain an extra example, skip a slot, or
fulfil the same slot twice, and the validator reports `TRAJECTORY_WITHOUT_ASSIGNMENT`,
`ASSIGNMENT_UNFULFILLED` and `ASSIGNMENT_USED_TWICE` separately, because they are three different
mistakes.

### 8. The two assignments in a cell must differ

Different persona, and a different difficulty or starting phase. Two takes on the same situation with
the same customer is one conversation written twice, which is the degeneration the matrix exists to
prevent — and it is easiest to commit precisely where the plan says "write two".

### 9. Diversity is a set of FLOORS, not quotas

Persona, difficulty, risk and depth minima are floors, and they deliberately do not sum to 360.

Forcing exact persona quotas would mean writing a `PREMIUM` customer asking a completed-intake process
question purely to balance a table. An unnatural scenario is worse than an uneven distribution: it
teaches a customer who does not exist.

Final floors: every persona ≥ 30; `BASIC` ≥ 50, `STANDARD` ≥ 150, `HARD` ≥ 100, `EDGE` ≥ 30;
`HIGH_RISK` ≥ 90, `STANDARD` risk ≥ 180. Wave 1 carries its own proportionate floors so calibration
runs against a genuinely representative wave.

### 10. Depth is 4–12 assistant turns, and the corpus spreads across the range

Below four turns an example teaches a reply; above twelve it teaches a transcript. The plan assigns a
target per slot and spreads Wave 1 across shallow (≤5), mid (6–8) and deep (≥9) bands.

A finished conversation may drift by one turn from its target when naturalness demands it. Beyond one
turn the validator reports `DEPTH_DEVIATION` — reported, not silently accepted, so a reviewer decides
whether the scenario genuinely needed it.

### 11. A BRIEF is a writing assignment, and cannot become a training row

A brief carries a customer situation, a conversation goal, required journey events, forbidden
shortcuts, an authority plan, a style plan and a review focus. It carries no dialogue.

The constructor refuses quotation marks and speaker prefixes (`Customer:`, `Riya:`) in its prose
fields, and there is no field a finished sentence would fit in. A brief cannot be parsed as a
trajectory. This is structural on purpose: briefs and trajectories live in one repository, and the
shortest path from "we need 360 conversations" to "we have 360 conversations" is to promote the
instructions into the corpus.

### 12. Wave-1 briefs are 72 INDEPENDENTLY authored scenarios

Not one scenario per kind translated into three languages. Every situation and every goal in the 72
is unique.

Cross-language clones would make the corpus look three times its real size and teach roughly a third
as much, and Hinglish especially would come out as English with Hindi words dropped in rather than
the way people actually type.

### 13. The exam corpus is PINNED at verification time, and never transcribed

The Gold release policy names the protected corpus opaquely (`protected.riya-quality-golden-v1`) and
takes its entry count and index digest from a `ProtectedTextIndex` the caller supplies. Tests and
authoring tooling load the real P10 corpus through its public testing subpath and build that index.

No P10 fixture identifier, no fixture text and no hard-coded entry count appears anywhere in the Gold
slice. Writing the digest in would freeze a value nobody could re-derive; writing the ids in would put
the exam in the shipped bundle, which is the exact failure the leakage firewall exists to catch.

### 14. Gold validation runs the FULL RID-F1 gate first, unchanged

Deep re-proof, lineage isolation, the protected-exam firewall, privacy, business-fact authority,
risk-based review and the release binding all run before any Gold-specific check. A Gold corpus that
is not a valid dataset is not a valid Gold corpus, and `goldEligible` requires both.

The matrix is what HGV1-A adds. A dataset can pass every generic gate and still be the wrong corpus —
300 discovery examples and 60 of everything else would sail through RID-F1 and be useless.

### 15. EVERY field the assignment fixes is checked, slot by slot

Split, language, primary kind, persona, risk class, **difficulty**, **starting phase**, provenance and
depth must each match the assignment, and each mismatch is its own finding. A single aggregate "does
not match" would tell an author to re-read their brief; a named finding tells them which field to fix.

An assignment field nobody validates is a field the corpus is free to drift on — and it drifts in one
direction, toward the easier conversation. An EDGE slot quietly rewritten as STANDARD, or a
mid-conversation `BUDGET_TIMELINE` opening rewritten as a fresh `INTRO`, satisfies the total, the
languages and the kinds while dropping exactly what the slot existed to teach.

Two further checks are structural rather than scalar:

- **Required secondary kinds** are a SUBSET check. An assignment naming `CORRECTION` as secondary
  says the conversation must contain a correction; an author who also produced a natural
  `GROUNDING_QA` moment has enriched the example, not violated it. Missing one is
  `REQUIRED_SECONDARY_KIND_MISSING`.
- **Required authority fact classes** are checked in two halves, because the two failures are
  different. `REQUIRED_AUTHORITY_CLASS_MISSING` means the authoritative context never supplied a fact
  of that class. `REQUIRED_AUTHORITY_CLASS_UNUSED` means it supplied one and no assistant turn ever
  cited it — a conversation about price where the price arrives and nobody mentions it is not the
  conversation the slot asked for, and it is exactly what an author produces when they write around a
  fact they found awkward.

These read the resolved trajectory structure. RID-F1 already proves citation order and authority
consistency, so nothing here re-derives that, and nothing here infers meaning from prose.

**Forbidden patterns stay human-reviewed.** `forbiddenPatterns` is on the assignment as an
instruction to the author and a focus for the reviewer. Where a deterministic scanner already owns a
pattern — privacy, secrets, hidden reasoning fields, multiple discovery questions in a turn — that
scanner enforces it. The rest (false urgency, canned openers, guilt) are judgement calls, and
pretending to enforce them with a keyword list would produce a check that misses the real cases and
fails the innocent ones, while telling reviewers they no longer need to look.

### 16. Formula degeneration is MEASURED, and reported rather than gated

Unique replies, exact repeated replies, repeated five-token openers and repeated five-token closers,
computed deterministically over the corpus.

Setting a threshold now would mean guessing what a healthy Gold corpus looks like before one exists,
and a guessed number is either so loose it never fires or so tight it blocks the first honest wave.
Wave-1 calibration sets the V1 threshold against real content. Short acknowledgements are excluded:
"Sure." recurring is normal human writing, and a metric that flagged it would be ignored within a
week.

### 17. WAVE-1 CALIBRATION IS A GATE. Waves 2–5 do not start until it passes

After Wave 1 is authored and reviewed, the calibration pass must produce: 72 accepted trajectories
fulfilling exactly the 72 Wave-1 assignments; zero matrix findings; zero protected-exam leakage; zero
privacy findings; zero unsupported business facts; every high-risk slot twice-reviewed; and a
repetition report a human has actually read and signed off, with the V1 degeneration threshold written
down.

Authoring 288 more conversations before knowing whether the first 72 are any good is how a corpus
becomes unfixable. The gate exists to make the expensive mistake cheap.

### 18. Calibration may change the PLAN. It may not change the RULES

Wave 1 is allowed to teach us that a difficulty mix is wrong, that a persona is unnatural in a
situation, that a depth target is too shallow, or that a brief was ambiguous. Waves 2–5 are
regenerated or re-briefed accordingly, and what changed is recorded.

What calibration may not do is relax §1, §2, §5, §13, §14 or the RID-F1 gates. "The firewall is
inconvenient at this scale" is not a calibration finding.

### 19. Review is risk-based, content-free and never by the author

Inherited from RID-F1 and restated because Gold is where it gets tested: one accepted review for a
standard slot, two distinct accepted reviews for a high-risk one, and never from the person who wrote
it. The progress board reports `highRiskAwaitingSecondReview` because that is the number that stalls
a wave.

### 20. The progress board is workflow metadata, carries NO content, and is validated AGAINST THE PLAN

Assignment id, status, trajectory reference, author reference, review count, last revision. No
dialogue, no reviewer name, no free-text note.

A progress record with a notes field becomes a place where conversation content lives outside the
corpus, unvalidated and ungated, and where a reviewer's opinion of a colleague is stored in Git
forever.

#### A record cannot police the review rule by itself

A record knows its status and its review count. It does not know its assignment's RISK CLASS — and
the requirement in §19 depends entirely on that. So `HIGH_RISK` slot, `ACCEPTED`, `reviewCount: 1` is
internally consistent and globally wrong, and wrong in the direction that hides itself: the slot
leaves the awaiting-second-review queue and joins the accepted count, so a wave looks finished while a
high-risk conversation has been read by one person.

`validateRiyaGoldV1ProgressBoard(records, assignments)` is therefore the authority. It holds the plan
and proves: the assignment exists; no slot has two rows; a drafted row's trajectory reference equals
its assignment id; a `STANDARD` acceptance carries at least one review; a `HIGH_RISK` acceptance
carries at least two. A row that fails any of these is **excluded from the summary** — counting it
anyway would mean the headline number reports work the same report has just refused.

Teaching the record constructor to infer risk from an id was the alternative and it is worse: two
sources of truth for the plan, and the wrong one is the one that is easy to reach. What a single
record _can_ contradict, it still checks itself — a `NOT_STARTED` slot is at revision zero, and a
drafted one is at one or more.

The corpus review gate remains the artifact authority. The board tracks work; it does not certify it.

### 21. The Gold slice is a SEPARATE subpath, and no runtime may import it

`@qf-jarvis/riya-intelligence-dataset/gold-v1`. The root surface is unchanged by HGV1-A and exports
nothing named Gold, so nothing on a production import path can reach the plan, the briefs or the Gold
policies. Runtime importers of the package are zero and stay zero.

### 22. HGV1-A invokes nothing, trains nothing and deploys nothing

No model, provider, gateway, judge, embedding, tokenizer or training framework. No HTTP, database,
migration, filesystem, clock or randomness. No migration is added; there is no `0013`. Nothing about
Wave-1 authoring touches the managed database, live WhatsApp, n8n or the QuickFurno repository.

### 23. No base model is named, still

The benchmark that chooses one has not run. Naming a model in an authoring brief would pre-empt it,
and the brief validator refuses one — model and provider names are in its reject list precisely so an
authoring instruction cannot smuggle one in.

### 24. Gold V1 acceptance is defined in advance

360 trajectories fulfilling the 360 assignments; every one human-authored; every one passing the full
RID-F1 gate; zero matrix findings; the Gold coverage policy satisfied; every high-risk slot
twice-reviewed; the repetition report within the calibrated threshold; a sealed manifest and release
evidence with `syntheticOnly: true` and `trainingApproval: false`.

Release evidence never starts a training run. That remains a separate, separately governed decision.

## Consequences

- The shape of the corpus is a checkable table before anyone writes a sentence, so a distribution
  defect costs an afternoon rather than two hundred conversations.
- Declared provenance is enforced rather than trusted, and the limit of that enforcement is written
  down instead of implied.
- A finished conversation must fulfil every field of its slot, so the corpus cannot drift toward the
  easier version of the plan while every count still looks right.
- A wave cannot report itself finished while a high-risk slot has been read by one person.
- Authors receive unambiguous, validated assignments instead of a rubric and a target number.
- The corpus cannot silently degenerate into one voice, because degeneration is measured.
- The first 72 conversations are allowed to change the plan for the remaining 288.
- Nothing in this slice can be mistaken for training data, and nothing can reach a runtime.

## Change-control rule

Owner-locked. Changing any of these requires a new ADR:

- human-authored means a human wrote the words, and no approval reclassifies AI-written dialogue;
- classification is enforced and physical authorship is process-attested — no AI-authorship detector,
  and no claim of cryptographic proof of who typed a sentence;
- every assignment field is validated against the finished trajectory, including difficulty, starting
  phase, required secondary kinds and required authority-fact classes (supplied AND cited);
- forbidden patterns without an existing deterministic owner stay human-reviewed rather than
  pretend-enforced;
- the Gold slice ships no dialogue of its own;
- 360 as 5 waves × 3 languages × 12 kinds × 2, with waves balanced rather than sequential;
- waves 1–4 TRAIN, wave 5 VALIDATION, no populated holdout in V1;
- one slot, one conversation, `trajectoryId` equals `assignmentId`;
- diversity minima are floors, never quotas;
- a brief carries no dialogue and cannot be parsed as a trajectory;
- the protected exam corpus is pinned by derived digest and count, never transcribed;
- the full RID-F1 gate runs first and unchanged, and `goldEligible` requires it;
- repetition metrics are reported, and the V1 threshold is set by Wave-1 calibration;
- Wave-1 calibration gates waves 2–5, and may change the plan but not the rules;
- review is risk-based, content-free and never by the author;
- the progress board carries no content and no reviewer name, and is validated against the plan, so a
  high-risk slot cannot be accepted on one review or counted after being refused;
- the Gold authoring system is an offline subpath no runtime may import;
- no model, provider, judge, embedding, tokenizer, training framework, migration or deployment;
- release evidence stays `syntheticOnly` with `trainingApproval: false`.
