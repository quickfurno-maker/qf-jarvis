# Current QuickFurno AOS → QF Jarvis — Migration Map

**Status:** Analysis. **The current AOS bridge is untouched, and stays untouched until Phase 11.**
**Date:** 2026-07-13
**QuickFurno snapshot:** `quickfurno-maker/quickfurno-marketplace` @ **`00706899b46ae16fa6170c70125708b63e0926a9`**
**Decision:** [ADR-0025](../decisions/ADR-0025-quickfurno-compatibility-boundary-and-core-adapter-baseline.md) (Proposed)

> **The current AOS bridge is TRANSITIONAL. It is not the final integration, and this document does not call it one.**

All paths below are relative to the QuickFurno repository at the pinned snapshot.

---

## 1. What the current AOS actually is

A **preview-first agent scaffold with a best-effort n8n webhook bridge.** It is genuinely careful about not causing side effects — and it is genuinely **not a durable event source.** Both halves of that sentence matter.

| Property                      | Reality                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Writes to business tables** | **No.** AOS never touches `leads`, `vendors`, `lead_assignments`, credits, or `whatsapp_logs`. Its only writes are `aos_runtime_settings` (its own switch) and `lead_assignment_approvals` (a preview ledger) |
| **Calls an AI provider**      | **No.** Zero provider calls exist in `lib/aos/**`. `AOS_AI_ENABLED = false` and **there is no code path behind it**                                                                                           |
| **Emission**                  | **Fire-and-forget and lossy.** See §2                                                                                                                                                                         |
| **Delivery guarantee**        | **None.** No queue, no retry, no outbox, no dead letter. `databasePersisted: false`, always                                                                                                                   |
| **Agents**                    | 30 registered. **5** have real deterministic rule engines (`lib/aos/agents/engines.ts`); **22** are unreachable stubs whose `service.ts` has **zero importers**                                               |

**The AOS is safe because it does almost nothing — not because it is governed.** `lib/aos/kernel/permissionGate.ts` defines a `BLOCKED_ACTIONS` set, and `checkAgentPermission` has **zero callers**. It gates nothing. That is fine today, when there is nothing to gate. It is precisely the thing that must not be mistaken for an authorization layer later.

---

## 2. Emission semantics — why this cannot be the event source

| Behaviour                                | Evidence                                                                                                                                                                             | Consequence for Jarvis                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Not awaited at the main call site**    | `void emitLeadCreatedEvent({...})` — `services/leadService.ts:148`                                                                                                                   | The lead commits whether or not the event survives                                                       |
| **Never throws**                         | `runSafeAgentEventPipeline` wraps all in `try/catch`; the catch returns a **synthesized success** (`ok: true, status: "mocked"`) — `lib/aos/events/safeAgentEventPipeline.ts:93,153` | A failure is **indistinguishable from a success** to the caller                                          |
| **A non-2xx from n8n is reported as OK** | `sendEventToN8n` returns `createSafeN8nWebhookFailureResult(...)` → `ok: true, status: "mocked"` — `lib/aos/tools/n8nTool.ts:139-142,211-215`                                        | **A 500 from n8n looks exactly like "n8n is disabled."** The event is gone and nothing is red            |
| **Timeout mismatch**                     | Emitter gives up at `AOS_EMIT_TIMEOUT_MS = 3_000` (`emitLeadCreatedEvent.ts:22`); the webhook runs to `N8N_WEBHOOK_TIMEOUT_MS = 8_000` (`n8nTool.ts:18`)                             | The emitter logs "timed out" **while the request may still deliver** — a reported failure that succeeded |
| **No queue**                             | `queueEventForN8n` is a misnomer; `databasePersisted: false` — `lib/aos/sync/n8nSyncService.ts:184`                                                                                  | **A failed webhook is a permanently lost event**                                                         |
| **Fabricated ids**                       | `generateFallbackLeadId()` = `Date.now()` + `Math.random()` — `emitLeadCreatedEvent.ts:110-112`                                                                                      | **No stable idempotency key.** Redelivery cannot be recognised                                           |

> **An event that is permitted to vanish is not an event a downstream system may derive truth from.**
>
> This is the single most important finding in the compatibility read. A durable, replayable, idempotent event store fed by this bridge would be durable about **whatever happened to survive** — and would have no way of knowing what did not. **The [durable Core outbox](./quickfurno-core-adapter-design.md#a-durable-core-outbox) is not a refinement of this bridge. It is a replacement for it.**

---

## 3. Feature flags and the two-lock activation

**Lock 1 — environment** (`lib/aos/config/featureFlags.ts:28-29`, overridable via env at `n8nTool.ts:198-204`):
`N8N_ENABLED` **and** `N8N_OUTBOUND_WEBHOOK_ENABLED`, **both** required.

**Lock 2 — database** (`lib/aos/runtime/aosRuntimeSettings.ts:189-209`):
the `aos_n8n_master_router` row in `aos_runtime_settings` must be `enabled = true` **and** `mode = 'preview'`. Seeded off. Superadmin-only. `production_locked` is refused.

```ts
const runtimeReady = runtime.enabled && runtime.mode === 'preview';
const shouldCallN8n = envLock.bothEnabled && runtimeReady;
```

Both locks open ⇒ a **real `fetch()` POST** to `N8N_WEBHOOK_URL`. This is the only real outbound call in the AOS path, and the design is sound: two independent locks, one of which is not deployable by a code change alone.

> **The hardcoded `false` values are not the safety property.** `N8N_ENABLED` and `N8N_OUTBOUND_WEBHOOK_ENABLED` are **environment-overridable**, so the constants in `featureFlags.ts` describe the default, not the guarantee. `WHATSAPP_SENDING_ENABLED`, `CREDIT_DEDUCTION_ENABLED` and `AUTO_ASSIGNMENT_ENABLED` have **no env path** and require a code change — those three are genuinely hard-off.

### The side-effect report is cosmetic

`QuickFurnoSafeSideEffectReport` (`lib/aos/events/n8nEventTypes.ts:27-35`) has seven booleans. **Only `n8nWebhookCalled` is ever set true.** The other six (`whatsappSent`, `creditsDeducted`, `leadAutoAssigned`, …) are hardcoded `false` and **nothing reads them to decide anything.** It is a reporting struct that looks like a gate, which is the more dangerous of the two things to be.

---

## 4. Masking — real, partial, and not what the comment says

- The `lead` object carrying **raw name and phone** is built in `emitLeadCreatedEvent.ts:58-66`, but `normalizeSafeAgentEventPayload` (`safeAgentEventPipeline.ts:207-223`) **drops it entirely** — only `eventType`, `leadId`, `source`, `timestamp`, `safeData` are forwarded. **Raw PII never reaches n8n, by field-dropping rather than by masking.**
- The file's own comment — _"The pipeline masks phone numbers / secrets"_ (`emitLeadCreatedEvent.ts:52`) — **is wrong about the mechanism.** It is right about the outcome, which is why nobody has noticed.
- Real masking (`n8nTool.ts:243-248,344-350`) applies only to `data`/`metadata`: secret-like keys → `[redacted]`, phone-like keys and digit runs → masked.
- **`maskPhoneNumber` retains the last four digits** (`whatsappTool.ts:63-68`): `9999999999` → `******9999`. That is **partial masking, not redaction**, and last-4 is re-identifying when combined with a city and a category.

---

## 5. The event mapping

**21 n8n event names** are defined (`lib/aos/events/n8nEventTypes.ts:1-23`) — the real surface. **Only 12 are actually emittable**: `normalizeSafeEventType` (`safeAgentEventPipeline.ts:225-240`) **silently coerces any other name to `aos.failure`**.

Disposition legend: **retain** (a canonical event exists) · **rename** · **version** · **split** · **replace** (the mechanism changes, not just the name) · **deprecate** · **unsupported** (no Jarvis equivalent, and none is wanted).

| #   | Current n8n event                  | Emittable?    | Disposition     | Canonical Jarvis target                                              | Note                                                                                                                  |
| --- | ---------------------------------- | ------------- | --------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `lead.created`                     | ✅            | **replace**     | `qf.client.requirement-completed` **(gap: see below)**               | Core's "lead created" ≠ the canonical "requirement completed". **Contract gap**                                       |
| 2   | `lead.scored`                      | ✅            | **unsupported** | —                                                                    | Scoring is **Core's** (LeadLens). Kabir advises **alongside** it, and Jarvis does not ingest Core's score as an event |
| 3   | `lead.qualified`                   | ✅            | **replace**     | `qf.client.requirement-completed`                                    | Same target as (1); the two are Core lifecycle stages of one canonical fact                                           |
| 4   | `lead.clarification_required`      | ✅            | **gap**         | _none_                                                               | **No canonical clarification event exists.** Resolution: **Phase 11**                                                 |
| 5   | `lead.rejected_quality`            | ✅            | **gap**         | _none_                                                               | No canonical lead-rejection event. **Phase 11**                                                                       |
| 6   | `lead.assignment_preview`          | ✅            | **deprecate**   | —                                                                    | A _preview_ is an internal Core artifact, not a business fact. Nothing to ingest                                      |
| 7   | `lead.assignment_approved`         | ✅            | **replace**     | `qf.assignment.batch-created`                                        | **Closest real match.** Requires batch semantics Core does not have (§6)                                              |
| 8   | `lead.assignment_queued`           | ✅            | **deprecate**   | —                                                                    | Core-internal queue mechanics                                                                                         |
| 9   | `lead.assignment_queue_rechecked`  | ✅            | **deprecate**   | —                                                                    | Core-internal queue mechanics                                                                                         |
| 10  | `lead.assigned`                    | ❌ **orphan** | **replace**     | `qf.assignment.batch-completed`                                      | **Defined and workflow-mapped, but unroutable** — coerces to `aos.failure`                                            |
| 11  | `vendor.profile_interest_captured` | ✅            | **gap**         | _none_                                                               | Free-vendor interest has no canonical event. **Phase 11**                                                             |
| 12  | `vendor.recharge_prompt_preview`   | ✅            | **rename**      | `qf.vendor.recharge-opportunity-detected`                            | Canonical event **exists**. Must carry a **band, never a balance**                                                    |
| 13  | `vendor.replied`                   | ❌ **orphan** | **gap**         | _none_                                                               | **Phase 11**                                                                                                          |
| 14  | `client.followup_due`              | ❌ **orphan** | **rename**      | `qf.client.follow-up-due-detected`                                   | Canonical event **exists**                                                                                            |
| 15  | `client.rating_due`                | ❌ **orphan** | **rename**      | `qf.client.review-requested`                                         | Canonical event **exists**                                                                                            |
| 16  | `nurture.due`                      | ❌ **orphan** | **gap**         | _none_                                                               | Nurture is a **stub** in Core (`lead-nurture/service.ts` → `future_inactive`). **Phase 11**                           |
| 17  | `report.daily`                     | ❌ **orphan** | **unsupported** | —                                                                    | An internal report, not a business fact                                                                               |
| 18  | `vendor.low_credit`                | ❌ **orphan** | **rename**      | `qf.vendor.package-readiness-changed`                                | **Band, never a balance**                                                                                             |
| 19  | `complaint.created`                | ❌ **orphan** | **split**       | `qf.client.complaint-recorded` **or** `qf.vendor.complaint-recorded` | Core has **one** name; the canonical catalogue has **two**, by subject. Core must say which                           |
| 20  | `aos.failure`                      | ✅            | **unsupported** | —                                                                    | Core's operational telemetry. Not a business event, and Jarvis must not ingest it                                     |
| 21  | `whatsapp.status_updated`          | ❌ **orphan** | **replace**     | `qf.communication.state-recorded`                                    | Must come from the **Communication Core**, and carry one of the **18 communication states**                           |

**Also present, and not in the 21:**

- **`lib/aos/events/eventTypes.ts`** — four internal AOS types (`agent.task.queued`, `agent.task.completed`, `approval.requested`, `audit.logged`). **Dead code**: never emitted, never handled, `eventHandlers.ts` is a literal no-op. **Deprecate.**
- **`n8nPreviewWorkflowMap.ts`** — four display-only names (`lead.quality_preview`, `vendor.match_preview`, `client.followup_preview`, `ops.daily`). Route nothing. **Deprecate.**

### Every current event is accounted for

**21 n8n + 4 internal + 4 preview = 29 named events**, each with a disposition above. The manifest (`quickfurno-compatibility-manifest.json`) carries the same list, and a test asserts the two agree.

---

## 6. Where Core's model and the canonical model genuinely disagree

These are **not** naming problems, and an adapter cannot paper over them.

**Assignment is not batched in Core.** The canonical model is a **two-batch policy** — initial batch of at most 3 (`batchNumber: 1`), exactly one replacement batch of at most 3 (`batchNumber: 2`), **6 unique vendors per lead-category for all time, no overlap** ([ADR-0015](../decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md), [compatibility directive §4](../architecture/quickfurno-compatibility-directive.md)). Core has **no batch number, no replacement batch, and no lifetime cap.** For Core to emit `qf.assignment.batch-created`, Core must **acquire batch semantics** — a Core change, not a mapping.

**Replacement/reassignment does not exist in Core.** There is no replacement flow to map. The canonical model requires an explicit `ClientConfirmationV1` pointing at the event in which the client **actually asked**. Core has no such artifact.

**Communication state is 18 states in the canonical model.** Core's `whatsapp-status` endpoint accepts **any** status string with no enum validation, defaulting to `"unknown"` (`n8nSyncService.ts:256-271`) — **and updates nothing** (`databasePersisted: false`). It is a masking echo endpoint.

**Money must cross as bands, never balances.** Core's events carry credit counts. The canonical vendor events carry `low`/`medium`/`high`/`critical` — deliberately, because a balance in a Jarvis contract is stale by construction.

---

## 7. Documentation vs implementation drift found in Core

Recorded because a stale document is how a business rule quietly changes.

| #   | Claim                                                                      | Reality                                                                                                                                                                                                                                                                                                                  | Severity     |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | `README.md:42` — _"No WhatsApp sending yet."_                              | **FALSE.** `supabase/functions/whatsapp-dispatch/index.ts:43` POSTs to the **real Meta WhatsApp Cloud API v20.0**. Its **only** gate is the presence of `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`. It is Deno and **cannot** read the Next.js feature flags, so **`WHATSAPP_SENDING_ENABLED = false` does not restrain it** | **HIGH**     |
| 2   | `lib/aos/README.md:43` — _"No n8n webhook calls yet."_                     | **FALSE when both locks are open** — `n8nTool.ts:129` performs a real `fetch`                                                                                                                                                                                                                                            | Medium       |
| 3   | `emitLeadCreatedEvent.ts:52` — _"The pipeline masks PII."_                 | Right outcome, **wrong mechanism**: the pipeline **drops** the `lead` object; masking applies elsewhere                                                                                                                                                                                                                  | Medium       |
| 4   | `queueEventForN8n` (name)                                                  | **There is no queue.** No persistence, no retry. A failed event is lost                                                                                                                                                                                                                                                  | Medium       |
| 5   | `README.md:41` — _"No real AI yet."_                                       | **TRUE.** Verified: zero AI-provider calls in `lib/aos/**`                                                                                                                                                                                                                                                               | — (accurate) |
| 6   | 9 of 21 event names                                                        | Defined **and** workflow-mapped, but **unroutable** — they coerce to `aos.failure`                                                                                                                                                                                                                                       | Medium       |
| 7   | The `agents` preview block on every forwarded event                        | **Hardcoded** (`leadQuality: "warm"`, `score: 70`) — not computed. `buildSafeAgentPreview`, `safeAgentEventPipeline.ts:242-283`                                                                                                                                                                                          | Medium       |
| 8   | `lib/aos/approvals/*`, `kernel/permissionGate.ts`, `kernel/auditWriter.ts` | **Zero callers.** They gate, approve and audit **nothing**                                                                                                                                                                                                                                                               | Medium       |

> ### Finding #1 is the one to act on
>
> **A live WhatsApp send path exists that no AOS safety flag can stop.** The Next.js feature flags and the Deno Edge Function are in **different runtimes**, so `WHATSAPP_SENDING_ENABLED = false` is not a property of the system — it is a property of one half of it. Setting two Supabase secrets sends real messages to real people.
>
> This is a **QuickFurno-side** finding. Stage 3.1.2 may not fix it, and has not. It is recorded here, and it is **exactly the class of thing this compatibility read existed to surface**: a safety guarantee that everybody believes, that the documentation asserts, and that the code does not provide.

---

## 8. How the current bridge stays untouched until Phase 11

- The QuickFurno repository was **cloned read-only at a pinned commit** and **never written to**. No branch, no commit, no push.
- **Nothing in this stage disables, deprecates, or migrates the AOS bridge.** It keeps running exactly as it does today.
- The dispositions in §5 describe **what will happen at Phase 11**, and authorize nothing now.
- The durable outbox ([adapter design](./quickfurno-core-adapter-design.md)) is **additive**: Core gains an outbox alongside the AOS bridge. The bridge is retired **only after** the outbox is proven — never by cutting one over to the other in a single step.
