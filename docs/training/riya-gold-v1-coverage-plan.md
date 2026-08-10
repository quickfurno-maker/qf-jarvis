# Riya HUMAN GOLD V1 — coverage plan

**Slice:** RID-F1 (plan only) · **Decision:** [ADR-0107](../decisions/ADR-0107-riya-intelligence-dataset-foundation-and-leakage-firewall.md) · **Companions:** [governance](./riya-intelligence-dataset-governance.md), [roadmap](./riya-post-training-roadmap.md)

**Nothing in this plan is generated in RID-F1.** This is the target the next slice authors against.
The `360` below appears nowhere in production source: it belongs to the Gold V1 release policy, which
is authored as data.

---

## The target

| Axis                             | Count                        |
| -------------------------------- | ---------------------------- |
| Language modes                   | 3 — English, Hindi, Hinglish |
| Primary interaction kinds        | 12                           |
| Trajectories per language × kind | 10                           |
| **Total**                        | **360**                      |

Typical depth: **4–12 assistant turns**, so 360 trajectories yield roughly 2,000–4,000 assistant
targets once SFT samples are derived.

### Why 360 and not 5,000

Enough diversity to cover the twelve situations in three languages with ten distinct takes on each,
and small enough that a domain expert can genuinely review every one. Reviewer attention is the
binding constraint on quality, not authoring throughput.

Ten thousand mediocre near-duplicates is the standard way this goes wrong: the corpus looks
impressive, the dedupe stats are ignored, and the model learns one phrasing very well.

### Why depth matters more than count

A single-turn corpus cannot teach the thing Riya is bad at without training — carrying context across
turns, not re-asking, choosing when to stop discovering and start proposing. Four to twelve assistant
turns is where those decisions actually appear.

---

## Per-language, per-kind allocation

Each of the twelve kinds gets ten trajectories in **each** language. Symmetry is deliberate: a thinner
Hindi or Hinglish set is how a system ends up measurably good in English and quietly bad everywhere
else, and it happens by drift rather than by decision.

Hinglish is authored as Hinglish — Latin script with Hindi structure, the way people actually type —
not as English with a few Hindi words dropped in.

Within each block of ten, vary:

- **persona** across `DECISIVE`, `EXPLORING`, `PRICE_SENSITIVE`, `PREMIUM`, `SKEPTICAL`,
  `BUSY_SHORT_REPLY`, `CONFUSED`, `FRUSTRATED`;
- **difficulty** across `BASIC`, `STANDARD`, `HARD`, `EDGE`, weighted toward `STANDARD` and `HARD`;
- **starting state** — some from an empty `INTRO`/`NEED`, some mid-conversation with facts already
  known and their provenance set.

Suggested per-block shape: 2 `BASIC`, 4 `STANDARD`, 3 `HARD`, 1 `EDGE`.

---

## Risk classes

Mark `HIGH_RISK` wherever a wrong answer becomes a commitment: price, discount, payment, warranty,
policy, consent, human handoff, complaint, business action, current availability, identity, privacy.

Expect roughly a third of the corpus to be `HIGH_RISK` — the three objection kinds are almost entirely
so, and `NEXT_STEP`, `HUMAN_REQUEST` and `GROUNDING_QA` contribute more. Those need **two** distinct
accepted reviews, so plan reviewer capacity around that rather than around the total.

---

## What every block should contain

Across the ten in a block, make sure at least one covers each:

- several facts stated in a single message;
- a fact already known and deliberately **not** re-asked;
- a correction of something said earlier;
- a turn where the right move is to answer, not to ask;
- a turn where the right move is to stop and hand off.

For `GROUNDING_QA`, `POST_SUMMARY_QA` and `COMPLETE_QA`, the answer must cite an authoritative context
fact. For `OUT_OF_SCOPE`, `HUMAN_REQUEST` and `COMPLETE_QA`, the turn must produce **no** discovery
observation — an out-of-scope request is not a source of leads.

---

## Authoring rules that are enforced, not advisory

- At most **one** discovery question per assistant turn. Zero on a handoff.
- Context precedes use: cite only facts already supplied.
- Synthetic references only — `service.alpha`, `city.beta`, `property.apartment`. No real package,
  price, vendor or customer.
- No email, phone, key, token, URL or governed production name, anywhere, including in fact values.
- No hidden reasoning field. The decision and the objective are the claim.
- A lineage lives in one split.

The validator reports all of these in one pass, so fix them in one pass.

---

## Split allocation

Assign by **lineage**, before authoring variants. A reasonable Gold V1 starting point:

| Split        | Share | Purpose                         |
| ------------ | ----- | ------------------------------- |
| `TRAIN`      | ~70%  | learning                        |
| `VALIDATION` | ~15%  | tuning and candidate comparison |
| `HOLDOUT`    | ~15%  | one final unlooked-at check     |

Keep the holdout balanced across languages and kinds, or it measures whatever happens to be in it.
And do not read it.

---

## Definition of done for Gold V1

- 360 trajectories, 24 blocks of ten... in the 3 × 12 arrangement above;
- every trajectory passes the deterministic gates;
- every trajectory reviewed to its risk class, by somebody other than its author;
- zero protected-exam leakage and zero unresolved quarantine;
- a sealed manifest and release evidence with `trainingApproval: false`;
- the coverage policy for Gold V1 authored as data, naming these minima explicitly.

Then, and only then, the roadmap's next step.
