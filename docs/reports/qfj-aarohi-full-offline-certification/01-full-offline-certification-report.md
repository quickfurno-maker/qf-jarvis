# Aarohi full offline certification — AVG-0 … AVG-12

**Governing decision:** [ADR-0131](../../decisions/ADR-0131-qfj-p12-aarohi-full-offline-certification-closeout.md).

---

## A. Baseline, lineage, branch, head

|                              |                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Certified baseline           | `d3c2d7c597eaf553c59f2f8f9a767deab353bb0d`                                                                                                                   |
| Baseline is                  | merge of PR #171, parents `60fd6abf27c7d464c433bc0668e52d0d715d84a0` + `a91baef9d22fe731b161df44cfb024f97d2f9231`                                            |
| PR #171                      | **MERGED** 2026-08-28T16:28:46Z                                                                                                                              |
| Exact-head CI for `a91baef`  | run `33188708898` — **success**                                                                                                                              |
| Branch                       | `qfj-aarohi-full-offline-certification-closeout`, cut from the baseline commit                                                                               |
| Rebase                       | none. `origin/main` was unmoved at branch time and is re-verified before the PR                                                                              |
| Pre-existing untracked paths | 29, recorded and untouched (`.mcp.json`, `CLAUDE_CODE_JAO*.txt`, `QFJ_AVG11_PR170_*.txt`, `docs/reports/qfj-managed-reconciliation-0002-0005/`, `qfj-*.ps1`) |

## B. Scope

This certifies exactly one sentence:

> **Aarohi AVG-0…AVG-12 is internally coherent and certified as an OFFLINE domain implementation
> under the existing governance boundaries.**

It is **not** AVG-13, not QFJ-P13, not a feature phase, not live Core integration, not provider/n8n/
channel integration, not deployment, and not production activation. Section M lists what it does not
prove.

## C. Read set inspected

Roadmap and governance: `qf-jarvis-roadmap-v3.md`, `aarohi-vendor-growth-roadmap-overlay.md`,
`agent-constitution.md`, `authority-routing-data-access-matrix.md`.

Binding decisions: ADR-0001, ADR-0002, ADR-0005, ADR-0006, ADR-0008, ADR-0085, ADR-0086.

Aarohi decisions: ADR-0111, ADR-0112, ADR-0113, ADR-0122 … ADR-0130 (including §8a).

JAO autonomy reference: ADR-0114 … ADR-0121 and `apps/worker/src/jao/*`.

Code: the Aarohi barrel and package manifest, `existing-vendor-gate.ts`, `acquisition-case.ts`,
`active-handoff.ts`, every AVG-2…AVG-12 contract, every Aarohi test including the containment and
public-API lock, control-plane V1/V2 contracts and their tests, and the Jarvis OS Aarohi readiness
surface and its tests. Merged code was read directly; no PR summary was taken on trust.

## D. Per-stage verdict

| Stage                                     | Verdict                    | The property that carries it                                                                                                                                                                             |
| ----------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AVG-0** governance                      | **PASS**                   | Constitution ceiling and authority matrix exercised as tests, not quoted                                                                                                                                 |
| **AVG-1** identity, gate, case, handoff   | **PASS**                   | Cold gate exactly `NOT_REGISTERED` over all 12 statuses; handoff singular; neither reserved state reachable; a prospect has no field a vendor identity could occupy                                      |
| **AVG-2** discovery / enrichment          | **PASS**                   | Enrichment is untrusted reference material; downstream eligibility re-derives the Core gate rather than inheriting a verdict                                                                             |
| **AVG-3** scoring / eligibility           | **PASS**                   | Score carries no permission-shaped field; eligibility takes no score input; unresolved Core truth fails closed                                                                                           |
| **AVG-4** outreach workspace              | **PASS**                   | Drafting is not sending; readiness re-checks the CURRENT gate; no request, approval, authorization or intent created                                                                                     |
| **AVG-5** Instagram offline conversation  | **PASS**                   | Shared executable channel vocabulary unwidened (still four members, no Instagram); inbound is untrusted observation; the candidate derives only from a canonical OPEN draft and inherits AVG-4's refusal |
| **AVG-6** omnichannel identity            | **PASS**                   | Recommendation only; a forged positive naming invented evidence is REFUSED because the policy is re-run over the canonical bundle; channel handoff ≠ ownership handoff                                   |
| **AVG-7** sales brain                     | **PASS**                   | Plan not message; latest-turn binding; stale reading refused; contact risk outranks selling; every ethics prohibition pinned                                                                             |
| **AVG-8** commercial truth                | **PASS**                   | Core's two prices exact and distinct; nothing derived, discounted or ranked; plan re-derived, not believed; a stale plan cannot be replayed                                                              |
| **AVG-9** registration assistance         | **PASS**                   | Assistance ≠ registration; admits only re-derived `REGISTRATION_PROCESS` intent; payment intent refused                                                                                                  |
| **AVG-10** payment / activation / handoff | **PASS**, gaps intentional | Payment ≠ activation; brief cannot parse as an attestation; both deliberate gaps still absent and unreachable (see L)                                                                                    |
| **AVG-11** analytics / admin read         | **PASS**                   | Workflow step ≠ business outcome; unknown ≠ zero; terminal metric re-runs the canonical handoff; a case asserted already handed off is refused                                                           |
| **AVG-12** scale / evaluation / autonomy  | **PASS** (post-§8a design) | Evaluator derives; no function accepts an evaluation result or a decision as input; forged PASS and forged L2 both inert; same zero-authority posture at every level                                     |

## E. Cross-stage adversarial results

All 25 owner matrix items are covered by
`packages/aarohi-agent/src/tests/full-offline-certification.test.ts`. **32 tests, all passing.**

Highlights worth a reviewer's eye:

- **Items 5 and 6 are the sharpest.** `REGISTRATION_PROCESS` and `PAYMENT_OR_ACTIVATION` reach the
  _same_ `REQUEST_CORE_PROCESS_CONTEXT` strategy, which is exactly why strategy cannot be the
  discriminator. Each plan is driven into the _other_ stage and refused by re-derived INTENT:
  `SALES_PLAN_NOT_PAYMENT_OR_ACTIVATION` and `SALES_PLAN_NOT_REGISTRATION_PROCESS`.
- **Items 10–13** drive all four representable substitute authorities through the canonical handoff;
  each is refused by name as `AUTHORITY_NOT_CORE` rather than incidentally.
- **Items 15 and 16** build a complete forged AVG-12 PASS and a complete forged L2 decision, then
  sweep _every exported function_ with each. None consumes either, and the autonomy input refuses
  them under four different field names because the schema is strict.
- **Item 22** is asserted as an absence: the barrel contains no certification token, flag or parser,
  so there is nothing for production code to read.

## F. Public API and provenance audit

230 exported symbols; 55 callable. Classified as schemas/types/constants, pure builders, evaluators,
parsers and transition boundaries.

| Question                                                                                  | Finding                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does any `parse*` imply provenance?                                                       | **No.** The two authority-adjacent artifacts — the AVG-12 evaluation report and the autonomy decision — have **no public parser** (ADR-0130 §8a made both internal). The 16 remaining `parse*` exports are shape parsers over upstream artifacts that a downstream stage **re-derives** rather than believes. |
| Can a builder be fed its own output back for a stronger result?                           | **No.** An AVG-8 brief handed in where a plan is expected is refused, and a plan whose Core observation has since turned hostile cannot be replayed.                                                                                                                                                          |
| Can a transition be reached by constructing a valid shape?                                | **No.** The handoff requires the boundary state the ordinary table cannot produce.                                                                                                                                                                                                                            |
| Can an authority-sensitive artifact be trusted by another function without re-derivation? | **No** — AVG-6 re-runs the identity policy, AVG-8/9/10 re-derive the AVG-7 plan, AVG-11 re-runs the canonical handoff, and AVG-12 accepts neither report nor decision.                                                                                                                                        |
| Is any callable named as an act of authority?                                             | **No.** Scan is over callables, not every symbol: a constant may legitimately say `PAYMENT`, because naming the domain a stage refuses to act in is what the postures are for.                                                                                                                                |

**Verdict: shape validity is not provenance — asserted, not assumed.**

## G. Authority audit

QuickFurno Core remains the final business, commercial, identity, consent, payment and activation
authority. Each of the following is separately proved to carry **no** authority: a request, a
priority score, a draft, a model-shaped interpretation, a conversation, a provider-like receipt, an
analytics count, an offline evaluation PASS, an autonomy level, and a schema-valid object.

Every autonomy level carries the **same frozen posture object** (asserted by reference identity, not
structural equality), so the delta between floor and ceiling is empty by construction.

## H. Data minimization audit

The two governed aggregates are serialized and searched. Neither leaks a prospect reference, Core
lookup, draft reference, actor, participant handle, message body or enrichment label; and neither
matches a 7+ digit run, an address shape or a URL shape. No PII is present in this report.

## I. Dependency and containment audit

|                                             |                                                                |
| ------------------------------------------- | -------------------------------------------------------------- |
| Third-party dependencies added              | **0** — `@qf-jarvis/aarohi-agent` still depends on `zod` alone |
| Workspace dependencies                      | **0** — the package imports no `@qf-jarvis/*` package          |
| Lockfile delta                              | **0**                                                          |
| Migrations / SQL / persistence              | **none**                                                       |
| DB, HTTP, provider, model or evaluation SDK | **none**                                                       |

The package-wide static containment scans (`containment.test.ts`, 48 tests) run beside the
certification suite and find no transport, store, credential, provider, n8n, Meta, model, prompt,
RAG, scheduler, queue or worker capability.

## J. Control-plane and Jarvis OS audit

V1 and V2 are both `mode: READ_ONLY`, and neither contains a `POST`, `PUT`, `PATCH`, `DELETE`,
mutation or command token. V1 never acquired any AVG-11/AVG-12 vocabulary. No V3 was created and no
V1/V2 shape changed. The Jarvis OS Aarohi readiness section is `STATIC_BASELINE` and every row is
`PLANNED`, `NOT_CONNECTED` or `DISABLED`; both deliberately-unbuilt bridges are still displayed as
blockers rather than omitted. **No control-plane or Jarvis OS file was changed by this closeout.**

## K. Real AVG-12 evaluator result

The certification suite runs the **real** evaluator over the whole corpus — no fixture, no forged
report:

|                                             |                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome                                     | `OFFLINE_EVALUATION_PASSED`                                                                                                                                                      |
| Probes evaluated / held / failed / critical | 40 / 40 / 0 / 0                                                                                                                                                                  |
| Dimensions                                  | 15                                                                                                                                                                               |
| Offline evaluation volume                   | `evidenceItemsEvaluated: 1989`, `duplicateEvidenceItemsCollapsed: 3`, `conflictingEvidenceItemsRefused: 2`, `certifiedBoundsExercised: 5`, `largestCertifiedBoundExercised: 501` |
| Bounds derived from siblings                | `MAX_AAROHI_ANALYTICS_EVIDENCE` = 500 (500 accepted / 501 refused whole), `MAX_INSTAGRAM_CONVERSATION_TURNS` = 100 (100 accepted / 101 refused)                                  |

**This is governance evidence only.** It is not a runtime credential, not a capacity or throughput
measurement, and it grants nothing: the posture it carries is the same powerless frozen value the
floor of the autonomy ladder carries, with `rolloutAuthorityGranted`, `productionActivated` and
`fullAarohiCertificationClaimed` all `false`.

## L. The intentional AVG-10 gaps

| Gap                                     | State                               |
| --------------------------------------- | ----------------------------------- |
| Post-registration continuation boundary | **absent, deliberately** (ADR-0127) |
| Bridge into `AWAITING_CORE_ACTIVATION`  | **absent, deliberately** (ADR-0127) |

Certification asserts they are still absent and still unreachable — by exhaustive transition driving,
by the transition table, and by the absence of any helper, analytics path, autonomy path or evaluation
path that reaches them. It does **not** assert they are solved.

They do not invalidate offline certification, because closing them requires a Core-authoritative
prospect-facing fact that does not exist in governed Jarvis evidence, and inventing one to make a
certification green is the exact failure this closeout exists to prevent. **They remain blockers for
the later live-integration decision**, and the Jarvis OS surface continues to display them as such.

## M. What this certification does NOT prove

Not production-ready. Not runtime-enabled. Not rollout-enabled. Not approved to send. Not approved to
contact. No consent established. No live Core connection. No provider connection. No payment
confirmed. No activation confirmed. No production Anisha handoff. No business, commercial or
execution authority. **No throughput or capacity claim of any kind** — the scale evidence is bounded
algorithmic behaviour at sibling-declared maxima, and nothing here was timed.

Runtime remains **PLANNED / DISABLED**. Production rollout remains **OFF**.

## N. Tests and gates

| Suite                                | Result         |
| ------------------------------------ | -------------- |
| Cross-stage certification (new)      | **32 passed**  |
| Aarohi package total                 | **676 passed** |
| Aarohi containment / public-API lock | **48 passed**  |
| Control-plane V1/V2 + Jarvis OS      | **292 passed** |
| Repository unit suite                | see §N-2       |

**N-1 — negative proof.** Twenty conceptual regressions were applied to the merged source and the
certification suite **alone** was run against each. **All 20 caught, 0 survivors.** Two of them
exposed genuine gaps in the first draft and were closed rather than explained away: an optional
`channel` field on the decision schema (no observable behaviour change) and a restored fallback
autonomy reason (structurally unreachable). Every mutated file was restored byte-identically
(sha256-compared). No mutation framework was installed; no dependency was added.

**N-2 — local gate.** `pnpm check` results are recorded in the PR body at the exact head. The known
Windows parallel timing flake in `apps/api/src/tests/deployment-containment.test.ts` is classified
with evidence — it passes in isolation at the same head — and no timeout was raised, no assertion
weakened, and no real failure relabelled. Exact-head Linux CI is the merge authority.

## O. Final verdict

**AAROHI FULL OFFLINE CERTIFICATION: PASS**

Scope as stated in section B. Next, in order and each separately governed: (1) real execution
integration, (2) staged activation. Neither is authorized by this certification, and neither may
cite it as authority.
