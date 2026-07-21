# QF Jarvis — MVP Capability Activation Matrix

**Status:** Canonical governance matrix for MVP capability activation. **Not implementation.** Adopted 2026-07-22 under [ADR-0042](../decisions/ADR-0042-mvp-and-post-mvp-delivery-overlay-and-controlled-launch-sequencing.md). Read with [qf-jarvis-mvp-post-mvp-delivery-overlay.md](../architecture/qf-jarvis-mvp-post-mvp-delivery-overlay.md) and [authority-routing-data-access-matrix.md](./authority-routing-data-access-matrix.md).

## Activation states

| State | Meaning |
| --- | --- |
| `DISABLED` | Present in design/code but not executing; produces no output. |
| `SHADOW` | Runs and is measured; output reaches no customer/vendor. |
| `HUMAN_APPROVAL` | Runs, but every consequential output requires human approval before it acts/sends. |
| `LIMITED_AUTONOMY` | Acts within tightly bounded, approved policy; anything outside bounds escalates. |
| `FULLY_ACTIVE` | Operates autonomously within its governed limits (still fail-closed; still no business authority beyond its ceiling). |
| `SUSPENDED` | Temporarily halted by a kill switch / incident; requires re-authorization to resume. |

> **A capability being implemented does not imply it is fully autonomous.** Launch states are deliberately conservative; states advance only through the evaluation and approval gates below.

## MVP capability activation

| Capability | Initial state | Activation owner | Required approval | Kill switch | Rollback | Evaluation gate | Authority boundary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jarvis coordination | LIMITED_AUTONOMY | Owner | QFJ-P04.04 pass + owner | global Jarvis pause | redeploy prior version | routing/consolidation eval | coordination only; no business authority |
| Riya conversation | HUMAN_APPROVAL → LIMITED_AUTONOMY | Owner | eval pass + owner cohort approval | AI pause (per-conversation + global) | disable agent → HUMAN_ONLY | grounding/refusal/multilingual eval | customer-only; no financial; no lead-allocation change |
| Anisha conversation | HUMAN_APPROVAL → LIMITED_AUTONOMY | Owner | eval pass + owner cohort approval | AI pause (per-conversation + global) | disable agent → HUMAN_ONLY | grounding/refusal/sales-ethics eval | vendor-only; no price/discount/entitlement/verification |
| Model gateway (Groq) | FULLY_ACTIVE | Owner | QFJ-P04.04 | Groq kill switch → HUMAN_ONLY | switch profile | structured-output validation | infra; authorizes nothing |
| Provider adapters — local / hybrid | DISABLED | Owner | Post-MVP ADR + eval | n/a (inactive) | remain disabled | per-provider parity | no business authority; data-class enforced |
| RAG + pgvector | LIMITED_AUTONOMY | Owner | knowledge lifecycle APPROVED→ACTIVE | disable retrieval → deterministic-only | retire knowledge version | RAG-quality eval | non-authoritative; never overrides live facts/consent |
| Memory | LIMITED_AUTONOMY | Owner | provenance rules frozen | disable write | replay from durable state | consistency checks | provider-independent; not authoritative memory |
| Commercial-policy engine | FULLY_ACTIVE (deterministic) | Owner | policy frozen by owner | suspend offers | revert policy version | policy conformance | deterministic; controls prices/offers/bands |
| Negotiation (model wording) | HUMAN_APPROVAL for exceptions | Owner | policy engine + human for exceptions | AI pause | disable negotiation | ethics/no-false-promise eval | may recommend; may not invent price/discount/commitment |
| Payment/refund workflow | HUMAN_APPROVAL | Owner + Core | Core authority + human approval | suspend workflow | cancel case | authority-boundary eval = 100% | agents never move money; Core executes |
| Vendor verification | DISABLED for agents (Core/human only) | Core | Core process | n/a | n/a | n/a | agents never verify vendors |
| Package activation / entitlements / credits | DISABLED for agents (Core only) | Core | Core process | n/a | n/a | n/a | agents never mutate |
| WhatsApp runtime | LIMITED_AUTONOMY | Owner | webhook + dedup + outbound-idempotency gates | AI pause / provider-outage handling | queue drain + redeploy | delivery reconciliation | delivery only via n8n; ack path not projection-dependent |
| Controlled-learning pipeline | SHADOW → HUMAN_APPROVAL | Owner | consent/retention + human review | disable pipeline | discard candidates | dataset eval | raw conversations never auto-train/alter production |
| LoRA / fine-tuning (Riya/Anisha) | SHADOW or NOT_YET_TRAINED | Owner | eval comparison + canary | disable adapter | rollback to base | shadow/canary eval | production activation is Post-MVP, not launch-required |
| Local custom model | INTERNAL_TEST or DISABLED | Owner | Post-MVP | n/a | remain disabled | internal eval | inactive at launch |
| Human control console | FULLY_ACTIVE | Owner | operator provisioning | n/a (is the control) | n/a | operator drills | takeover stops AI replies |
| Analytics (focused) | LIMITED_AUTONOMY (read-only) | Owner | none (read-only) | disable dashboards | n/a | data-quality checks | read-only; marketing analytics excluded |
| Resilience (active + warm standby) | LIMITED_AUTONOMY | Owner/ops | recovery test pass | failover halt | restore from backup | recovery drill | ops-gated; active-active is Post-MVP |

## Post-MVP capabilities (launch state)

All Post-MVP capabilities — advanced/marketing specialist agents, local & hybrid inference activation, production custom models, advanced RAG, voice/image/document, advanced commercial automation, advanced analytics, active-active multi-region, advanced Jarvis autonomy — are **`DISABLED`** at MVP launch and require a **separate ADR** plus their own evaluation and authority gates to advance. Deferred, not cancelled.

## Universal rules

- Every state advance requires its evaluation gate (QFJ-P04.04 where applicable) **and** the named approval; no capability self-promotes.
- Every consequential capability has a kill switch and a rollback; the universal fallback is `HUMAN_ONLY`.
- No agent capability grants financial, commercial, administrative, or destructive authority beyond its ceiling; QuickFurno Core remains the final business authority.
- `SUSPENDED` requires re-authorization to resume.
