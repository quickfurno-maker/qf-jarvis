# Embedded Governance Contracts — Why They Were Not Re-Versioned, and How They Are Guarded

**Status:** Stage 3.1.4 verification record. **[ADR-0026](../decisions/ADR-0026-canonical-payload-privacy-boundary.md) — Accepted (2026-07-13).**
**Date:** 2026-07-13

---

## The claim being justified

Stage 3.1.4 moved **41 inherited canonical events** to version 2. It did **not** re-version the **15 governance contracts** those events carry — `RecommendationV1`, `ApprovalDecisionV1`, `ExecutionIntentV1` and the rest.

**That is a decision, and a decision with no stated reason is a decision nobody can review.** This document is the reason, and the tests named at the bottom are the proof.

> **The contracts' shapes were never the problem.** Not one of them has a `detail` field, an open `Record<string, unknown>` dictionary, or an unknown-key escape. Every one is already a strict object of declared, bounded fields.
>
> **What they lacked was a guard over the human-authored text inside them** — a recommendation's `rationale` is 2,000 characters of prose, and prose is where a coordinate hides. That guard is supplied by the **v2 event payload that carries them**, and it reaches all the way down.
>
> **Re-versioning fifteen contracts to fix a hole at the event boundary would have been ceremony, not safety** — fifteen new versions, fifteen migrations, fifteen sets of fixtures, and exactly zero additional bytes refused.

---

## The 15 contracts, and where each is carried

Every contract below is embedded in one or more **version 2** canonical events. Every one of those events is built with `contractPayloadV2(...)`, which wraps the payload in the deep prohibited-content guard.

| #   | Embedded contract                                                | Why its own structure needed no version bump                                                                                                                                                                                                                   | Carried by (all `@2`)                                                                      |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `RecommendationV1`                                               | Strict object. No free-text _field_ is unbounded; `summary` (280) and `rationale` (2000) are the governance text the contract exists for. No open dictionary — `parameters` is a **governed** JSON object that already refuses credentials and contacts by key | `qf.recommendation.created`                                                                |
| 2   | `RecommendationLifecycleRecordV1`                                | Strict. `explanation` is bounded governance text                                                                                                                                                                                                               | `qf.recommendation.lifecycle-state-recorded`                                               |
| 3   | `ApprovalDecisionV1`                                             | Strict. `explanation` bounded                                                                                                                                                                                                                                  | `qf.approval.decision-recorded`                                                            |
| 4   | `ExecutionIntentV1`                                              | Strict. `issuer`/`executor` are **literals** — the authority boundary is structural and unaffected by this stage                                                                                                                                               | `qf.execution.intent-issued`                                                               |
| 5   | `ExecutionResultV1`                                              | Strict. `description` bounded; `metadata` is a governed JSON object                                                                                                                                                                                            | `qf.execution.result-recorded`                                                             |
| 6   | `CommunicationStateRecordV1`                                     | Strict. `recipient` is an **opaque entity reference** — the correct design, and one this stage explicitly protects rather than punishes                                                                                                                        | `qf.communication.state-recorded`                                                          |
| 7   | `CommunicationAuthorizationV1`                                   | Strict. `explanation` bounded. Names a governance artifact, **not** a credential                                                                                                                                                                               | `qf.communication.authorization-recorded`                                                  |
| 8   | `CommunicationResultV1`                                          | Strict. `explanation` bounded                                                                                                                                                                                                                                  | `qf.communication.result-recorded`                                                         |
| 9   | `HumanHandoffRequestV1`                                          | Strict. `summary` bounded                                                                                                                                                                                                                                      | `qf.communication.human-handoff-requested`                                                 |
| 10  | `HumanHandoffRecordV1`                                           | Strict. `explanation` bounded                                                                                                                                                                                                                                  | `qf.communication.human-handoff-recorded`                                                  |
| 11  | `ClientReassignmentRequestV1`                                    | Strict. Carries a `ClientConfirmationV1` — the artifact that makes a replacement legitimate                                                                                                                                                                    | `qf.client.reassignment-requested`                                                         |
| 12  | `ClientReassignmentDecisionV1`                                   | Strict. `explanation` bounded                                                                                                                                                                                                                                  | `qf.client.reassignment-authorized`, `qf.client.reassignment-rejected`                     |
| 13  | `AssignmentBatchV1`                                              | Strict. Vendors are **entity references**; the 3-vendor cap and the no-overlap rule are enforced in the schema and are untouched here                                                                                                                          | `qf.assignment.batch-created`                                                              |
| 14  | `AdditionalServiceRequestV1`                                     | Strict. `summary` bounded                                                                                                                                                                                                                                      | `qf.client.additional-service-identified`                                                  |
| 15  | `LinkedLeadCreatedV1`                                            | Strict. Independence is asserted as four literals that can only be `true`                                                                                                                                                                                      | `qf.lead.linked-created`                                                                   |
| —   | `ErasureRequestV1` / `ErasureRecordV1` / `PolicyVersionChangeV1` | Strict; bounded `explanation`/`summary`                                                                                                                                                                                                                        | `qf.privacy.erasure-requested`, `qf.privacy.erasure-recorded`, `qf.policy.version-changed` |
| —   | `ClientConfirmationV1`                                           | Strict. Points at the canonical event in which the client **actually asked**                                                                                                                                                                                   | Nested inside 11, and carried by `qf.client.additional-service-confirmed`                  |

---

## How the guard reaches inside them

`withProhibitedContentGuard` is applied to the **whole payload**, not to individual fields:

```ts
export function withProhibitedContentGuard<T extends z.ZodType>(schema: T): T {
  const guarded = schema.superRefine((value, ctx) => {
    for (const issue of inspectProhibitedContent(value)) {
      // ← walks the ENTIRE payload
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
    }
  });

  GUARDED_SCHEMAS.add(guarded); // ← structural record, not a convention
  return guarded;
}
```

`inspectProhibitedContent` is a **deep** walk: every key at every depth is segment-matched against the prohibited vocabulary, every string at every depth is checked for contacts, coordinates, map links and credentials, and every two-element numeric array is checked for a coordinate pair. It is cycle-safe and depth-bounded, so a hostile payload gets **rejected**, never a stack overflow.

**So a coordinate written into `payload.recommendation.rationale` is refused** — at path `payload.recommendation.rationale`, by the event that carries the recommendation, without the recommendation contract knowing anything about it.

---

## Proving no v2 event bypasses the guard

A comment claiming "all payloads are guarded" is a claim, and a claim about 52 hand-written registry entries **will be false the first time somebody adds the 53rd without thinking.**

So the guard keeps a structural record. `withProhibitedContentGuard` adds every schema it wraps to a `WeakSet`, and `isGuardedPayloadSchema()` reports membership. The test then asserts it for **every registered payload schema**:

```ts
for (const key of CANONICAL_PAYLOAD_KEYS) {
  expect(isGuardedPayloadSchema(resolveCanonicalPayloadSchema(...))).toBe(true);
}
```

**A payload that skipped the guard fails the build**, not the next audit.

### The tests that hold this up

| Proof                                      | Test                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Every registered payload schema is guarded | `canonical-payload-privacy.test.ts` → _"every registered payload schema carries the guard"_                |
| The guard reaches nested governance text   | _"a coordinate inside an embedded contract's governance text is refused"_ — one case per embedded contract |
| Every v2 payload is strict                 | _"every registered v2 payload rejects an unknown key"_                                                     |
| Authority boundaries are unchanged         | `quickfurno-compatibility.test.ts` → the authority suite, unchanged and still passing                      |

---

## What this stage did **not** change about them

**Nothing.** No field was added, removed, renamed, widened or narrowed in any of the 15. The authority literals — `ExecutionIntentV1.issuer === 'quickfurno-core'`, `executor === 'n8n'` — are untouched, so **Jarvis still cannot construct a valid execution intent**. The assignment caps, the client-confirmation requirement, the linked-lead independence literals: all untouched.

**Canonical payload hardening grants no new authority, and removes none.**
